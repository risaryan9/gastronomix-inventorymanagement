import { useState } from 'react'
import { useNavigate, useLocation, NavLink, Outlet } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  ADMIN_NAV,
  adminSectionPath,
  adminGroupDefaultPath,
  resolveAdminSection,
} from './admin/adminNavigation'

const AdminDashboard = () => {
  // getSession() is a synchronous localStorage read, so there is no reason to
  // start at null and fill it in from an effect — that only costs a blank render.
  const [session] = useState(getSession)
  const navigate = useNavigate()
  const location = useLocation()

  const { group: activeGroup } = resolveAdminSection(location.pathname)

  // Manual expand/collapse, seeded from the URL so a deep link or a refresh
  // opens the group the user actually landed in.
  const [expandedGroupIds, setExpandedGroupIds] = useState(() =>
    activeGroup ? [activeGroup.id] : []
  )

  // Landing in a group by any route other than a sidebar click — back/forward,
  // a pasted link — must open it too. Adjusting during render rather than in an
  // effect avoids rendering the sidebar once with the wrong group folded shut.
  const [lastOpenedGroupId, setLastOpenedGroupId] = useState(activeGroup?.id ?? null)
  if (activeGroup && activeGroup.id !== lastOpenedGroupId) {
    setLastOpenedGroupId(activeGroup.id)
    setExpandedGroupIds((prev) =>
      prev.includes(activeGroup.id) ? prev : [...prev, activeGroup.id]
    )
  }

  const handleLogout = async () => {
    // Sign out from Supabase if auth login
    if (session?.login_type === 'auth') {
      await supabase.auth.signOut()
    }

    clearSession()
    navigate('/invmanagement/login')
  }

  // Clicking the group you are already in just folds it away; clicking any
  // other group opens it and takes you to its first section.
  const handleGroupClick = (group) => {
    if (activeGroup?.id === group.id) {
      setExpandedGroupIds((prev) => prev.filter((id) => id !== group.id))
      return
    }

    setExpandedGroupIds((prev) => (prev.includes(group.id) ? prev : [...prev, group.id]))
    navigate(adminGroupDefaultPath(group))
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
      <main className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="w-72 shrink-0">
            <div className="space-y-4">
              <nav aria-label="Admin sections" className="bg-card border border-border rounded-xl p-4">
                {ADMIN_NAV.map((group) => {
                  const isExpanded = expandedGroupIds.includes(group.id)
                  const panelId = `admin-nav-panel-${group.id}`

                  return (
                    <div key={group.id} className="mb-4 last:mb-0">
                      <button
                        type="button"
                        onClick={() => handleGroupClick(group)}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        className={`w-full flex items-center justify-between gap-2 px-1.5 py-2 rounded-md text-base font-semibold tracking-tight transition-colors ${
                          activeGroup?.id === group.id
                            ? 'bg-accent text-background'
                            : 'text-foreground hover:bg-muted'
                        }`}
                      >
                        <span>{group.label}</span>
                        <span
                          className={`transition-transform duration-200 ${
                            isExpanded ? 'rotate-90' : 'rotate-0'
                          }`}
                          aria-hidden="true"
                        >
                          ▸
                        </span>
                      </button>
                      {/* `inert` keeps collapsed items out of the tab order while
                          leaving the height/opacity transition intact. */}
                      <div
                        id={panelId}
                        inert={!isExpanded}
                        className={`mt-1 pl-1 transition-all duration-300 ease-out ${
                          isExpanded
                            ? 'max-h-[min(70vh,28rem)] opacity-100 overflow-y-auto'
                            : 'max-h-0 opacity-0 overflow-hidden'
                        }`}
                      >
                        <div className="space-y-0.5">
                          {group.children.map((section) => (
                            <NavLink
                              key={section.id}
                              to={adminSectionPath(group.id, section.id)}
                              className={({ isActive }) =>
                                `block w-full text-left pl-6 pr-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                  isActive
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/60'
                                }`
                              }
                            >
                              {section.label}
                            </NavLink>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </nav>

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
            <div className="-mt-2">
              <Outlet />
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default AdminDashboard
