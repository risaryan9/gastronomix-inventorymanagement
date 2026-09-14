/*
 * /api/franchise/* — what a signed-in franchise user reads and does.
 *
 * Every route starts from requireFranchiseUser and scopes every query to the
 * franchise that returns: a franchise id in a URL or body is never trusted to
 * say whose data to read. That is the whole of franchise isolation — these
 * tables are unreachable any other way (decision 0015) — so a route that skips
 * it is a leak.
 *
 * Same-origin, one function behind a vercel.json rewrite (see api/admin.js).
 * The catalogue, cart, orders, invoices and store credit join this file.
 *
 *   GET /api/franchise/outlets     the outlets this franchise owns
 */
import { transaction } from './_lib/db.js'
import { HttpError, sendError } from './_lib/http.js'
import { requireFranchiseUser, requireSameOrigin } from './_lib/franchiseAuth.js'

async function listOutlets(user) {
  return transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT o.id, o.code, o.name
         FROM fofo.franchise_outlets fo
         JOIN public.outlets o ON o.id = fo.outlet_id
        WHERE fo.franchise_id = $1
          AND o.is_active = true AND o.deleted_at IS NULL
        ORDER BY o.code, o.id`,
      [user.franchiseId]
    )
    return rows
  })
}

// path → { method → handler(user, req) }
const ROUTES = {
  outlets: { GET: (user) => listOutlets(user) },
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
