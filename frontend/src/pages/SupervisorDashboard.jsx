import { useState, useEffect } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import gastronomixLogo from '../assets/gastronomix-logo.png'

const SupervisorDashboard = () => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const currentSession = getSession()
    setSession(currentSession)
    setLoading(false)
  }, [])

  const handleLogout = () => {
    clearSession()
    navigate('/invmanagement/login')
  }

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    )
  }

  const firstName = session.full_name?.split(' ')[0] || 'User'
  const cloudKitchenName = session.cloud_kitchen_name

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar with branding and supervisor context, but no nav */}
      <header className="bg-card border-b border-border px-4 lg:px-8 py-3 lg:py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <img
              src={gastronomixLogo}
              alt="Gastronomix"
              className="h-8 lg:h-10 w-auto object-contain flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs lg:text-sm text-muted-foreground uppercase tracking-wide">
                Supervisor Dashboard
              </p>
              <h1 className="text-sm lg:text-xl font-semibold text-foreground truncate">
                Welcome, {firstName}
              </h1>
              <p className="text-xs lg:text-sm text-muted-foreground truncate">
                {cloudKitchenName ? `Cloud Kitchen: ${cloudKitchenName}` : null}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="bg-destructive text-destructive-foreground font-semibold px-3 lg:px-4 py-2 rounded-lg hover:bg-destructive/90 transition-colors text-xs lg:text-sm flex-shrink-0"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main content shows only the nested page (Outlets / Outlet details) */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

export default SupervisorDashboard
