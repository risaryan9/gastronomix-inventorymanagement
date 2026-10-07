// The staff pass — how a purchase manager or kitchen executive reaches FOFO
// orders from this app.
//
// WHY IT EXISTS. FOFO orders live in the `fofo` schema, which this app cannot
// see (decision 0015), so the screens that accept, pack and ship them call the
// partner app's server. That server has to know who is calling. An admin sends
// a Supabase Auth session (lib/partnerApi.js). Key-login staff have none: the
// `user_session` entry in localStorage is only this browser's memory of who
// logged in, and anyone can write it. So the server checks the login key
// itself, once, and hands back a PASS, a random token that stands for "this
// person, this role, this kitchen" for 7 days. Decision 0023 has the
// reasoning; partner-frontend/api/_lib/staffAuth.js is the other half.
//
// WHEN IT IS FETCHED. At key login (pages/Login.jsx), in the background, with
// the key the person has just typed. That is the only moment this app has the
// key: it is deliberately never kept (decision 0017). Nothing about logging in
// waits on it or fails because of it, so if the partner app is down the rest of
// this app works as before and only the FOFO screens are affected.
//
// WHEN IT RUNS OUT. After 7 days, the same as a key login here (Login.jsx), so
// the two normally end together and logging in again fetches a new one. A
// person can still be logged in with no working pass: the partner app was
// unreachable when they logged in, or an admin has since deactivated them,
// moved them, or changed their key. The server then answers 401, staffRequest
// throws StaffPassRequired, and the screen asks for the key again and calls
// requestStaffPass. A FOFO staff screen must handle that error.
//
// WHAT IS KEPT IN THE BROWSER. The pass, in localStorage, so it survives a
// reload and is shared by this app's tabs. A script running on this page could
// read it, which is why it is a pass and not the key. It is a bearer
// token rather than a cookie because the partner app is a different site, and a
// cookie from it would be a third-party cookie here.

import { PARTNER_API_URL } from './partnerApi'

const STORAGE_KEY = 'fofo_staff_pass'

// The roles the server will give a pass to. Mirrored in
// partner-frontend/api/_lib/staffAuth.js and migration 21: change all three.
export const STAFF_PASS_ROLES = ['purchase_manager', 'kitchen_executive']

/** Thrown when a FOFO staff request has no working pass: ask for the key again. */
export class StaffPassRequired extends Error {
  constructor(message = 'Enter your login key to work on franchise orders.') {
    super(message)
    this.name = 'StaffPassRequired'
  }
}

// The pass request started at login, so a FOFO screen opened straight away
// waits for it instead of asking for a key that is already on its way.
let pending = null
// Bumped whenever the pass is thrown away, so a request still in flight for the
// previous person cannot store its answer over the next one's.
let generation = 0

function readStored() {
  try {
    const pass = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!pass?.token || !pass.expires_at) return null
    if (new Date(pass.expires_at) <= new Date()) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return pass
  } catch {
    return null
  }
}

async function call(method, path, { token, body, keepalive } = {}) {
  if (!PARTNER_API_URL) {
    throw new Error('The partner app address is not configured (VITE_PARTNER_API_URL).')
  }
  let response
  try {
    response = await fetch(`${PARTNER_API_URL}/api/staff/${path}`, {
      method,
      keepalive,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the partner app. Check your connection and try again.')
  }
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

/**
 * Exchanges a login key for a pass and keeps it. Called at key login, and again
 * from a FOFO screen when StaffPassRequired says the old one is gone.
 *
 * Send the same role and kitchen the person logged in with: the server refuses
 * a key that is right for someone else. Rejects with the server's message
 * ("That login key is not right…", "Too many wrong login keys…"), which is
 * written to be shown.
 */
export function requestStaffPass({ loginKey, role, cloudKitchenId }) {
  const mine = ++generation
  const request = (async () => {
    const { response, payload } = await call('POST', 'pass', {
      body: { login_key: loginKey, role, cloud_kitchen_id: cloudKitchenId },
    })
    if (!response.ok) {
      throw new Error(payload?.error || `The partner app answered ${response.status}.`)
    }
    if (mine === generation) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ token: payload.token, expires_at: payload.expires_at, user_id: payload.staff.id })
      )
    }
    return payload.staff
  })()
  pending = request
  // Whoever awaits `request` sees the outcome; this copy only clears the slot.
  request.catch(() => {}).finally(() => {
    if (pending === request) pending = null
  })
  return request
}

/** True when this browser holds a pass that has not run out. The server may still refuse it. */
export const hasStaffPass = () => readStored() !== null

/**
 * Throws the pass away and tells the server to end it. Called on every sign-out
 * and at the start of every login, so a pass never outlives the person it was
 * issued to on a shared computer. Never throws: signing out must always work.
 */
export function forgetStaffPass() {
  generation++
  pending = null
  let token = null
  try {
    token = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')?.token || null
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored, or storage is unavailable: nothing to forget.
  }
  // keepalive lets the request finish even though sign-out navigates away.
  if (token && PARTNER_API_URL) call('DELETE', 'pass', { token, keepalive: true }).catch(() => {})
}

/**
 * One request to /api/staff/<path> as the pass holder. Resolves with the JSON
 * answer; throws StaffPassRequired when there is no pass or the server no
 * longer accepts it, and an Error carrying the server's message otherwise.
 */
export async function staffRequest(method, path, body) {
  if (pending) await pending.catch(() => {})

  const pass = readStored()
  if (!pass) throw new StaffPassRequired()

  const { response, payload } = await call(method, path, { token: pass.token, body })
  if (response.status === 401) {
    // Run out, or ended by the server. Drop it so the next call asks at once.
    if (readStored()?.token === pass.token) localStorage.removeItem(STORAGE_KEY)
    throw new StaffPassRequired()
  }
  if (!response.ok) {
    throw new Error(payload?.error || `The partner app answered ${response.status}.`)
  }
  return payload
}

/** Who the server says this pass belongs to. Throws StaffPassRequired if it has none. */
export const currentStaffPass = () => staffRequest('GET', 'pass')
