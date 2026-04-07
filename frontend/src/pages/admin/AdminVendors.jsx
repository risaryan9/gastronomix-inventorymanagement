import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const AdminVendors = () => {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
  })
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    action: null,
    vendor: null,
  })

  const resetForm = () => {
    setEditingVendor(null)
    setFormData({ name: '' })
    setFormError('')
  }

  const fetchVendors = async () => {
    try {
      setLoading(true)
      setError('')
      const { data, error: vendorsError } = await supabase
        .from('vendors')
        .select('id, name, is_active, created_at, updated_at, deleted_at')
        .order('created_at', { ascending: false })

      if (vendorsError) throw vendorsError
      setVendors(data || [])
    } catch (err) {
      console.error('Error fetching vendors:', err)
      setError('Failed to load vendors. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchVendors()
  }, [])

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = (vendor) => {
    setEditingVendor(vendor)
    setFormData({ name: vendor.name || '' })
    setFormError('')
    setIsModalOpen(true)
  }

  const filteredVendors = vendors.filter((vendor) => {
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!(vendor.name || '').toLowerCase().includes(q)) return false
    }
    if (statusFilter === 'active' && !vendor.is_active) return false
    if (statusFilter === 'inactive' && vendor.is_active) return false
    return true
  })

  const saveVendor = async (e) => {
    e.preventDefault()
    setFormError('')

    const name = formData.name.trim()
    if (!name) {
      setFormError('Vendor name is required')
      return
    }

    try {
      setSaving(true)
      const payload = {
        name,
        updated_at: new Date().toISOString(),
      }

      if (editingVendor) {
        const { error: updateError } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', editingVendor.id)

        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase.from('vendors').insert(payload)
        if (insertError) throw insertError
      }

      setIsModalOpen(false)
      await fetchVendors()
    } catch (err) {
      console.error('Error saving vendor:', err)
      if (err.code === '23505') {
        setFormError('A vendor with this name already exists.')
      } else if (err.code === '42501') {
        setFormError('Permission denied. Please login with an admin account.')
      } else {
        setFormError(err.message || 'Failed to save vendor. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const openConfirmDialog = (action, vendor) => {
    setConfirmDialog({
      isOpen: true,
      action,
      vendor,
    })
  }

  const closeConfirmDialog = () => {
    if (saving) return
    setConfirmDialog({
      isOpen: false,
      action: null,
      vendor: null,
    })
  }

  const deactivateVendor = async (vendor) => {
    try {
      setSaving(true)
      const now = new Date().toISOString()
      const { error: deactivateError } = await supabase
        .from('vendors')
        .update({
          is_active: false,
          deleted_at: now,
          updated_at: now,
        })
        .eq('id', vendor.id)

      if (deactivateError) throw deactivateError
      await fetchVendors()
      closeConfirmDialog()
    } catch (err) {
      console.error('Error deactivating vendor:', err)
      setError(err.message || 'Failed to deactivate vendor.')
    } finally {
      setSaving(false)
    }
  }

  const reactivateVendor = async (vendor) => {
    try {
      setSaving(true)
      const { error: reactivateError } = await supabase
        .from('vendors')
        .update({
          is_active: true,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', vendor.id)

      if (reactivateError) throw reactivateError
      await fetchVendors()
      closeConfirmDialog()
    } catch (err) {
      console.error('Error reactivating vendor:', err)
      setError(err.message || 'Failed to reactivate vendor.')
    } finally {
      setSaving(false)
    }
  }

  const confirmVendorStatusChange = async () => {
    if (!confirmDialog.vendor || !confirmDialog.action) return
    if (confirmDialog.action === 'deactivate') {
      await deactivateVendor(confirmDialog.vendor)
      return
    }
    await reactivateVendor(confirmDialog.vendor)
  }

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Vendors</h1>
            <p className="text-sm text-muted-foreground">
              Manage vendor records used across material and stock-in flows.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add Vendor
          </button>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by vendor name..."
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-52 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading vendors...</div>
          ) : filteredVendors.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No vendors found. Try adjusting filters or add a new vendor.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground w-[40%]">
                      Vendor
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Updated
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.map((vendor) => (
                    <tr
                      key={vendor.id}
                      className="border-b border-border/70 hover:bg-background/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">{vendor.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          ID: {vendor.id.slice(0, 8)}...
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {vendor.is_active ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {vendor.updated_at
                          ? new Date(vendor.updated_at).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openEditModal(vendor)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                          >
                            Edit
                          </button>
                          {vendor.is_active ? (
                            <button
                              onClick={() => openConfirmDialog('deactivate', vendor)}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => openConfirmDialog('reactivate', vendor)}
                              disabled={saving}
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

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingVendor ? 'Edit Vendor' : 'Add Vendor'}
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

                <form onSubmit={saveVendor} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">
                      Vendor Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      disabled={saving}
                      placeholder="Enter vendor name"
                    />
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
                      {saving ? 'Saving...' : editingVendor ? 'Update Vendor' : 'Create Vendor'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg">
              <div className="p-5 lg:p-6">
                <h2 className="text-xl font-bold text-foreground mb-2">
                  {confirmDialog.action === 'deactivate'
                    ? 'Deactivate Vendor'
                    : 'Reactivate Vendor'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {confirmDialog.action === 'deactivate'
                    ? `Are you sure you want to deactivate "${confirmDialog.vendor?.name}"? This will hide it from vendor dropdowns.`
                    : `Are you sure you want to reactivate "${confirmDialog.vendor?.name}"? This will make it available in vendor dropdowns again.`}
                </p>

                <div className="flex justify-end gap-3 pt-5">
                  <button
                    type="button"
                    onClick={closeConfirmDialog}
                    disabled={saving}
                    className="px-5 py-2.5 bg-muted text-foreground border border-border rounded-lg hover:bg-muted/80 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmVendorStatusChange}
                    disabled={saving}
                    className={`px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                      confirmDialog.action === 'deactivate'
                        ? 'bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20'
                    }`}
                  >
                    {saving
                      ? 'Processing...'
                      : confirmDialog.action === 'deactivate'
                        ? 'Yes, Deactivate'
                        : 'Yes, Reactivate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminVendors
