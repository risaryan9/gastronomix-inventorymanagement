import { Navigate } from 'react-router-dom'
import { getSession } from '../lib/auth'

/**
 * PublicRoute component
 * Redirects to dashboard if user is already logged in
 */
const PublicRoute = ({ children }) => {
  const session = getSession()

  // If user has a session, redirect to their role-based dashboard
  if (session) {
    return <Navigate to={`/invmanagement/dashboard/${session.role}`} replace />
  }

  return children
}

export default PublicRoute
