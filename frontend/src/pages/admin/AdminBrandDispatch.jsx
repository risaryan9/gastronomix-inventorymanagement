import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase } from '../../lib/supabase'

/** Dispatch-brand list: Finished → Semi-finished → Raw materials (incl. non-food & unknown types) */
const BRAND_ITEM_SECTIONS = [
  { key: 'finished', label: 'Finished' },
  { key: 'semi_finished', label: 'Semi-finished' },
  { key: 'raw_material', label: 'Raw materials' },
]

function getBrandItemSectionKey(material) {
  const t = material?.material_type
  if (t === 'finished') return 'finished'
  if (t === 'semi_finished') return 'semi_finished'
  return 'raw_material'
}

const AdminBrandDispatch = () => {
  const [brands, setBrands] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [brandItems, setBrandItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  
  // Add material modal
  const [showAddMaterialModal, setShowAddMaterialModal] = useState(false)
  const [materialSearch, setMaterialSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  // Confirm delete dialog
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    item: null,
  })

  const fetchBrands = async () => {
    try {
      setLoading(true)
      setError('')
      const { data, error: brandsError } = await supabase
        .from('brand_dispatch')
        .select('id, name, code, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order')

      if (brandsError) throw brandsError
      setBrands(data || [])
      
      // Select first brand by default
      if (data && data.length > 0 && !selectedBrand) {
        setSelectedBrand(data[0])
      }
    } catch (err) {
      console.error('Error fetching brands:', err)
      setError('Failed to load dispatch brands. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fetchMaterials = async () => {
    try {
      const { data, error: materialsError } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit, category, material_type')
        .eq('is_active', true)
        .order('name')

      if (materialsError) throw materialsError
      setMaterials(data || [])
    } catch (err) {
      console.error('Error fetching materials:', err)
    }
  }

  const fetchBrandItems = async (brandId) => {
    if (!brandId) {
      setBrandItems([])
      return
    }

    try {
      setLoadingItems(true)
      const { data, error: itemsError } = await supabase
        .from('brand_dispatch_items')
        .select(`
          id,
          raw_material_id,
          sort_order,
          raw_materials (
            id,
            name,
            code,
            unit,
            category,
            material_type
          )
        `)
        .eq('brand_dispatch_id', brandId)
        .order('sort_order')

      if (itemsError) throw itemsError
      setBrandItems(data || [])
    } catch (err) {
      console.error('Error fetching brand items:', err)
      setError('Failed to load brand materials.')
    } finally {
      setLoadingItems(false)
    }
  }

  useEffect(() => {
    fetchBrands()
    fetchMaterials()
  }, [])

  useEffect(() => {
    if (selectedBrand) {
      fetchBrandItems(selectedBrand.id)
    }
  }, [selectedBrand])

  const openAddMaterialModal = () => {
    setMaterialSearch('')
    setModalError('')
    setShowAddMaterialModal(true)
  }

  const addMaterialToBrand = async (materialId) => {
    if (!selectedBrand) return

    try {
      setSaving(true)
      setModalError('')

      // Check if material already exists for this brand
      const existing = brandItems.find(item => item.raw_material_id === materialId)
      if (existing) {
        setModalError('This material is already added to this brand.')
        return
      }

      // Get next sort order
      const maxSortOrder = brandItems.length > 0 
        ? Math.max(...brandItems.map(item => item.sort_order || 0))
        : 0

      const { error: insertError } = await supabase
        .from('brand_dispatch_items')
        .insert({
          brand_dispatch_id: selectedBrand.id,
          raw_material_id: materialId,
          sort_order: maxSortOrder + 1
        })

      if (insertError) throw insertError

      setShowAddMaterialModal(false)
      await fetchBrandItems(selectedBrand.id)
    } catch (err) {
      console.error('Error adding material:', err)
      if (err.code === '23505') {
        setModalError('This material is already added to this brand.')
      } else if (err.code === '42501') {
        setModalError('Permission denied. Please login with an admin account.')
      } else {
        setModalError(err.message || 'Failed to add material. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const openConfirmDialog = (item) => {
    setConfirmDialog({
      isOpen: true,
      item,
    })
  }

  const closeConfirmDialog = () => {
    if (saving) return
    setConfirmDialog({
      isOpen: false,
      item: null,
    })
  }

  const removeMaterialFromBrand = async () => {
    const item = confirmDialog.item
    if (!item) return

    try {
      setSaving(true)
      const { error: deleteError } = await supabase
        .from('brand_dispatch_items')
        .delete()
        .eq('id', item.id)

      if (deleteError) throw deleteError

      closeConfirmDialog()
      await fetchBrandItems(selectedBrand.id)
    } catch (err) {
      console.error('Error removing material:', err)
      setError('Failed to remove material. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const filteredMaterials = materials.filter(material => {
    if (!materialSearch.trim()) return true
    const q = materialSearch.toLowerCase()
    return (
      material.name.toLowerCase().includes(q) ||
      material.code.toLowerCase().includes(q) ||
      (material.category || '').toLowerCase().includes(q)
    )
  })

  const brandItemsBySection = useMemo(() => {
    const buckets = { finished: [], semi_finished: [], raw_material: [] }
    for (const item of brandItems) {
      const key = getBrandItemSectionKey(item.raw_materials)
      if (buckets[key]) buckets[key].push(item)
      else buckets.raw_material.push(item)
    }
    return BRAND_ITEM_SECTIONS.map((section) => ({
      ...section,
      items: buckets[section.key],
    })).filter((s) => s.items.length > 0)
  }, [brandItems])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading dispatch brands...</div>
      </div>
    )
  }

  if (error && brands.length === 0) {
    return (
      <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
        <p className="text-destructive font-semibold">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Dispatch Brands</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure which materials are auto-populated for each dispatch brand in stock-out.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-destructive font-semibold">{error}</p>
        </div>
      )}

      {/* Brand selector */}
      <div className="bg-card border border-border rounded-xl p-4">
        <label className="block text-sm font-bold text-foreground mb-2">
          Select Brand
        </label>
        <div className="flex gap-3">
          {brands.map((brand) => (
            <button
              key={brand.id}
              onClick={() => setSelectedBrand(brand)}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                selectedBrand?.id === brand.id
                  ? 'bg-accent text-background'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {brand.name} ({brand.code})
            </button>
          ))}
        </div>
      </div>

      {/* Materials list */}
      {selectedBrand && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground">
                Materials for {selectedBrand.name}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {brandItems.length} material{brandItems.length !== 1 ? 's' : ''} configured
              </p>
            </div>
            <button
              onClick={openAddMaterialModal}
              className="bg-accent text-background font-bold px-4 py-2 rounded-lg hover:bg-accent/90 transition-all"
            >
              + Add Material
            </button>
          </div>

          {loadingItems ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading materials...
            </div>
          ) : brandItems.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground mb-4">
                No materials configured for this brand yet.
              </p>
              <button
                onClick={openAddMaterialModal}
                className="text-accent hover:text-accent/80 font-semibold"
              >
                Add your first material
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">
                      Material Name
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">
                      Code
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">
                      Unit
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">
                      Category
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-bold text-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {brandItemsBySection.map((section, sectionIdx) => (
                    <Fragment key={section.key}>
                      <tr
                        className={`bg-muted/20 ${sectionIdx > 0 ? 'border-t border-border/80' : ''}`}
                      >
                        <td
                          colSpan={5}
                          className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {section.label}
                        </td>
                      </tr>
                      {section.items.map((item) => (
                        <tr
                          key={item.id}
                          className="border-b border-border/70 hover:bg-accent/5 transition-colors"
                        >
                          <td className="px-4 py-3 text-foreground text-sm">
                            {item.raw_materials?.name || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm font-mono">
                            {item.raw_materials?.code || '—'}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm">
                            {item.raw_materials?.unit || '—'}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm capitalize">
                            {item.raw_materials?.category || '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => openConfirmDialog(item)}
                              className="text-destructive hover:text-destructive/80 font-semibold text-xs"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Material Modal */}
      {showAddMaterialModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-foreground">
                Add Material to {selectedBrand?.name}
              </h3>
              <button
                onClick={() => setShowAddMaterialModal(false)}
                disabled={saving}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {modalError && (
              <div className="mb-4 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                <p className="text-destructive text-sm">{modalError}</p>
              </div>
            )}

            <div className="mb-4">
              <input
                type="text"
                placeholder="Search materials by name, code, or category..."
                value={materialSearch}
                onChange={(e) => setMaterialSearch(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              />
            </div>

            <div className="max-h-96 overflow-y-auto border border-border rounded-lg">
              {filteredMaterials.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No materials found matching your search.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredMaterials.map((material) => {
                    const alreadyAdded = brandItems.some(
                      item => item.raw_material_id === material.id
                    )
                    return (
                      <div
                        key={material.id}
                        className="p-3 hover:bg-accent/5 transition-colors flex items-center justify-between"
                      >
                        <div>
                          <p className="font-semibold text-foreground">{material.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Code: <span className="font-mono">{material.code}</span> • Unit: {material.unit}
                            {material.category && ` • Category: ${material.category}`}
                          </p>
                        </div>
                        <button
                          onClick={() => addMaterialToBrand(material.id)}
                          disabled={saving || alreadyAdded}
                          className={`px-3 py-1.5 rounded-lg font-semibold text-sm transition-all ${
                            alreadyAdded
                              ? 'bg-muted text-muted-foreground cursor-not-allowed'
                              : 'bg-accent text-background hover:bg-accent/90'
                          }`}
                        >
                          {alreadyAdded ? 'Added' : 'Add'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-foreground mb-4">Remove Material</h3>
            <p className="text-foreground mb-6">
              Are you sure you want to remove{' '}
              <span className="font-semibold">{confirmDialog.item?.raw_materials?.name}</span>{' '}
              from {selectedBrand?.name}? This material will no longer be auto-populated for dispatch stock-outs.
            </p>
            <div className="flex gap-3">
              <button
                onClick={closeConfirmDialog}
                disabled={saving}
                className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={removeMaterialFromBrand}
                disabled={saving}
                className="flex-1 bg-destructive text-white font-bold px-4 py-2.5 rounded-lg hover:bg-destructive/90 transition-all disabled:opacity-50"
              >
                {saving ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminBrandDispatch
