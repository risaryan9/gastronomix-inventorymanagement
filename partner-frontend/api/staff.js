/*
 * /api/staff/* — what purchase managers and kitchen executives call from the
 * internal app.
 *
 * Cross-origin, like /api/admin: the internal app is a different site, so every
 * response carries CORS headers for INTERNAL_APP_ORIGINS. One function behind a
 * vercel.json rewrite (see api/admin.js for why).
 *
 * The caller is known by a STAFF PASS, a bearer token this server issues in
 * exchange for a login key (_lib/staffAuth.js, decision 0023).
 *
 *   POST   /api/staff/pass   { login_key, role, cloud_kitchen_id }   check the key, issue a pass
 *   GET    /api/staff/pass                                           who this pass belongs to, or 401
 *   DELETE /api/staff/pass                                           end it (signing out)
 *
 *   GET    /api/staff/orders/summary    how many of the kitchen's orders wait to be accepted, and packed
 *   GET    /api/staff/orders            the kitchen's orders, newest first
 *   GET    /api/staff/orders?id=        one order, its lines and the stock on hand
 *   GET    /api/staff/orders/label?id=  what an accepted order's shipping label says
 *   POST   /api/staff/orders/accept     { order_id }   purchase manager: accept a paid order in full
 *   POST   /api/staff/orders/pack       { order_id }   kitchen executive: mark an accepted order packed
 *
 * The reads are open to both roles, and each sees what its role should
 * (_lib/staffOrders.js, statusesFor). Each change belongs to one role.
 *
 * TWO KINDS OF ROUTE. The pass routes look after the pass themselves. Every
 * other route is a STAFF_ROUTE: it names the roles it allows, the handler below
 * resolves the pass first (401 without one, 403 for the wrong role), and the
 * route gets the staff member and a transaction. A staff route must scope what
 * it reads or changes to `staff.cloudKitchenId` itself; nothing here can do
 * that for it.
 *
 * The remaining routes that change an order (logistics invoice, shipping) are
 * added with spec §8.4.
 */
import { handleCors } from './_lib/cors.js'
import { transaction } from './_lib/db.js'
import { HttpError, jsonBody, sendError } from './_lib/http.js'
import { STAFF_ROLES, endPass, issuePass, passView, requireStaff } from './_lib/staffAuth.js'
import {
  acceptOrder,
  getKitchenOrder,
  getShippingLabel,
  listKitchenOrders,
  ordersSummary,
  packOrder,
} from './_lib/staffOrders.js'

// path → { method → [status, handler(req)] }
const PASS_ROUTES = {
  pass: {
    POST: [201, (req) => issuePass(req, jsonBody(req))],
    GET: [200, async (req) => passView(await requireStaff(req))],
    DELETE: [200, (req) => endPass(req)],
  },
}

const PURCHASE_MANAGER = ['purchase_manager']
const KITCHEN_EXECUTIVE = ['kitchen_executive']

// path → { method → [roles, handler(db, staff, req)] }
const STAFF_ROUTES = {
  'orders/summary': {
    GET: [STAFF_ROLES, (db, staff) => ordersSummary(db, staff)],
  },
  orders: {
    GET: [STAFF_ROLES, (db, staff, req) =>
      req.query.id ? getKitchenOrder(db, staff, req.query.id) : listKitchenOrders(db, staff)],
  },
  'orders/label': {
    GET: [STAFF_ROLES, (db, staff, req) => getShippingLabel(db, staff, req.query.id)],
  },
  'orders/accept': {
    POST: [PURCHASE_MANAGER, (db, staff, req) => acceptOrder(db, staff, jsonBody(req), req)],
  },
  'orders/pack': {
    POST: [KITCHEN_EXECUTIVE, (db, staff, req) => packOrder(db, staff, jsonBody(req), req)],
  },
}

function methodOf(route, req, res) {
  if (!route[req.method]) {
    res.setHeader('Allow', Object.keys(route).join(', '))
    throw new HttpError(405, 'Method not allowed')
  }
  return route[req.method]
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return
  res.setHeader('Cache-Control', 'no-store')

  try {
    const path = String(req.query?.path || '').replace(/^\/+|\/+$/g, '')

    if (PASS_ROUTES[path]) {
      const [status, run] = methodOf(PASS_ROUTES[path], req, res)
      return res.status(status).json(await run(req))
    }

    if (STAFF_ROUTES[path]) {
      const [roles, run] = methodOf(STAFF_ROUTES[path], req, res)
      const staff = await requireStaff(req, roles)
      return res.status(200).json(await transaction((db) => run(db, staff, req)))
    }

    throw new HttpError(404, 'Not found')
  } catch (err) {
    return sendError(res, err)
  }
}
