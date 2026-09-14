import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/AuthShell.jsx'
import Alert from '../../components/Alert.jsx'
import { inputClass, labelClass, primaryButton } from '../../components/styles.js'
import { api } from '../../lib/api.js'

// Asks for a reset link. The answer is the same whether or not the address
// has a login, so this page cannot be used to find out who does.
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Enter the email you sign in with.')
    try {
      setSubmitting(true)
      const result = await api('auth/password-reset', { method: 'POST', body: { email } })
      setSent(result.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">{sent}</Alert>
          <p className="text-sm text-muted-foreground">The link works once and expires after an hour. Check your spam folder if it does not arrive.</p>
          <Link to="/login" className="block text-center text-sm font-semibold text-accent-text hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className={labelClass}>Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} className={inputClass} placeholder="you@example.com" />
          </div>
          {error && <Alert>{error}</Alert>}
          <button type="submit" disabled={submitting} className={primaryButton}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <Link to="/login" className="block text-center text-sm font-semibold text-accent-text hover:underline">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  )
}
