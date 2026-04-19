import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'
import MultiSelectFilter from '../../components/MultiSelectFilter'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'purchase_manager', label: 'Purchase Manager' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'bp_operator', label: 'Boom Pizza Operator' },
]

const AdminUsers = () => {
  const [users, setUsers] = useState([])
  const [cloudKitchens, setCloudKitchens] = useState([])
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState(['all'])

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    role: '',
    cloud_kitchen_id: '',
    phone_number: '',
    login_key: '',
    outlet_map: '',
    is_active: true,
  })

  const resetForm = () => {
    setEditingUser(null)
    setFormData({
      full_name: '',
      email: '',
      role: '',
      cloud_kitchen_id: '',
      phone_number: '',
      login_key: '',
      outlet_map: '',
      is_active: true,
    })
    setFormError('')
    setOutlets([])
  }

  const fetchCloudKitchens = async () => {
    try {
      const { data, error } = await supabase
        .from('cloud_kitchens')
        .select('id, name, code')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      setCloudKitchens(data || [])
    } catch (err) {
      console.error('Error fetching cloud kitchens:', err)
    }
  }

  const fetchUsers = async () => {
    try {
      setLoading(true)
      setError('')
      const { data, error } = await supabase
        .from('users')
        .select('*, cloud_kitchens(name, code), outlets(id, code, name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error
      setUsers(data || [])
    } catch (err) {
      console.error('Error fetching users:', err)
      setError('Failed to load users. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
    fetchCloudKitchens()
  }, [])

  const filteredUsers = users.filter((u) => {
    if (search.trim()) {
      const q = search.toLowerCase()
      const inName = (u.full_name || '').toLowerCase().includes(q)
      const inLoginKey = (u.login_key || '').toLowerCase().includes(q)
      const inPhone = (u.phone_number || '').toLowerCase().includes(q)
      if (!inName && !inLoginKey && !inPhone) return false
    }
    if (!roleFilter.includes('all') && !roleFilter.includes(u.role)) return false
    return true
  })

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = async (user) => {
    setEditingUser(user)
    setFormData({
      full_name: user.full_name || '',
      email: user.email || '',
      role: user.role || '',
      cloud_kitchen_id: user.cloud_kitchen_id || '',
      phone_number: user.phone_number || '',
      login_key: user.login_key || '',
      outlet_map: user.outlet_map || '',
      is_active: user.is_active !== false,
    })
    setFormError('')
    
    // Load outlets for bp_operator role
    if (user.role === 'bp_operator' && user.cloud_kitchen_id) {
      await fetchOutletsForCloudKitchen(user.cloud_kitchen_id)
    }
    
    setIsModalOpen(true)
  }

  const fetchOutletsForCloudKitchen = async (cloudKitchenId) => {
    if (!cloudKitchenId) {
      setOutlets([])
      return
    }
    try {
      const { data, error } = await supabase
        .from('outlets')
        .select('id, code, name')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .ilike('code', 'BP%')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      setOutlets(data || [])
    } catch (err) {
      console.error('Error fetching outlets:', err)
      setOutlets([])
    }
  }

  const generateLoginKey = (cloudKitchenCode) => {
    // Generate random suffix: first char = letter, next 3 = letter or digit
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    
    const firstChar = letters[Math.floor(Math.random() * letters.length)]
    const secondChar = alphanumeric[Math.floor(Math.random() * alphanumeric.length)]
    const thirdChar = alphanumeric[Math.floor(Math.random() * alphanumeric.length)]
    const fourthChar = alphanumeric[Math.floor(Math.random() * alphanumeric.length)]
    
    return `BP-${cloudKitchenCode}${firstChar}${secondChar}${thirdChar}${fourthChar}`
  }

  const validateAndSave = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!formData.full_name.trim()) {
      setFormError('Full name is required')
      return
    }
    if (!formData.role) {
      setFormError('Role is required')
      return
    }
    if (formData.role !== 'admin' && !formData.cloud_kitchen_id) {
      setFormError('Cloud kitchen is required for non-admin roles')
      return
    }
    if (formData.role !== 'admin' && !formData.login_key.trim()) {
      setFormError('Login key is required for non-admin roles')
      return
    }
    if (formData.role === 'bp_operator' && !formData.outlet_map) {
      setFormError('Outlet is required for Boom Pizza Operator role')
      return
    }

    try {
      setSaving(true)

      // Enforce: only one active user per (role, cloud_kitchen) pair for non-admin, non-bp_operator roles
      // bp_operator uses database unique constraint on outlet_map instead
      if (formData.role !== 'admin' && formData.role !== 'bp_operator' && formData.cloud_kitchen_id) {
        const { data: existing, error: dupError } = await supabase
          .from('users')
          .select('id')
          .eq('role', formData.role)
          .eq('cloud_kitchen_id', formData.cloud_kitchen_id)
          .eq('is_active', true)
          .is('deleted_at', null)

        if (dupError) throw dupError

        const conflict = (existing || []).find(
          (u) => !editingUser || u.id !== editingUser.id
        )
        if (conflict) {
          setFormError(
            'A user with this role already exists for this cloud kitchen. No duplicate role allowed for a particular cloud kitchen.'
          )
          setSaving(false)
          return
        }
      }

      const session = getSession()
      if (!session?.id) {
        throw new Error('Session expired. Please login again.')
      }

      const payload = {
        full_name: formData.full_name.trim(),
        email:
          formData.role === 'admin'
            ? (formData.email || '').trim() || null
            : null,
        role: formData.role,
        cloud_kitchen_id:
          formData.role === 'admin' ? null : formData.cloud_kitchen_id || null,
        phone_number: formData.phone_number.trim() || null,
        login_key:
          formData.role === 'admin'
            ? null
            : formData.login_key.trim() || null,
        outlet_map:
          formData.role === 'bp_operator' ? formData.outlet_map || null : null,
        // Admin users must always remain active because RLS admin checks rely on is_active = true
        is_active: formData.role === 'admin' ? true : formData.is_active,
        updated_at: new Date().toISOString(),
      }

      if (editingUser) {
        const { error } = await supabase
          .from('users')
          .update(payload)
          .eq('id', editingUser.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('users').insert(payload)
        if (error) throw error
      }

      setIsModalOpen(false)
      await fetchUsers()
    } catch (err) {
      console.error('Error saving user:', err)
      if (err.code === '42501') {
        setFormError(
          'Permission denied by row-level security. Ensure you are logged in as an admin.'
        )
      } else if (err.code === '23505') {
        // unique_violation
        if (err.message && err.message.includes('outlet_map')) {
          setFormError('An operator is already assigned to this outlet.')
        } else {
          setFormError('Login key or email must be unique. This value is already in use.')
        }
      } else {
        setFormError(err.message || 'Failed to save user. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSoftDelete = async (user) => {
    if (!window.confirm(`Deactivate and hide user "${user.full_name}"?`)) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('users')
        .update({
          is_active: false,
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (error) throw error
      await fetchUsers()
    } catch (err) {
      console.error('Error soft deleting user:', err)
      setError(err.message || 'Failed to deactivate user.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Users</h1>
            <p className="text-sm text-muted-foreground">
              Manage all users across cloud kitchens. For each cloud kitchen, only one active user
              is allowed per role.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add User
          </button>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, login key, or phone..."
              className="sm:flex-1 sm:max-w-md bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            />
            <MultiSelectFilter
              label="Role"
              allLabel="All Roles"
              selectedValues={roleFilter}
              onChange={setRoleFilter}
              options={ROLE_OPTIONS}
              className="w-full sm:w-52"
            />
            {!roleFilter.includes('all') && (
              <button
                type="button"
                onClick={() => setRoleFilter(['all'])}
                className="self-start sm:self-center h-9 w-9 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-all"
                title="Clear filters"
                aria-label="Clear filters"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {/* Users table */}
        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading users…</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No users found. Try adjusting your filters or add a new user.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground w-[25%]">
                      Name / Login Key
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Cloud Kitchen
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Outlet
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-border/70 hover:bg-background/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">{u.full_name}</div>
                        {u.email && (
                          <div className="text-[11px] text-muted-foreground">
                            {u.email}
                          </div>
                        )}
                        {u.login_key && (
                          <div className="text-[11px] text-muted-foreground font-mono">
                            Key: {u.login_key}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          ID: {u.id.slice(0, 8)}…
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground capitalize">
                        {u.role.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {u.cloud_kitchens
                          ? `${u.cloud_kitchens.name}${
                              u.cloud_kitchens.code ? ` (${u.cloud_kitchens.code})` : ''
                            }`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {u.outlets
                          ? `${u.outlets.name} (${u.outlets.code})`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {u.phone_number || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {u.is_active ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          {u.role !== 'admin' && (
                            <button
                              onClick={() => openEditModal(u)}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                            >
                              Edit
                            </button>
                          )}
                          {u.is_active && u.role !== 'admin' && (
                            <button
                              onClick={() => handleSoftDelete(u)}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Create / Edit modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingUser ? 'Edit User' : 'Add User'}
                  </h2>
                  <button
                    onClick={() => !saving && setIsModalOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    disabled={saving}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={validateAndSave} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">
                      Full Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, full_name: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      disabled={saving}
                    />
                  </div>

                  {formData.role === 'admin' && (
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Email <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, email: e.target.value }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        placeholder="Required for admin (auth login)"
                        disabled={saving}
                        required
                      />
                    </div>
                  )}
                  {formData.role !== 'admin' && (
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Login Key <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.login_key}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, login_key: e.target.value }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all font-mono"
                        placeholder={formData.role === 'bp_operator' ? 'Auto-generated' : 'e.g. PM-CK1-ABCDE'}
                        disabled={saving || (formData.role === 'bp_operator')}
                        readOnly={formData.role === 'bp_operator'}
                        required
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formData.role === 'bp_operator' 
                          ? 'Auto-generated based on cloud kitchen. Cannot be edited.'
                          : 'Must be unique and is used for key-based login. Email must be empty for non-admin roles.'}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Role <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={formData.role}
                        onChange={async (e) => {
                          const newRole = e.target.value
                          const selectedCk = cloudKitchens.find(ck => ck.id === formData.cloud_kitchen_id)
                          
                          setFormData((prev) => ({
                            ...prev,
                            role: newRole,
                            // Clear CK when switching to admin
                            cloud_kitchen_id: newRole === 'admin' ? '' : prev.cloud_kitchen_id,
                            outlet_map: newRole === 'bp_operator' ? prev.outlet_map : '',
                            // Generate login key for bp_operator on create if CK is selected
                            login_key: newRole === 'bp_operator' && !editingUser && selectedCk
                              ? generateLoginKey(selectedCk.code)
                              : prev.login_key
                          }))
                          
                          // Load outlets if switching to bp_operator and CK is selected
                          if (newRole === 'bp_operator' && formData.cloud_kitchen_id) {
                            await fetchOutletsForCloudKitchen(formData.cloud_kitchen_id)
                          } else {
                            setOutlets([])
                          }
                        }}
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving}
                      >
                        <option value="">Select role</option>
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Cloud Kitchen {formData.role && formData.role !== 'admin' && (
                          <span className="text-destructive">*</span>
                        )}
                      </label>
                      <select
                        value={formData.cloud_kitchen_id}
                        onChange={async (e) => {
                          const newCkId = e.target.value
                          const selectedCk = cloudKitchens.find(ck => ck.id === newCkId)
                          
                          setFormData((prev) => ({
                            ...prev,
                            cloud_kitchen_id: newCkId,
                            outlet_map: '', // Clear outlet when CK changes
                            // Generate login key for bp_operator on create
                            login_key: prev.role === 'bp_operator' && !editingUser && selectedCk
                              ? generateLoginKey(selectedCk.code)
                              : prev.login_key
                          }))
                          
                          // Load outlets for bp_operator
                          if (formData.role === 'bp_operator') {
                            await fetchOutletsForCloudKitchen(newCkId)
                          }
                        }}
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving || formData.role === 'admin'}
                      >
                        <option value="">
                          {formData.role === 'admin'
                            ? 'Not required for admins'
                            : 'Select cloud kitchen'}
                        </option>
                        {cloudKitchens.map((ck) => (
                          <option key={ck.id} value={ck.id}>
                            {ck.name}
                            {ck.code ? ` (${ck.code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {formData.role === 'bp_operator' && (
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Outlet <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={formData.outlet_map}
                        onChange={(e) => {
                          const selectedOutlet = outlets.find(o => o.id === e.target.value)
                          setFormData((prev) => ({
                            ...prev,
                            outlet_map: e.target.value,
                            // Auto-fill full_name if empty or default
                            full_name: !prev.full_name.trim() || prev.full_name.startsWith('Boom Pizza Operator')
                              ? selectedOutlet ? `Boom Pizza Operator ${selectedOutlet.code}` : prev.full_name
                              : prev.full_name
                          }))
                        }}
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving || !formData.cloud_kitchen_id}
                      >
                        <option value="">
                          {!formData.cloud_kitchen_id
                            ? 'Select cloud kitchen first'
                            : outlets.length === 0
                            ? 'No Boom Pizza outlets available'
                            : 'Select outlet'}
                        </option>
                        {outlets.map((outlet) => (
                          <option key={outlet.id} value={outlet.id}>
                            {outlet.name} ({outlet.code})
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Only Boom Pizza outlets are shown. Each outlet can have only one active operator.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={formData.phone_number}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            phone_number: e.target.value,
                          }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        placeholder="Optional"
                        disabled={saving}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        id="user-is-active"
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) =>
                          setFormData((prev) =>
                            prev.role === 'admin'
                              ? { ...prev, is_active: true }
                              : { ...prev, is_active: e.target.checked }
                          )
                        }
                        className="rounded border-border"
                        disabled={saving || formData.role === 'admin'}
                      />
                      <label htmlFor="user-is-active" className="text-sm text-foreground">
                        Active
                      </label>
                    </div>
                  </div>

                  {formError && (
                    <div className="bg-destructive/15 border border-destructive rounded-lg px-4 py-3 text-sm text-destructive-foreground">
                      {formError}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => !saving && setIsModalOpen(false)}
                      disabled={saving}
                      className="px-5 py-2.5 bg-muted text-foreground border border-border rounded-lg hover:bg-muted/80 transition-all disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2.5 bg-accent text-background font-black rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? 'Saving…' : editingUser ? 'Update User' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminUsers

