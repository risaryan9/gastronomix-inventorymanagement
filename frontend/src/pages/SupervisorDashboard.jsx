import { useState, useEffect } from 'react'
import { useNavigate, Outlet, NavLink } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import gastronomixLogo from '../assets/gastronomix-logo.png'

const SupervisorDashboard = () => {
  const [session, setSession] = useState(null)
  const [cloudKitchenName, setCloudKitchenName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const currentSession = getSession()
    setSession(currentSession)

    // Use cloud kitchen name from session (fetched during login)
    // No need to fetch again - it's already stored in the session
    if (currentSession?.cloud_kitchen_name) {
      setCloudKitchenName(currentSession.cloud_kitchen_name)
    } else {
      // If not in session, set to null explicitly
      setCloudKitchenName(null)
    }
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

  // Helper function to title case role
  const titleCaseRole = (role) => {
    return role
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  // Navigation items
  const navItems = [
    { path: 'outlets', label: 'Outlets' },
    { path: 'inventory', label: 'Inventory' },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="lg:hidden bg-card border-b border-border px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <img 
            src={gastronomixLogo} 
            alt="Gastronomix" 
            className="h-8 w-auto object-contain"
          />
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-lg hover:bg-accent/10 transition-colors flex-shrink-0 touch-manipulation"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-foreground truncate">
            Welcome, {session?.full_name?.split(' ')[0] || 'User'}
          </h2>
          <p className="text-xs text-muted-foreground truncate">
            {session ? titleCaseRole(session.role) : ''}
            {(cloudKitchenName || session?.cloud_kitchen_name) ? ` · ${cloudKitchenName || session.cloud_kitchen_name}` : ''}
          </p>
        </div>
      </div>

      {/* Left Sidebar - Mobile First: Full width on mobile */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-full lg:w-72 bg-card border-r border-border flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo/Brand - Desktop and Mobile Sidebar */}
        <div className="p-4 lg:p-6 border-b border-border">
          <img 
            src={gastronomixLogo} 
            alt="Gastronomix" 
            className="h-8 lg:h-10 w-auto mb-2 object-contain"
          />
          <p className="text-xs lg:text-sm text-muted-foreground">Inventory Management</p>
        </div>

        {/* Navigation - Mobile First: Larger touch targets */}
        <nav className="flex-1 p-4 lg:p-4 overflow-y-auto">
          <ul className="space-y-3">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center px-5 py-4 lg:px-4 lg:py-3.5 rounded-xl transition-all duration-200 text-base lg:text-sm ${
                      isActive
                        ? 'bg-accent text-background font-bold shadow-lg'
                        : 'text-foreground hover:bg-accent/10 font-medium'
                    }`
                  }
                >
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Logout Button - Mobile First: Larger touch target */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full bg-destructive text-destructive-foreground font-bold px-5 py-4 lg:px-4 lg:py-3 rounded-xl hover:bg-destructive/90 transition-all duration-200 shadow-md hover:shadow-lg text-base lg:text-sm"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header - Desktop only (mobile shows in top bar) */}
        <header className="hidden lg:block bg-card border-b border-border">
          <div className="px-8 py-5">
            <div className="flex items-center gap-4 mb-4">
              <img 
                src={gastronomixLogo} 
                alt="Gastronomix" 
                className="h-12 w-auto object-contain"
              />
            </div>
            <div className="flex flex-row items-center justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-3xl font-bold text-foreground truncate">
                  Welcome, {session.full_name.split(' ')[0]}
                </h2>
                <p className="mt-2 text-base text-muted-foreground">
                  {titleCaseRole(session.role)}
                  {(cloudKitchenName || session.cloud_kitchen_name) ? ` · ${cloudKitchenName || session.cloud_kitchen_name}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground truncate">{session.email}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default SupervisorDashboard
