import { useEffect, useState } from 'react'

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

const MIN_PASSWORD_LENGTH = 8

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

  return (
    <main className="page">
      <img src="/gastronomix-logo.png" alt="" className="logo" />
      <h1>Create your login</h1>

      {link.state === 'loading' && <p className="lede">Checking your registration link…</p>}

      {link.state === 'invalid' && (
        <section className="card">
          <p className="bad"><strong>This page needs a registration link.</strong></p>
          <p>Open the link from your registration email. If it does not work, ask your franchise&apos;s main contact to request a new registration email from Gastronomix.</p>
        </section>
      )}

      {link.state === 'error' && (
        <section className="card">
          <p className="bad"><strong>{link.message.replace(/\.?$/, '.')}</strong></p>
          <p>Each link works once and expires after a week. Ask your franchise&apos;s main contact to request a new registration email from Gastronomix.</p>
        </section>
      )}

      {link.state === 'ok' && done && (
        <section className="card">
          <p className="good"><strong>Your login is ready.</strong></p>
          <p>You can sign in to Gastronomix Partners as <strong>{done.email}</strong> for {done.franchise_name} once ordering opens. Keep your password safe — Gastronomix will never ask you for it.</p>
        </section>
      )}

      {link.state === 'ok' && !done && (
        <>
          <p className="lede">
            For <strong>{link.details.franchise_name}</strong> · registration #{link.details.invitation_number}
            <br />
            <span className="muted">This link works once and expires {formatExpiry(link.details.expires_at)} IST.</span>
          </p>

          <form className="card form" onSubmit={handleSubmit} noValidate>
            <label>
              Your email
              <input type="email" autoComplete="email" value={form.email} onChange={set('email')} required disabled={submitting} />
              <span className="hint">Use your own address — you will sign in with it.</span>
            </label>
            <label>
              Password
              <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={MIN_PASSWORD_LENGTH} disabled={submitting} />
              <span className="hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
            </label>
            <label>
              Confirm password
              <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required disabled={submitting} />
            </label>

            {formError && <p className="bad" role="alert">{formError}</p>}

            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating your login…' : 'Create login'}
            </button>
          </form>
        </>
      )}
    </main>
  )
}
