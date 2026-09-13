/*
 * Who is calling an admin endpoint.
 *
 * Admins log into the internal app with Supabase Auth, so their browser holds a
 * Supabase access token. They send it as `Authorization: Bearer <token>`, and
 * the server checks two things (decision 0015):
 *
 *   1. The token is real and current — by asking Supabase Auth who it belongs
 *      to. That also catches a token revoked by signing out, which checking the
 *      JWT signature locally would not.
 *   2. That person is an active admin in public.users. Being signed in to
 *      Supabase is not enough: the internal app's login only lets admins
 *      through, but the Auth project is shared and the check belongs here too.
 *
 * The admin's public.users id is what the fofo functions receive as the actor,
 * and they check it once more themselves.
 *
 * Purchase managers and kitchen staff log in by key, not Supabase Auth; their
 * check is a different module, built with the accept flow.
 */
import { HttpError } from './http.js'

async function authUserIdForToken(token) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')

  let response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: key },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    throw new Error(`Could not reach Supabase Auth: ${err.message}`)
  }

  // 401/403: expired, revoked or forged. Anything else is Supabase's problem,
  // not the caller's, and must not read as "you are logged out".
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error(`Supabase Auth answered ${response.status}`)

  const user = await response.json()
  return typeof user?.id === 'string' ? user.id : null
}

/**
 * Step 1: the Supabase Auth user behind the request's bearer token, or
 * HttpError 401. Done before opening a database transaction, so a slow answer
 * from Supabase never holds a pooled connection.
 */
export async function authUserIdFromRequest(req) {
  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) throw new HttpError(401, 'Sign in again to continue')

  const authUserId = await authUserIdForToken(match[1])
  if (!authUserId) throw new HttpError(401, 'Your session has expired — sign in again')
  return authUserId
}

/**
 * Step 2, inside the request's transaction: `{ id, fullName }` for an active
 * admin, or HttpError 403 (signed in, but not an active admin).
 */
export async function requireActiveAdmin(db, authUserId) {
  // public.users.id is the Supabase Auth user id for admins (Login.jsx).
  const { rows } = await db.query(
    `SELECT id, full_name
       FROM public.users
      WHERE id = $1 AND role = 'admin' AND is_active = true AND deleted_at IS NULL`,
    [authUserId]
  )
  if (!rows.length) throw new HttpError(403, 'Only an active admin can do this')

  return { id: rows[0].id, fullName: rows[0].full_name }
}
