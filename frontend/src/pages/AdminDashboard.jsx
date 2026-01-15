import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'

const AdminDashboard = () => {
  const [session, setSession] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const currentSession = getSession()
    setSession(currentSession)
  }, [])

  const handleLogout = async () => {
    // Sign out from Supabase if auth login
    if (session?.login_type === 'auth') {
      await supabase.auth.signOut()
    }
    
    clearSession()
    navigate('/invmanagement/login')
  }

  if (!session) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">Gastronomix Inventory Management</p>
            </div>
            <button
              onClick={handleLogout}
              className="bg-destructive text-destructive-foreground font-semibold px-4 py-2 rounded-lg hover:bg-destructive/90 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Session Info Card */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <h2 className="text-xl font-bold text-foreground mb-4">Session Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Full Name</p>
              <p className="font-semibold text-foreground">{session.full_name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Role</p>
              <p className="font-semibold text-foreground capitalize">{session.role}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-semibold text-foreground">{session.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Login Type</p>
              <p className="font-semibold text-foreground capitalize">{session.login_type}</p>
            </div>
            {session.cloud_kitchen_id && (
              <div>
                <p className="text-sm text-muted-foreground">Cloud Kitchen ID</p>
                <p className="font-semibold text-foreground">{session.cloud_kitchen_id}</p>
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-foreground mb-2">User Management</h3>
            <p className="text-sm text-muted-foreground mb-4">Manage users and roles</p>
            <button className="bg-accent text-background font-semibold px-4 py-2 rounded-lg hover:brightness-110 transition-all">
              Manage Users
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-foreground mb-2">Inventory</h3>
            <p className="text-sm text-muted-foreground mb-4">View and manage inventory</p>
            <button className="bg-accent text-background font-semibold px-4 py-2 rounded-lg hover:brightness-110 transition-all">
              View Inventory
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-foreground mb-2">Reports</h3>
            <p className="text-sm text-muted-foreground mb-4">Generate and view reports</p>
            <button className="bg-accent text-background font-semibold px-4 py-2 rounded-lg hover:brightness-110 transition-all">
              View Reports
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

export default AdminDashboard
