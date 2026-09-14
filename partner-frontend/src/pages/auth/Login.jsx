import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../../components/AuthShell.jsx'
import Alert from '../../components/Alert.jsx'
import { inputClass, labelClass, primaryButton } from '../../components/styles.js'
import { useAuth } from '../../auth/authContext.js'
import { safeNextPath } from '../../lib/safeRedirect.js'

export default function Login() {
  const { status, notice, signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))

  const [form, setForm] = useState({ email: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (status === 'signedIn') return <Navigate to={next} replace />

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.email.trim() || !form.password) return setError('Enter your email and password.')
    try {
      setSubmitting(true)
      await signIn(form.email, form.password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Order supplies for your outlets from Gastronomix.">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {notice && !error && <Alert tone="info">{notice}</Alert>}

        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} disabled={submitting} className={inputClass} placeholder="you@example.com" />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm font-semibold text-foreground">Password</label>
            <Link to="/forgot-password" className="text-xs font-semibold text-accent-text hover:underline">
              Forgot password?
            </Link>
          </div>
          <input id="password" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} disabled={submitting} className={inputClass} placeholder="Your password" />
        </div>

        {error && <Alert>{error}</Alert>}

        <button type="submit" disabled={submitting} className={primaryButton}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          New here? Logins are created from a registration email sent to your franchise&apos;s main contact.
        </p>
      </form>
    </AuthShell>
  )
}
