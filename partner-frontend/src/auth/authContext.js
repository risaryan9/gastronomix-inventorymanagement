// Kept apart from AuthProvider.jsx so that file exports only a component —
// Fast Refresh stops working for a file that mixes the two.

import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

/**
 * The signed-in franchise user.
 *
 *   const { status, session, signIn, signOut } = useAuth()
 *
 * status: 'loading' | 'signedIn' | 'signedOut'
 * session: { user: { id, email }, franchise: { id, name }, session_expires_at } | null
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
