/*
 * /api/staff/* — what purchase managers and kitchen executives call from the
 * internal app.
 *
 * Cross-origin, like /api/admin: the internal app is a different site, so every
 * response carries CORS headers for INTERNAL_APP_ORIGINS. One function behind a
 * vercel.json rewrite (see api/admin.js for why).
 *
 * The caller is known by a STAFF PASS, a bearer token this server issues in
 * exchange for a login key (_lib/staffAuth.js, decision 0023). Only the first
 * route below is open; every other one starts from requireStaff.
 *
 *   POST   /api/staff/pass   { login_key, role, cloud_kitchen_id }   check the key, issue a pass
 *   GET    /api/staff/pass                                           who this pass belongs to, or 401
 *   DELETE /api/staff/pass                                           end it (signing out)
 *
 * The routes that act on orders (accept, pack, logistics invoice, shipping) are
 * added with spec §8.3 and §8.4. Each must name the roles it allows and check
 * the order's kitchen against the pass.
 */
import { handleCors } from './_lib/cors.js'
import { HttpError, jsonBody, sendError } from './_lib/http.js'
import { endPass, issuePass, passView, requireStaff } from './_lib/staffAuth.js'

// path → { method → [status, handler(req)] }
const ROUTES = {
  pass: {
    POST: [201, (req) => issuePass(req, jsonBody(req))],
    GET: [200, async (req) => passView(await requireStaff(req))],
    DELETE: [200, (req) => endPass(req)],
  },
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return
  res.setHeader('Cache-Control', 'no-store')

  try {
    const route = ROUTES[String(req.query?.path || '').replace(/^\/+|\/+$/g, '')]
    if (!route) throw new HttpError(404, 'Not found')
    if (!route[req.method]) {
      res.setHeader('Allow', Object.keys(route).join(', '))
      throw new HttpError(405, 'Method not allowed')
    }
    const [status, run] = route[req.method]
    return res.status(status).json(await run(req))
  } catch (err) {
    return sendError(res, err)
  }
}
