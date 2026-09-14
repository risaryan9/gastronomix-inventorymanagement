/*
 * GET /api/health
 *
 * Exists to prove one thing about a deployment: that /api reaches a function
 * and is not swallowed by the single-page-app rewrite in vercel.json, which
 * sends every other path to index.html. If this URL returns the React page
 * instead of JSON, routing is broken and no other endpoint will work either.
 *
 * `configured` says whether the server-side secrets are set, as a yes/no only.
 * It never echoes a value, a variable name, or which one is missing — this
 * endpoint is public, and it should tell an attacker nothing they can use.
 */
export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const configured = Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.DATABASE_URL &&
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.PARTNER_APP_URL
  )

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    ok: true,
    service: 'gastronomix-partners-api',
    configured,
    time: new Date().toISOString(),
  })
}
