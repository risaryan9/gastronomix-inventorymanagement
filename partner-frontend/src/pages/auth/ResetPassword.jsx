import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/AuthShell.jsx'
import Alert from '../../components/Alert.jsx'
import { inputClass, labelClass, primaryButton } from '../../components/styles.js'
import { api } from '../../lib/api.js'
import { MIN_PASSWORD_LENGTH } from '../../lib/passwords.js'

/*
 * /reset-password — where Supabase's reset email lands. Supabase puts a
 * short-lived recovery token in the #fragment (never sent to any server), or
 * an error if the link was expired or already used. This page reads it once,
 * clears it from the address bar, and posts it with the new password.
 */
function readRecoveryFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
  if (params.get('error') || params.get('error_code')) {
    return { error: 'This reset link has expired or has already been used.' }
  }
  const token = params.get('access_token')
  if (!token || (params.get('type') && params.get('type') !== 'recovery')) {
    return { error: 'This page needs the link from your password reset email.' }
  }
  return { token }
}

export default function ResetPassword() {
  const [recovery] = useState(readRecoveryFromUrl)
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < MIN_PASSWORD_LENGTH) return setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (form.password !== form.confirm) return setError('The two passwords do not match.')
    try {
      setSubmitting(true)
      const result = await api('auth/password-reset/complete', {
        method: 'POST',
        body: { access_token: recovery.token, password: form.password },
      })
      setDone(result.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (recovery.error) {
    return (
      <AuthShell title="This link can't be used">
        <Alert>{recovery.error}</Alert>
        <Link to="/forgot-password" className="mt-4 block text-center text-sm font-semibold text-accent-text hover:underline">
          Request a new reset link
        </Link>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Password changed">
        <div className="space-y-4">
          <Alert tone="success">{done}</Alert>
          <p className="text-sm text-muted-foreground">You have been signed out everywhere you were signed in.</p>
          <Link to="/login" className={`${primaryButton} block text-center`}>Sign in</Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="password" className={labelClass}>New password</label>
          <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} disabled={submitting} className={inputClass} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>Confirm new password</label>
          <input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} disabled={submitting} className={inputClass} placeholder="Type it again" />
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="submit" disabled={submitting} className={primaryButton}>
          {submitting ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </AuthShell>
  )
}
