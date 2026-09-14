/*
 * /api/auth/* — franchise users' own account endpoints.
 *
 * Same-origin: the partner app calls its own /api, so no CORS. vercel.json
 * rewrites /api/auth/<path> here as ?path=<path>, one function for the group
 * (see api/admin.js for why).
 *
 *   POST /api/auth/registration-link   { token }                    what a link is for
 *   POST /api/auth/register            { token, email, password }   create the login
 *
 * Login, logout and password reset join this file with franchise auth.
 */
import { HttpError, jsonBody, sendError } from './_lib/http.js'
import { describeRegistrationLink, register } from './_lib/onboarding.js'

const ROUTES = {
  'registration-link': (req) => describeRegistrationLink(jsonBody(req)),
  register: (req) => register(req, jsonBody(req)),
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const route = ROUTES[String(req.query?.path || '').replace(/^\/+|\/+$/g, '')]
    if (!route) throw new HttpError(404, 'Not found')
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      throw new HttpError(405, 'Method not allowed')
    }
    const result = await route(req)
    return res.status(req.query.path === 'register' ? 201 : 200).json(result)
  } catch (err) {
    return sendError(res, err)
  }
}
