import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import PurchaseManagerDashboard from './pages/PurchaseManagerDashboard'
import SupervisorDashboard from './pages/SupervisorDashboard'
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
        />
        
        <Route 
          path="/invmanagement/dashboard/supervisor" 
          element={
            <ProtectedRoute allowedRoles={['supervisor']}>
              <SupervisorDashboard />
            </ProtectedRoute>
          } 
        />

        {/* Catch all - redirect to /invmanagement */}
        <Route path="*" element={<Navigate to="/invmanagement" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
