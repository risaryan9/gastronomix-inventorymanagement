import { useEffect, useState } from 'react'
import Register from './Register.jsx'
import AuthShell from './components/AuthShell.jsx'

export default function App() {
  // No router yet: /register is the only other page, and it needs no navigation.
  if (window.location.pathname.replace(/\/$/, '') === '/register') return <Register />
  return <DeploymentCheck />
}

const Row = ({ tone, children }) => (
  <li className="flex items-start gap-2 text-sm">
    <span className={`mt-0.5 font-bold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-accent-text'}`}>
      {tone === 'good' ? '✓' : '!'}
    </span>
    <span className="text-foreground">{children}</span>
  </li>
)

/*
 * Placeholder until Phase 5 builds the real dashboard.
 *
 * The status panel calls /api/health from the browser — the same path a real
 * screen will take — so opening the deployed site shows at a glance whether
 * the API is reachable and whether the server has its secrets. It fetches
 * nothing else, and this app will never import a Supabase client: all data
 * comes from /api (docs/fofo-dashboard-spec.md §4).
 */
function DeploymentCheck() {
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
    <AuthShell title="Coming soon" subtitle="The franchise ordering dashboard is on its way.">
      <section aria-live="polite" className="rounded-xl border border-border bg-background/60 p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Deployment check</h2>
        {health.state === 'loading' && <p className="text-sm text-muted-foreground">Checking the API…</p>}
        {health.state === 'error' && (
          <ul><Row tone="bad"><strong>API unreachable.</strong> {health.message}</Row></ul>
        )}
        {health.state === 'ok' && (
          <ul className="space-y-2">
            <Row tone="good">API reachable</Row>
            <Row tone={health.body.configured ? 'good' : 'warn'}>
              {health.body.configured
                ? 'Server secrets configured'
                : 'Server secrets not set yet — add them in Vercel → Settings → Environment Variables'}
            </Row>
          </ul>
        )}
      </section>
    </AuthShell>
  )
}
