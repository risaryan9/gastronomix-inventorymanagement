import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, UNAUTHORIZED_EVENT } from '../lib/api.js'
import { AuthContext } from './authContext.js'

/*
 * Who is signed in, as the server sees it. The session lives in an HttpOnly
 * cookie the browser cannot read, so the only way to know is to ask
 * /api/auth/session — once on load, and again whenever a request comes back
 * 401 (the session ended, or the user or franchise was deactivated).
 */
export default function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', session: null, notice: null })

  useEffect(() => {
    let cancelled = false
    api('auth/session')
      .then((session) => { if (!cancelled) setState({ status: 'signedIn', session, notice: null }) })
      .catch(() => { if (!cancelled) setState({ status: 'signedOut', session: null, notice: null }) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onUnauthorized = () =>
      setState((current) =>
        current.status === 'signedIn'
          ? { status: 'signedOut', session: null, notice: 'Your session has ended. Sign in again to continue.' }
          : current
      )
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const signIn = useCallback(async (email, password) => {
    const session = await api('auth/login', { method: 'POST', body: { email, password } })
    setState({ status: 'signedIn', session, notice: null })
    return session
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api('auth/logout', { method: 'POST' })
    } finally {
      // Signed out on this screen even if the request failed: the person asked.
      setState({ status: 'signedOut', session: null, notice: null })
    }
  }, [])

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
