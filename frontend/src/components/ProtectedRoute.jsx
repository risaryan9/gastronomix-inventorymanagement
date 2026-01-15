import { Navigate } from 'react-router-dom'
import { getSession } from '../lib/auth'

/**
 * ProtectedRoute component
 * Redirects to login if no session exists
 * Optionally checks for specific roles
 */
const ProtectedRoute = ({ children, allowedRoles = null }) => {
  const session = getSession()

  // No session - redirect to login
  if (!session) {
    return <Navigate to="/invmanagement/login" replace />
  }

  // Check if user has required role
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    // Redirect to their own dashboard if they don't have access
    return <Navigate to={`/invmanagement/dashboard/${session.role}`} replace />
  }

  return children
}

export default ProtectedRoute
