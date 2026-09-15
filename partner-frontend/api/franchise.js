/*
 * /api/franchise/* — what a signed-in franchise user reads and does.
 *
 * Every route starts from requireFranchiseUser and scopes every query to the
 * franchise that returns: a franchise id in a URL or body is never trusted to
 * say whose data to read. That is the whole of franchise isolation — these
 * tables are unreachable any other way (decision 0015) — so a route that skips
 * it is a leak. An outlet id in a request is only ever used through
 * catalog.outletForFranchise, which refuses one the franchise does not own.
 *
 * Same-origin, one function behind a vercel.json rewrite (see api/admin.js).
 *
 *   GET    /api/franchise/outlets                         outlets, with where their orders stand
 *   GET    /api/franchise/catalog?outlet_id=              an outlet's catalogue, final prices only
 *   GET    /api/franchise/catalog/history?outlet_id=&material_id=
 *                                                         every time the outlet bought one supply
 *   GET    /api/franchise/cart                            the outlets that have a cart
 *   GET    /api/franchise/cart?outlet_id=                 one outlet's cart, priced now
 *   PUT    /api/franchise/cart                            set a line's quantity (0 removes it)
 *   DELETE /api/franchise/cart?outlet_id=                 clear one outlet's cart
 *   POST   /api/franchise/cart/keep                       keep a changed price
 *   POST   /api/franchise/checkout                        check a cart and work out what it costs
 */
import { transaction } from './_lib/db.js'
import { HttpError, jsonBody, sendError } from './_lib/http.js'
import { requireFranchiseUser, requireSameOrigin } from './_lib/franchiseAuth.js'
import { catalogForOutlet, outletsWithOrderSummary, purchaseHistory } from './_lib/catalog.js'
import { cartSummary, checkout, clearCart, getCart, keepPrice, setQuantity } from './_lib/cart.js'

const inTransaction = (work) => (user, req) => transaction((db) => work(db, user, req))

// path → { method → handler(user, req) }
const ROUTES = {
  outlets: {
    GET: inTransaction((db, user) => outletsWithOrderSummary(db, user.franchiseId)),
  },
  catalog: {
    GET: inTransaction((db, user, req) => catalogForOutlet(db, user.franchiseId, req.query.outlet_id)),
  },
  'catalog/history': {
    GET: inTransaction((db, user, req) =>
      purchaseHistory(db, user.franchiseId, req.query.outlet_id, req.query.material_id)
    ),
  },
  cart: {
    GET: inTransaction((db, user, req) =>
      req.query.outlet_id ? getCart(db, user, req.query.outlet_id) : cartSummary(db, user)
    ),
    PUT: inTransaction((db, user, req) => setQuantity(db, user, jsonBody(req))),
    DELETE: inTransaction((db, user, req) => clearCart(db, user, req.query.outlet_id)),
  },
  'cart/keep': {
    POST: inTransaction((db, user, req) => keepPrice(db, user, jsonBody(req))),
  },
  checkout: {
    POST: inTransaction((db, user, req) => checkout(db, user, jsonBody(req))),
  },
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const route = ROUTES[String(req.query?.path || '').replace(/^\/+|\/+$/g, '')]
    if (!route) throw new HttpError(404, 'Not found')
    if (!route[req.method]) {
      res.setHeader('Allow', Object.keys(route).join(', '))
      throw new HttpError(405, 'Method not allowed')
    }
    requireSameOrigin(req)
    const user = await requireFranchiseUser(req, res)
    return res.status(200).json(await route[req.method](user, req))
  } catch (err) {
    return sendError(res, err)
  }
}
