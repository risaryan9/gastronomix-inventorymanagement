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
import PMOutletDetails from './pages/purchase-manager/OutletDetails'
import SupervisorOutlets from './pages/supervisor/Outlets'
import SupervisorOutletDetails from './pages/supervisor/OutletDetails'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import SessionRedirect from './components/SessionRedirect'
import './App.css'

function App() {
  return (
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
        <Route 
          path="/invmanagement/dashboard/admin" 
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />

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
        </Route>

        {/* Catch all - redirect to /invmanagement */}
        <Route path="*" element={<Navigate to="/invmanagement" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
