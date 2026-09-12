import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * THE PARTNER APP HOLDS NO SUPABASE KEY — NOT EVEN THE ANON ONE.
 *
 * The internal app talks to Postgres straight from the browser with the anon
 * key, and that key can read every purchase cost in the company
 * (docs/fofo-schema.md §2). This app is sold-to franchisees, so it gets no key
 * at all: every request goes through the functions in api/, which hold the
 * service_role key server-side.
 *
 * That rule is easy to break by accident and invisible when broken, so the
 * build enforces it twice:
 *
 *   1. Before building — refuse any VITE_ variable that names a secret. Vite
 *      copies every VITE_ variable into the bundle, so the *name* is the leak.
 *   2. After building — scan the output for the actual secret values, for any
 *      Supabase URL or key shape, whatever they are called. This catches the
 *      case (1) cannot: a value pasted into source, or imported from somewhere.
 *
 * This is the Phase 2 gate in docs/fofo-build-plan.md, made automatic: "no
 * Supabase key or cost price visible in the browser".
 */

const SECRET_NAME = /SUPABASE|SERVICE_ROLE|RAZORPAY|SECRET|PRIVATE/i

// Shapes that must never appear in anything shipped to a browser.
const FORBIDDEN_IN_BUNDLE = [
  { what: 'a Supabase project URL', re: /[a-z0-9]{20}\.supabase\.co/i },
  { what: 'a Supabase JWT key', re: /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*cm9sZS/ },
  { what: 'a Supabase API key', re: /sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/ },
  { what: 'a Razorpay secret', re: /rzp_(test|live)_[A-Za-z0-9]{10,}/ },
]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function noSecretsInBundle(env) {
  const secretValues = Object.entries(env)
    .filter(([name, value]) => !name.startsWith('VITE_') && SECRET_NAME.test(name) && value?.length >= 8)

  return {
    name: 'no-secrets-in-bundle',
    apply: 'build',
    configResolved() {
      const leaking = Object.keys(env).filter((name) => name.startsWith('VITE_') && SECRET_NAME.test(name))
      if (leaking.length) {
        throw new Error(
          `Refusing to build: ${leaking.join(', ')} would be copied into the browser bundle. ` +
          'Remove the VITE_ prefix — secrets are read by api/ only. See .env.example.'
        )
      }
    },
    closeBundle() {
      const problems = []
      for (const file of walk('dist')) {
        if (!/\.(js|html|css|json|map|txt)$/.test(file)) continue
        const text = readFileSync(file, 'utf8')
        for (const { what, re } of FORBIDDEN_IN_BUNDLE) {
          if (re.test(text)) problems.push(`${file}: contains ${what}`)
        }
        for (const [name, value] of secretValues) {
          if (text.includes(value)) problems.push(`${file}: contains the value of ${name}`)
        }
      }
      if (problems.length) {
        throw new Error('Refusing to ship — secrets found in the browser bundle:\n  ' + problems.join('\n  '))
      }
    },
  }
}

/*
 * `npm run dev` serves api/ too, so the functions can be exercised locally
 * without the Vercel CLI or a Vercel login. It wraps Node's response in the two
 * helpers Vercel adds (res.status, res.json) and nothing more — anything a
 * function needs beyond that will fail here first, which is the right place.
 * Production does not use this: Vercel runs api/ itself.
 */
function localApi(env) {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      for (const [name, value] of Object.entries(env)) {
        if (!name.startsWith('VITE_') && process.env[name] === undefined) process.env[name] = value
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        const route = url.pathname.replace(/\/$/, '')
        try {
          const mod = await server.ssrLoadModule(`${route}.js`)
          req.query = Object.fromEntries(url.searchParams)
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (body) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(body))
            return res
          }
          await mod.default(req, res)
        } catch (err) {
          if (/Failed to load url|does not exist/i.test(String(err?.message))) {
            res.statusCode = 404
            return res.end(JSON.stringify({ error: 'Not found' }))
          }
          next(err)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), noSecretsInBundle(env), localApi(env)],
  }
})
