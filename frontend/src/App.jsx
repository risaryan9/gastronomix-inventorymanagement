import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import PurchaseManagerDashboard from './pages/PurchaseManagerDashboard'
import SupervisorDashboard from './pages/SupervisorDashboard'
import Overview from './pages/purchase-manager/Overview'
import StockIn from './pages/purchase-manager/StockIn'
import Materials from './pages/purchase-manager/Materials'
import Inventory from './pages/purchase-manager/Inventory'
import Outlets from './pages/supervisor/Outlets'
import OutletDetails from './pages/supervisor/OutletDetails'
import SupervisorInventory from './pages/supervisor/Inventory'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import { getSession } from './lib/auth'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Root redirect to /invmanagement */}
        <Route path="/" element={<Navigate to="/invmanagement" replace />} />
        
        {/* /invmanagement redirect based on session */}
        <Route 
          path="/invmanagement" 
          element={
            (() => {
              const session = getSession()
              if (session) {
                return <Navigate to={`/invmanagement/dashboard/${session.role}`} replace />
              }
              return <Navigate to="/invmanagement/login" replace />
            })()
          } 
        />

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
          <Route path="materials" element={<Materials />} />
          <Route path="inventory" element={<Inventory />} />
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
          <Route path="outlets" element={<Outlets />} />
          <Route path="outlets/:outletId" element={<OutletDetails />} />
          <Route path="inventory" element={<SupervisorInventory />} />
        </Route>

        {/* Catch all - redirect to /invmanagement */}
        <Route path="*" element={<Navigate to="/invmanagement" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
