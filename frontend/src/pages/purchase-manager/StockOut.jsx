import { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const StockOut = () => {
  const [allocationRequests, setAllocationRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [showAllocationModal, setShowAllocationModal] = useState(false)
  const [allocationItems, setAllocationItems] = useState([])
  const [inventoryData, setInventoryData] = useState({})
  const [todayTotals, setTodayTotals] = useState({})
  const [allocating, setAllocating] = useState(false)
  const [alert, setAlert] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  
  // Self stock out states
  const [showSelfStockOutModal, setShowSelfStockOutModal] = useState(false)
  const [selfStockOutItems, setSelfStockOutItems] = useState([])
  const [selfStockOutReason, setSelfStockOutReason] = useState('')
  const [allMaterials, setAllMaterials] = useState([])
  const [isSelfStockOut, setIsSelfStockOut] = useState(false)
  // Prevent double-submit on allocation (ref blocks immediately)
  const allocatingRef = useRef(false)
  // Material search popup (same design as Stock In / OutletDetails)
  const [openMaterialDropdownRow, setOpenMaterialDropdownRow] = useState(-1)
  const [materialDropdownSearchTerm, setMaterialDropdownSearchTerm] = useState('')
  const [materialDropdownPosition, setMaterialDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const materialDropdownSearchRef = useRef(null)

  // Fetch allocation requests
  useEffect(() => {
    fetchAllocationRequests()
  }, [statusFilter])

  const fetchAllocationRequests = async () => {
    const session = getSession()
    if (!session?.cloud_kitchen_id) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)

      // Base query (no date range filter; show all matching status)
      let dateQuery = supabase
        .from('allocation_requests')
        .select(`
          *,
          outlets (id, name, code),
          users:requested_by (id, full_name),
          allocation_request_items (
            id,
            quantity,
            raw_materials:raw_material_id (
              id,
              name,
              code,
              unit
            )
          )
        `)
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)

      // Apply status filter
      if (statusFilter !== 'all') {
        dateQuery = dateQuery.eq('is_packed', statusFilter === 'packed')
      }

      const { data, error } = await dateQuery
        .order('is_packed', { ascending: true }) // Unpacked first
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

  // Open self stock out modal
  const openSelfStockOutModal = async () => {
    setIsSelfStockOut(true)
    const session = getSession()

    try {
      // Fetch all active raw materials
      const { data: materials, error: matError } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit, category')
        .eq('is_active', true)
        .order('name')

      if (matError) throw matError

      setAllMaterials(materials || [])
      setSelfStockOutItems([])
      setSelfStockOutReason('')
      setOpenMaterialDropdownRow(-1)
      setMaterialDropdownSearchTerm('')
      setShowSelfStockOutModal(true)
    } catch (err) {
      console.error('Error loading materials:', err)
      setAlert({ type: 'error', message: 'Failed to load materials' })
    }
  }

  // Add new empty row for self stock out
  const addSelfStockOutRow = () => {
    setSelfStockOutItems(prev => [...prev, {
      raw_material_id: '',
      name: '',
      code: '',
      unit: '',
      allocated_quantity: 0,
      current_inventory: 0
    }])
  }

  // Remove material from self stock out
  const removeMaterialFromSelfStockOut = (index) => {
    setSelfStockOutItems(prev => prev.filter((_, i) => i !== index))
  }

  // Update material selection in self stock out
  const handleSelfStockOutMaterialChange = async (index, materialId) => {
    const session = getSession()
    
    // Check if material already selected in another row
    if (selfStockOutItems.some((item, i) => i !== index && item.raw_material_id === materialId)) {
      setAlert({ type: 'error', message: 'Material already selected in another row' })
      return
    }

    const material = allMaterials.find(m => m.id === materialId)
    if (!material) return

    // Fetch current inventory for this material
    try {
      const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .eq('raw_material_id', materialId)
        .single()

      const currentInventory = invData ? parseFloat(invData.quantity || 0) : 0

      setSelfStockOutItems(prev => {
        const updated = [...prev]
        updated[index] = {
          raw_material_id: materialId,
          name: material.name,
          code: material.code,
          unit: material.unit,
          allocated_quantity: 0,
          current_inventory: currentInventory
        }
        return updated
      })
    } catch (err) {
      console.error('Error fetching inventory:', err)
      // Still update the material info even if inventory fetch fails
      setSelfStockOutItems(prev => {
        const updated = [...prev]
        updated[index] = {
          raw_material_id: materialId,
          name: material.name,
          code: material.code,
          unit: material.unit,
          allocated_quantity: 0,
          current_inventory: 0
        }
        return updated
      })
    }
  }

  // Update self stock out quantity
  const handleUpdateSelfStockOutQuantity = (index, value) => {
    setSelfStockOutItems(prev => {
      const updated = [...prev]
      updated[index].allocated_quantity = value
      return updated
    })
  }

  // Filter materials for self stock out search popup (same design as Stock In / OutletDetails)
  const getFilteredMaterialsForSelfStockOut = (rowIndex) => {
    const search = openMaterialDropdownRow === rowIndex ? materialDropdownSearchTerm : ''
    const usedIds = selfStockOutItems
      .filter((item, i) => i !== rowIndex && item.raw_material_id)
      .map(item => item.raw_material_id)
    return allMaterials.filter(material => {
      if (usedIds.includes(material.id)) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return material.name.toLowerCase().includes(q) || material.code.toLowerCase().includes(q)
    })
  }

  // Focus search input and update position when material dropdown opens
  useEffect(() => {
    if (openMaterialDropdownRow >= 0 && showSelfStockOutModal) {
      const trigger = document.querySelector(`[data-self-stock-out-trigger="${openMaterialDropdownRow}"]`)
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        setMaterialDropdownPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) })
      }
      const t = setTimeout(() => materialDropdownSearchRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [openMaterialDropdownRow, showSelfStockOutModal])

  // Close material dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openMaterialDropdownRow >= 0 && !e.target.closest('.material-dropdown-container')) {
        setOpenMaterialDropdownRow(-1)
        setMaterialDropdownSearchTerm('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMaterialDropdownRow])

  // Open allocation modal
  const openAllocationModal = async (request) => {
    setIsSelfStockOut(false)
    setSelectedRequest(request)
    const session = getSession()

    // Prepare items with requested quantities
    const items = request.allocation_request_items.map(item => ({
      raw_material_id: item.raw_materials.id,
      name: item.raw_materials.name,
      code: item.raw_materials.code,
      unit: item.raw_materials.unit,
      requested_quantity: parseFloat(item.quantity),
      allocated_quantity: parseFloat(item.quantity), // Start with requested amount
      current_inventory: 0,
      today_total: 0
    }))

    setAllocationItems(items)

    // Fetch current inventory for all materials
    try {
      const materialIds = items.map(item => item.raw_material_id)
      const { data: inventoryData, error: invError } = await supabase
        .from('inventory')
        .select('raw_material_id, quantity')
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .in('raw_material_id', materialIds)

      if (invError) throw invError

      const invMap = {}
      inventoryData.forEach(inv => {
        invMap[inv.raw_material_id] = parseFloat(inv.quantity || 0)
      })
      setInventoryData(invMap)

      // Calculate today's totals for each material (from all unpacked requests today)
      const today = new Date().toISOString().split('T')[0]
      const { data: todayRequests, error: reqError } = await supabase
        .from('allocation_requests')
        .select(`
          allocation_request_items (
            raw_material_id,
            quantity
          )
        `)
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .eq('request_date', today)
        .eq('is_packed', false)

      if (reqError) throw reqError

      const totalsMap = {}
      todayRequests.forEach(req => {
        req.allocation_request_items.forEach(item => {
          if (!totalsMap[item.raw_material_id]) {
            totalsMap[item.raw_material_id] = 0
          }
          totalsMap[item.raw_material_id] += parseFloat(item.quantity)
        })
      })
      setTodayTotals(totalsMap)

      setShowAllocationModal(true)
    } catch (err) {
      console.error('Error fetching inventory data:', err)
      setAlert({ type: 'error', message: 'Failed to load inventory data' })
    }
  }

  // Update allocated quantity
  const handleUpdateAllocatedQuantity = (index, value) => {
    setAllocationItems(prev => {
      const updated = [...prev]
      updated[index].allocated_quantity = value
      return updated
    })
  }

  // FIFO Allocation Logic
  const allocateStockFIFO = async (rawMaterialId, quantity, cloudKitchenId) => {
    // Query stock_in_batches ordered by created_at (oldest first)
    const { data: batches, error: batchError } = await supabase
      .from('stock_in_batches')
      .select('id, quantity_remaining, unit_cost, created_at')
      .eq('raw_material_id', rawMaterialId)
      .eq('cloud_kitchen_id', cloudKitchenId)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: true })

    if (batchError) throw batchError

    if (!batches || batches.length === 0) {
      throw new Error('No batches available for this material')
    }

    let remainingQuantity = parseFloat(quantity)
    const batchUpdates = []

    // Iterate through batches and allocate FIFO
    for (const batch of batches) {
      if (remainingQuantity <= 0) break

      const availableInBatch = parseFloat(batch.quantity_remaining)
      const toAllocate = Math.min(availableInBatch, remainingQuantity)

      // Prepare batch update
      batchUpdates.push({
        id: batch.id,
        newQuantityRemaining: availableInBatch - toAllocate
      })

      remainingQuantity -= toAllocate
    }

    // Check if we have enough stock
    if (remainingQuantity > 0) {
      throw new Error(`Insufficient stock. Short by ${remainingQuantity.toFixed(3)} units`)
    }

    // Update batches
    for (const update of batchUpdates) {
      const { error: updateError } = await supabase
        .from('stock_in_batches')
        .update({ quantity_remaining: update.newQuantityRemaining })
        .eq('id', update.id)

      if (updateError) throw updateError
    }

    return true
  }

  // Handle allocation submission (both regular and self stock out)
  const handleAllocateStock = async () => {
    // Prevent double/multiple submit
    if (allocatingRef.current) return
    allocatingRef.current = true
    setAllocating(true)

    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      allocatingRef.current = false
      setAllocating(false)
      return
    }

    // Determine which items to process
    const itemsToProcess = isSelfStockOut ? selfStockOutItems : allocationItems

    // Validate for self stock out
    if (isSelfStockOut) {
      if (!selfStockOutReason || selfStockOutReason.trim() === '') {
        setAlert({ type: 'error', message: 'Please provide a reason for self stock out' })
        allocatingRef.current = false
        setAllocating(false)
        return
      }

      if (itemsToProcess.length === 0) {
        setAlert({ type: 'error', message: 'Please add at least one material' })
        allocatingRef.current = false
        setAllocating(false)
        return
      }

      // Check if all rows have materials selected
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i]
        if (!item.raw_material_id) {
          setAlert({ type: 'error', message: `Please select a material for row ${i + 1}` })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }

      // Validate quantities
      for (const item of itemsToProcess) {
        if (item.allocated_quantity <= 0) {
          setAlert({ type: 'error', message: `Please enter a valid quantity for ${item.name}` })
          allocatingRef.current = false
          setAllocating(false)
          return
        }

        // Use the current_inventory already fetched when material was selected
        const availableInventory = item.current_inventory || 0
        if (item.allocated_quantity > availableInventory) {
          setAlert({ 
            type: 'error', 
            message: `Insufficient stock for ${item.name}. Available: ${availableInventory.toFixed(3)} ${item.unit}` 
          })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }
    } else {
      // Validate allocated quantities for regular stock out
      for (const item of itemsToProcess) {
        if (item.allocated_quantity <= 0) {
          setAlert({ type: 'error', message: `Please enter a valid quantity for ${item.name}` })
          allocatingRef.current = false
          setAllocating(false)
          return
        }

        const availableInventory = inventoryData[item.raw_material_id] || 0
        if (item.allocated_quantity > availableInventory) {
          setAlert({ 
            type: 'error', 
            message: `Insufficient stock for ${item.name}. Available: ${availableInventory.toFixed(3)} ${item.unit}` 
          })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }
    }

    try {
      // Create stock_out record
      const stockOutPayload = {
        cloud_kitchen_id: session.cloud_kitchen_id,
        allocated_by: session.id,
        allocation_date: new Date().toISOString().split('T')[0],
        self_stock_out: isSelfStockOut
      }

      if (isSelfStockOut) {
        // Self stock out
        stockOutPayload.reason = selfStockOutReason.trim()
        stockOutPayload.notes = `Self stock out: ${selfStockOutReason.trim()}`
      } else {
        // Regular stock out
        stockOutPayload.allocation_request_id = selectedRequest.id
        stockOutPayload.outlet_id = selectedRequest.outlet_id
        stockOutPayload.notes = `Allocated from request #${selectedRequest.id.substring(0, 8)}`
      }

      const { data: stockOutData, error: stockOutError } = await supabase
        .from('stock_out')
        .insert(stockOutPayload)
        .select()
        .single()

      if (stockOutError) throw stockOutError

      // Process each item with FIFO allocation
      for (const item of itemsToProcess) {
        // Allocate stock using FIFO
        await allocateStockFIFO(
          item.raw_material_id,
          item.allocated_quantity,
          session.cloud_kitchen_id
        )

        // Create stock_out_item
        const { error: itemError } = await supabase
          .from('stock_out_items')
          .insert({
            stock_out_id: stockOutData.id,
            raw_material_id: item.raw_material_id,
            quantity: item.allocated_quantity
          })

        if (itemError) throw itemError

        // Update inventory (decrement)
        const { data: currentInv, error: invFetchError } = await supabase
          .from('inventory')
          .select('quantity')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('raw_material_id', item.raw_material_id)
          .single()

        if (invFetchError) throw invFetchError

        const newQuantity = parseFloat(currentInv.quantity) - item.allocated_quantity

        const { error: invUpdateError } = await supabase
          .from('inventory')
          .update({
            quantity: Math.max(0, newQuantity),
            last_updated_at: new Date().toISOString(),
            updated_by: session.id
          })
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('raw_material_id', item.raw_material_id)

        if (invUpdateError) throw invUpdateError
      }

      // Create audit log
      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert({
          user_id: session.id,
          action: 'stock_out',
          entity_type: 'stock_out',
          entity_id: stockOutData.id,
          new_values: {
            self_stock_out: isSelfStockOut,
            reason: isSelfStockOut ? selfStockOutReason.trim() : null,
            allocation_request_id: isSelfStockOut ? null : selectedRequest.id,
            outlet_id: isSelfStockOut ? null : selectedRequest.outlet_id,
            items: itemsToProcess.map(item => ({
              raw_material_id: item.raw_material_id,
              name: item.name,
              quantity: item.allocated_quantity,
              unit: item.unit
            }))
          }
        })

      if (auditError) {
        console.error('Error creating audit log:', auditError)
        // Don't fail the operation if audit log fails
      }

      // Mark allocation request as packed (only for regular stock out)
      if (!isSelfStockOut) {
        const { error: updateRequestError } = await supabase
          .from('allocation_requests')
          .update({ is_packed: true })
          .eq('id', selectedRequest.id)

        if (updateRequestError) throw updateRequestError
      }

      setAlert({ 
        type: 'success', 
        message: isSelfStockOut ? 'Self stock out completed successfully!' : 'Stock allocated successfully!' 
      })
      
      if (isSelfStockOut) {
        setShowSelfStockOutModal(false)
      } else {
        setShowAllocationModal(false)
      }
      
      fetchAllocationRequests()
    } catch (err) {
      console.error('Error allocating stock:', err)
      setAlert({ 
        type: 'error', 
        message: err.message || 'Failed to allocate stock. Please try again.' 
      })
    } finally {
      allocatingRef.current = false
      setAllocating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading allocation requests...</p>
          </div>
        </div>
      </div>
    )
  }

  // Apply search filter (outlet name, outlet code, requested by)
  const filteredRequests = allocationRequests.filter((request) => {
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    const outletName = request.outlets?.name?.toLowerCase() || ''
    const outletCode = request.outlets?.code?.toLowerCase() || ''
    const requestedBy = request.users?.full_name?.toLowerCase() || ''
    return (
      outletName.includes(q) ||
      outletCode.includes(q) ||
      requestedBy.includes(q)
    )
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            Stock Out
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Allocate stock to outlets based on allocation requests
          </p>
        </div>

        {/* Self Stock Out Card */}
        <div className="bg-gradient-to-br from-accent/10 to-accent/5 border-2 border-accent/30 rounded-xl p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-foreground mb-2 flex items-center gap-2">
                <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Self Stock Out
              </h2>
              <p className="text-sm text-muted-foreground">
                Allocate inventory for internal cloud kitchen use (R&D, testing, etc.)
              </p>
            </div>
            <button
              onClick={openSelfStockOutModal}
              className="px-6 py-3 bg-accent text-background font-bold rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 whitespace-nowrap"
            >
              + Self Stock Out
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card border-2 border-border rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Search (Outlet / Code / Requested By)
              </label>
              <input
                type="text"
                placeholder="Search by outlet name, outlet code, or requested by..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              />
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              >
                <option value="all">All</option>
                <option value="unpacked">Unpacked (Pending)</option>
                <option value="packed">Packed (Completed)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Allocation Requests Table */}
        <div className="bg-card border-2 border-border rounded-xl overflow-hidden">
          {filteredRequests.length === 0 ? (
            <div className="text-center py-16">
              <h3 className="text-xl font-bold text-foreground mb-2">
                No allocation requests found
              </h3>
              <p className="text-muted-foreground">
                {searchTerm.trim()
                  ? 'No allocation requests match your search.'
                  : 'No allocation requests match your filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Request Date</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Outlet</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Requested By</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Items</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((request) => (
                    <tr 
                      key={request.id} 
                      className={`border-b border-border transition-colors ${
                        request.is_packed 
                          ? 'bg-accent/5 hover:bg-accent/10' 
                          : 'hover:bg-background/30'
                      }`}
                    >
                      <td className="px-4 py-3 text-foreground">
                        {new Date(request.request_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-foreground">{request.outlets?.name || 'N/A'}</p>
                          <p className="text-xs text-muted-foreground font-mono">{request.outlets?.code || ''}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {request.users?.full_name || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {request.allocation_request_items?.length || 0} item(s)
                      </td>
                      <td className="px-4 py-3">
                        {request.is_packed ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-accent/20 text-accent border border-accent/30">
                            ✓ Packed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-yellow-500/20 text-yellow-600 border border-yellow-500/30">
                            ⏳ Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {request.is_packed ? (
                          <span className="text-sm text-muted-foreground">Completed</span>
                        ) : (
                          <button
                            onClick={() => openAllocationModal(request)}
                            className="px-3 py-1.5 bg-accent/10 text-accent border-2 border-accent/30 rounded-lg hover:bg-accent/20 hover:border-accent/50 transition-all duration-200 text-sm font-semibold"
                          >
                            Allocate Stock
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Allocation Modal */}
        {showAllocationModal && selectedRequest && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Allocate Stock</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedRequest.outlets?.name} • {new Date(selectedRequest.request_date).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => setShowAllocationModal(false)}
                  disabled={allocating}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Items Table */}
              <div className="mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full border border-border rounded-lg">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Requested</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Today's Total</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Current Stock</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Allocate Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocationItems.map((item, index) => {
                        const currentInventory = inventoryData[item.raw_material_id] || 0
                        const todayTotal = todayTotals[item.raw_material_id] || 0
                        const isLowStock = currentInventory < item.allocated_quantity

                        return (
                          <tr key={item.raw_material_id} className="border-b border-border">
                            <td className="px-4 py-3">
                              <div>
                                <p className="font-semibold text-foreground">{item.name}</p>
                                <p className="text-xs text-muted-foreground font-mono">{item.code}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              {item.requested_quantity.toFixed(3)} {item.unit}
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              {todayTotal.toFixed(3)} {item.unit}
                            </td>
                            <td className={`px-4 py-3 font-semibold ${isLowStock ? 'text-destructive' : 'text-foreground'}`}>
                              {currentInventory.toFixed(3)} {item.unit}
                              {isLowStock && (
                                <p className="text-xs text-destructive mt-1">⚠ Insufficient stock</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0.5"
                                step="0.5"
                                value={item.allocated_quantity}
                                onChange={(e) => handleUpdateAllocatedQuantity(index, parseFloat(e.target.value) || 0)}
                                disabled={allocating}
                                className="w-32 bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowAllocationModal(false)}
                  disabled={allocating}
                  className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAllocateStock}
                  disabled={allocating}
                  className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {allocating ? 'Allocating...' : 'Confirm Allocation'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Self Stock Out Modal */}
        {showSelfStockOutModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Self Stock Out</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Allocate inventory for internal cloud kitchen use
                  </p>
                </div>
                <button
                  onClick={() => setShowSelfStockOutModal(false)}
                  disabled={allocating}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Reason Field */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-foreground mb-2">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={selfStockOutReason}
                  onChange={(e) => setSelfStockOutReason(e.target.value)}
                  placeholder="Enter reason for self stock out (e.g., R&D, testing, quality check, etc.)"
                  disabled={allocating}
                  rows={3}
                  className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all resize-none"
                />
              </div>

              {/* Materials Table */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-foreground">Materials</h3>
                  <button
                    onClick={addSelfStockOutRow}
                    disabled={allocating}
                    className="px-3 py-1.5 bg-accent/10 text-accent border-2 border-accent/30 rounded-lg hover:bg-accent/20 hover:border-accent/50 transition-all duration-200 text-sm font-semibold disabled:opacity-50"
                  >
                    + Add Row
                  </button>
                </div>
                
                {selfStockOutItems.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border border-border rounded-lg">
                      <thead className="bg-background border-b border-border">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Current Stock</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selfStockOutItems.map((item, index) => (
                          <tr key={index} className="border-b border-border">
                            <td className="px-4 py-3 relative material-dropdown-container">
                              <div className="min-w-[180px]">
                                <button
                                  type="button"
                                  data-self-stock-out-trigger={index}
                                  onClick={() => {
                                    setOpenMaterialDropdownRow(openMaterialDropdownRow === index ? -1 : index)
                                    setMaterialDropdownSearchTerm('')
                                  }}
                                  disabled={allocating}
                                  className="w-full text-left px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm truncate disabled:opacity-50"
                                >
                                  {item.raw_material_id ? (
                                    <span>{item.name} <span className="text-muted-foreground text-xs">({item.unit})</span></span>
                                  ) : (
                                    <span className="text-muted-foreground">Select material...</span>
                                  )}
                                </button>
                                {openMaterialDropdownRow === index && ReactDOM.createPortal(
                                  <div
                                    className="fixed z-[9999] bg-card border-2 border-accent rounded-xl shadow-2xl overflow-hidden material-dropdown-container"
                                    style={{
                                      top: materialDropdownPosition.top,
                                      left: materialDropdownPosition.left,
                                      width: materialDropdownPosition.width,
                                      minWidth: 280
                                    }}
                                  >
                                    <input
                                      ref={materialDropdownSearchRef}
                                      type="text"
                                      value={materialDropdownSearchTerm}
                                      onChange={(e) => setMaterialDropdownSearchTerm(e.target.value)}
                                      placeholder="Search material..."
                                      className="w-full px-4 py-3 border-b-2 border-border focus:outline-none focus:ring-2 focus:ring-accent bg-background text-foreground"
                                    />
                                    <div className="max-h-44 overflow-y-auto bg-card">
                                      {getFilteredMaterialsForSelfStockOut(index).length === 0 ? (
                                        <div className="p-4 text-center text-sm text-muted-foreground">
                                          No materials found. Add in Materials first.
                                        </div>
                                      ) : (
                                        getFilteredMaterialsForSelfStockOut(index).map((m) => (
                                          <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => {
                                              handleSelfStockOutMaterialChange(index, m.id)
                                              setOpenMaterialDropdownRow(-1)
                                              setMaterialDropdownSearchTerm('')
                                            }}
                                            className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors border-b border-border/50 last:border-0 font-medium text-foreground"
                                          >
                                            <div className="text-sm">{m.name}</div>
                                            <div className="text-xs text-muted-foreground">{m.code} • {m.unit}</div>
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  </div>,
                                  document.body
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {item.raw_material_id ? (
                                <div className={`font-semibold ${
                                  item.current_inventory === 0 ? 'text-destructive' :
                                  item.current_inventory < 10 ? 'text-yellow-600' :
                                  'text-foreground'
                                }`}>
                                  {item.current_inventory.toFixed(3)} {item.unit}
                                  {item.current_inventory === 0 && (
                                    <p className="text-xs text-destructive mt-1">⚠ Out of stock</p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0.5"
                                  step="0.5"
                                  value={item.allocated_quantity}
                                  onChange={(e) => handleUpdateSelfStockOutQuantity(index, parseFloat(e.target.value) || 0)}
                                  disabled={allocating || !item.raw_material_id}
                                  placeholder="0.000"
                                  className="w-32 bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all disabled:opacity-50"
                                />
                                {item.unit && (
                                  <span className="text-sm text-muted-foreground">{item.unit}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => removeMaterialFromSelfStockOut(index)}
                                disabled={allocating}
                                className="text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 bg-background/50 rounded-lg border border-border">
                    <p className="text-muted-foreground text-sm">No materials added yet. Click "+ Add Row" to start.</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSelfStockOutModal(false)}
                  disabled={allocating}
                  className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAllocateStock}
                  disabled={
                    allocating || 
                    selfStockOutItems.length === 0 || 
                    !selfStockOutReason.trim() ||
                    selfStockOutItems.some(item => !item.raw_material_id)
                  }
                  className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {allocating ? 'Processing...' : 'Confirm Self Stock Out'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Alert Modal */}
        {alert && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-end lg:items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full shadow-xl">
              <div className="flex items-start gap-4">
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
              </div>
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

export default StockOut
