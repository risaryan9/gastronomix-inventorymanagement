import { useEffect, useState } from 'react'

/*
 * Placeholder until Phase 5 builds the real dashboard.
 *
 * The status panel calls /api/health from the browser — the same path a real
 * screen will take — so opening the deployed site shows at a glance whether
 * the API is reachable and whether the server has its secrets. It fetches
 * nothing else, and this app will never import a Supabase client: all data
 * comes from /api (docs/fofo-dashboard-spec.md §4).
 */
export default function App() {
  const [health, setHealth] = useState({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/health', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const type = response.headers.get('content-type') || ''
        // HTML back from /api means the SPA rewrite swallowed the route.
        if (!type.includes('application/json')) {
          throw new Error('/api/health returned a web page instead of JSON — the rewrite in vercel.json is catching /api.')
        }
        if (!response.ok) throw new Error(`/api/health returned ${response.status}`)
        return response.json()
      })
      .then((body) => { if (!cancelled) setHealth({ state: 'ok', body }) })
      .catch((err) => { if (!cancelled) setHealth({ state: 'error', message: err.message }) })
    return () => { cancelled = true }
  }, [])

  return (
    <main className="page">
      <img src="/gastronomix-logo.png" alt="" className="logo" />
      <h1>Gastronomix Partners</h1>
      <p className="lede">The franchise ordering dashboard is on its way.</p>

      <section className="status" aria-live="polite">
        <h2>Deployment check</h2>
        {health.state === 'loading' && <p>Checking the API…</p>}
        {health.state === 'error' && (
          <p className="bad"><strong>API unreachable.</strong> {health.message}</p>
        )}
        {health.state === 'ok' && (
          <ul>
            <li className="good">API reachable</li>
            <li className={health.body.configured ? 'good' : 'warn'}>
              {health.body.configured
                ? 'Server secrets configured'
                : 'Server secrets not set yet — add them in Vercel → Settings → Environment Variables'}
            </li>
          </ul>
        )}
      </section>
    </main>
  )
}
