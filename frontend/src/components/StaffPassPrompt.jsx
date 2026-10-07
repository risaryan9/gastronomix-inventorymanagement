import { useState } from 'react'
import { getSession } from '../lib/auth'
import { requestStaffPass } from '../lib/staffPass'

/**
 * Asks a logged-in purchase manager or kitchen executive for their login key
 * again, to get a staff pass for franchise orders (decision 0023).
 *
 * Shown in place of a FOFO screen's content when a request threw
 * StaffPassRequired. That happens when the person logged in before the pass
 * existed or while the partner app was unreachable, or when their pass was
 * ended early. It is not a second login: the role and kitchen come from the
 * session they already have, and only the key is typed.
 *
 * The key goes straight to the partner app's server and is not kept here.
 * `onIssued` runs once a pass is in hand, so the screen can load.
 */
const StaffPassPrompt = ({ what = 'franchise orders', onIssued }) => {
  const [loginKey, setLoginKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const session = getSession()
    if (!loginKey.trim() || !session) return
    setBusy(true)
    setError('')
    try {
      await requestStaffPass({
        loginKey: loginKey.trim(),
        role: session.role,
        cloudKitchenId: session.cloud_kitchen_id,
      })
      setLoginKey('')
      onIssued?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-card border-2 border-border rounded-2xl p-6 max-w-md mx-auto">
      <h2 className="text-lg font-bold text-foreground">Enter your login key</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        To open {what}, confirm it is you. This is the same key you log in with. You will not be asked again
        until you next log in.
      </p>
      <label htmlFor="staff-pass-key" className="block mt-4 mb-1 text-sm font-semibold text-foreground">
        Login key
      </label>
      <input
        id="staff-pass-key"
        type="password"
        autoComplete="off"
        value={loginKey}
        onChange={(e) => setLoginKey(e.target.value)}
        disabled={busy}
        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !loginKey.trim()}
        className="mt-4 w-full bg-accent text-background font-bold px-4 py-2.5 rounded-xl hover:bg-accent/90 transition-all disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </form>
  )
}

export default StaffPassPrompt
