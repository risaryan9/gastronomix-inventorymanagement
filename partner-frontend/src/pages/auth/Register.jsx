import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/AuthShell.jsx'
import Alert from '../../components/Alert.jsx'
import { inputClass, labelClass, primaryButton } from '../../components/styles.js'
import { MIN_PASSWORD_LENGTH } from '../../lib/passwords.js'

/*
 * /register#token=… — where a registration email's link lands.
 *
 * The token is in the #fragment, which the browser never sends to a server, so
 * it stays out of logs (api/_lib/onboarding.js). This page reads it once, takes
 * it out of the address bar, and posts it in request bodies.
 *
 * The person registering chooses their own email and password; the link only
 * decides which franchise the login belongs to. Everything is checked again on
 * the server — the checks here are for a quicker, clearer answer.
 */


function readTokenFromUrl() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (token) {
    // Out of the address bar, so it is not left in history or a screenshot.
    window.history.replaceState(null, '', window.location.pathname)
  }
  return token
}

async function post(path, body) {
  let response
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach Gastronomix Partners. Check your connection and try again.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Something went wrong. Please try again.')
  return payload
}

const formatExpiry = (value) =>
  new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })

const NeedNewLink = () => (
  <p className="mt-4 text-sm text-muted-foreground">
    Each link works once and expires after a week. Ask your franchise&apos;s main contact to request a new
    registration email from Gastronomix.
  </p>
)

export default function Register() {
  const [token] = useState(readTokenFromUrl)
  const [link, setLink] = useState({ state: token ? 'loading' : 'invalid' })
  const [form, setForm] = useState({ email: '', password: '', confirm: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    post('registration-link', { token })
      .then((details) => { if (!cancelled) setLink({ state: 'ok', details }) })
      .catch((err) => { if (!cancelled) setLink({ state: 'error', message: err.message }) })
    return () => { cancelled = true }
  }, [token])

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return setFormError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    if (form.password !== form.confirm) return setFormError('The two passwords do not match.')

    try {
      setSubmitting(true)
      setDone(await post('register', { token, email: form.email, password: form.password }))
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (link.state === 'loading') {
    return (
      <AuthShell title="Create your login">
        <p className="text-muted-foreground">Checking your registration link…</p>
      </AuthShell>
    )
  }

  if (link.state === 'invalid' || link.state === 'error') {
    return (
      <AuthShell title="This link can't be used">
        <Alert>
          {link.state === 'invalid'
            ? 'This page needs the link from your registration email.'
            : link.message.replace(/\.?$/, '.')}
        </Alert>
        <NeedNewLink />
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Your login is ready">
        <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 p-4">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-foreground">
            You can now sign in to Gastronomix Partners as <strong>{done.email}</strong> for{' '}
            <strong>{done.franchise_name}</strong>.
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Keep your password safe — Gastronomix will never ask you for it.
        </p>
        <Link to="/login" className={`${primaryButton} mt-6 block text-center`}>Sign in</Link>
      </AuthShell>
    )
  }

  const { franchise_name: franchiseName, invitation_number: number, expires_at: expiresAt } = link.details

  return (
    <AuthShell
      title="Create your login"
      subtitle={
        <>
          For <span className="font-semibold text-foreground">{franchiseName}</span>
          <span className="mx-2 text-muted-foreground/60">•</span>
          Registration #{number}
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>Your email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
            disabled={submitting}
            className={inputClass}
            placeholder="you@example.com"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Use your own address — you will sign in with it.</p>
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={MIN_PASSWORD_LENGTH}
            disabled={submitting}
            className={inputClass}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
        </div>

        <div>
          <label htmlFor="confirm" className={labelClass}>Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            required
            disabled={submitting}
            className={inputClass}
            placeholder="Type it again"
          />
        </div>

        {formError && <Alert>{formError}</Alert>}

        <button type="submit" disabled={submitting} className={primaryButton}>
          {submitting ? 'Creating your login…' : 'Create login'}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          This link works once and expires {formatExpiry(expiresAt)} IST.
        </p>
      </form>
    </AuthShell>
  )
}
