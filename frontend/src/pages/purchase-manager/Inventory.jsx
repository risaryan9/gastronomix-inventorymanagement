import { useState, useEffect } from 'react'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const Inventory = () => {
  const [inventory, setInventory] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockLevelFilter, setStockLevelFilter] = useState('all')
  const [editingItem, setEditingItem] = useState(null)
  const [editForm, setEditForm] = useState({ quantity: '', low_stock_threshold: '' })
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  
  // Add inventory modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [availableMaterials, setAvailableMaterials] = useState([])
  const [materialSearchTerm, setMaterialSearchTerm] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState(null)
  const [materialDetails, setMaterialDetails] = useState(null)
  const [newInventoryForm, setNewInventoryForm] = useState({ quantity: '', low_stock_threshold: '' })
  const [creating, setCreating] = useState(false)

  // Fetch inventory with material details
  useEffect(() => {
    const fetchInventory = async () => {
      const session = getSession()
      
      if (!session?.cloud_kitchen_id) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        
        console.log('Fetching inventory for cloud_kitchen_id:', session.cloud_kitchen_id)
        
        // Fetch inventory first (RLS might block joins for key-based users)
        const { data: inventoryData, error: inventoryError } = await supabase
          .from('inventory')
          .select('*')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)

        console.log('Inventory query result:', { inventoryData, inventoryError })

        if (inventoryError) {
          console.error('Error fetching inventory:', inventoryError)
          alert(`Error fetching inventory: ${inventoryError.message}`)
          setLoading(false)
          return
        }

        if (!inventoryData || inventoryData.length === 0) {
          console.log('No inventory data returned - this might be due to RLS policies blocking key-based users')
          setInventory([])
          setMaterials([])
          setLoading(false)
          return
        }

        // Get unique raw_material_ids
        const rawMaterialIds = [...new Set(inventoryData.map(item => item.raw_material_id))]

        // Fetch raw_materials separately
        const { data: materialsData, error: materialsError } = await supabase
          .from('raw_materials')
          .select('id, name, code, unit, category')
          .in('id', rawMaterialIds)
          .eq('is_active', true)

        if (materialsError) {
          console.error('Error fetching raw materials:', materialsError)
          // Still set inventory even if materials fetch fails
          setInventory(inventoryData.map(item => ({ ...item, raw_materials: null })))
          setMaterials([])
          setLoading(false)
          return
        }

        // Fetch material costs - get the latest cost for each material
        const { data: costsData, error: costsError } = await supabase
          .from('material_costs')
          .select('raw_material_id, cost_per_unit, created_at')
          .in('raw_material_id', rawMaterialIds)
          .order('created_at', { ascending: false })

        // Create a map of raw_material_id -> latest cost
        const costsMap = new Map()
        if (costsData) {
          // Get the most recent cost for each material
          costsData.forEach(cost => {
            if (!costsMap.has(cost.raw_material_id)) {
              costsMap.set(cost.raw_material_id, parseFloat(cost.cost_per_unit))
            }
          })
        }

        // Create a map of raw_material_id -> material data
        const materialsMap = new Map()
        if (materialsData) {
          materialsData.forEach(material => {
            materialsMap.set(material.id, material)
          })
        }

        // Join inventory with materials and costs
        const inventoryWithMaterials = inventoryData.map(item => ({
          ...item,
          raw_materials: materialsMap.get(item.raw_material_id) || null,
          cost_per_unit: costsMap.get(item.raw_material_id) || 0
        }))

        // Sort by material name
        inventoryWithMaterials.sort((a, b) => {
          const nameA = a.raw_materials?.name || ''
          const nameB = b.raw_materials?.name || ''
          return nameA.localeCompare(nameB)
        })

        setInventory(inventoryWithMaterials)

        // Extract unique categories from materials
        const uniqueCategories = [...new Set(
          materialsData
            .map(m => m.category)
            .filter(Boolean)
        )].sort()
        
        setMaterials(uniqueCategories)
      } catch (err) {
        console.error('Error fetching data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchInventory()
  }, []) // Empty dependency array - only fetch once on mount

  // Fetch available materials (not in inventory) when modal opens
  useEffect(() => {
    const fetchAvailableMaterials = async () => {
      if (!showAddModal) return

      const session = getSession()
      if (!session?.cloud_kitchen_id) return

      try {
        // Get raw_material_ids that are already in inventory
        const existingMaterialIds = inventory.map(item => item.raw_material_id)

        // Fetch all active materials
        const { data: allMaterials, error } = await supabase
          .from('raw_materials')
          .select('id, name, code, unit, category')
          .eq('is_active', true)
          .order('name', { ascending: true })

        if (error) {
          console.error('Error fetching materials:', error)
          return
        }

        // Filter out materials that are already in inventory
        const available = allMaterials.filter(material => 
          !existingMaterialIds.includes(material.id)
        )

        setAvailableMaterials(available)
      } catch (err) {
        console.error('Error fetching available materials:', err)
      }
    }

    fetchAvailableMaterials()
  }, [showAddModal, inventory])

  // Fetch material details and cost when material is selected
  useEffect(() => {
    const fetchMaterialDetails = async () => {
      if (!selectedMaterial) {
        setMaterialDetails(null)
        return
      }

      try {
        // Fetch latest cost for the material
        const { data: costData, error: costError } = await supabase
          .from('material_costs')
          .select('cost_per_unit, created_at')
          .eq('raw_material_id', selectedMaterial.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!costError && costData) {
          setMaterialDetails({
            ...selectedMaterial,
            cost_per_unit: parseFloat(costData.cost_per_unit)
          })
        } else {
          setMaterialDetails({
            ...selectedMaterial,
            cost_per_unit: 0
          })
        }
      } catch (err) {
        console.error('Error fetching material details:', err)
        setMaterialDetails({
          ...selectedMaterial,
          cost_per_unit: 0
        })
      }
    }

    fetchMaterialDetails()
  }, [selectedMaterial])

  // Open edit modal
  const openEditModal = (item) => {
    setEditingItem(item)
    setEditForm({
      quantity: parseFloat(item.quantity).toString(),
      low_stock_threshold: parseFloat(item.low_stock_threshold || 0).toString()
    })
  }

  // Close edit modal
  const closeEditModal = () => {
    setEditingItem(null)
    setEditForm({ quantity: '', low_stock_threshold: '' })
  }

  // Open add inventory modal
  const openAddModal = () => {
    setShowAddModal(true)
    setMaterialSearchTerm('')
    setSelectedMaterial(null)
    setMaterialDetails(null)
    setNewInventoryForm({ quantity: '', low_stock_threshold: '' })
  }

  // Close add inventory modal
  const closeAddModal = () => {
    setShowAddModal(false)
    setMaterialSearchTerm('')
    setSelectedMaterial(null)
    setMaterialDetails(null)
    setNewInventoryForm({ quantity: '', low_stock_threshold: '' })
  }

  // Create new inventory entry
  const handleCreateInventory = async () => {
    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      alert('Session expired. Please log in again.')
      return
    }

    if (!selectedMaterial) {
      alert('Please select a material')
      return
    }

    const quantity = parseFloat(newInventoryForm.quantity)
    const lowStockThreshold = parseFloat(newInventoryForm.low_stock_threshold || 0)

    if (isNaN(quantity) || quantity < 0) {
      alert('Please enter a valid quantity (>= 0)')
      return
    }

    if (isNaN(lowStockThreshold) || lowStockThreshold < 0) {
      alert('Please enter a valid low stock threshold (>= 0)')
      return
    }

    setCreating(true)
    try {
      const { data, error } = await supabase
        .from('inventory')
        .insert({
          cloud_kitchen_id: session.cloud_kitchen_id,
          raw_material_id: selectedMaterial.id,
          quantity: quantity,
          low_stock_threshold: lowStockThreshold,
          last_updated_at: new Date().toISOString(),
          updated_by: session.id
        })
        .select()

      if (error) {
        console.error('Error creating inventory:', error)
        alert(`Failed to create inventory entry: ${error.message}`)
        setCreating(false)
        return
      }

      if (!data || data.length === 0) {
        alert('Failed to create inventory entry. Please try again.')
        setCreating(false)
        return
      }

      // Refresh inventory list
      if (session?.cloud_kitchen_id) {
        // Fetch the new inventory item with material details
        const { data: inventoryData } = await supabase
          .from('inventory')
          .select('*')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)

        if (inventoryData) {
          const rawMaterialIds = [...new Set(inventoryData.map(item => item.raw_material_id))]
          
          const { data: materialsData } = await supabase
            .from('raw_materials')
            .select('id, name, code, unit, category')
            .in('id', rawMaterialIds)
            .eq('is_active', true)

          const { data: costsData } = await supabase
            .from('material_costs')
            .select('raw_material_id, cost_per_unit, created_at')
            .in('raw_material_id', rawMaterialIds)
            .order('created_at', { ascending: false })

          const materialsMap = new Map()
          if (materialsData) {
            materialsData.forEach(material => {
              materialsMap.set(material.id, material)
            })
          }

          const costsMap = new Map()
          if (costsData) {
            costsData.forEach(cost => {
              if (!costsMap.has(cost.raw_material_id)) {
                costsMap.set(cost.raw_material_id, parseFloat(cost.cost_per_unit))
              }
            })
          }

          const inventoryWithMaterials = inventoryData.map(item => ({
            ...item,
            raw_materials: materialsMap.get(item.raw_material_id) || null,
            cost_per_unit: costsMap.get(item.raw_material_id) || 0
          }))

          inventoryWithMaterials.sort((a, b) => {
            const nameA = a.raw_materials?.name || ''
            const nameB = b.raw_materials?.name || ''
            return nameA.localeCompare(nameB)
          })

          setInventory(inventoryWithMaterials)
        }
      }

      // Close modal
      closeAddModal()
    } catch (err) {
      console.error('Error creating inventory:', err)
      alert(`Failed to create inventory entry: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  // Filter available materials based on search
  const filteredAvailableMaterials = availableMaterials.filter(material =>
    material.name.toLowerCase().includes(materialSearchTerm.toLowerCase()) ||
    material.code.toLowerCase().includes(materialSearchTerm.toLowerCase())
  )

  // Update inventory item
  const handleUpdateInventory = async () => {
    if (!editingItem) return
    
    const session = getSession()
    if (!session?.id) {
      alert('Session expired. Please log in again.')
      return
    }

    const quantity = parseFloat(editForm.quantity)
    const lowStockThreshold = parseFloat(editForm.low_stock_threshold)

    if (isNaN(quantity) || quantity < 0) {
      alert('Please enter a valid quantity (>= 0)')
      return
    }

    if (isNaN(lowStockThreshold) || lowStockThreshold < 0) {
      alert('Please enter a valid low stock threshold (>= 0)')
      return
    }

    setUpdating(true)
    try {
      const { data, error } = await supabase
        .from('inventory')
        .update({
          quantity: quantity,
          low_stock_threshold: lowStockThreshold,
          last_updated_at: new Date().toISOString(),
          updated_by: session.id
        })
        .eq('id', editingItem.id)
        .select()

      if (error) {
        console.error('Error updating inventory:', error)
        alert(`Failed to update inventory: ${error.message}`)
        setUpdating(false)
        return
      }

      if (!data || data.length === 0) {
        console.error('Update returned no data - RLS might be blocking')
        alert('Update may have been blocked by security policies. Please check your permissions or run the migration to allow key-based users to update inventory.')
        setUpdating(false)
        return
      }

      const updatedItem = data[0]
      console.log('Successfully updated inventory:', updatedItem)

      // Update local state
      setInventory(prev => prev.map(item => 
        item.id === editingItem.id 
          ? { 
              ...item, 
              quantity: parseFloat(updatedItem.quantity), 
              low_stock_threshold: parseFloat(updatedItem.low_stock_threshold || 0),
              last_updated_at: updatedItem.last_updated_at 
            }
          : item
      ))

      // Close modal
      closeEditModal()
    } catch (err) {
      console.error('Error updating inventory:', err)
      alert(`Failed to update inventory: ${err.message}`)
    } finally {
      setUpdating(false)
    }
  }

  // Filter inventory
  const filteredInventory = inventory.filter(item => {
    const material = item.raw_materials
    if (!material) return false

    // Search filter
    const matchesSearch = searchTerm === '' || 
      material.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      material.code.toLowerCase().includes(searchTerm.toLowerCase())

    // Category filter
    const matchesCategory = categoryFilter === 'all' || material.category === categoryFilter

    // Stock level filter
    let matchesStockLevel = true
    if (stockLevelFilter === 'low') {
      matchesStockLevel = item.quantity <= item.low_stock_threshold
    } else if (stockLevelFilter === 'out') {
      matchesStockLevel = item.quantity === 0
    } else if (stockLevelFilter === 'in') {
      matchesStockLevel = item.quantity > item.low_stock_threshold
    }

    return matchesSearch && matchesCategory && matchesStockLevel
  })

  // Pagination calculations
  const totalPages = Math.ceil(filteredInventory.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedInventory = filteredInventory.slice(startIndex, endIndex)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, categoryFilter, stockLevelFilter])

  // Calculate stats
  const stats = {
    totalItems: inventory.length,
    lowStockItems: inventory.filter(item => item.quantity <= item.low_stock_threshold).length,
    totalValue: inventory.reduce((sum, item) => {
      const quantity = parseFloat(item.quantity) || 0
      const costPerUnit = item.cost_per_unit || 0
      return sum + (quantity * costPerUnit)
    }, 0)
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading inventory...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Inventory</h1>
          <div className="flex gap-2">
            <button 
              onClick={openAddModal}
              className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200"
            >
              + Add Inventory
            </button>
            <button className="bg-transparent text-accent font-semibold px-5 py-2.5 rounded-lg border-2 border-accent hover:bg-accent/10 transition-all">
              Export
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-card border-2 border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground font-semibold mb-1">Total Items</p>
            <p className="text-3xl font-bold text-foreground">{stats.totalItems}</p>
          </div>
          <div className="bg-card border-2 border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground font-semibold mb-1">Low Stock Alerts</p>
            <p className="text-3xl font-bold text-destructive">{stats.lowStockItems}</p>
          </div>
          <div className="bg-card border-2 border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground font-semibold mb-1">Total Value</p>
            <p className="text-3xl font-bold text-foreground">
              ₹{(Math.floor(stats.totalValue * 100) / 100).toFixed(2)}
            </p>
          </div>
        </div>
        
        {/* Search and Filter */}
        <div className="bg-card border-2 border-border rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search by material name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
            />
            <select 
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
            >
              <option value="all">All Categories</option>
              {materials.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select 
              value={stockLevelFilter}
              onChange={(e) => setStockLevelFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
            >
              <option value="all">All Stock Levels</option>
              <option value="in">In Stock</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
            </select>
          </div>
        </div>

        {/* Inventory Table */}
        <div className="bg-card border-2 border-border rounded-xl overflow-hidden">
          {filteredInventory.length === 0 ? (
            <div className="text-center py-16">
              <h3 className="text-xl font-bold text-foreground mb-2">No inventory items found</h3>
              <p className="text-muted-foreground">
                {inventory.length === 0 
                  ? 'No inventory items available for your cloud kitchen.'
                  : 'No items match your current filters.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-background border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Code</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Category</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Unit</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Low Stock Threshold</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInventory.map((item) => {
                    const material = item.raw_materials
                    if (!material) return null

                    const isLowStock = item.quantity <= item.low_stock_threshold
                    const isOutOfStock = item.quantity === 0

                    return (
                      <tr 
                        key={item.id} 
                        className="border-b border-border hover:bg-accent/5 transition-colors"
                      >
                        <td className="px-4 py-3 text-foreground font-medium">
                          {material.name}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {material.code}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {material.category || 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-foreground font-semibold">
                            {parseFloat(item.quantity).toFixed(3)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {material.unit}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {parseFloat(item.low_stock_threshold || 0).toFixed(3)}
                        </td>
                        <td className="px-4 py-3">
                          {isOutOfStock ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-destructive/20 text-destructive text-xs font-bold">
                              Out of Stock
                            </span>
                          ) : isLowStock ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-yellow-500/20 text-yellow-500 text-xs font-bold">
                              Low Stock
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-green-500/20 text-green-500 text-xs font-bold">
                              In Stock
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openEditModal(item)}
                            className="text-accent hover:text-accent/80 font-semibold text-sm"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-border px-4 py-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredInventory.length)} of {filteredInventory.length} items
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
            </>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-foreground">
                Edit Inventory
              </h2>
              <button
                onClick={closeEditModal}
                className="text-muted-foreground hover:text-foreground transition-colors"
                disabled={updating}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-muted-foreground mb-1">Material</p>
              <p className="text-lg font-semibold text-foreground">
                {editingItem.raw_materials?.name || 'N/A'}
              </p>
              <p className="text-xs text-muted-foreground">
                {editingItem.raw_materials?.code} • {editingItem.raw_materials?.unit}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="quantity" className="block text-sm font-semibold text-foreground mb-2">
                  Quantity ({editingItem.raw_materials?.unit})
                </label>
                <input
                  id="quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                  className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  disabled={updating}
                />
              </div>

              <div>
                <label htmlFor="low_stock_threshold" className="block text-sm font-semibold text-foreground mb-2">
                  Low Stock Threshold ({editingItem.raw_materials?.unit})
                </label>
                <input
                  id="low_stock_threshold"
                  type="number"
                  min="0"
                  step="0.001"
                  value={editForm.low_stock_threshold}
                  onChange={(e) => setEditForm({ ...editForm, low_stock_threshold: e.target.value })}
                  className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  disabled={updating}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Alert will trigger when quantity falls below this value
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={closeEditModal}
                disabled={updating}
                className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateInventory}
                disabled={updating}
                className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Inventory Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-foreground">
                Add New Inventory Item
              </h2>
              <button
                onClick={closeAddModal}
                className="text-muted-foreground hover:text-foreground transition-colors"
                disabled={creating}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Info Message */}
            <div className="mb-4 p-3 bg-accent/20 border border-accent rounded-lg">
              <p className="text-xs text-foreground">
                <span className="font-semibold">Note:</span> If the material you want to add is not shown here, 
                please go to the <span className="font-semibold">Materials</span> section to add it first, 
                then come back to Inventory to create a listing.
              </p>
            </div>

            {/* Material Search - Only show if no material selected */}
            {!selectedMaterial && (
              <>
                <div className="mb-4">
                  <label htmlFor="material-search" className="block text-sm font-semibold text-foreground mb-2">
                    Search Material
                  </label>
                  <input
                    id="material-search"
                    type="text"
                    placeholder="Type to search materials..."
                    value={materialSearchTerm}
                    onChange={(e) => setMaterialSearchTerm(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    disabled={creating}
                  />
                </div>

                {/* Material Selection */}
                {materialSearchTerm && (
                  <div className="mb-4 max-h-48 overflow-y-auto border border-border rounded-lg">
                    {filteredAvailableMaterials.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground text-sm">
                        No materials found matching your search
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {filteredAvailableMaterials.map((material) => (
                          <button
                            key={material.id}
                            onClick={() => {
                              setSelectedMaterial(material)
                              setMaterialSearchTerm('')
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-accent/10 transition-colors"
                            disabled={creating}
                          >
                            <div className="font-semibold text-foreground">{material.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {material.code} • {material.unit} • {material.category || 'No category'}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Selected Material Details */}
            {selectedMaterial && materialDetails && (
              <div className="mb-4 p-4 bg-background border border-border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground">Selected Material</p>
                  <button
                    onClick={() => {
                      setSelectedMaterial(null)
                      setMaterialDetails(null)
                      setMaterialSearchTerm('')
                    }}
                    className="text-xs text-accent hover:text-accent/80 font-semibold"
                    disabled={creating}
                  >
                    Change
                  </button>
                </div>
                <p className="text-lg font-semibold text-foreground">{materialDetails.name}</p>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <span>Code: {materialDetails.code}</span>
                  <span>Unit: {materialDetails.unit}</span>
                  {materialDetails.cost_per_unit > 0 && (
                    <span>Cost: ₹{materialDetails.cost_per_unit.toFixed(2)}/{materialDetails.unit}</span>
                  )}
                </div>
                {materialDetails.cost_per_unit === 0 && (
                  <p className="text-xs text-yellow-500 mt-2">
                    No cost data available for this material
                  </p>
                )}
              </div>
            )}

            {/* Quantity and Threshold Inputs */}
            {selectedMaterial && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="new-quantity" className="block text-sm font-semibold text-foreground mb-2">
                    Quantity ({selectedMaterial.unit})
                  </label>
                  <input
                    id="new-quantity"
                    type="number"
                    min="0"
                    step="0.001"
                    value={newInventoryForm.quantity}
                    onChange={(e) => setNewInventoryForm({ ...newInventoryForm, quantity: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    disabled={creating}
                    placeholder="0.000"
                  />
                </div>

                <div>
                  <label htmlFor="new-low-stock-threshold" className="block text-sm font-semibold text-foreground mb-2">
                    Low Stock Threshold ({selectedMaterial.unit})
                  </label>
                  <input
                    id="new-low-stock-threshold"
                    type="number"
                    min="0"
                    step="0.001"
                    value={newInventoryForm.low_stock_threshold}
                    onChange={(e) => setNewInventoryForm({ ...newInventoryForm, low_stock_threshold: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    disabled={creating}
                    placeholder="0.000"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Alert will trigger when quantity falls below this value
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={closeAddModal}
                disabled={creating}
                className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateInventory}
                disabled={creating || !selectedMaterial}
                className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating...' : 'Create Inventory'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Inventory
