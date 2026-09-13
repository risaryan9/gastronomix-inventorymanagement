// The partner app's admin API — how this app reaches FOFO data.
//
// WHY NOT supabase.from('fofo....'). FOFO tables live in the `fofo` schema,
// which is deliberately not exposed to PostgREST, so the anon-key client in
// lib/supabase.js cannot see them at all (decision 0015). FOFO reads and writes
// go through the partner app's server instead, which checks this admin and
// calls the audited fofo functions.
//
// The admin proves who they are with their Supabase Auth session — the one
// Login.jsx creates with signInWithPassword, which supabase-js keeps and
// refreshes — sent as a bearer token. Key-login staff have no such session and
// cannot use these endpoints.
//
// VITE_PARTNER_API_URL is the partner app's address, e.g.
// https://gastronomix-inventorymanagement-kzh.vercel.app. It is not a secret.
// In development it defaults to the partner app's dev server.

import { supabase } from './supabase'

const DEV_PARTNER_API_URL = 'http://localhost:5174'

export const PARTNER_API_URL = (
  import.meta.env.VITE_PARTNER_API_URL || (import.meta.env.DEV ? DEV_PARTNER_API_URL : '')
).replace(/\/$/, '')

async function request(method, path, body) {
  if (!PARTNER_API_URL) {
    throw new Error('The partner app address is not configured (VITE_PARTNER_API_URL).')
  }

  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) {
    throw new Error('Your admin session has expired. Sign out and sign in again.')
  }

  let response
  try {
    response = await fetch(`${PARTNER_API_URL}/api/admin/${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the partner app. Check your connection and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    // The server's messages are written for people ("Outlet EC1026 already
    // belongs to franchise Test Foods"), so they are shown as they are.
    throw new Error(payload?.error || `The partner app answered ${response.status}.`)
  }
  return payload
}

const franchisePath = (id) => `franchises/${encodeURIComponent(id)}`

export const fofoAdminApi = {
  listFranchises: () => request('GET', 'franchises'),
  getFranchise: (id) => request('GET', franchisePath(id)),
  createFranchise: (details) => request('POST', 'franchises', details),
  // Send all seven fields: the server replaces every one, and a missing field
  // is refused rather than silently cleared.
  updateFranchise: (id, details) => request('PUT', franchisePath(id), details),
  setFranchiseActive: (id, isActive) =>
    request('PUT', `${franchisePath(id)}/active`, { is_active: isActive }),
  linkOutlet: (id, outletId) => request('POST', `${franchisePath(id)}/outlets`, { outlet_id: outletId }),
  unlinkOutlet: (id, outletId) =>
    request('DELETE', `${franchisePath(id)}/outlets/${encodeURIComponent(outletId)}`),
  listOutlets: () => request('GET', 'outlets'),
}
