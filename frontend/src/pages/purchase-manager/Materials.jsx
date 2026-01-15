import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'

// Unit options
const UNITS = ['nos', 'kg', 'liter', 'packets']

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
  const [statusFilter, setStatusFilter] = useState('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    unit: '',
    category: '',
    description: '',
    is_active: true,
    price: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Fetch materials with current prices
  const fetchMaterials = async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch raw materials (excluding soft-deleted)
      const { data: rawMaterials, error: materialsError } = await supabase
        .from('raw_materials')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (materialsError) throw materialsError

      // Fetch all costs for materials and get the most recent one for each
      const materialIds = rawMaterials.map(m => m.id)
      const priceMap = {}
      
      if (materialIds.length > 0) {
        const { data: costs, error: costsError } = await supabase
          .from('material_costs')
          .select('raw_material_id, cost_per_unit, created_at')
          .in('raw_material_id', materialIds)

        if (costsError) throw costsError

        // Create a map of material_id -> most recent price
        // Group by material_id and find the most recent one by created_at
        if (costs && costs.length > 0) {
          // Sort all costs by created_at DESC
          const sortedCosts = [...costs].sort((a, b) => {
            const aDate = new Date(a.created_at)
            const bDate = new Date(b.created_at)
            return bDate - aDate
          })

          // Take the first (most recent) cost for each material_id
          sortedCosts.forEach(cost => {
            if (!priceMap[cost.raw_material_id]) {
              priceMap[cost.raw_material_id] = cost.cost_per_unit
            }
          })
        }
      }

      // Combine materials with their current prices
      const materialsWithPrices = rawMaterials.map(material => ({
        ...material,
        price: priceMap[material.id] || null
      }))

      setMaterials(materialsWithPrices)
      setFilteredMaterials(materialsWithPrices)
    } catch (err) {
      console.error('Error fetching materials:', err)
      setError('Failed to load materials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMaterials()
  }, [])

  // Filter materials based on search and filters
  useEffect(() => {
    let filtered = [...materials]

    // Search filter (case-insensitive)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(material =>
        material.name.toLowerCase().includes(query) ||
        material.code.toLowerCase().includes(query)
      )
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(material => material.category === categoryFilter)
    }

    // Status filter
    if (statusFilter !== 'all') {
      const isActive = statusFilter === 'active'
      filtered = filtered.filter(material => material.is_active === isActive)
    }

    setFilteredMaterials(filtered)
    // Reset to page 1 when filters change
    setCurrentPage(1)
  }, [searchQuery, categoryFilter, statusFilter, materials])

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
      is_active: true,
      price: ''
    })
    setError(null)
    setIsModalOpen(true)
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
      is_active: material.is_active ?? true,
      price: material.price || ''
    })
    setError(null)
    setIsModalOpen(true)
  }

  // Handle form submission (create or update)
  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const session = getSession()
      if (!session) {
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
          is_active: formData.is_active,
          updated_at: new Date().toISOString()
        }

        const { error: updateError } = await supabase
          .from('raw_materials')
          .update(updateData)
          .eq('id', editingMaterial.id)

        if (updateError) throw updateError

        // Update price (required field)
        const newPrice = parseFloat(formData.price)
        if (isNaN(newPrice) || newPrice <= 0) {
          throw new Error('Price must be a valid positive number')
        }

        // Check if price changed
        if (formData.price !== editingMaterial.price) {
          // Create new cost record
          const { error: costError } = await supabase
            .from('material_costs')
            .insert({
              raw_material_id: editingMaterial.id,
              cost_per_unit: newPrice,
              created_by: session.id
            })

          if (costError) throw costError
        }
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
            is_active: formData.is_active
          })
          .select()
          .single()

        if (insertError) throw insertError

        // Add price (required field)
        const newPrice = parseFloat(formData.price)
        if (isNaN(newPrice) || newPrice <= 0) {
          throw new Error('Price must be a valid positive number')
        }

        const { error: costError } = await supabase
          .from('material_costs')
          .insert({
            raw_material_id: newMaterial.id,
            cost_per_unit: newPrice,
            created_by: session.id
          })

        if (costError) throw costError
      }

      setIsModalOpen(false)
      await fetchMaterials()
    } catch (err) {
      console.error('Error saving material:', err)
      
      // Provide helpful error message for RLS violations
      if (err.code === '42501') {
        setError('Permission denied: Row-level security policy violation. Purchase managers using key-based login need Supabase auth accounts or RLS policies need to be updated to support key-based authentication.')
      } else if (err.code === '23505') {
        setError('Duplicate entry: A material with this code already exists.')
      } else {
        setError(err.message || 'Failed to save material. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  // Toggle material active status
  const handleToggleStatus = async (material) => {
    try {
      const { error } = await supabase
        .from('raw_materials')
        .update({
          is_active: !material.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', material.id)

      if (error) throw error
      await fetchMaterials()
    } catch (err) {
      console.error('Error toggling status:', err)
      setError('Failed to update status. Please try again.')
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
            Manage material details and pricing
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
              placeholder="Search by name or code..."
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

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
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
                {searchQuery || categoryFilter !== 'all' || statusFilter !== 'all'
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
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Price</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Status</th>
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
                      <td className="px-4 py-3 text-foreground">
                        {material.price !== null && material.price !== undefined
                          ? `₹${parseFloat(material.price).toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
                            material.is_active
                              ? 'bg-accent/20 text-accent border border-accent/30'
                              : 'bg-muted text-muted-foreground border border-border'
                          }`}
                        >
                          {material.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(material)}
                            className="px-3 py-1.5 bg-accent/10 text-accent border-2 border-accent/30 rounded-lg hover:bg-accent/20 hover:border-accent/50 transition-all duration-200 text-sm font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleStatus(material)}
                            className={`px-3 py-1.5 rounded-lg border-2 transition-all duration-200 text-sm font-semibold ${
                              material.is_active
                                ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 hover:border-destructive/50'
                                : 'bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 hover:border-accent/50'
                            }`}
                          >
                            {material.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
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
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-2xl shadow-2xl shadow-black/50 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-foreground">
                    {editingMaterial ? 'Edit Material' : 'Add New Material'}
                  </h2>
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
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
                  </div>

                  {/* Code */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Material Code <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      disabled={!editingMaterial} // Auto-generated for new materials
                      className={`w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300 font-mono ${
                        !editingMaterial ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    />
                    {!editingMaterial && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Code is auto-generated based on category
                      </p>
                    )}
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
                    />
                  </div>

                  {/* Price */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Price (₹) <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      placeholder="0.00"
                      className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-300"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Current price per unit
                    </p>
                  </div>

                  {/* Active Status */}
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-5 h-5 rounded border-2 border-border bg-input text-accent focus:ring-2 focus:ring-ring cursor-pointer"
                    />
                    <label htmlFor="is_active" className="text-sm font-semibold text-foreground cursor-pointer">
                      Active
                    </label>
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
                      className="px-5 py-2.5 bg-muted text-foreground border-2 border-border rounded-lg hover:bg-muted/80 transition-all duration-200 font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2.5 bg-accent text-background font-black rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? 'Saving...' : editingMaterial ? 'Update Material' : 'Create Material'}
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

export default Materials
