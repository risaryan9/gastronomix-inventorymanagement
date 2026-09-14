/*
 * Franchise users' sessions: sign in, sign out, who is asking, and password
 * reset. Decision 0018 explains the shape; migration 14 holds the tables.
 *
 * THE COOKIE. `__Host-gx_session`, holding 32 random bytes:
 *   HttpOnly   no script on the page can read it, so an XSS bug cannot steal it
 *   Secure     HTTPS only (browsers treat http://localhost as secure too)
 *   SameSite=Lax  not sent on another site's POST, which with the Origin
 *              check below is the defence against cross-site request forgery
 *   __Host-    no Domain, Path=/ — a subdomain cannot set or overwrite it
 * Only the token's SHA-256 is stored (fofo.franchise_sessions).
 *
 * SESSION LENGTH: 7 days from sign-in, then sign in again. A franchise user
 * orders a few times a week; a week keeps them signed in between orders
 * without leaving a forgotten laptop signed in for months.
 */
import { transaction } from './db.js'
import { HttpError } from './http.js'
import { partnerAppUrl } from './email.js'
import { clientIp, hashToken, newToken, requireEmail, requireNewPassword, userAgent } from './request.js'
import {
  checkPassword,
  endSupabaseSession,
  sendPasswordResetEmail,
  setPasswordWithToken,
  userForToken,
} from './supabaseAuth.js'

const COOKIE = '__Host-gx_session'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000

/* ------------------------------------------------------------------ *
 * Cookies and origin
 * ------------------------------------------------------------------ */

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader?.('Set-Cookie')
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie)
}

const setSessionCookie = (res, token, expiresAt) =>
  appendSetCookie(res, `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}`)

const clearSessionCookie = (res) =>
  appendSetCookie(res, `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`)

/**
 * Refuses a state-changing request from another website. Browsers send
 * Origin on every POST; a request with no Origin is not from a browser page,
 * and carries no victim's cookie unless that client chose to send one.
 */
export function requireSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return
  const origin = req.headers.origin
  if (origin && origin !== new URL(partnerAppUrl()).origin) {
    throw new HttpError(403, 'This request did not come from Gastronomix Partners')
  }
}

/* ------------------------------------------------------------------ *
 * Who is asking
 * ------------------------------------------------------------------ */

/** The signed-in franchise user, or null. */
export async function currentFranchiseUser(req) {
  const token = readCookie(req, COOKIE)
  if (!token) return null
  const { rows } = await transaction((db) =>
    db.query('SELECT * FROM fofo.resolve_franchise_session($1)', [hashToken(token)])
  )
  if (!rows.length) return null
  const row = rows[0]
  return {
    franchiseUserId: row.franchise_user_id,
    franchiseId: row.franchise_id,
    email: row.email,
    franchiseName: row.franchise_name,
    sessionExpiresAt: row.expires_at,
  }
}

/**
 * The signed-in franchise user, or HttpError 401 — clearing a dead cookie on
 * the way, so the browser stops sending it. Every franchise endpoint starts
 * here, and scopes every query to the `franchiseId` it returns — never to a
 * franchise named in the request.
 */
export async function requireFranchiseUser(req, res) {
  const user = await currentFranchiseUser(req)
  if (user) return user
  if (readCookie(req, COOKIE)) clearSessionCookie(res)
  throw new HttpError(401, 'Sign in to continue')
}

export const sessionView = (user) => ({
  user: { id: user.franchiseUserId, email: user.email },
  franchise: { id: user.franchiseId, name: user.franchiseName },
  session_expires_at: user.sessionExpiresAt,
})

/* ------------------------------------------------------------------ *
 * Sign in and out
 * ------------------------------------------------------------------ */

const INCORRECT = 'Incorrect email or password'

