/*
 * Every call the server makes to Supabase Auth.
 *
 * Supabase Auth owns franchise users' passwords: it stores them, checks them,
 * and sends password-reset emails. It does not own their sessions — the
 * partner app does (decision 0018) — so a Supabase token obtained here is used
 * once and then ended, never handed to the browser.
 *
 * All calls use the service_role key from the server. The Auth project is the
 * internal app's as well, so internal admins are users here too; the callers
 * check fofo.franchise_users before acting on anyone.
 */
import { HttpError } from './http.js'

function config() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')
  return { base: `${url.replace(/\/$/, '')}/auth/v1`, key }
}

async function call(path, { method = 'GET', bearer, body } = {}) {
  const { base, key } = config()
  let response
  try {
    response = await fetch(`${base}/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${bearer || key}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    throw new Error(`Could not reach Supabase Auth: ${err.message}`)
  }
  const payload = await response.json().catch(() => null)
  return { status: response.status, ok: response.ok, body: payload }
}

const errorCode = (body) => body?.error_code || (typeof body?.code === 'string' ? body.code : null) || body?.error
const errorMessage = (body) => body?.msg || body?.message || body?.error_description || ''

/* ------------------------------------------------------------------ *
 * Users (admin API)
 * ------------------------------------------------------------------ */

/** Creates a confirmed user and resolves to its id. */
export async function createUser(email, password) {
  const { ok, status, body } = await call('admin/users', {
    method: 'POST',
    // email_confirm: the address is the registrant's own choice and is not
    // verified by email — by decision, a registration link is not tied to an
    // address (migration 11). Confirmation mail would also need Supabase SMTP.
    body: { email, password, email_confirm: true, app_metadata: { kind: 'fofo_franchise_user' } },
  })
  if (ok && body?.id) return body.id

  const code = errorCode(body)
  const message = errorMessage(body)
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|already exists/i.test(message)) {
    throw new HttpError(409, 'An account with this email already exists')
  }
  if (code === 'weak_password' || /password/i.test(message)) {
    throw new HttpError(400, message || 'Choose a stronger password')
  }
  console.error('Supabase Auth refused to create a user:', status, body)
  throw new Error(`Supabase Auth answered ${status}`)
}

/** Deletes a user. Never throws: failure is logged loudly instead. */
export async function deleteUser(authUserId) {
  try {
    const { ok, status } = await call(`admin/users/${authUserId}`, { method: 'DELETE' })
    if (!ok) throw new Error(`status ${status}`)
  } catch (err) {
    // A login with no franchise user behind it. It cannot reach any FOFO data,
    // but it holds the email address and should be removed by hand.
    console.error(`ORPHANED AUTH USER ${authUserId} — delete it in Supabase → Authentication:`, err.message)
  }
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

/**
 * Checks an email and password. Resolves to `{ authUserId, accessToken }`, or
 * null for wrong credentials. Throws HttpError 429 if Supabase is rate-limiting.
 */
export async function checkPassword(email, password) {
  const { ok, status, body } = await call('token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  if (ok && body?.access_token && body?.user?.id) {
    return { authUserId: body.user.id, accessToken: body.access_token }
  }
  if (status === 429) {
    throw new HttpError(429, 'Too many sign-in attempts right now. Wait a few minutes and try again.')
  }
  if (status === 400 || status === 401 || status === 422) return null
  console.error('Supabase Auth sign-in failed unexpectedly:', status, body)
  throw new Error(`Supabase Auth answered ${status}`)
}

/**
 * Ends a Supabase session obtained here. `scope` 'local' ends that one session;
 * 'global' ends every Supabase session the user has. Never throws.
 */
export async function endSupabaseSession(accessToken, scope = 'local') {
  try {
    await call(`logout?scope=${scope}`, { method: 'POST', bearer: accessToken })
  } catch (err) {
    console.error('Could not end a Supabase session:', err.message)
  }
}

/**
 * Asks Supabase to email a password-reset link that lands on `redirectTo`.
 * Never reveals whether the address exists: errors other than an outage are
 * swallowed.
 */
export async function sendPasswordResetEmail(email, redirectTo) {
  const { ok, status, body } = await call(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    body: { email },
  })
  if (!ok && status >= 500) {
    console.error('Supabase Auth could not send a reset email:', status, body)
    throw new HttpError(502, 'The reset email could not be sent. Try again in a few minutes.')
  }
  if (!ok) console.warn('Supabase Auth declined a reset email:', status, errorCode(body))
}

/** The user a (recovery) access token belongs to, or null if it is not valid. */
export async function userForToken(accessToken) {
  const { ok, status, body } = await call('user', { bearer: accessToken })
  if (ok && body?.id) return body
  if (status === 401 || status === 403) return null
  console.error('Supabase Auth could not read a user:', status, body)
  throw new Error(`Supabase Auth answered ${status}`)
}

/** Sets a new password using the recovery access token from a reset email. */
export async function setPasswordWithToken(accessToken, password) {
  const { ok, status, body } = await call('user', { method: 'PUT', bearer: accessToken, body: { password } })
  if (ok) return
  const code = errorCode(body)
  if (status === 401 || status === 403) {
    throw new HttpError(410, 'This reset link has expired or been used. Request a new one.')
  }
  if (code === 'same_password') throw new HttpError(400, 'Choose a password different from your current one')
  if (code === 'weak_password') throw new HttpError(400, errorMessage(body) || 'Choose a stronger password')
  console.error('Supabase Auth refused a new password:', status, body)
  throw new Error(`Supabase Auth answered ${status}`)
}
