// Admin CRUD for service kits.
//
// A service kit is what an outlet needs alongside one unit of a finished
// product in order to serve it — the butter it is cooked in, the chutney and
// onions that go out with it. Dispatch planning reads the active kit for a
// finished product and auto-fills those companion materials at their per-unit
// quantity (see DispatchExecutiveDashboard.handleQuantityChange).
//
// This is deliberately NOT a bill of materials. It says nothing about how the
// product is made or what it costs to make; it is a packing rule. The table was
// called `recipes` until migrations/rename-recipes-to-service-kits.sql, which
// explains the distinction at length.

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/toastContext'
import { useConfirm } from '../../context/confirmContext'

const AdminServiceKits = () => {
  const toast = useToast()
  const confirm = useConfirm()

  const [serviceKits, setServiceKits] = useState([])
  const [finishedProducts, setFinishedProducts] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listSearch, setListSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingKit, setEditingKit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    finished_product_id: '',
    kit_name: '',
    is_active: true,
    items: []
  })

  const resetForm = () => {
    setEditingKit(null)
    setFormData({
      finished_product_id: '',
      kit_name: '',
      is_active: true,
      items: []
    })
    setFormError('')
  }

  const fetchFinishedProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit')
        .eq('material_type', 'finished')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      setFinishedProducts(data || [])
    } catch (err) {
      console.error('Error fetching finished products:', err)
    }
  }

  const fetchAllMaterials = async () => {
    try {
      const { data, error } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit, material_type')
        .in('material_type', ['raw_material', 'semi_finished'])
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      setAllMaterials(data || [])
    } catch (err) {
      console.error('Error fetching materials:', err)
    }
  }

  const fetchServiceKits = async () => {
    try {
      setLoading(true)
      setError('')

      const { data: kitsData, error: kitsError } = await supabase
        .from('service_kits')
        .select(`
          *,
          finished_product:raw_materials!service_kits_finished_product_fk(id, name, code, unit)
        `)
        .order('created_at', { ascending: false })

      if (kitsError) throw kitsError

      const { data: itemsData, error: itemsError } = await supabase
        .from('service_kit_items')
        .select(`
          *,
          material:raw_materials!service_kit_items_material_fk(id, name, code, unit, material_type)
        `)
        .order('sort_order')

      if (itemsError) throw itemsError

      const kitsWithItems = (kitsData || []).map(kit => ({
        ...kit,
        items: (itemsData || []).filter(item => item.service_kit_id === kit.id)
      }))

      setServiceKits(kitsWithItems)
    } catch (err) {
      console.error('Error fetching service kits:', err)
      setError('Failed to load service kits. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServiceKits()
    fetchFinishedProducts()
    fetchAllMaterials()
  }, [])

  const filteredKits = useMemo(() => {
    return serviceKits.filter((kit) => {
      if (!listSearch.trim()) return true
      const q = listSearch.toLowerCase()
      const name = (kit.kit_name || '').toLowerCase()
      const productName = (kit.finished_product?.name || '').toLowerCase()
      const productCode = (kit.finished_product?.code || '').toLowerCase()
      return name.includes(q) || productName.includes(q) || productCode.includes(q)
    })
  }, [serviceKits, listSearch])

  const openCreateModal = () => {
    resetForm()
    setIsModalOpen(true)
  }

  const openEditModal = (kit) => {
    setEditingKit(kit)
    setFormData({
      finished_product_id: kit.finished_product_id || '',
      kit_name: kit.kit_name || '',
      is_active: kit.is_active !== false,
      items: kit.items.map(item => ({
        id: item.id,
        material_id: item.material_id,
        quantity_per_unit: item.quantity_per_unit
      }))
    })
    setFormError('')
    setIsModalOpen(true)
  }

  const addItemRow = () => {
    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          material_id: '',
          quantity_per_unit: ''
        }
      ]
    }))
  }

  const removeItemRow = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }))
  }

  const updateItem = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    }))
  }

  const validateAndSave = async (e) => {
    e.preventDefault()
    setFormError('')

    if (!formData.finished_product_id) {
      setFormError('Finished product is required')
      return
    }
    if (!formData.kit_name.trim()) {
      setFormError('Kit name is required')
      return
    }
    if (formData.items.length === 0) {
      setFormError('At least one material is required')
      return
    }

    for (let i = 0; i < formData.items.length; i++) {
      const item = formData.items[i]
      if (!item.material_id) {
        setFormError(`Material ${i + 1}: Material is required`)
        return
      }
      if (!item.quantity_per_unit || parseFloat(item.quantity_per_unit) <= 0) {
        setFormError(`Material ${i + 1}: Quantity must be greater than 0`)
        return
      }
    }

    try {
      setSaving(true)

      const kitPayload = {
        finished_product_id: formData.finished_product_id,
        kit_name: formData.kit_name.trim(),
        is_active: formData.is_active,
        updated_at: new Date().toISOString()
      }

      let kitId = editingKit?.id

      if (editingKit) {
        const { error: updateError } = await supabase
          .from('service_kits')
          .update(kitPayload)
          .eq('id', editingKit.id)

        if (updateError) throw updateError

        const { error: deleteItemsError } = await supabase
          .from('service_kit_items')
          .delete()
          .eq('service_kit_id', editingKit.id)

        if (deleteItemsError) throw deleteItemsError
      } else {
        const { data: newKit, error: insertError } = await supabase
          .from('service_kits')
          .insert(kitPayload)
          .select()
          .single()

        if (insertError) throw insertError
        kitId = newKit.id
      }

      const itemsPayload = formData.items.map((item) => ({
        service_kit_id: kitId,
        material_id: item.material_id,
        quantity_per_unit: parseFloat(item.quantity_per_unit)
      }))

      const { error: itemsError } = await supabase
        .from('service_kit_items')
        .insert(itemsPayload)

      if (itemsError) throw itemsError

      setIsModalOpen(false)
      await fetchServiceKits()
    } catch (err) {
      console.error('Error saving service kit:', err)
      if (err.code === '23505') {
        setFormError('A service kit already exists for this finished product. Only one active kit per product is allowed.')
      } else {
        setFormError(err.message || 'Failed to save service kit. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (kit) => {
    const confirmed = await confirm({
      title: 'Deactivate this service kit?',
      message: `"${kit.kit_name}" will stop being available for use. You can activate it again later.`,
      confirmLabel: 'Deactivate',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      setSaving(true)
      const { error } = await supabase
        .from('service_kits')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', kit.id)

      if (error) throw error
      await fetchServiceKits()
      toast.success('Service kit deactivated', `"${kit.kit_name}" is no longer available.`)
    } catch (err) {
      console.error('Error deactivating service kit:', err)
      setError(err.message || 'Failed to deactivate service kit.')
      toast.error('Could not deactivate service kit', err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (kit) => {
    const confirmed = await confirm({
      title: 'Activate this service kit?',
      message: `"${kit.kit_name}" will become available for use again.`,
      confirmLabel: 'Activate',
    })
    if (!confirmed) return

    try {
      setSaving(true)
      const { error } = await supabase
        .from('service_kits')
        .update({
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', kit.id)

      if (error) throw error
      await fetchServiceKits()
      toast.success('Service kit activated', `"${kit.kit_name}" is available again.`)
    } catch (err) {
      console.error('Error activating service kit:', err)
      setError(err.message || 'Failed to activate service kit.')
      toast.error('Could not activate service kit', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Service Kits</h1>
            <p className="text-sm text-muted-foreground">
              Define what goes out alongside each finished product — companion materials and cooking consumables. When a finished product is added to a dispatch plan, its kit materials are populated automatically.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add Service Kit
          </button>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search by kit name or finished product..."
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
            <div className="p-8 text-center text-muted-foreground">Loading service kits…</div>
          ) : filteredKits.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No service kits found. Try adjusting your search or add a new kit.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Kit Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Finished Product
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Materials
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
                  {filteredKits.map((kit) => (
                    <tr
                      key={kit.id}
                      className="border-b border-border/70 hover:bg-background/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm">
                        <div className="font-semibold text-foreground">{kit.kit_name}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">{kit.finished_product?.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {kit.finished_product?.code}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {kit.items.length} material{kit.items.length !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {kit.is_active ? (
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
                          <button
                            onClick={() => openEditModal(kit)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                          >
                            Edit
                          </button>
                          {kit.is_active ? (
                            <button
                              onClick={() => handleDeactivate(kit)}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60 transition-colors disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivate(kit)}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20 hover:border-emerald-500/60 transition-colors disabled:opacity-50"
                            >
                              Activate
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
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingKit ? 'Edit Service Kit' : 'Add Service Kit'}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Finished Product <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={formData.finished_product_id}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, finished_product_id: e.target.value }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        disabled={saving || editingKit}
                      >
                        <option value="">Select finished product</option>
                        {finishedProducts.map((fp) => (
                          <option key={fp.id} value={fp.id}>
                            {fp.name} ({fp.code})
                          </option>
                        ))}
                      </select>
                      {editingKit && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Cannot change finished product when editing. Create a new service kit instead.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1">
                        Kit Name <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.kit_name}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, kit_name: e.target.value }))
                        }
                        className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                        placeholder="e.g. Peri Peri Kabab Service Kit"
                        disabled={saving}
                      />
                    </div>
                  </div>


                  <div className="flex items-center gap-2">
                    <input
                      id="service-kit-is-active"
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, is_active: e.target.checked }))
                      }
                      className="rounded border-border"
                      disabled={saving}
                    />
                    <label htmlFor="service-kit-is-active" className="text-sm text-foreground">
                      Active (only one active kit per finished product allowed)
                    </label>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold text-foreground">
                        Materials <span className="text-destructive">*</span>
                      </h3>
                      <button
                        type="button"
                        onClick={addItemRow}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors disabled:opacity-50"
                      >
                        + Add Material
                      </button>
                    </div>

                    {formData.items.length === 0 ? (
                      <div className="bg-muted/30 border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
                        No materials added yet. Click &quot;+ Add Material&quot; to start.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {formData.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="bg-muted/30 border border-border rounded-lg p-4"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <span className="text-sm font-semibold text-foreground">
                                Material {idx + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeItemRow(idx)}
                                disabled={saving}
                                className="text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="sm:col-span-2">
                                <label className="block text-xs font-semibold text-foreground mb-1">
                                  Material <span className="text-destructive">*</span>
                                </label>
                                <select
                                  value={item.material_id}
                                  onChange={(e) =>
                                    updateItem(idx, 'material_id', e.target.value)
                                  }
                                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                                  disabled={saving}
                                >
                                  <option value="">Select raw material or semi-finished</option>
                                  {allMaterials.map((mat) => (
                                    <option key={mat.id} value={mat.id}>
                                      {mat.name} ({mat.code}) - {mat.unit}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="sm:col-span-2">
                                <label className="block text-xs font-semibold text-foreground mb-1">
                                  Quantity per Unit <span className="text-destructive">*</span>
                                </label>
                                <input
                                  type="number"
                                  step="0.001"
                                  value={item.quantity_per_unit}
                                  onChange={(e) =>
                                    updateItem(idx, 'quantity_per_unit', e.target.value)
                                  }
                                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                                  disabled={saving}
                                />
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  Amount needed per 1 unit of finished product
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
                      {saving ? 'Saving…' : editingKit ? 'Update Service Kit' : 'Create Service Kit'}
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

export default AdminServiceKits
