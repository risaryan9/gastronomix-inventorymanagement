import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'

// Unit options
const UNITS = ['nos', 'kg', 'liter', 'packets', 'btl']

// Category options with their short forms for code generation
const CATEGORIES = [
  { label: 'Meat', short: 'MEAT' },
  { label: 'Grains', short: 'GRNS' },
  { label: 'Vegetables', short: 'VEGT' },
  { label: 'Oils', short: 'OIL' },
  { label: 'Spices', short: 'SPCE' },
  { label: 'Dairy', short: 'DARY' },
  { label: 'Packaging', short: 'PKG' },
  { label: 'Sanitary', short: 'SAN' },
  { label: 'Misc', short: 'MISC' }
]

const Materials = () => {
  const [materials, setMaterials] = useState([])
  const [filteredMaterials, setFilteredMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    unit: '',
    category: '',
    description: '',
    low_stock_threshold: '',
    vendor_id: ''
  })
  const [vendors, setVendors] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [alert, setAlert] = useState(null) // { type: 'error' | 'success' | 'warning', message: string }
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Fetch materials
  const fetchMaterials = async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch raw materials with vendor info (excluding soft-deleted)
      const { data: rawMaterials, error: materialsError } = await supabase
        .from('raw_materials')
        .select('*, vendors(name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (materialsError) throw materialsError

      setMaterials(rawMaterials || [])
      setFilteredMaterials(rawMaterials || [])
    } catch (err) {
      console.error('Error fetching materials:', err)
      setError('Failed to load materials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Fetch vendors for dropdown
  const fetchVendors = async () => {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      setVendors(data || [])
    } catch (err) {
      console.error('Error fetching vendors:', err)
    }
  }

  useEffect(() => {
    fetchMaterials()
    fetchVendors()
  }, [])

  // Filter materials based on search and filters
  useEffect(() => {
    let filtered = [...materials]

    // Search filter (case-insensitive)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(material =>
        material.name.toLowerCase().includes(query) ||
        material.code.toLowerCase().includes(query) ||
        (material.description && material.description.toLowerCase().includes(query))
      )
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(material => material.category === categoryFilter)
    }


    setFilteredMaterials(filtered)
    // Reset to page 1 when filters change
    setCurrentPage(1)
  }, [searchQuery, categoryFilter, materials])

  // Pagination calculations
  const totalPages = Math.ceil(filteredMaterials.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedMaterials = filteredMaterials.slice(startIndex, endIndex)

  // Get unique categories for filter dropdown
  const categories = ['all', ...new Set(materials.map(m => m.category).filter(Boolean))]

  // Function to generate material code based on category
  const generateMaterialCode = async (category) => {
    if (!category) return ''

    // Find category short form
    const categoryData = CATEGORIES.find(cat => cat.label === category)
    if (!categoryData) return ''

    try {
      // Get all materials with the same category to find the next number
      const { data: categoryMaterials, error } = await supabase
        .from('raw_materials')
        .select('code')
        .eq('category', category)
        .is('deleted_at', null)

      if (error) throw error

      // Extract numbers from existing codes (format: RM-{SHORT}-{NUMBER})
      const codePattern = new RegExp(`^RM-${categoryData.short}-(\\d+)$`)
      const existingNumbers = categoryMaterials
        .map(m => {
          const match = m.code.match(codePattern)
          return match ? parseInt(match[1], 10) : 0
        })
        .filter(num => num > 0)

      // Find the next number
      const nextNumber = existingNumbers.length > 0 
        ? Math.max(...existingNumbers) + 1 
        : 1

      // Format with leading zeros (001, 002, etc.)
      const formattedNumber = String(nextNumber).padStart(3, '0')

      return `RM-${categoryData.short}-${formattedNumber}`
    } catch (err) {
      console.error('Error generating material code:', err)
      // Fallback: return a code with number 001
      return `RM-${categoryData.short}-001`
    }
  }

  // Handle category change - auto-generate code for new materials
  const handleCategoryChange = async (category) => {
    // Only auto-generate code for new materials (not when editing)
    if (!editingMaterial && category) {
      const generatedCode = await generateMaterialCode(category)
      setFormData(prev => ({ ...prev, category, code: generatedCode }))
    } else {
      // For editing, just update category (code stays the same)
      setFormData(prev => ({ ...prev, category }))
    }
  }

  // Open modal for adding new material
  const handleAddNew = () => {
    setEditingMaterial(null)
    setFormData({
      name: '',
      code: '',
      unit: '',
      category: '',
      description: '',
      low_stock_threshold: '',
      vendor_id: ''
    })
    setError(null)
    setIsModalOpen(true)
    setShowConfirmModal(false)
  }

  // Open modal for editing material
  const handleEdit = (material) => {
    setEditingMaterial(material)
    setFormData({
      name: material.name || '',
      code: material.code || '',
      unit: material.unit || '',
      category: material.category || '',
      description: material.description || '',
      low_stock_threshold: material.low_stock_threshold ? parseFloat(material.low_stock_threshold).toString() : '',
      vendor_id: material.vendor_id || ''
    })
    setError(null)
    setIsModalOpen(true)
    setShowConfirmModal(false)
  }

  // Handle form submission - show confirmation for new materials
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    // Validate form
    if (!formData.name.trim()) {
      setError('Material name is required')
      return
    }
    if (!formData.unit.trim()) {
      setError('Unit is required')
      return
    }
    if (!formData.category.trim()) {
      setError('Category is required')
      return
    }
    if (!formData.code.trim()) {
      setError('Material code is required')
      return
    }
    if (!formData.vendor_id) {
      setError('Vendor is required')
      return
    }

    // For new materials, show confirmation modal
    if (!editingMaterial) {
      setShowConfirmModal(true)
    } else {
      // For editing, proceed directly
      await confirmSubmit()
    }
  }

  // Confirm and submit (create or update)
  const confirmSubmit = async () => {
    setSaving(true)
    setError(null)
    setShowConfirmModal(false)

    try {
      const session = getSession()
      if (!session?.id) {
        throw new Error('Session expired. Please login again.')
      }

      if (editingMaterial) {
        // Update existing material
        const updateData = {
          name: formData.name.trim(),
          code: formData.code.trim(),
          unit: formData.unit.trim(),
          category: formData.category.trim() || null,
          description: formData.description.trim() || null,
          low_stock_threshold: formData.low_stock_threshold ? parseFloat(formData.low_stock_threshold) : 0,
          vendor_id: formData.vendor_id || null,
          updated_at: new Date().toISOString()
        }

        const { error: updateError } = await supabase
          .from('raw_materials')
          .update(updateData)
          .eq('id', editingMaterial.id)

        if (updateError) throw updateError

        // Create audit log entry for material update
        const auditLogData = {
          user_id: session.id,
          action: 'update',
          entity_type: 'raw_material',
          entity_id: editingMaterial.id,
          old_values: {
            name: editingMaterial.name,
            code: editingMaterial.code,
            unit: editingMaterial.unit,
            category: editingMaterial.category,
            description: editingMaterial.description,
            low_stock_threshold: editingMaterial.low_stock_threshold
          },
          new_values: {
            name: updateData.name,
            code: updateData.code,
            unit: updateData.unit,
            category: updateData.category,
            description: updateData.description,
            low_stock_threshold: updateData.low_stock_threshold
          },
          ip_address: null,
          user_agent: navigator.userAgent || null
        }

        const { error: auditError } = await supabase
          .from('audit_logs')
          .insert(auditLogData)

        if (auditError) {
          console.error('Error creating audit log:', auditError)
          // Don't fail the update if audit log fails, but log it
        }

        setAlert({ type: 'success', message: 'Material updated successfully!' })
      } else {
        // Generate code if not provided (shouldn't happen, but safety check)
        let materialCode = formData.code.trim()
        if (!materialCode && formData.category) {
          materialCode = await generateMaterialCode(formData.category)
        }

        // Create new material
        const { data: newMaterial, error: insertError } = await supabase
          .from('raw_materials')
          .insert({
            name: formData.name.trim(),
            code: materialCode,
            unit: formData.unit.trim(),
            category: formData.category.trim() || null,
            description: formData.description.trim() || null,
            low_stock_threshold: formData.low_stock_threshold ? parseFloat(formData.low_stock_threshold) : 0,
            vendor_id: formData.vendor_id || null
          })
          .select()
          .single()

        if (insertError) throw insertError

        // Create audit log entry for new material
        const auditLogData = {
          user_id: session.id,
          action: 'create',
          entity_type: 'raw_material',
          entity_id: newMaterial.id,
          old_values: null,
          new_values: {
            name: newMaterial.name,
            code: newMaterial.code,
            unit: newMaterial.unit,
            category: newMaterial.category,
            description: newMaterial.description,
            low_stock_threshold: newMaterial.low_stock_threshold
          },
          ip_address: null,
          user_agent: navigator.userAgent || null
        }

        const { error: auditError } = await supabase
          .from('audit_logs')
          .insert(auditLogData)

        if (auditError) {
          console.error('Error creating audit log:', auditError)
          // Don't fail the creation if audit log fails, but log it
        }

        setAlert({ type: 'success', message: 'Material created successfully! Inventory entries have been automatically created for all cloud kitchens.' })
      }

      setIsModalOpen(false)
      await fetchMaterials()
    } catch (err) {
      console.error('Error saving material:', err)
      
      // Provide helpful error message for RLS violations
      if (err.code === '42501') {
        setError('Permission denied: Row-level security policy violation. Please check your permissions.')
      } else if (err.code === '23505') {
        setError('Duplicate entry: A material with this code already exists.')
      } else {
        setError(err.message || 'Failed to save material. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2">
            Raw Materials
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mb-4">
            Manage raw material catalog. New materials automatically create inventory entries for all cloud kitchens.
          </p>
          <button
            onClick={handleAddNew}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add New Material
          </button>
        </div>
        
        {/* Search & Filter Bar */}
        <div className="bg-card/90 backdrop-blur-md border-2 border-border rounded-2xl p-4 sm:p-6 mb-6 shadow-2xl shadow-black/50">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search Input */}
            <input
              type="text"
              placeholder="Search by name, code, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
            />
            
            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
            >
              <option value="all">All Categories</option>
              {categories.filter(c => c !== 'all').map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-destructive/20 border-2 border-destructive rounded-xl p-4 mb-6">
            <p className="text-destructive-foreground text-sm">{error}</p>
          </div>
        )}

        {/* Materials Table */}
        <div className="bg-card/90 backdrop-blur-md border-2 border-border rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <p className="text-foreground">Loading materials...</p>
            </div>
          ) : filteredMaterials.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">
                {searchQuery || categoryFilter !== 'all'
                  ? 'No materials match your filters.'
                  : 'No materials found. Add your first material to get started.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-border bg-background/50">
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material Name</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material Code</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">UOM</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Category</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Brand</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Low Stock Threshold</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMaterials.map((material) => (
                    <tr
                      key={material.id}
                      className="border-b border-border hover:bg-background/30 transition-colors duration-200"
                    >
                      <td className="px-4 py-3 text-foreground">{material.name}</td>
                      <td className="px-4 py-3 text-foreground font-mono text-sm">{material.code}</td>
                      <td className="px-4 py-3 text-foreground">{material.unit}</td>
                      <td className="px-4 py-3 text-muted-foreground">{material.category || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{material.brand || '—'}</td>
                      <td className="px-4 py-3 text-foreground">
                        {material.low_stock_threshold !== null && material.low_stock_threshold !== undefined
                          ? parseFloat(material.low_stock_threshold).toFixed(3)
                          : '0.000'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleEdit(material)}
                          className="px-3 py-1.5 bg-accent/10 text-accent border-2 border-accent/30 rounded-lg hover:bg-accent/20 hover:border-accent/50 transition-all duration-200 text-sm font-semibold"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-border px-4 py-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredMaterials.length)} of {filteredMaterials.length} materials
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 bg-input border border-border rounded-lg text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 rounded-lg font-semibold transition-all ${
                        currentPage === page
                          ? 'bg-accent text-background'
                          : 'bg-input border border-border text-foreground hover:bg-accent/10'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 bg-input border border-border rounded-lg text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Add/Edit Modal */}
        {isModalOpen && !showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    {editingMaterial ? 'Edit Material' : 'Add New Material'}
                  </h2>
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                    disabled={saving}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Material ID (read-only, if editing) */}
                  {editingMaterial && (
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-2">
                        Material ID
                      </label>
                      <input
                        type="text"
                        value={editingMaterial.id}
                        disabled
                        className="w-full bg-muted border-2 border-border rounded-lg px-4 py-2.5 text-muted-foreground cursor-not-allowed opacity-60"
                      />
                      <p className="text-xs text-muted-foreground mt-1">ID cannot be modified</p>
                    </div>
                  )}

                  {/* Code - Always shown, always read-only */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Material Code <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.code}
                      disabled
                      className="w-full bg-muted border-2 border-border rounded-lg px-4 py-2.5 text-muted-foreground cursor-not-allowed opacity-60 font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {editingMaterial 
                        ? 'Code cannot be modified' 
                        : 'Code is auto-generated based on category'}
                    </p>
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Material Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
                      disabled={saving}
                    />
                  </div>

                  {/* Unit (UOM) */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Unit of Measure (UOM) <span className="text-destructive">*</span>
                    </label>
                    <select
                      required
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
                      disabled={saving}
                    >
                      <option value="">Select unit</option>
                      {UNITS.map(unit => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Category <span className="text-destructive">*</span>
                    </label>
                    <select
                      required
                      value={formData.category}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
                      disabled={saving || editingMaterial} // Disable category change when editing
                    >
                      <option value="">Select category</option>
                      {CATEGORIES.map(cat => (
                        <option key={cat.label} value={cat.label}>{cat.label}</option>
                      ))}
                    </select>
                    {!editingMaterial && formData.category && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Material code will be auto-generated when category is selected
                      </p>
                    )}
                    {editingMaterial && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Category cannot be modified
                      </p>
                    )}
                  </div>

                  {/* Vendor */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Vendor <span className="text-destructive">*</span>
                    </label>
                    <select
                      required
                      value={formData.vendor_id}
                      onChange={(e) => setFormData({ ...formData, vendor_id: e.target.value })}
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
                      disabled={saving}
                    >
                      <option value="">Select vendor</option>
                      {vendors.map(vendor => (
                        <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Low Stock Threshold */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Low Stock Threshold ({formData.unit || 'unit'})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={formData.low_stock_threshold}
                      onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value })}
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
                      placeholder="0.000"
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Alert will trigger when inventory quantity falls below this value
                    </p>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300 resize-none"
                      disabled={saving}
                    />
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="bg-destructive/20 border-2 border-destructive rounded-lg p-3">
                      <p className="text-destructive-foreground text-sm">{error}</p>
                    </div>
                  )}

                  {/* Form Actions */}
                  <div className="flex items-center justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      disabled={saving}
                      className="px-5 py-2.5 bg-muted text-foreground border-2 border-border rounded-lg hover:bg-muted/80 transition-all duration-200 font-semibold disabled:opacity-50 touch-manipulation"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2.5 bg-accent text-background font-black rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                    >
                      {saving ? 'Saving...' : editingMaterial ? 'Update Material' : 'Continue'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal for New Materials */}
        {showConfirmModal && !editingMaterial && (
          <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                    Confirm New Material
                  </h2>
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                    disabled={saving}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Material Summary */}
                <div className="mb-4 p-4 bg-background border border-border rounded-lg">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Material Details</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="text-foreground font-semibold">{formData.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Code:</span>
                      <span className="text-foreground font-mono font-semibold">{formData.code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Unit:</span>
                      <span className="text-foreground font-semibold">{formData.unit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Category:</span>
                      <span className="text-foreground font-semibold">{formData.category}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Low Stock Threshold:</span>
                      <span className="text-foreground font-semibold">
                        {formData.low_stock_threshold ? parseFloat(formData.low_stock_threshold).toFixed(3) : '0.000'} {formData.unit}
                      </span>
                    </div>
                    {formData.description && (
                      <div className="pt-2 border-t border-border">
                        <span className="text-muted-foreground">Description:</span>
                        <p className="text-foreground mt-1">{formData.description}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Info Message */}
                <div className="mb-4 p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg">
                  <p className="text-xs lg:text-sm text-foreground">
                    <span className="font-semibold">ℹ️ Note:</span> Creating this material will automatically create inventory entries (with quantity 0) for all active cloud kitchens. This action will be logged in the audit trail.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col lg:flex-row gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    disabled={saving}
                    className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 lg:py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmSubmit}
                    disabled={saving}
                    className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 lg:py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation"
                  >
                    {saving ? 'Creating...' : 'Confirm & Create Material'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Custom Alert Modal */}
        {alert && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full shadow-xl">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={`flex-shrink-0 w-10 h-10 lg:w-12 lg:h-12 rounded-full flex items-center justify-center ${
                  alert.type === 'error' ? 'bg-destructive/20' :
                  alert.type === 'success' ? 'bg-green-500/20' :
                  'bg-yellow-500/20'
                }`}>
                  {alert.type === 'error' ? (
                    <svg className="w-6 h-6 lg:w-7 lg:h-7 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : alert.type === 'success' ? (
                    <svg className="w-6 h-6 lg:w-7 lg:h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 lg:w-7 lg:h-7 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                </div>

                {/* Message */}
                <div className="flex-1 min-w-0">
                  <h3 className={`text-base lg:text-lg font-bold mb-1 ${
                    alert.type === 'error' ? 'text-destructive' :
                    alert.type === 'success' ? 'text-green-500' :
                    'text-yellow-500'
                  }`}>
                    {alert.type === 'error' ? 'Error' :
                     alert.type === 'success' ? 'Success' :
                     'Warning'}
                  </h3>
                  <p className="text-sm lg:text-base text-foreground break-words">
                    {alert.message}
                  </p>
                </div>

                {/* Close Button */}
                <button
                  onClick={() => setAlert(null)}
                  className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Action Button */}
              <div className="mt-4">
                <button
                  onClick={() => setAlert(null)}
                  className={`w-full font-bold px-4 py-3 rounded-xl transition-all duration-200 text-base touch-manipulation ${
                    alert.type === 'error' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' :
                    alert.type === 'success' ? 'bg-green-500 text-white hover:bg-green-600' :
                    'bg-yellow-500 text-white hover:bg-yellow-600'
                  }`}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Materials
