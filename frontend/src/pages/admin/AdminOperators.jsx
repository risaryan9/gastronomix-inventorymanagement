import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const AdminOperators = () => {
  const [operators, setOperators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listSearch, setListSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingOperator, setEditingOperator] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
  })

  const resetForm = () => {
    setEditingOperator(null)
    setFormData({
      name: '',
      phone: '',
    })
    setFormError('')
  }

  const fetchOperators = async () => {
    try {
      setLoading(true)
      setError('')
      const { data, err } = await supabase
        .from('operators')
        .select('*')
        .order('name')
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
  }, [])

  const filteredOperators = useMemo(() => {
    return operators.filter((op) => {
      if (!listSearch.trim()) return true
      const q = listSearch.toLowerCase()
      const name = (op.name || '').toLowerCase()
      const phone = (op.phone || '').toLowerCase()
      return (
        name.includes(q) ||
        phone.includes(q)
      )
    })
  }, [operators, listSearch])

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = (op) => {
    setEditingOperator(op)
    setFormData({
      name: op.name || '',
      phone: op.phone || '',
    })
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
    try {
      setSaving(true)
      const payload = {
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

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Operators</h1>
            <p className="text-sm text-muted-foreground">
              Manage universal operators used across all outlets.
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
            placeholder="Search by operator name or phone..."
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
                      Created
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
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {op.created_at ? new Date(op.created_at).toLocaleDateString() : '—'}
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