export async function signIn(req, res, body) {
  requireSameOrigin(req)
  const email = requireEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password) throw new HttpError(400, 'Enter your password')
  const ip = clientIp(req)

  const throttled = await transaction(async (db) => {
    const { rows } = await db.query('SELECT fofo.sign_in_throttled($1, $2) AS throttled', [email, ip])
    if (rows[0].throttled) {
      await db.query('SELECT fofo.record_sign_in_attempt($1, $2, false, $3)', [email, ip, 'throttled'])
    }
    return rows[0].throttled
  })
  if (throttled) {
    throw new HttpError(429, 'Too many unsuccessful attempts. Wait 15 minutes, or reset your password.')
  }

  const checked = await checkPassword(email, password)
  if (!checked) {
    await transaction((db) =>
      db.query('SELECT fofo.record_sign_in_attempt($1, $2, false, $3)', [email, ip, 'bad_credentials'])
    )
    throw new HttpError(401, INCORRECT)
  }

  // The Supabase session has done its job — the password is right. End it so
  // no refresh token outlives this request.
  await endSupabaseSession(checked.accessToken)

  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_MS)
  const { rows } = await transaction((db) =>
    db.query('SELECT * FROM fofo.start_franchise_session($1, $2, $3, $4, $5, $6)', [
      checked.authUserId, email, hashToken(token), expiresAt.toISOString(), ip, userAgent(req),
    ])
  )
  const result = rows[0]

  switch (result.outcome) {
    case 'ok':
      setSessionCookie(res, token, expiresAt)
      return sessionView({
        franchiseUserId: result.franchise_user_id,
        franchiseId: result.franchise_id,
        email: result.email,
        franchiseName: result.franchise_name,
        sessionExpiresAt: expiresAt.toISOString(),
      })
    // A valid Supabase login that is not a franchise user — an internal admin
    // trying the partner app. Indistinguishable from a wrong password.
    case 'not_a_franchise_user':
      throw new HttpError(401, INCORRECT)
    case 'user_inactive':
      throw new HttpError(403, "This login has been deactivated. Ask your franchise's main contact or Gastronomix to restore it.")
    case 'franchise_inactive':
      throw new HttpError(403, `${result.franchise_name} is not active on Gastronomix Partners. Contact Gastronomix.`)
    default:
      throw new Error(`Unexpected sign-in outcome: ${result.outcome}`)
  }
}

export async function signOut(req, res) {
  requireSameOrigin(req)
  const token = readCookie(req, COOKIE)
  if (token) {
    await transaction((db) =>
      db.query('SELECT fofo.end_franchise_session($1, $2, $3)', [hashToken(token), clientIp(req), userAgent(req)])
    )
  }
  clearSessionCookie(res)
  return { signed_out: true }
}

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

/**
 * Emails a reset link — only to an active franchise user, so the partner app
 * cannot be used to trigger resets for internal admins, who share the Auth
 * project. The answer is the same whether or not one was sent.
 */
export async function requestPasswordReset(req, body) {
  requireSameOrigin(req)
  const email = requireEmail(body.email)

  const eligible = await transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT 1 FROM fofo.franchise_users u
         JOIN fofo.franchises f ON f.id = u.franchise_id
        WHERE u.email = $1 AND u.is_active AND f.is_active AND f.deleted_at IS NULL`,
      [email]
    )
    return rows.length > 0
  })

  if (eligible) await sendPasswordResetEmail(email, `${partnerAppUrl()}/reset-password`)

  return { message: 'If that email belongs to a Gastronomix Partners login, a reset link is on its way.' }
}

/**
 * Sets a new password with the recovery token Supabase put in the reset link,
 * then ends every partner-app session the user had.
 */
export async function completePasswordReset(req, body) {
  requireSameOrigin(req)
  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  if (!accessToken || accessToken.length > 4096) {
    throw new HttpError(400, 'This reset link is not valid. Request a new one.')
  }
  const password = requireNewPassword(body.password)

  const user = await userForToken(accessToken)
  if (!user) throw new HttpError(410, 'This reset link has expired or been used. Request a new one.')

  // Only franchise users reset through the partner app.
  const isFranchiseUser = await transaction(async (db) =>
    (await db.query('SELECT 1 FROM fofo.franchise_users WHERE auth_user_id = $1', [user.id])).rowCount > 0
  )
  if (!isFranchiseUser) throw new HttpError(403, 'This account does not use Gastronomix Partners')

  await setPasswordWithToken(accessToken, password)

  await transaction((db) =>
    db.query('SELECT fofo.end_all_franchise_user_sessions_for_password_reset($1, $2, $3)', [
      user.id, clientIp(req), userAgent(req),
    ])
  )
  // Any Supabase session behind the recovery link goes too.
  await endSupabaseSession(accessToken, 'global')

  return { message: 'Your password has been changed. Sign in with your new password.' }
}
