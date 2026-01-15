import { useState, useEffect } from 'react'
import { useNavigate, Outlet, NavLink } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'

const PurchaseManagerDashboard = () => {
  const [session, setSession] = useState(null)
  const [cloudKitchenName, setCloudKitchenName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const currentSession = getSession()
    setSession(currentSession)

    // Use cloud kitchen name from session if available (fetched during login)
    // Otherwise try to fetch it (for existing sessions that don't have it)
    if (currentSession?.cloud_kitchen_name) {
      setCloudKitchenName(currentSession.cloud_kitchen_name)
      setLoading(false)
    } else if (currentSession?.cloud_kitchen_id) {
      // Fallback: try to fetch if not in session (may fail due to RLS)
      const fetchCloudKitchen = async () => {
        try {
          const { data, error } = await supabase
            .from('cloud_kitchens')
            .select('name')
            .eq('id', currentSession.cloud_kitchen_id)
            .single()

          if (!error && data) {
            setCloudKitchenName(data.name)
          }
        } catch (err) {
          console.error('Error fetching cloud kitchen:', err)
        } finally {
          setLoading(false)
        }
      }
      fetchCloudKitchen()
    } else {
      setLoading(false)
    }
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
    { path: 'overview', label: 'Overview' },
    { path: 'stock-in', label: 'Stock In' },
    { path: 'materials', label: 'Materials' },
    { path: 'inventory', label: 'Inventory' },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="lg:hidden bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Gastronomix</h1>
          <p className="text-xs text-muted-foreground">Inventory Management</p>
        </div>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 rounded-lg hover:bg-accent/10 transition-colors"
        >
          <svg className="w-6 h-6 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Left Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo/Brand - Desktop only */}
        <div className="hidden lg:block p-6 border-b border-border">
          <h1 className="text-2xl font-bold text-foreground">Gastronomix</h1>
          <p className="text-sm text-muted-foreground mt-1">Inventory Management</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-2">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center px-4 py-3.5 rounded-xl transition-all duration-200 ${
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

        {/* Logout Button */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full bg-destructive text-destructive-foreground font-bold px-4 py-3 rounded-xl hover:bg-destructive/90 transition-all duration-200 shadow-md hover:shadow-lg"
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
        {/* Top Header */}
        <header className="bg-card border-b border-border">
          <div className="px-4 sm:px-6 lg:px-8 py-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground truncate">
                  Welcome, {session.full_name.split(' ')[0]}
                </h2>
                <p className="mt-2 text-sm sm:text-base text-muted-foreground">
                  {titleCaseRole(session.role)}
                  {cloudKitchenName ? ` · ${cloudKitchenName}` : ''}
                </p>
              </div>
              <div className="text-left sm:text-right">
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

export default PurchaseManagerDashboard
