import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import nippuKodiLogo from '../../assets/nippu-kodi-logo.png'
import elChaapoLogo from '../../assets/el-chaapo-logo.png'
import boomPizzaLogo from '../../assets/boom-pizza-logo.png'

const OutletDetails = () => {
  const { outletId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [outlet, setOutlet] = useState(location.state?.outlet || null)
  const [allocationRequests, setAllocationRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAllocateModal, setShowAllocateModal] = useState(false)
  const [rawMaterials, setRawMaterials] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedItems, setSelectedItems] = useState([]) // {raw_material_id, name, code, unit, requested_quantity}
  const [requesting, setRequesting] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [alert, setAlert] = useState(null) // { type: 'error' | 'success' | 'warning', message: string }

  useEffect(() => {
    if (!outlet) {
      fetchOutlet()
    }
    fetchAllocationRequests()
    fetchRawMaterials()
  }, [outletId])

  const fetchOutlet = async () => {
    try {
      const { data, error } = await supabase
        .from('outlets')
        .select('*')
        .eq('id', outletId)
        .single()

      if (error) throw error
      setOutlet(data)
    } catch (err) {
      console.error('Error fetching outlet:', err)
      setAlert({ type: 'error', message: 'Failed to fetch outlet details' })
    }
  }

  const fetchAllocationRequests = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('allocation_requests')
        .select(`
          *,
          allocation_request_items (
            *,
            raw_materials (
              id,
              name,
              code,
              unit
            )
          )
        `)
        .eq('outlet_id', outletId)
        .order('request_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setAllocationRequests(data || [])
    } catch (err) {
      console.error('Error fetching allocation requests:', err)
      setAlert({ type: 'error', message: 'Failed to fetch allocation requests' })
    } finally {
      setLoading(false)
    }
  }

  const fetchRawMaterials = async () => {
    try {
      const { data, error } = await supabase
        .from('raw_materials')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) throw error
      setRawMaterials(data || [])
    } catch (err) {
      console.error('Error fetching raw materials:', err)
      setAlert({ type: 'error', message: 'Failed to fetch raw materials' })
    }
  }

  const handleAllocate = () => {
    setShowAllocateModal(true)
    setSelectedItems([])
    setSearchTerm('')
    setCategoryFilter('all')
  }

  const handleAddItem = (material) => {
    const existing = selectedItems.find(item => item.raw_material_id === material.id)
    if (existing) {
      setAlert({ type: 'warning', message: 'This material is already added' })
      return
    }

    setSelectedItems([...selectedItems, {
      raw_material_id: material.id,
      name: material.name,
      code: material.code,
      unit: material.unit,
      requested_quantity: ''
    }])
    setSearchTerm('')
  }

  const handleUpdateQuantity = (raw_material_id, quantity) => {
    setSelectedItems(selectedItems.map(item =>
      item.raw_material_id === raw_material_id
        ? { ...item, requested_quantity: quantity }
        : item
    ))
  }

  const handleRemoveItem = (raw_material_id) => {
    setSelectedItems(selectedItems.filter(item => item.raw_material_id !== raw_material_id))
  }

  const handleFinalizeAllocation = () => {
    // Validate
    if (selectedItems.length === 0) {
      setAlert({ type: 'warning', message: 'Please add at least one item' })
      return
    }

    for (const item of selectedItems) {
      const qty = parseFloat(item.requested_quantity)
      if (isNaN(qty) || qty <= 0) {
        setAlert({ 
          type: 'error', 
          message: `Please enter a valid quantity for ${item.name}` 
        })
        return
      }
    }

    // Show confirmation modal
    setShowConfirmModal(true)
  }

  const confirmAllocation = async () => {
    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      return
    }

    setRequesting(true)
    setShowConfirmModal(false)
    try {
      // Create allocation request
      const { data: allocationRequest, error: allocationError } = await supabase
        .from('allocation_requests')
        .insert({
          outlet_id: outletId,
          cloud_kitchen_id: session.cloud_kitchen_id,
          requested_by: session.id,
          request_date: new Date().toISOString().split('T')[0],
          is_packed: false
        })
        .select()
        .single()

      if (allocationError) throw allocationError

      // Create allocation request items
      const allocationRequestItems = selectedItems.map(item => ({
        allocation_request_id: allocationRequest.id,
        raw_material_id: item.raw_material_id,
        quantity: parseFloat(item.requested_quantity)
      }))

      const { error: itemsError } = await supabase
        .from('allocation_request_items')
        .insert(allocationRequestItems)

      if (itemsError) throw itemsError

      setAlert({ type: 'success', message: 'Allocation request created successfully!' })
      setShowAllocateModal(false)
      setSelectedItems([])
      setSearchTerm('')
      fetchAllocationRequests()
    } catch (err) {
      console.error('Error creating allocation request:', err)
      setAlert({ type: 'error', message: `Failed to create allocation request: ${err.message}` })
    } finally {
      setRequesting(false)
    }
  }

  // Get unique categories from raw materials
  const categories = ['all', ...new Set(rawMaterials.map(material => material.category).filter(Boolean))]

  const filteredRawMaterials = rawMaterials
    .filter(material => {
      // Search filter
      const matchesSearch = searchTerm === '' || 
        material.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        material.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (material.description && material.description.toLowerCase().includes(searchTerm.toLowerCase()))

      // Category filter
      const matchesCategory = categoryFilter === 'all' || material.category === categoryFilter

      return matchesSearch && matchesCategory
    })
    .sort((a, b) => {
      // Sort alphabetically by name
      return a.name.localeCompare(b.name)
    })

  const getBrandColor = (code) => {
    if (code.startsWith('NK')) return 'bg-black'
    if (code.startsWith('EC')) return 'bg-green-500'
    if (code.startsWith('BP')) return 'bg-red-500'
    return 'bg-gray-500'
  }

  const getBrandName = (code) => {
    if (code.startsWith('NK')) return 'Nippu Kodi'
    if (code.startsWith('EC')) return 'El Chaapo'
    if (code.startsWith('BP')) return 'Boom Pizza'
    return 'Unknown'
  }

  const getBrandLogo = (code) => {
    if (code.startsWith('NK')) return nippuKodiLogo
    if (code.startsWith('EC')) return elChaapoLogo
    if (code.startsWith('BP')) return boomPizzaLogo
    return null
  }

  if (!outlet) {
    return (
      <div className="p-3 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading outlet details...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate('/invmanagement/dashboard/purchase_manager/outlets')}
          className="flex items-center text-accent hover:text-accent/80 font-semibold mb-4 touch-manipulation"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Outlets
        </button>

        {/* Outlet Info Card */}
        <div className="bg-card border-2 border-border rounded-xl p-4 lg:p-6 mb-4 lg:mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl lg:text-3xl font-bold text-foreground mb-2">{outlet.name}</h1>
              <p className="text-sm lg:text-base text-muted-foreground font-mono">{outlet.code}</p>
            </div>
            <div className={`${getBrandColor(outlet.code)} text-white text-xs lg:text-sm font-bold px-2 py-1.5 rounded-lg ml-2 flex items-center gap-1.5`}>
              {getBrandLogo(outlet.code) && (
                <img 
                  src={getBrandLogo(outlet.code)} 
                  alt={getBrandName(outlet.code)} 
                  className="h-4 lg:h-5 w-auto object-contain"
                />
              )}
              <span>{getBrandName(outlet.code)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 text-sm lg:text-base">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-muted-foreground mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-muted-foreground">{outlet.address}</span>
            </div>

            <div className="flex items-center">
              <svg className="w-5 h-5 text-muted-foreground mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-muted-foreground">{outlet.contact_person}</span>
            </div>

            <div className="flex items-center">
              <svg className="w-5 h-5 text-muted-foreground mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span className="text-muted-foreground">{outlet.contact_phone}</span>
            </div>
          </div>
        </div>

        {/* Allocate Button */}
        <div className="mb-4 lg:mb-6">
          <button
            onClick={handleAllocate}
            className="w-full lg:w-auto bg-accent text-background font-bold px-6 py-4 lg:py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 text-base touch-manipulation"
          >
            + Create Allocation Request
          </button>
        </div>

        {/* Allocation Requests List */}
        <div>
          <h2 className="text-lg lg:text-xl font-bold text-foreground mb-4">Allocation Requests</h2>

          {loading ? (
            <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12">
              <div className="text-center">
                <p className="text-muted-foreground">Loading allocation requests...</p>
              </div>
            </div>
          ) : allocationRequests.length === 0 ? (
            <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12">
              <div className="text-center">
                <svg className="w-16 h-16 lg:w-20 lg:h-20 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg lg:text-xl font-bold text-foreground mb-2">No Allocation Requests Yet</h3>
                <p className="text-sm lg:text-base text-muted-foreground">
                  No allocation requests have been created for this outlet yet.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 lg:space-y-4">
              {allocationRequests.map((request) => (
                <div key={request.id} className="bg-card border-2 border-border rounded-xl p-4 lg:p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs lg:text-sm text-muted-foreground">Request ID</p>
                      <p className="text-sm lg:text-base font-mono text-foreground">{request.id.slice(0, 8)}...</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs lg:text-sm text-muted-foreground">Request Date</p>
                      <p className="text-sm lg:text-base font-semibold text-foreground">
                        {new Date(request.request_date).toLocaleDateString()}
                      </p>
                      {request.is_packed && (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg bg-green-500/20 text-green-500 text-xs font-bold mt-1">
                          Packed
                        </span>
                      )}
                    </div>
                  </div>

                  {request.notes && (
                    <div className="mb-3 p-2 bg-background rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Notes:</p>
                      <p className="text-sm text-foreground">{request.notes}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs lg:text-sm font-semibold text-foreground mb-2">Items:</p>
                    {request.allocation_request_items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between bg-background rounded-lg p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm lg:text-base font-semibold text-foreground truncate">
                            {item.raw_materials.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{item.raw_materials.code}</p>
                        </div>
                        <div className="text-right ml-3">
                          <p className="text-base lg:text-lg font-bold text-foreground">
                            {parseFloat(item.quantity).toFixed(3)}
                          </p>
                          <p className="text-xs text-muted-foreground">{item.raw_materials.unit}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Allocate Materials Modal */}
      {showAllocateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                Create Allocation Request
              </h2>
              <button
                onClick={() => setShowAllocateModal(false)}
                className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                disabled={requesting}
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Outlet Info */}
            <div className="mb-4 p-3 bg-accent/20 border border-accent rounded-lg">
              <p className="text-sm font-semibold text-foreground">{outlet.name}</p>
              <p className="text-xs text-muted-foreground">{outlet.code} • {outlet.address}</p>
            </div>

            {/* Search and Filter Bar */}
            <div className="mb-4 space-y-3">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Search Raw Materials
                </label>
                <input
                  type="text"
                  placeholder="Search by name, code, or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-input border-2 border-border rounded-lg px-4 py-3.5 lg:py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all text-base"
                  disabled={requesting}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-2">
                  Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full bg-input border-2 border-border rounded-lg px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all text-sm"
                  disabled={requesting}
                >
                  <option value="all">All Categories</option>
                  {categories.filter(c => c !== 'all').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Raw Materials List */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Available Raw Materials ({filteredRawMaterials.length})
                </h3>
                {filteredRawMaterials.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Click to add to request
                  </p>
                )}
              </div>
              
              <div className="max-h-80 overflow-y-auto border-2 border-border rounded-lg bg-background/30">
                {filteredRawMaterials.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-2">
                      {rawMaterials.length === 0 
                        ? 'No raw materials available'
                        : 'No materials match your filters'}
                    </p>
                    {(searchTerm || categoryFilter !== 'all') && (
                      <button
                        onClick={() => {
                          setSearchTerm('')
                          setCategoryFilter('all')
                        }}
                        className="text-xs text-accent hover:text-accent/80 font-semibold"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredRawMaterials.map((material) => {
                      const isAlreadySelected = selectedItems.some(selected => selected.raw_material_id === material.id)
                      
                      return (
                        <button
                          key={material.id}
                          onClick={() => {
                            if (!isAlreadySelected) {
                              handleAddItem(material)
                            }
                          }}
                          disabled={requesting || isAlreadySelected}
                          className={`w-full text-left px-4 py-4 lg:py-3 transition-all touch-manipulation ${
                            isAlreadySelected
                              ? 'bg-accent/20 cursor-not-allowed'
                              : 'hover:bg-accent/10 active:bg-accent/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`font-semibold text-base lg:text-sm ${
                                  isAlreadySelected ? 'text-muted-foreground' : 'text-foreground'
                                }`}>
                                  {material.name}
                                </div>
                                {isAlreadySelected && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-accent text-background">
                                    Added
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {material.code} • {material.unit} • {material.category || 'No category'}
                              </div>
                              {material.description && (
                                <div className="text-xs text-muted-foreground mt-1 truncate">
                                  {material.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Selected Items */}
            {selectedItems.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground mb-2">Selected Items ({selectedItems.length})</h3>
                <div className="space-y-2">
                  {selectedItems.map((item) => (
                    <div key={item.raw_material_id} className="bg-background border border-border rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.code} • {item.unit}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveItem(item.raw_material_id)}
                          className="text-destructive hover:text-destructive/80 p-1 touch-manipulation"
                          disabled={requesting}
                          aria-label="Remove"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">
                          Quantity to Request ({item.unit})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={item.requested_quantity}
                          onChange={(e) => handleUpdateQuantity(item.raw_material_id, e.target.value)}
                          className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
                          placeholder="0.000"
                          disabled={requesting}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col lg:flex-row gap-3 mt-6">
              <button
                onClick={() => setShowAllocateModal(false)}
                disabled={requesting}
                className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 lg:py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={handleFinalizeAllocation}
                disabled={requesting || selectedItems.length === 0}
                className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 lg:py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation"
              >
                {requesting ? 'Creating Request...' : 'Create Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                Confirm Allocation Request
              </h2>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                disabled={requesting}
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Outlet Info */}
            <div className="mb-4 p-3 bg-accent/20 border border-accent rounded-lg">
              <p className="text-sm font-semibold text-foreground">{outlet.name}</p>
              <p className="text-xs text-muted-foreground">{outlet.code} • {outlet.address}</p>
            </div>

            {/* Request Summary */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Request Summary ({selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {selectedItems.map((item) => (
                  <div key={item.raw_material_id} className="bg-background border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.code}</p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="text-base font-bold text-foreground">
                          {parseFloat(item.requested_quantity).toFixed(3)} {item.unit}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Info Message */}
            <div className="mb-4 p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg">
              <p className="text-xs lg:text-sm text-foreground">
                <span className="font-semibold">ℹ️ Note:</span> This will create an allocation request. The inventory will not be decremented until the request is processed and packed.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col lg:flex-row gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={requesting}
                className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 lg:py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={confirmAllocation}
                disabled={requesting}
                className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 lg:py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation"
              >
                {requesting ? 'Creating Request...' : 'Confirm & Create Request'}
              </button>
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
  )
}

export default OutletDetails
