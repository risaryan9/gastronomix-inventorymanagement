/**
 * Authentication and Session Management Utilities
 */

// Get current user session
export const getSession = () => {
  try {
    const sessionData = localStorage.getItem('user_session')
    if (!sessionData) return null

    const session = JSON.parse(sessionData)
    
    // Check if session is expired
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      clearSession()
      return null
    }

    return session
  } catch (error) {
    console.error('Error getting session:', error)
    return null
  }
}

// Clear session
export const clearSession = () => {
  localStorage.removeItem('user_session')
  sessionStorage.removeItem('user')
}

// Check if user is authenticated
export const isAuthenticated = () => {
  const session = getSession()
  return session !== null
}

// Get current user
export const getCurrentUser = () => {
  return getSession()
}

// Check if user has specific role
export const hasRole = (role) => {
  const session = getSession()
  return session?.role === role
}

// Check if user is admin
export const isAdmin = () => {
  return hasRole('admin')
}

// Check if user is purchase manager
export const isPurchaseManager = () => {
  return hasRole('purchase_manager')
}

// Check if user is supervisor
export const isSupervisor = () => {
  return hasRole('supervisor')
}
