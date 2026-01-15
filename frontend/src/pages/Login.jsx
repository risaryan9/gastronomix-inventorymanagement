import { useState } from 'react'
import { supabase } from '../lib/supabase'

const Login = () => {
  const [loginType, setLoginType] = useState(null) // 'admin', 'purchase_manager', 'supervisor'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginKey, setLoginKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAdminLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      // Verify user is admin in our users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .eq('role', 'admin')
        .single()

      if (userError || !userData) {
        await supabase.auth.signOut()
        throw new Error('Unauthorized: Admin access only')
      }

      // Store session data
      const sessionData = {
        id: userData.id,
        full_name: userData.full_name,
        role: userData.role,
        cloud_kitchen_id: userData.cloud_kitchen_id,
        email: userData.email,
        login_type: 'auth',
        auth_user_id: data.user.id
      }

      localStorage.setItem('user_session', JSON.stringify(sessionData))
      sessionStorage.setItem('user', JSON.stringify(sessionData))

      // Redirect to role-based dashboard
      window.location.href = `/invmanagement/dashboard/${userData.role}`
    } catch (err) {
      setError(err.message || 'Failed to login')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Use regular client - RLS policy allows login_key lookups
      const client = supabase
      
      // Query users table for matching login_key
      const { data: userData, error: userError } = await client
        .from('users')
        .select('*')
        .eq('login_key', loginKey.trim())
        .eq('role', loginType)
        .eq('is_active', true)
        .maybeSingle()

      if (userError) {
        console.error('Login error:', userError)
        throw new Error(userError.message || 'Failed to verify login key')
      }

      if (!userData) {
        throw new Error('Invalid login key or user not found')
      }

      // Fetch cloud kitchen name separately (join might fail due to RLS)
      let cloudKitchenName = null
      if (userData.cloud_kitchen_id) {
        try {
          const { data: cloudKitchenData, error: ckError } = await client
            .from('cloud_kitchens')
            .select('name')
            .eq('id', userData.cloud_kitchen_id)
            .eq('is_active', true)
            .maybeSingle()

          if (!ckError && cloudKitchenData) {
            cloudKitchenName = cloudKitchenData.name
          }
        } catch (err) {
          console.error('Error fetching cloud kitchen name:', err)
          // Continue without cloud kitchen name if fetch fails
        }
      }

      // Create a custom session for key-based users
      // Store in localStorage for persistence
      const sessionData = {
        id: userData.id,
        full_name: userData.full_name,
        role: userData.role,
        cloud_kitchen_id: userData.cloud_kitchen_id,
        cloud_kitchen_name: cloudKitchenName,
        email: userData.email,
        login_type: 'key',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      }

      localStorage.setItem('user_session', JSON.stringify(sessionData))
      
      // Also set in sessionStorage for immediate access
      sessionStorage.setItem('user', JSON.stringify(sessionData))

      // Redirect to role-based dashboard
      window.location.href = `/invmanagement/dashboard/${userData.role}`
    } catch (err) {
      setError(err.message || 'Failed to login')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setLoginType(null)
    setEmail('')
    setPassword('')
    setLoginKey('')
    setError('')
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {!loginType ? (
          // Login Type Selection
          <div className="bg-card/90 backdrop-blur-md border-2 border-border rounded-2xl p-8 shadow-2xl shadow-black/50 animate-fade-in">
            <h1 className="text-3xl font-bold text-center mb-2 text-foreground">
              Gastronomix
            </h1>
            <p className="text-center text-muted-foreground mb-8">
              Inventory Management System
            </p>
            
            <div className="space-y-4">
              <button
                onClick={() => setLoginType('admin')}
                className="w-full bg-accent text-background font-black text-lg px-5 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-button-active transition-all duration-300 hover:brightness-110"
              >
                Admin Login
              </button>
              
              <button
                onClick={() => setLoginType('purchase_manager')}
                className="w-full bg-transparent text-accent font-black text-lg px-5 py-3 rounded-xl border-3 border-accent hover:bg-accent/10 transition-all duration-300"
              >
                Purchase Manager
              </button>
              
              <button
                onClick={() => setLoginType('supervisor')}
                className="w-full bg-transparent text-accent font-black text-lg px-5 py-3 rounded-xl border-3 border-accent hover:bg-accent/10 transition-all duration-300"
              >
                Supervisor
              </button>
            </div>
          </div>
        ) : (
          // Login Form
          <div className="bg-card/90 backdrop-blur-md border-2 border-border rounded-2xl p-8 shadow-2xl shadow-black/50 animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-foreground">
                {loginType === 'admin' ? 'Admin Login' : 
                 loginType === 'purchase_manager' ? 'Purchase Manager Login' : 
                 'Supervisor Login'}
              </h2>
              <button
                onClick={resetForm}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-destructive/20 border border-destructive rounded-lg text-destructive-foreground text-sm">
                {error}
              </div>
            )}

            {loginType === 'admin' ? (
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold mb-2 text-foreground">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                    placeholder="admin@gastronomix.com"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-semibold mb-2 text-foreground">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                    placeholder="Enter your password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent text-background font-black text-lg px-5 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-button-active transition-all duration-300 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Logging in...' : 'Login'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleKeyLogin} className="space-y-4">
                <div>
                  <label htmlFor="loginKey" className="block text-sm font-semibold mb-2 text-foreground">
                    Login Key
                  </label>
                  <input
                    id="loginKey"
                    type="text"
                    value={loginKey}
                    onChange={(e) => setLoginKey(e.target.value)}
                    required
                    className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                    placeholder="Enter your login key"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Enter your unique login key to access the system
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent text-background font-black text-lg px-5 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-button-active transition-all duration-300 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Logging in...' : 'Login'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Login
