import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const AdminOperators = () => {
  const [operators, setOperators] = useState([])
  const [allOutlets, setAllOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listSearch, setListSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingOperator, setEditingOperator] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    outlet_id: '',
    name: '',
    phone: '',
  })
  const [outletSearch, setOutletSearch] = useState('')

  const resetForm = () => {
    setEditingOperator(null)
    setFormData({
      outlet_id: '',
      name: '',
      phone: '',
    })
    setOutletSearch('')
    setFormError('')
  }

  const fetchAllOutlets = async () => {
    try {
      const { data, err } = await supabase
        .from('outlets')
        .select('id, name, code, cloud_kitchen_id, cloud_kitchens ( id, name, code )')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')
      if (err) throw err
      setAllOutlets(data || [])
    } catch (err) {
      console.error('Error fetching outlets:', err)
      setAllOutlets([])
    }
  }

  const fetchOperators = async () => {
    try {
      setLoading(true)
      setError('')
      const { data, err } = await supabase
        .from('operators')
        .select(`
          *,
          outlets (
            id,
            name,
            code,
            cloud_kitchen_id,
            cloud_kitchens ( id, name, code )
          )
        `)
        .order('created_at', { ascending: false })
      if (err) throw err
      setOperators(data || [])
    } catch (err) {
      console.error('Error fetching operators:', err)
      setError('Failed to load operators. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOperators()
    fetchAllOutlets()
  }, [])

  const filteredOperators = useMemo(() => {
    return operators.filter((op) => {
      if (!listSearch.trim()) return true
      const q = listSearch.toLowerCase()
      const name = (op.name || '').toLowerCase()
      const phone = (op.phone || '').toLowerCase()
      const outletName = (op.outlets?.name || '').toLowerCase()
      const outletCode = (op.outlets?.code || '').toLowerCase()
      const brandName = (op.outlets?.cloud_kitchens?.name || '').toLowerCase()
      const brandCode = (op.outlets?.cloud_kitchens?.code || '').toLowerCase()
      return (
        name.includes(q) ||
        phone.includes(q) ||
        outletName.includes(q) ||
        outletCode.includes(q) ||
        brandName.includes(q) ||
        brandCode.includes(q)
      )
    })
  }, [operators, listSearch])

  const filteredOutletsForDropdown = useMemo(() => {
    if (!outletSearch.trim()) return allOutlets
    const q = outletSearch.toLowerCase()
    return allOutlets.filter(
      (o) =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.code || '').toLowerCase().includes(q) ||
        (o.cloud_kitchens?.name || '').toLowerCase().includes(q) ||
        (o.cloud_kitchens?.code || '').toLowerCase().includes(q)
    )
  }, [allOutlets, outletSearch])

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = (op) => {
    setEditingOperator(op)
    setFormData({
      outlet_id: op.outlet_id || '',
      name: op.name || '',
      phone: op.phone || '',
    })
    setOutletSearch('')
    setFormError('')
    setIsModalOpen(true)
  }

  const validateAndSave = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!formData.name.trim()) {
      setFormError('Operator name is required.')
      return
    }
    if (!formData.outlet_id) {
      setFormError('Please select an outlet.')
      return
    }
    try {
      setSaving(true)
      const payload = {
        outlet_id: formData.outlet_id,
        name: formData.name.trim(),
        phone: formData.phone.trim() || null,
      }
      if (editingOperator) {
        const { error: updateErr } = await supabase
          .from('operators')
          .update(payload)
          .eq('id', editingOperator.id)
        if (updateErr) throw updateErr
      } else {
        const { error: insertErr } = await supabase.from('operators').insert(payload)
        if (insertErr) throw insertErr
      }
      setIsModalOpen(false)
      await fetchOperators()
    } catch (err) {
      console.error('Error saving operator:', err)
      setFormError(err.message || 'Failed to save operator. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (op) => {
    if (!window.confirm(`Delete operator "${op.name}"? This cannot be undone.`)) return
    try {
      setSaving(true)
      const { error: deleteErr } = await supabase
        .from('operators')
        .delete()
        .eq('id', op.id)
      if (deleteErr) throw deleteErr
      await fetchOperators()
    } catch (err) {
      console.error('Error deleting operator:', err)
      setError(err.message || 'Failed to delete operator.')
    } finally {
      setSaving(false)
    }
  }

  const brandName = (op) =>
    op.outlets?.cloud_kitchens?.name
      ? `${op.outlets.cloud_kitchens.name}${op.outlets.cloud_kitchens.code ? ` (${op.outlets.cloud_kitchens.code})` : ''}`
      : '—'
  const outletLabel = (op) =>
    op.outlets
      ? `${op.outlets.name}${op.outlets.code ? ` (${op.outlets.code})` : ''}`
      : '—'

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Operators</h1>
            <p className="text-sm text-muted-foreground">
              Manage operators per outlet. Select an outlet to add or edit operators.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add Operator
          </button>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search by operator name, phone, outlet, or brand..."
            className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading operators…</div>
          ) : filteredOperators.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No operators found. Try adjusting your search or add a new operator.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Outlet
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Brand
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOperators.map((op) => (
                    <tr
                      key={op.id}
                      className="border-b border-border/70 hover:bg-background/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-semibold text-foreground">
                        {op.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {op.phone || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {outletLabel(op)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {brandName(op)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openEditModal(op)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(op)}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                          >
                            Delete
                          </button>
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
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingOperator ? 'Edit Operator' : 'Add Operator'}
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
                      Outlet <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={outletSearch}
                      onChange={(e) => setOutletSearch(e.target.value)}
                      placeholder="Search outlets by name, code, or brand..."
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all mb-2"
                      disabled={saving}
                    />
                    <select
                      value={formData.outlet_id}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, outlet_id: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      disabled={saving}
                    >
                      <option value="">Select outlet</option>
                      {filteredOutletsForDropdown.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                          {o.code ? ` (${o.code})` : ''}
                          {o.cloud_kitchens?.name ? ` — ${o.cloud_kitchens.name}` : ''}
                        </option>
                      ))}
                      {filteredOutletsForDropdown.length === 0 && outletSearch.trim() && (
                        <option value="" disabled>No outlets match your search</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">
                      Operator Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      placeholder="e.g. John Doe"
                      disabled={saving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">
                      Phone (optional)
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      placeholder="Optional"
                      disabled={saving}
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
                      {saving ? 'Saving…' : editingOperator ? 'Update Operator' : 'Create Operator'}
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

export default AdminOperators
