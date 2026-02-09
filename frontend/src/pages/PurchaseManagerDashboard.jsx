import { useState, useEffect } from 'react'
import { useNavigate, Outlet, NavLink } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import gastronomixLogo from '../assets/gastronomix-logo.png'

const PurchaseManagerDashboard = () => {
  const [session, setSession] = useState(null)
  const [cloudKitchenName, setCloudKitchenName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [notificationStats, setNotificationStats] = useState({
    pendingAllocationsToday: 0,
    lowStock: 0,
    noStock: 0
  })
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

  useEffect(() => {
    const fetchNotificationStats = async () => {
      const currentSession = getSession()
      if (!currentSession?.cloud_kitchen_id) return

      try {
        const todayStr = new Date().toISOString().split('T')[0]

        const [pendingAllocationsResult, inventoryResult] = await Promise.all([
          supabase
            .from('allocation_requests')
            .select('id')
            .eq('cloud_kitchen_id', currentSession.cloud_kitchen_id)
            .eq('request_date', todayStr)
            .eq('is_packed', false),
          supabase
            .from('inventory')
            .select(`
              quantity,
              raw_material_id,
              raw_materials!inner (
                id,
                low_stock_threshold
              )
            `)
            .eq('cloud_kitchen_id', currentSession.cloud_kitchen_id)
        ])

        const pendingAllocationsToday = pendingAllocationsResult.data?.length || 0

        let lowStock = 0
        let noStock = 0

        if (inventoryResult.data) {
          inventoryResult.data.forEach(item => {
            const quantity = parseFloat(item.quantity) || 0
            const threshold = parseFloat(item.raw_materials?.low_stock_threshold || 0)

            if (quantity === 0) {
              noStock++
            } else if (quantity > 0 && quantity <= threshold) {
              lowStock++
            }
          })
        }

        setNotificationStats({
          pendingAllocationsToday,
          lowStock,
          noStock
        })
      } catch (err) {
        console.error('Error fetching notification stats:', err)
      }
    }

    fetchNotificationStats()
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
    { path: 'stock-out', label: 'Stock Out' },
    { path: 'materials', label: 'Materials' },
    { path: 'inventory', label: 'Inventory' },
    { path: 'outlets', label: 'Outlets' },
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

      {/* Left Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col
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
                  <span className="flex-1">{item.label}</span>

                  {/* Stock Out notifications: hourglass + count for pending allocations today */}
                  {item.path === 'stock-out' && notificationStats.pendingAllocationsToday > 0 && (
                    <span
                      className="ml-2 inline-flex items-center justify-center px-1.5 h-5 rounded-full bg-accent/20 text-accent text-[11px] font-semibold gap-1"
                      aria-label="Pending allocations today"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 5h8M8 19h8M9 5v3l3 3 3-3V5M9 19v-3l3-3 3 3v3"
                        />
                      </svg>
                      <span>{notificationStats.pendingAllocationsToday}</span>
                    </span>
                  )}

                  {/* Inventory notifications: single arrow + count for low stock, double arrows + count for no stock */}
                  {item.path === 'inventory' && (notificationStats.lowStock > 0 || notificationStats.noStock > 0) && (
                    <span className="ml-2 flex items-center gap-1" aria-label="Inventory alerts">
                      {notificationStats.lowStock > 0 && (
                        <span className="inline-flex items-center justify-center px-1.5 h-4 rounded-full bg-yellow-500/20 text-yellow-600 text-[10px] font-bold gap-0.5">
                          <span>↓</span>
                          <span>{notificationStats.lowStock}</span>
                        </span>
                      )}
                      {notificationStats.noStock > 0 && (
                        <span className="inline-flex items-center justify-center px-1.5 h-4 rounded-full bg-destructive/20 text-destructive text-[10px] font-bold gap-0.5">
                          <span>↓↓</span>
                          <span>{notificationStats.noStock}</span>
                        </span>
                      )}
                    </span>
                  )}
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
            <div className="flex items-center gap-4 mb-4">
              <img 
                src={gastronomixLogo} 
                alt="Gastronomix" 
                className="h-10 sm:h-12 w-auto object-contain"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground truncate">
                  Welcome, {session.full_name.split(' ')[0]}
                </h2>
                <p className="mt-2 text-sm sm:text-base text-muted-foreground">
                  {titleCaseRole(session.role)}
                  {(cloudKitchenName || session.cloud_kitchen_name) ? ` · ${cloudKitchenName || session.cloud_kitchen_name}` : ''}
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
