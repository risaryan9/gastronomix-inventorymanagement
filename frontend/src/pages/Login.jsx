import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const Login = () => {
  const [loginType, setLoginType] = useState(null) // 'admin', 'purchase_manager', 'supervisor'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginKey, setLoginKey] = useState('')
  const [selectedCloudKitchenId, setSelectedCloudKitchenId] = useState('')
  const [cloudKitchens, setCloudKitchens] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingCloudKitchens, setLoadingCloudKitchens] = useState(false)
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

  // Fetch cloud kitchens when login type is purchase_manager or supervisor
  useEffect(() => {
    const fetchCloudKitchens = async () => {
      if (loginType === 'purchase_manager' || loginType === 'supervisor') {
        setLoadingCloudKitchens(true)
        try {
          const { data, error } = await supabase
            .from('cloud_kitchens')
            .select('id, name, code')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name', { ascending: true })

          if (error) {
            console.error('Error fetching cloud kitchens:', error)
            setError('Failed to load cloud kitchens')
            return
          }

          setCloudKitchens(data || [])
        } catch (err) {
          console.error('Error fetching cloud kitchens:', err)
          setError('Failed to load cloud kitchens')
        } finally {
          setLoadingCloudKitchens(false)
        }
      }
    }

    fetchCloudKitchens()
  }, [loginType])

  const handleKeyLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Validate cloud kitchen selection
    if (!selectedCloudKitchenId) {
      setError('Please select a cloud kitchen')
      setLoading(false)
      return
    }

    if (!loginKey.trim()) {
      setError('Please enter your login key')
      setLoading(false)
      return
    }

    try {
      console.log('Attempting login with:', {
        loginKey: loginKey.trim(),
        role: loginType,
        selectedCloudKitchenId: selectedCloudKitchenId
      })
      
      // Use RPC function to authenticate user (bypasses RLS)
      const { data: userDataArray, error: userError } = await supabase.rpc(
        'authenticate_user_by_key',
        {
          p_login_key: loginKey.trim(),
          p_role: loginType,
          p_cloud_kitchen_id: selectedCloudKitchenId
        }
      )

      console.log('RPC result:', { userDataArray, userError })

      if (userError) {
        console.error('Login error:', userError)
        console.error('Error details:', {
          code: userError.code,
          message: userError.message,
          details: userError.details,
          hint: userError.hint
        })
        throw new Error(userError.message || 'Failed to verify login key')
      }

      // RPC returns an array, get first result
      const userData = userDataArray && userDataArray.length > 0 ? userDataArray[0] : null

      if (!userData) {
        console.error('No user found with login_key:', loginKey.trim(), 'for cloud kitchen:', selectedCloudKitchenId)
        throw new Error('Invalid login key or user not found for this cloud kitchen')
      }

      console.log('User found:', {
        id: userData.id,
        full_name: userData.full_name,
        role: userData.role,
        cloud_kitchen_id: userData.cloud_kitchen_id,
        login_key: userData.login_key
      })

      // Fetch cloud kitchen name separately (join might fail due to RLS)
      let cloudKitchenName = null
      if (userData.cloud_kitchen_id) {
        try {
          const { data: cloudKitchenData, error: ckError } = await supabase
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
    setSelectedCloudKitchenId('')
    setCloudKitchens([])
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
                {/* Cloud Kitchen Selection */}
                <div>
                  <label htmlFor="cloudKitchen" className="block text-sm font-semibold mb-2 text-foreground">
                    Cloud Kitchen <span className="text-destructive">*</span>
                  </label>
                  {loadingCloudKitchens ? (
                    <div className="w-full bg-input border border-border rounded-lg px-4 py-3 text-muted-foreground">
                      Loading cloud kitchens...
                    </div>
                  ) : cloudKitchens.length === 0 ? (
                    <div className="w-full bg-input border border-destructive rounded-lg px-4 py-3 text-destructive text-sm">
                      No cloud kitchens available. Please contact administrator.
                    </div>
                  ) : (
                    <select
                      id="cloudKitchen"
                      value={selectedCloudKitchenId}
                      onChange={(e) => {
                        setSelectedCloudKitchenId(e.target.value)
                        setLoginKey('') // Clear login key when cloud kitchen changes
                        setError('') // Clear any previous errors
                      }}
                      required
                      className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                    >
                      <option value="">Select your cloud kitchen</option>
                      {cloudKitchens.map((kitchen) => (
                        <option key={kitchen.id} value={kitchen.id}>
                          {kitchen.name} ({kitchen.code})
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Select the cloud kitchen you belong to
                  </p>
                </div>

                {/* Login Key Input - Only show after cloud kitchen is selected */}
                {selectedCloudKitchenId && (
                  <div>
                    <label htmlFor="loginKey" className="block text-sm font-semibold mb-2 text-foreground">
                      Login Key <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="loginKey"
                      type="text"
                      value={loginKey}
                      onChange={(e) => setLoginKey(e.target.value)}
                      required
                      className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      placeholder="Enter your login key"
                      autoFocus
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Enter your unique login key for {cloudKitchens.find(ck => ck.id === selectedCloudKitchenId)?.name || 'this cloud kitchen'}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !selectedCloudKitchenId || !loginKey.trim() || loadingCloudKitchens}
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
