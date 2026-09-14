import { Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.jsx'
import DashboardLayout from './dashboard/DashboardLayout.jsx'
import { ACCOUNT_NAV, CART_ROUTE, DASHBOARD_EXTRA_ROUTES, DASHBOARD_NAV } from './dashboard/navigation.js'
import Login from './pages/auth/Login.jsx'
import ForgotPassword from './pages/auth/ForgotPassword.jsx'
import ResetPassword from './pages/auth/ResetPassword.jsx'
import Register from './pages/auth/Register.jsx'
import Status from './pages/Status.jsx'
import NotFound from './pages/NotFound.jsx'

/*
 * Every page of the partner app.
 *
 *   Signed out   /login  /forgot-password  /reset-password  /register  /status
 *   Signed in    the dashboard sections in dashboard/navigation.js
 *
 * vercel.json sends every non-/api path to index.html, so a refresh or a
 * bookmarked link lands here and is routed in the browser.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/register" element={<Register />} />
      <Route path="/status" element={<Status />} />

      <Route element={<RequireAuth />}>
        <Route element={<DashboardLayout />}>
          {[...DASHBOARD_NAV, ACCOUNT_NAV, CART_ROUTE, ...DASHBOARD_EXTRA_ROUTES].map(({ path, Component }) =>
            path === ''
              ? <Route key="index" index element={<Component />} />
              : <Route key={path} path={path} element={<Component />} />
          )}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
