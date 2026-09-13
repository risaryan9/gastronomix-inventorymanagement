/*
 * CORS for endpoints the INTERNAL app calls from its own address.
 *
 * The internal app (a different origin) calls the admin endpoints from the
 * browser, so those responses must say which origins may read them. Only the
 * internal app's addresses are allowed, listed in INTERNAL_APP_ORIGINS:
 *
 *   INTERNAL_APP_ORIGINS=https://<internal-app>.vercel.app,http://localhost:5173
 *
 * CORS is not the security boundary — a script outside a browser ignores it,
 * which is why every admin endpoint also checks the admin's session. What it
 * does stop is some other website using a logged-in admin's browser to read
 * these responses.
 *
 * Franchise-facing endpoints are same-origin (the partner app calls its own
 * /api) and do not use this.
 */

const METHODS = 'GET, POST, PUT, DELETE, OPTIONS'

function allowedOrigins() {
  return (process.env.INTERNAL_APP_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/**
 * Sets CORS headers for an allowed origin. Returns true when the request was a
 * preflight and has been answered, so the handler should stop.
 */
export function handleCors(req, res) {
  const origin = req.headers.origin
  const allowed = origin && allowedOrigins().includes(origin)

  res.setHeader('Vary', 'Origin')
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', METHODS)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Max-Age', '600')
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = allowed ? 204 : 403
    res.end()
    return true
  }
  return false
}
