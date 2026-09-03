import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import PurchaseManagerDashboard from './pages/PurchaseManagerDashboard'
import SupervisorDashboard from './pages/SupervisorDashboard'
import DispatchExecutiveDashboard from './pages/DispatchExecutiveDashboard'
import KitchenExecutiveDashboard from './pages/KitchenExecutiveDashboard'
import Overview from './pages/purchase-manager/Overview'
import StockIn from './pages/purchase-manager/StockIn'
import StockOut from './pages/purchase-manager/StockOut'
import Materials from './pages/purchase-manager/Materials'
import Inventory from './pages/purchase-manager/Inventory'
import PMOutlets from './pages/purchase-manager/Outlets'
import PMReturns from './pages/purchase-manager/Returns'
import PMOutletDetails from './pages/purchase-manager/OutletDetails'
import SupervisorOutlets from './pages/supervisor/Outlets'
import SupervisorOutletDetails from './pages/supervisor/OutletDetails'
import SupervisorCheckout from './pages/supervisor/Checkout'
import AdminSectionPlaceholder from './pages/admin/AdminSectionPlaceholder'
import {
  ADMIN_NAV,
  ADMIN_DEFAULT_PATH,
  adminGroupDefaultPath,
} from './pages/admin/adminNavigation'
import ToastProvider from './components/ui/ToastProvider'
import ConfirmProvider from './components/ui/ConfirmProvider'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import SessionRedirect from './components/SessionRedirect'
import './App.css'

function App() {
  // Quantity/number inputs must only change by typing. The native spinner
  // buttons are hidden via CSS, but a focused number input still changes its
  // value on scroll-wheel and on Up/Down arrows — both easy to trigger by
  // accident (e.g. scrolling a modal's item list). Neutralise them globally.
  useEffect(() => {
    const handleWheel = () => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement && el.type === 'number') {
        // Drop focus so the wheel scrolls the page instead of nudging the value.
        el.blur()
      }
    }
    const handleKeyDown = (e) => {
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        e.target instanceof HTMLInputElement &&
        e.target.type === 'number'
      ) {
        e.preventDefault()
      }
    }
    // passive:true is fine — we blur rather than preventDefault, so the page
    // still scrolls normally.
    window.addEventListener('wheel', handleWheel, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    // Both providers sit above the router so any screen can raise a toast or a
    // confirmation without wiring anything through props.
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            {/* Root redirect to session-based destination or login */}
            <Route path="/" element={<SessionRedirect />} />

            {/* Generic entry paths that should honor session */}
            <Route path="/invmanagement" element={<SessionRedirect />} />
            <Route path="/invmanagement/dashboard" element={<SessionRedirect />} />
            <Route path="/inventory" element={<SessionRedirect />} />

            {/* Public route - Login */}
            <Route 
              path="/invmanagement/login" 
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              } 
            />

            {/* Protected routes - Dashboards */}
            {/* Admin routes are generated from ADMIN_NAV so the sidebar and the
                router can never disagree — see pages/admin/adminNavigation.jsx */}
            <Route
              path="/invmanagement/dashboard/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to={ADMIN_DEFAULT_PATH} replace />} />
              {ADMIN_NAV.map((group) => (
                <Route key={group.id} path={group.id}>
                  <Route index element={<Navigate to={adminGroupDefaultPath(group)} replace />} />
                  {group.children.flatMap((section) => {
                    const element = section.Component ? (
                      <section.Component {...(section.props ?? {})} />
                    ) : (
                      <AdminSectionPlaceholder groupLabel={group.label} sectionLabel={section.label} />
                    )

                    const routes = [
                      <Route key={section.id} path={section.id} element={element} />,
                    ]

                    // A section may also answer on a parameterised path — the same
                    // screen, told which record to show (see adminNavigation.js).
                    if (section.paramPath) {
                      routes.push(
                        <Route
                          key={`${section.id}-param`}
                          path={`${section.id}/${section.paramPath}`}
                          element={element}
                        />
                      )
                    }

                    return routes
                  })}
                </Route>
              ))}
              {/* An unknown admin URL lands on the dashboard's default section
                  rather than bouncing the admin out to the session redirect. */}
              <Route path="*" element={<Navigate to={ADMIN_DEFAULT_PATH} replace />} />
            </Route>

            <Route 
              path="/invmanagement/dashboard/dispatch_executive" 
              element={
                <ProtectedRoute allowedRoles={['dispatch_executive']}>
                  <DispatchExecutiveDashboard />
                </ProtectedRoute>
              } 
            />

            <Route 
              path="/invmanagement/dashboard/kitchen_executive" 
              element={
                <ProtectedRoute allowedRoles={['kitchen_executive']}>
                  <KitchenExecutiveDashboard />
                </ProtectedRoute>
              } 
            />
        
            <Route 
              path="/invmanagement/dashboard/purchase_manager" 
              element={
                <ProtectedRoute allowedRoles={['purchase_manager']}>
                  <PurchaseManagerDashboard />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<Overview />} />
              <Route path="stock-in" element={<StockIn />} />
              <Route path="stock-out" element={<StockOut />} />
              <Route path="materials" element={<Materials />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="returns" element={<PMReturns />} />
              <Route path="outlets" element={<PMOutlets />} />
              <Route path="outlets/:outletId" element={<PMOutletDetails />} />
            </Route>
        
            <Route 
              path="/invmanagement/dashboard/supervisor" 
              element={
                <ProtectedRoute allowedRoles={['supervisor']}>
                  <SupervisorDashboard />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="outlets" replace />} />
              <Route path="outlets" element={<SupervisorOutlets />} />
              <Route path="outlets/:outletId" element={<SupervisorOutletDetails />} />
              <Route path="checkout" element={<SupervisorCheckout />} />
            </Route>

            <Route 
              path="/invmanagement/dashboard/bp_operator" 
              element={
                <ProtectedRoute allowedRoles={['bp_operator']}>
                  <SupervisorDashboard hideClosingForm={true} />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="outlets" replace />} />
              <Route path="outlets" element={<SupervisorOutlets isBpOperator={true} />} />
              <Route path="outlets/:outletId" element={<SupervisorOutletDetails />} />
            </Route>

            {/* Catch all - redirect to /invmanagement */}
            <Route path="*" element={<Navigate to="/invmanagement" replace />} />
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  )
}

export default App
