/*
 * Who is calling a staff endpoint: the staff pass.
 *
 * Purchase managers and kitchen executives act on FOFO orders from the
 * internal app, which cannot reach the fofo schema, so their screens call this
 * server (decision 0015). An admin proves who they are with a Supabase Auth
 * session (adminAuth.js). These two roles have none: they log in with a key,
 * and the internal app only remembers them in the browser. So the server checks
 * the key itself, once, and hands back a PASS that stands for "this person,
 * this role, this kitchen" on later requests. Decision 0023 explains the shape;
 * migration 21 holds the tables.
 *
 * THE PASS IS A BEARER TOKEN, NOT A COOKIE. Franchise sessions use an HttpOnly
 * cookie (franchiseAuth.js) because the partner app calls its own /api. The
 * internal app is a different site, and a cookie set from here would be a
 * third-party cookie there, which browsers increasingly refuse to send. So the
 * token goes back in the response, the internal app keeps it, and sends it as
 * `Authorization: Bearer <token>`. Two things follow:
 *   - no requireSameOrigin here. That check stops another website riding on a
 *     cookie the browser attaches by itself; nothing attaches a bearer token
 *     but the internal app's own code;
 *   - a script running in the internal app could read the token. That is the
 *     price, and why a pass reaches only FOFO staff actions and is re-checked
 *     against its user on every request.
 * Only the token's SHA-256 is stored (fofo.staff_passes).
 *
 * PASS LENGTH: 7 days, the same as the internal app's own key login (Login.jsx,
 * `expires_at`). The two start together at login, so they run out together and
 * staff are not asked for their key a second time. Keep the two the same: a
 * shorter pass means a key prompt on FOFO screens while still logged in. A pass
 * can still end early (resolve_staff_pass), and the internal app then asks for
 * the key again (frontend/src/lib/staffPass.js).
 *
 * A PASS SAYS WHO, NOT WHAT. requireStaff gives a role and a kitchen, read from
 * public.users on this request. An endpoint that touches an order must still
 * check `order.cloud_kitchen_id === staff.cloudKitchenId` itself: a purchase
 * manager of one kitchen must not act on another kitchen's orders.
 */
import { transaction } from './db.js'
import { HttpError, isUuid } from './http.js'
import { TOKEN_PATTERN, clientIp, hashToken, newToken, userAgent } from './request.js'

const PASS_MS = 7 * 24 * 60 * 60 * 1000

// The roles that act on FOFO orders. Mirrored in migration 21
// (staff_passes_role_known, issue_staff_pass) and in the internal app's
// lib/staffPass.js: change all three together.
export const STAFF_ROLES = ['purchase_manager', 'kitchen_executive']

// Real keys are 10 to 13 characters. Anything much longer is not a key, and is
// not worth a database round trip.
const MAX_KEY_LENGTH = 64

const staffFromRow = (row) => ({
  id: row.user_id,
  fullName: row.full_name,
  role: row.role,
  cloudKitchenId: row.cloud_kitchen_id,
  cloudKitchenName: row.cloud_kitchen_name,
  passExpiresAt: row.expires_at,
})

export const passView = (staff) => ({
  staff: {
    id: staff.id,
    full_name: staff.fullName,
    role: staff.role,
    cloud_kitchen_id: staff.cloudKitchenId,
    cloud_kitchen_name: staff.cloudKitchenName,
  },
  expires_at: staff.passExpiresAt,
})

/* ------------------------------------------------------------------ *
 * Getting a pass
 * ------------------------------------------------------------------ */

/**
 * Checks a login key for a role and kitchen and, if it is right, issues a pass.
 * The internal app calls this once, straight after a key login succeeds, with
 * the same three values it has just sent to authenticate_user_by_key.
 *
 * The check is fofo.issue_staff_pass, which is quiet (no auth audit event) and
 * throttled. The token is returned ONCE, here; it cannot be read back.
 */
export async function issuePass(req, body) {
  const loginKey = typeof body.login_key === 'string' ? body.login_key.trim() : ''
  if (!loginKey || loginKey.length > MAX_KEY_LENGTH) throw new HttpError(400, 'Enter your login key')
  if (!STAFF_ROLES.includes(body.role)) {
    throw new HttpError(400, 'Franchise orders are handled by purchase managers and kitchen executives')
  }
  if (!isUuid(body.cloud_kitchen_id)) throw new HttpError(400, 'Choose a cloud kitchen')

  const token = newToken()
  const expiresAt = new Date(Date.now() + PASS_MS)
  const { rows } = await transaction((db) =>
    db.query('SELECT * FROM fofo.issue_staff_pass($1, $2, $3, $4, $5, $6, $7)', [
      loginKey, body.role, body.cloud_kitchen_id, hashToken(token), expiresAt.toISOString(),
      clientIp(req), userAgent(req),
    ])
  )
  const result = rows[0]

  switch (result.outcome) {
    case 'ok':
      return { token, ...passView(staffFromRow({ ...result, expires_at: expiresAt.toISOString() })) }
    // One message for every way of being wrong, as the function gives one outcome.
    case 'bad_key':
      throw new HttpError(401, 'That login key is not right for this role and cloud kitchen')
    case 'throttled':
      throw new HttpError(429, 'Too many wrong login keys. Wait 15 minutes and try again.')
    default:
      throw new Error(`Unexpected staff pass outcome: ${result.outcome}`)
  }
}

/* ------------------------------------------------------------------ *
 * Who is asking
 * ------------------------------------------------------------------ */

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null
}

/** The staff member holding the request's pass, or null. */
export async function currentStaff(req) {
  const token = bearerToken(req)
  if (!token) return null
  const { rows } = await transaction((db) =>
    db.query('SELECT * FROM fofo.resolve_staff_pass($1)', [hashToken(token)])
  )
  return rows.length ? staffFromRow(rows[0]) : null
}

/**
 * The staff member holding the request's pass, or HttpError 401 (no pass, or
 * one that has run out or been ended) or 403 (a real pass, the wrong role).
 * Every staff endpoint starts here.
 *
 *   const staff = await requireStaff(req, ['purchase_manager'])
 *
 * `roles` is who may use the endpoint; left out, either role may. The 401 is
 * what the internal app listens for to ask for the key again, so nothing else
 * in a staff endpoint should answer 401.
 *
 * Resolved in its own transaction, before the endpoint's work, so a pass that
 * resolve_staff_pass ends on the way stays ended. The work that follows must
 * check the order's kitchen against `staff.cloudKitchenId` (see the header).
 */
export async function requireStaff(req, roles = STAFF_ROLES) {
  const staff = await currentStaff(req)
  if (!staff) throw new HttpError(401, 'Enter your login key to continue')
  if (!roles.includes(staff.role)) throw new HttpError(403, 'Your role cannot do this')
  return staff
}

/** Signing out of the internal app. Always succeeds. */
export async function endPass(req) {
  const token = bearerToken(req)
  if (token) {
    await transaction((db) => db.query('SELECT fofo.end_staff_pass($1)', [hashToken(token)]))
  }
  return { ended: true }
}
