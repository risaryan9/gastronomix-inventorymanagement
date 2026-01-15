# Session Handling Documentation

## Overview

This application implements comprehensive session-based authentication with role-based routing. The base path for all routes is `/invmanagement` to allow future integration into a larger domain.

## Routing Structure

### Base Routes

- `/` → Redirects to `/invmanagement`
- `/invmanagement` → Redirects based on session:
  - If logged in: `/invmanagement/dashboard/{role}`
  - If not logged in: `/invmanagement/login`

### Authentication Routes

- `/invmanagement/login` - Login page (redirects to dashboard if already logged in)

### Dashboard Routes (Protected)

- `/invmanagement/dashboard/admin` - Admin dashboard
- `/invmanagement/dashboard/purchase_manager` - Purchase Manager dashboard
- `/invmanagement/dashboard/supervisor` - Supervisor dashboard

## Session Management

### Session Storage

Sessions are stored in both `localStorage` and `sessionStorage`:

```javascript
{
  id: "user-uuid",
  full_name: "User Name",
  role: "admin|purchase_manager|supervisor",
  cloud_kitchen_id: "kitchen-uuid",
  email: "user@example.com",
  login_type: "auth|key",
  auth_user_id: "supabase-auth-id", // Only for admin
  expires_at: "ISO-date-string" // Only for key-based login
}
```

### Session Functions (lib/auth.js)

- `getSession()` - Retrieves current session, checks expiration
- `clearSession()` - Clears session data
- `isAuthenticated()` - Checks if user is logged in
- `getCurrentUser()` - Gets current user data
- `hasRole(role)` - Checks if user has specific role
- `isAdmin()` - Checks if user is admin
- `isPurchaseManager()` - Checks if user is purchase manager
- `isSupervisor()` - Checks if user is supervisor

## Route Protection

### ProtectedRoute Component

Protects routes that require authentication. Features:

- Redirects to `/invmanagement/login` if no session
- Checks role permissions if `allowedRoles` specified
- Redirects to user's own dashboard if role doesn't match

```jsx
<ProtectedRoute allowedRoles={['admin']}>
  <AdminDashboard />
</ProtectedRoute>
```

### PublicRoute Component

Protects login page from authenticated users:

- Redirects authenticated users to their role-based dashboard
- Allows unauthenticated users to access the page

```jsx
<PublicRoute>
  <Login />
</PublicRoute>
```

## Login Flow

### Admin Login (Email/Password)

1. User enters email and password
2. Authenticates via Supabase Auth
3. Verifies admin role in users table
4. Creates session with `login_type: 'auth'`
5. Redirects to `/invmanagement/dashboard/admin`

### Key-Based Login (Purchase Manager/Supervisor)

1. User enters login key
2. Queries users table for matching key and role
3. Verifies user is active
4. Creates session with `login_type: 'key'` and 7-day expiration
5. Redirects to role-specific dashboard

## Dashboard Features

Each dashboard displays:

- **Session Information Card**
  - Full Name
  - Role
  - Email
  - Login Type
  - Cloud Kitchen ID (if applicable)

- **Role-Specific Actions**
  - Admin: User Management, Inventory, Reports
  - Purchase Manager: Purchase Orders, Suppliers, Inventory
  - Supervisor: Inventory, Stock Updates, Reports

- **Logout Button**
  - Clears session
  - Signs out from Supabase (if auth login)
  - Redirects to `/invmanagement/login`

## Session Behavior

### Auto-Redirect Scenarios

1. **Root Access (`/`)**
   - Always redirects to `/invmanagement`

2. **Base Path (`/invmanagement`)**
   - With session → Role-based dashboard
   - Without session → Login page

3. **Login Page Access**
   - With session → Redirects to dashboard
   - Without session → Shows login page

4. **Direct Dashboard Access**
   - With valid session → Shows dashboard
   - Without session → Redirects to login
   - Wrong role → Redirects to correct dashboard

5. **Invalid Routes**
   - Redirects to `/invmanagement`

### Session Expiration

- **Admin (Auth)**: No expiration (managed by Supabase)
- **Key-Based**: 7-day expiration
- Expired sessions automatically clear and redirect to login

## Testing the Implementation

### Test Cases

1. **No Session**
   - Access `/` → Should redirect to `/invmanagement/login`
   - Access `/invmanagement` → Should redirect to `/invmanagement/login`
   - Access any dashboard → Should redirect to `/invmanagement/login`

2. **With Active Session (Admin)**
   - Access `/` → Should redirect to `/invmanagement/dashboard/admin`
   - Access `/invmanagement` → Should redirect to `/invmanagement/dashboard/admin`
   - Access `/invmanagement/login` → Should redirect to `/invmanagement/dashboard/admin`
   - Access `/invmanagement/dashboard/supervisor` → Should redirect to `/invmanagement/dashboard/admin`

3. **With Active Session (Purchase Manager)**
   - Should redirect to `/invmanagement/dashboard/purchase_manager` appropriately

4. **With Active Session (Supervisor)**
   - Should redirect to `/invmanagement/dashboard/supervisor` appropriately

## Files Modified/Created

### Created Files
- `src/components/ProtectedRoute.jsx` - Protected route wrapper
- `src/components/PublicRoute.jsx` - Public route wrapper
- `src/pages/AdminDashboard.jsx` - Admin dashboard
- `src/pages/PurchaseManagerDashboard.jsx` - Purchase manager dashboard
- `src/pages/SupervisorDashboard.jsx` - Supervisor dashboard

### Modified Files
- `src/App.jsx` - Added routing configuration
- `src/pages/Login.jsx` - Updated redirect paths to use `/invmanagement` base

### Dependencies Added
- `react-router-dom` - For client-side routing

## Future Enhancements

1. Session refresh/renewal before expiration
2. Remember me functionality
3. Session timeout warnings
4. Multi-factor authentication
5. Activity logging
6. Session management (view/revoke active sessions)
