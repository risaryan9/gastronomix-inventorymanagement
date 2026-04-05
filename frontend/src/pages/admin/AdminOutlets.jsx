import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'

const BRAND_OPTIONS = [
  { value: 'all', label: 'All Brands' },
  { value: 'NK', label: 'Nippu Kodi (NK)' },
  { value: 'EC', label: 'El Chaapo (EC)' },
  { value: 'BP', label: 'Boom Pizza (BP)' },
  { value: 'other', label: 'Other' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
]

const BRAND_PREFIXES = ['NK', 'EC', 'BP']

const AdminOutlets = () => {
  const [outlets, setOutlets] = useState([])
  const [cloudKitchens, setCloudKitchens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [kitchenFilter, setKitchenFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingOutlet, setEditingOutlet] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    cloud_kitchen_id: '',
    name: '',
    code: '',
  })

  const [brandPrefix, setBrandPrefix] = useState('')
  const [codeSuffix, setCodeSuffix] = useState('')

  const [confirmDialog, setConfirmDialog] = useState(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  const resetForm = () => {
    setEditingOutlet(null)
    setFormData({
      cloud_kitchen_id: '',
      name: '',
      code: '',
    })
    setBrandPrefix('')
    setCodeSuffix('')
    setFormError('')
  }

  const fetchCloudKitchens = async () => {
    try {
      const { data, error } = await supabase
        .from('cloud_kitchens')
        .select('id, name, code')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      setCloudKitchens(data || [])
    } catch (err) {
      console.error('Error fetching cloud kitchens:', err)
    }
  }

  const fetchOutlets = async () => {
    try {
      setLoading(true)
      setError('')
      const { data, error } = await supabase
        .from('outlets')
        .select(
          'id, cloud_kitchen_id, name, code, is_active, created_at, updated_at, deleted_at, cloud_kitchens(name, code)'
        )
        .order('cloud_kitchen_id')
        .order('name', { ascending: true })

      if (error) throw error
      setOutlets(data || [])
    } catch (err) {
      console.error('Error fetching outlets:', err)
      setError('Failed to load outlets. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOutlets()
    fetchCloudKitchens()
  }, [])

  const getBrandFromCode = (code) => {
    if (!code) return 'other'
    const upper = code.toUpperCase()
    if (upper.startsWith('NK')) return 'NK'
    if (upper.startsWith('EC')) return 'EC'
    if (upper.startsWith('BP')) return 'BP'
    return 'other'
  }

  const filteredOutlets = outlets.filter((outlet) => {
    if (search.trim()) {
      const q = search.toLowerCase()
      const inName = (outlet.name || '').toLowerCase().includes(q)
      const inCode = (outlet.code || '').toLowerCase().includes(q)
      if (!inName && !inCode) return false
    }
    if (kitchenFilter !== 'all' && outlet.cloud_kitchen_id !== kitchenFilter) return false
    if (statusFilter === 'active' && (!outlet.is_active || outlet.deleted_at)) return false
    if (statusFilter === 'deactivated' && (outlet.is_active && !outlet.deleted_at)) return false
    if (brandFilter !== 'all') {
      const outletBrand = getBrandFromCode(outlet.code)
      if (outletBrand !== brandFilter) return false
    }
    return true
  })

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = (outlet) => {
    setEditingOutlet(outlet)
    const brand = getBrandFromCode(outlet.code)
    const prefix = BRAND_PREFIXES.includes(brand) ? brand : ''
    const suffix = prefix && outlet.code ? outlet.code.slice(prefix.length) : outlet.code
    
    setFormData({
      cloud_kitchen_id: outlet.cloud_kitchen_id || '',
      name: outlet.name || '',
      code: outlet.code || '',
    })
    setBrandPrefix(prefix)
    setCodeSuffix(suffix)
    setFormError('')
    setIsModalOpen(true)
  }

  const validateAndSave = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!formData.cloud_kitchen_id) {
      setFormError('Cloud kitchen is required')
      return
    }
    if (!formData.name.trim()) {
      setFormError('Outlet name is required')
      return
    }
    if (!formData.code.trim()) {
      setFormError('Outlet code is required')
      return
    }

    try {
      setSaving(true)

      const session = getSession()
      if (!session?.id) {
        throw new Error('Session expired. Please login again.')
      }

      const payload = {
        cloud_kitchen_id: formData.cloud_kitchen_id,
        name: formData.name.trim(),
        code: formData.code.trim(),
        updated_at: new Date().toISOString(),
      }

      if (editingOutlet) {
        const { error } = await supabase
          .from('outlets')
          .update(payload)
          .eq('id', editingOutlet.id)

        if (error) throw error
      } else {
        payload.is_active = true
        payload.deleted_at = null
        const { error } = await supabase.from('outlets').insert(payload)
        if (error) throw error
      }

      setIsModalOpen(false)
      await fetchOutlets()
    } catch (err) {
      console.error('Error saving outlet:', err)
      if (err.code === '42501') {
        setFormError(
          'Permission denied by row-level security. Ensure you are logged in as an admin.'
        )
      } else if (err.code === '23505') {
        setFormError('Outlet code must be unique for this cloud kitchen. This code is already in use.')
      } else {
        setFormError(err.message || 'Failed to save outlet. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const openDeactivateConfirm = (outlet) => {
    setConfirmDialog({ mode: 'deactivate', outlet })
  }

  const openReactivateConfirm = (outlet) => {
    setConfirmDialog({ mode: 'reactivate', outlet })
  }

  const closeConfirmDialog = () => {
    if (confirmLoading) return
    setConfirmDialog(null)
  }

  const executeStatusConfirm = async () => {
    if (!confirmDialog) return
    const { mode, outlet } = confirmDialog
    try {
      setConfirmLoading(true)
      if (mode === 'deactivate') {
        const { error } = await supabase
          .from('outlets')
          .update({
            is_active: false,
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', outlet.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('outlets')
          .update({
            is_active: true,
            deleted_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', outlet.id)
        if (error) throw error
      }
      setConfirmDialog(null)
      await fetchOutlets()
    } catch (err) {
      console.error(`Error ${mode === 'deactivate' ? 'deactivating' : 'reactivating'} outlet:`, err)
      setError(err.message || `Failed to ${mode === 'deactivate' ? 'deactivate' : 'reactivate'} outlet.`)
    } finally {
      setConfirmLoading(false)
    }
  }

  const handleBrandPrefixChange = (prefix) => {
    setBrandPrefix(prefix)
    setFormData((prev) => ({
      ...prev,
      code: prefix + codeSuffix,
    }))
  }

  const handleCodeSuffixChange = (suffix) => {
    setCodeSuffix(suffix)
    setFormData((prev) => ({
      ...prev,
      code: brandPrefix + suffix,
    }))
  }

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Outlets</h1>
            <p className="text-sm text-muted-foreground">
              Manage all outlets across cloud kitchens. Outlet codes should start with brand prefix (NK, EC, BP).
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add Outlet
          </button>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code…"
              className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            />
            <select
              value={kitchenFilter}
              onChange={(e) => setKitchenFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            >
              <option value="all">All Cloud Kitchens</option>
              {cloudKitchens.map((ck) => (
                <option key={ck.id} value={ck.id}>
                  {ck.name} ({ck.code})
                </option>
              ))}
            </select>
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            >
              {BRAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {/* Outlets table */}
        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading outlets…</div>
          ) : filteredOutlets.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No outlets found. Try adjusting your filters or add a new outlet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Cloud Kitchen
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Code
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
                  {filteredOutlets.map((outlet) => (
                    <tr
                      key={outlet.id}
                      className="border-b border-border/70 hover:bg-background/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-foreground">
                        {outlet.cloud_kitchens
                          ? `${outlet.cloud_kitchens.name}${
                              outlet.cloud_kitchens.code ? ` (${outlet.cloud_kitchens.code})` : ''
                            }`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground font-semibold">
                        {outlet.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground font-mono">
                        {outlet.code || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {outlet.is_active && !outlet.deleted_at ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
                            Deactivated
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openEditModal(outlet)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                          >
                            Edit
                          </button>
                          {outlet.is_active && !outlet.deleted_at ? (
                            <button
                              type="button"
                              onClick={() => openDeactivateConfirm(outlet)}
                              disabled={saving || confirmLoading}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openReactivateConfirm(outlet)}
                              disabled={saving || confirmLoading}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20 hover:border-emerald-500/60 transition-colors disabled:opacity-50"
                            >
                              Reactivate
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

        {/* Deactivate / Reactivate confirmation */}
        {confirmDialog && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="outlet-confirm-title"
            onClick={closeConfirmDialog}
          >
            <div
              className="bg-card/95 backdrop-blur-md border-2 border-border rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 lg:p-6">
                <h2
                  id="outlet-confirm-title"
                  className="text-lg font-bold text-foreground mb-2"
                >
                  {confirmDialog.mode === 'deactivate' ? 'Deactivate outlet?' : 'Reactivate outlet?'}
                </h2>
                <p className="text-sm text-muted-foreground mb-1">
                  <span className="font-semibold text-foreground">{confirmDialog.outlet.name}</span>
                  <span className="font-mono text-muted-foreground"> ({confirmDialog.outlet.code})</span>
                </p>
                {confirmDialog.mode === 'deactivate' ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    This outlet will be hidden from dispatch, allocation lists, and other operational views until
                    reactivated.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    This outlet will appear again in operational views for its cloud kitchen and brand.
                  </p>
                )}
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={closeConfirmDialog}
                    disabled={confirmLoading}
                    className="flex-1 bg-muted text-foreground font-semibold px-4 py-2.5 rounded-lg hover:bg-muted/80 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={executeStatusConfirm}
                    disabled={confirmLoading}
                    className={`flex-1 font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 ${
                      confirmDialog.mode === 'deactivate'
                        ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                        : 'bg-emerald-600 text-white hover:bg-emerald-600/90'
                    }`}
                  >
                    {confirmLoading
                      ? 'Please wait…'
                      : confirmDialog.mode === 'deactivate'
                        ? 'Deactivate'
                        : 'Reactivate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create / Edit modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingOutlet ? 'Edit Outlet' : 'Add Outlet'}
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
                      Cloud Kitchen <span className="text-destructive">*</span>
                    </label>
                    <select
                      value={formData.cloud_kitchen_id}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, cloud_kitchen_id: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      disabled={saving}
                    >
                      <option value="">Select cloud kitchen</option>
                      {cloudKitchens.map((ck) => (
                        <option key={ck.id} value={ck.id}>
                          {ck.name} ({ck.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">
                      Outlet Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      disabled={saving}
                      placeholder="e.g., Nippu Kodi Banjara Hills"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">
                      Outlet Code <span className="text-destructive">*</span>
                    </label>
                    <div className="text-xs text-muted-foreground mb-2">
                      Brand prefix (NK/EC/BP) + unique suffix. Example: NK-001, EC_SHOP_1, BP-JUBILEE
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={brandPrefix}
                        onChange={(e) => handleBrandPrefixChange(e.target.value)}
                        className="w-32 bg-input border border-border rounded-lg px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving}
                      >
                        <option value="">None</option>
                        <option value="NK">NK</option>
                        <option value="EC">EC</option>
                        <option value="BP">BP</option>
                      </select>
                      <input
                        type="text"
                        value={codeSuffix}
                        onChange={(e) => handleCodeSuffixChange(e.target.value)}
                        className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving}
                        placeholder="e.g., -001 or _SHOP_1"
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground font-mono">
                      Final code: {formData.code || '(empty)'}
                    </div>
                    {editingOutlet && formData.code !== editingOutlet.code && (
                      <div className="mt-2 text-xs text-amber-500 border border-amber-500/30 bg-amber-500/10 rounded px-2 py-1">
                        Warning: Changing the code may affect brand-based filtering in dispatch and allocation flows.
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="bg-destructive/15 border border-destructive rounded-lg px-4 py-3 text-sm text-destructive-foreground">
                      {formError}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => !saving && setIsModalOpen(false)}
                      className="flex-1 bg-muted text-foreground font-semibold px-4 py-2.5 rounded-lg hover:bg-muted/80 transition-colors"
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 bg-accent text-background font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
                      disabled={saving}
                    >
                      {saving ? 'Saving…' : editingOutlet ? 'Update Outlet' : 'Create Outlet'}
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

export default AdminOutlets
