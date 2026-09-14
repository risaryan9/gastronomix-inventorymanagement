import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './authContext.js'
import FullPageLoader from '../components/FullPageLoader.jsx'

// Routes inside this need a signed-in franchise user. Anyone else is sent to
// sign in, and brought back to where they were going afterwards.
export default function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageLoader />
  if (status === 'signedOut') {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`} replace />
  }
  return <Outlet />
}
