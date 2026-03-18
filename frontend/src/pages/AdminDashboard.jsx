import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import Materials from './purchase-manager/Materials'
import AdminUsers from './admin/AdminUsers'
import AdminOperators from './admin/AdminOperators'

const NAV_STRUCTURE = [
  {
    id: 'overview',
    label: 'Overview',
    children: [
      { id: 'cloud-kitchen', label: 'Cloud Kitchen' },
      { id: 'outlets', label: 'Outlets' }
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    children: [
      { id: 'sales', label: 'Sales' },
      { id: 'performance', label: 'Performance' },
      { id: 'trends', label: 'Trends' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    children: [
      { id: 'materials', label: 'Materials' },
      { id: 'users', label: 'Users' },
      { id: 'operators', label: 'Operators' },
      { id: 'preferences', label: 'Preferences' },
    ],
  },
  {
    id: 'audits',
    label: 'Audits',
    children: [
      { id: 'user-audit-logs', label: 'User Audit Logs' },
      { id: 'cloud-kitchen-audit-logs', label: 'Cloud Kitchen Audit Logs' },
      { id: 'alerts', label: 'Alerts' },
    ],
  },
]

const AdminDashboard = () => {
  const [session, setSession] = useState(null)
  const [activeParentId, setActiveParentId] = useState('overview')
  const [activeChildId, setActiveChildId] = useState('cloud-kitchen')
  const [expandedParents, setExpandedParents] = useState(
    () => NAV_STRUCTURE.map((parent) => parent.id) // all expanded by default
  )
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

  const activeParent = NAV_STRUCTURE.find((p) => p.id === activeParentId)
  const activeChild = activeParent?.children.find((c) => c.id === activeChildId)
  const isMaterialsSection =
    activeParentId === 'settings' && activeChildId === 'materials'
  const isUsersSection =
    activeParentId === 'settings' && activeChildId === 'users'
  const isOperatorsSection =
    activeParentId === 'settings' && activeChildId === 'operators'

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
      <main className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="w-72 shrink-0">
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-4">
                {NAV_STRUCTURE.map((parent) => (
                  <div key={parent.id} className="mb-4 last:mb-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveParentId(parent.id)
                        // Default to first child when switching parent
                        if (parent.children?.length) {
                          setActiveChildId(parent.children[0].id)
                        }
                        setExpandedParents((prev) =>
                          prev.includes(parent.id)
                            ? prev.filter((id) => id !== parent.id)
                            : [...prev, parent.id]
                        )
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-1.5 py-2 rounded-md text-base font-semibold tracking-tight transition-colors ${
                        activeParentId === parent.id
                          ? 'bg-accent text-black'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span>{parent.label}</span>
                      <span
                        className={`transition-transform duration-200 ${
                          expandedParents.includes(parent.id) ? 'rotate-90' : 'rotate-0'
                        }`}
                        aria-hidden="true"
                      >
                        ▸
                      </span>
                    </button>
                    <div
                      className={`mt-1 pl-1 overflow-hidden transition-all duration-300 ease-out ${
                        expandedParents.includes(parent.id)
                          ? 'max-h-40 opacity-100'
                          : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="space-y-0.5">
                        {parent.children.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            onClick={() => {
                              setActiveParentId(parent.id)
                              setActiveChildId(child.id)
                            }}
                            className={`w-full text-left pl-6 pr-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                              activeParentId === parent.id && activeChildId === child.id
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:bg-muted/60'
                            }`}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Session Info under sidebar */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h2 className="text-sm font-semibold text-foreground mb-3">Session Information</h2>
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Full Name</dt>
                    <dd className="font-semibold text-foreground">{session.full_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Role</dt>
                    <dd className="font-semibold text-foreground capitalize">{session.role}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="font-semibold text-foreground break-all">{session.email}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Login Type</dt>
                    <dd className="font-semibold text-foreground capitalize">{session.login_type}</dd>
                  </div>
                  {session.cloud_kitchen_id && (
                    <div>
                      <dt className="text-muted-foreground">Cloud Kitchen ID</dt>
                      <dd className="font-semibold text-foreground">{session.cloud_kitchen_id}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </aside>

          {/* Content Area */}
          <section className="flex-1">
            {isMaterialsSection ? (
              <div className="-mt-2">
                <Materials isAdminMode={true} />
              </div>
            ) : isUsersSection ? (
              <div className="-mt-2">
                <AdminUsers />
              </div>
            ) : isOperatorsSection ? (
              <div className="-mt-2">
                <AdminOperators />
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-8 flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {activeParent?.label} / {activeChild?.label}
                </p>
                <h2 className="text-2xl font-bold text-foreground">
                  {activeChild?.label} <span className="text-muted-foreground text-base">section</span>
                </h2>
                <p className="text-sm text-muted-foreground max-w-xl">
                  This is a placeholder for the{' '}
                  <span className="font-semibold text-foreground">
                    {activeParent?.label} &gt; {activeChild?.label}
                  </span>{' '}
                  area of the admin dashboard. We&apos;ll build out this section in detail next.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

export default AdminDashboard
