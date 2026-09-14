/*
 * /api/admin/* — everything the internal app's admin screens call.
 *
 * ONE FUNCTION, A SMALL ROUTER. vercel.json rewrites every /api/admin/<path>
 * here as ?path=<path>. One file rather than one per route because Vercel's
 * free plan caps a deployment at 12 functions, and the FOFO API will outgrow
 * that. It also keeps routing in plain code that moves unchanged to an Express
 * server later (docs/fofo-handoff.md).
 *
 * Every request: CORS for the internal app → verify the Supabase session →
 * one transaction as service_role that checks the caller is an active admin and
 * then does the work. The admin check and the change commit together.
 *
 * The email routes are the exception (`ownTransactions`): they call Resend
 * between database steps, and no transaction may stay open across that call
 * (_lib/onboarding.js), so they check the admin inside each step themselves.
 *
 *   GET    /api/admin/franchises
 *   POST   /api/admin/franchises
 *   GET    /api/admin/franchises/:id
 *   PUT    /api/admin/franchises/:id                  all seven fields
 *   PUT    /api/admin/franchises/:id/active           { is_active }
 *   POST   /api/admin/franchises/:id/outlets          { outlet_id }
 *   DELETE /api/admin/franchises/:id/outlets/:outletId
 *   GET    /api/admin/outlets
 *   PUT    /api/admin/outlets/:id/ownership-model   { ownership_model: 'foco' | 'fofo' }
 *   POST   /api/admin/franchises/:id/welcome-email
 *   POST   /api/admin/franchises/:id/invitations       sends a numbered registration email
 *   POST   /api/admin/invitations/:id/revoke
 */
import { handleCors } from './_lib/cors.js'
import { transaction } from './_lib/db.js'
import { HttpError, jsonBody, sendError } from './_lib/http.js'
import { authUserIdFromRequest, requireActiveAdmin } from './_lib/adminAuth.js'
import { revokeInvitation, sendRegistrationEmail, sendWelcomeEmail } from './_lib/onboarding.js'
import {
  createFranchise,
  getFranchise,
  linkOutlet,
  listFranchises,
  listOutlets,
  setFranchiseActive,
  setOutletOwnershipModel,
  unlinkOutlet,
  updateFranchise,
} from './_lib/franchiseAdmin.js'

// Routes that run in one request transaction: handler(db, admin, params, req).
const ROUTES = [
  ['GET', 'franchises', (db) => listFranchises(db)],
  ['POST', 'franchises', (db, admin, _p, req) => createFranchise(db, admin.id, jsonBody(req))],
  ['GET', 'franchises/:id', (db, _a, p) => getFranchise(db, p.id)],
  ['PUT', 'franchises/:id', (db, admin, p, req) => updateFranchise(db, admin.id, p.id, jsonBody(req))],
  ['PUT', 'franchises/:id/active', (db, admin, p, req) => setFranchiseActive(db, admin.id, p.id, jsonBody(req))],
  ['POST', 'franchises/:id/outlets', (db, admin, p, req) => linkOutlet(db, admin.id, p.id, jsonBody(req))],
  ['DELETE', 'franchises/:id/outlets/:outletId', (db, admin, p) => unlinkOutlet(db, admin.id, p.id, p.outletId)],
  ['GET', 'outlets', (db) => listOutlets(db)],
  ['PUT', 'outlets/:id/ownership-model', (db, admin, p, req) => setOutletOwnershipModel(db, admin.id, p.id, jsonBody(req))],
  ['POST', 'invitations/:id/revoke', (db, admin, p) => revokeInvitation(db, admin.id, p.id)],
]

// Routes that manage their own transactions: handler(authUserId, params, req).
const OWN_TRANSACTION_ROUTES = [
  ['POST', 'franchises/:id/welcome-email', (authUserId, p) => sendWelcomeEmail(authUserId, p.id)],
  ['POST', 'franchises/:id/invitations', (authUserId, p) => sendRegistrationEmail(authUserId, p.id)],
]

function matchPath(pattern, parts) {
  const want = pattern.split('/')
  if (want.length !== parts.length) return null
  const params = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = parts[i]
    else if (want[i] !== parts[i]) return null
  }
  return params
}

function resolve(method, path) {
  const parts = String(path || '').split('/').filter(Boolean)
  let pathMatched = false
  const candidates = [
    ...ROUTES.map((route) => [...route, false]),
    ...OWN_TRANSACTION_ROUTES.map((route) => [...route, true]),
  ]
  for (const [routeMethod, pattern, handler, ownTransactions] of candidates) {
    const params = matchPath(pattern, parts)
    if (!params) continue
    pathMatched = true
    if (routeMethod === method) return { handler, params, ownTransactions }
  }
  throw pathMatched ? new HttpError(405, 'Method not allowed') : new HttpError(404, 'Not found')
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return
  res.setHeader('Cache-Control', 'no-store')

  try {
    const { handler: route, params, ownTransactions } = resolve(req.method, req.query?.path)
    const authUserId = await authUserIdFromRequest(req)
    const result = ownTransactions
      ? await route(authUserId, params, req)
      : await transaction(async (db) => {
          const admin = await requireActiveAdmin(db, authUserId)
          return route(db, admin, params, req)
        })
    return res.status(req.method === 'POST' ? 201 : 200).json(result)
  } catch (err) {
    return sendError(res, err)
  }
}
