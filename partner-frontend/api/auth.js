/*
 * /api/auth/* — franchise users' accounts.
 *
 * Same-origin: the partner app calls its own /api, so no CORS. vercel.json
 * rewrites /api/auth/<path> here as ?path=<path>, one function for the group
 * (see api/admin.js for why).
 *
 *   POST /api/auth/registration-link        { token }                    what a link is for
 *   POST /api/auth/register                 { token, email, password }   create the login
 *   POST /api/auth/login                    { email, password }          sets the session cookie
 *   POST /api/auth/logout
 *   GET  /api/auth/session                  who is signed in, or 401
 *   POST /api/auth/password-reset           { email }                    emails a reset link
 *   POST /api/auth/password-reset/complete  { access_token, password }
 */
import { HttpError, jsonBody, sendError } from './_lib/http.js'
import { describeRegistrationLink, register } from './_lib/onboarding.js'
import {
  completePasswordReset,
  requestPasswordReset,
  requireFranchiseUser,
  sessionView,
  signIn,
  signOut,
} from './_lib/franchiseAuth.js'

// path → { method → [status, handler(req, res)] }
const ROUTES = {
  'registration-link': { POST: [200, (req) => describeRegistrationLink(jsonBody(req))] },
  register: { POST: [201, (req) => register(req, jsonBody(req))] },
  login: { POST: [200, (req, res) => signIn(req, res, jsonBody(req))] },
  logout: { POST: [200, (req, res) => signOut(req, res)] },
  session: { GET: [200, async (req, res) => sessionView(await requireFranchiseUser(req, res))] },
  'password-reset': { POST: [200, (req) => requestPasswordReset(req, jsonBody(req))] },
  'password-reset/complete': { POST: [200, (req) => completePasswordReset(req, jsonBody(req))] },
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
    const [status, run] = route[req.method]
    return res.status(status).json(await run(req, res))
  } catch (err) {
    return sendError(res, err)
  }
}
