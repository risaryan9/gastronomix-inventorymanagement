import { Navigate } from 'react-router-dom'
import { getSession } from '../lib/auth'

/**
 * SessionRedirect
 * Uses the current session (if any) to send the user
 * either to their role-based dashboard or to the login page.
 */
const SessionRedirect = () => {
  const session = getSession()

  if (!session) {
    return <Navigate to="/invmanagement/login" replace />
  }

  return <Navigate to={`/invmanagement/dashboard/${session.role}`} replace />
}

export default SessionRedirect

