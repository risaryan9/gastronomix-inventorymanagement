import { useState } from 'react'
import { matchPath, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContext.js'
import { useCart } from '../cart/cartContext.js'
import ThemeToggle from '../components/ThemeToggle.jsx'
import NavIcon from './NavIcon.jsx'
import { ACCOUNT_NAV, CART_ROUTE, DASHBOARD_NAV } from './navigation.js'

/*
 * The signed-in frame: a sidebar of sections, a top bar with the franchise,
 * the person signed in and the cart, and the section's page beside them. On a
 * phone the sidebar becomes a drawer behind the menu button.
 *
 * The cart is a highlighted gold icon at the top right, beside the theme
 * toggle, rather than a sidebar entry — one click away from every page. Each
 * outlet has its own cart, so inside an outlet's catalogue the icon opens that
 * outlet's cart; anywhere else it opens the list of carts. The count is the
 * number of lines across all of them.
 *
 * Built like the internal app's admin dashboard — cards on the navy ground,
 * the active section in gold — on the partner app's theme tokens.
 */

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`

function Sidebar({ onNavigate }) {
  return (
    <nav aria-label="Dashboard sections" className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-2 pb-6 pt-1">
        <img src="/gastronomix-logo.png" alt="" className="h-10 w-10 object-contain" />
        <div className="leading-tight">
          <p className="text-sm font-bold text-foreground">Gastronomix</p>
          <p className="text-xs text-muted-foreground">Partners</p>
        </div>
      </div>

      <ul className="space-y-1">
        {DASHBOARD_NAV.map((item) => (
          <li key={item.path}>
            <NavLink to={`/${item.path}`} end={item.path === ''} className={linkClass} onClick={onNavigate}>
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto border-t border-border pt-4">
        <NavLink to={`/${ACCOUNT_NAV.path}`} className={linkClass} onClick={onNavigate}>
          <NavIcon name={ACCOUNT_NAV.icon} />
          {ACCOUNT_NAV.label}
        </NavLink>
      </div>
    </nav>
  )
}

export default function DashboardLayout() {
  const { session, signOut } = useAuth()
  const { totalItems } = useCart()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut().catch(() => {})
    navigate('/login', { replace: true })
  }

  // In /order/:outletId, or already in one outlet's cart, the icon means that outlet.
  const inOutlet = matchPath('/order/:outletId', location.pathname)?.params.outletId
    || (location.pathname === `/${CART_ROUTE.path}` ? new URLSearchParams(location.search).get('outlet') : null)
  const cartLink = inOutlet ? `/${CART_ROUTE.path}?outlet=${inOutlet}` : `/${CART_ROUTE.path}`

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar: fixed on large screens */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card p-4 lg:block">
        <Sidebar />
      </aside>

      {/* Sidebar: drawer on small screens */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-card p-4 shadow-card">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground lg:hidden"
            >
              <NavIcon name="menu" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-foreground">{session?.franchise?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session?.user?.email}</p>
            </div>

            <NavLink
              to={cartLink}
              aria-label={totalItems ? `Cart, ${totalItems} item${totalItems === 1 ? '' : 's'}` : 'Cart'}
              title="Cart"
              className={({ isActive }) =>
                `relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-accent bg-accent text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 ${
                  isActive ? 'ring-2 ring-ring ring-offset-2 ring-offset-card' : ''
                }`
              }
            >
              <NavIcon name="cart" />
              {totalItems > 0 && (
                <span
                  key={totalItems}
                  className="absolute -right-2 -top-2 inline-flex h-5 min-w-5 animate-pop items-center justify-center rounded-full border-2 border-card bg-foreground px-1 text-[10px] font-black text-background"
                >
                  {totalItems}
                </span>
              )}
            </NavLink>
            <ThemeToggle />
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/80 px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-destructive/60 hover:text-foreground disabled:opacity-50"
            >
              <NavIcon name="signout" className="h-4 w-4" />
              <span className="hidden sm:inline">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
