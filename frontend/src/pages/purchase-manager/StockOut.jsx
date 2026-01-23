import { useState, useEffect } from 'react'
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
  const [dateFilter, setDateFilter] = useState('today')
  const [statusFilter, setStatusFilter] = useState('all')

  // Fetch allocation requests
  useEffect(() => {
    fetchAllocationRequests()
  }, [dateFilter, statusFilter])

  const fetchAllocationRequests = async () => {
    const session = getSession()
    if (!session?.cloud_kitchen_id) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)

      // Build date filter
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

      // Apply date filter
      if (dateFilter === 'today') {
        const today = new Date().toISOString().split('T')[0]
        dateQuery = dateQuery.eq('request_date', today)
      } else if (dateFilter === 'week') {
        const today = new Date()
        const weekAgo = new Date(today)
        weekAgo.setDate(today.getDate() - 7)
        dateQuery = dateQuery
          .gte('request_date', weekAgo.toISOString().split('T')[0])
          .lte('request_date', today.toISOString().split('T')[0])
      } else if (dateFilter === 'month') {
        const today = new Date()
        const monthAgo = new Date(today)
        monthAgo.setMonth(today.getMonth() - 1)
        dateQuery = dateQuery
          .gte('request_date', monthAgo.toISOString().split('T')[0])
          .lte('request_date', today.toISOString().split('T')[0])
      }

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

  // Open allocation modal
  const openAllocationModal = async (request) => {
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

  // Handle allocation submission
  const handleAllocateStock = async () => {
    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      return
    }

    // Validate allocated quantities
    for (const item of allocationItems) {
      if (item.allocated_quantity <= 0) {
        setAlert({ type: 'error', message: `Please enter a valid quantity for ${item.name}` })
        return
      }

      const availableInventory = inventoryData[item.raw_material_id] || 0
      if (item.allocated_quantity > availableInventory) {
        setAlert({ 
          type: 'error', 
          message: `Insufficient stock for ${item.name}. Available: ${availableInventory.toFixed(3)} ${item.unit}` 
        })
        return
      }
    }

    setAllocating(true)

    try {
      // Create stock_out record
      const { data: stockOutData, error: stockOutError } = await supabase
        .from('stock_out')
        .insert({
          allocation_request_id: selectedRequest.id,
          outlet_id: selectedRequest.outlet_id,
          cloud_kitchen_id: session.cloud_kitchen_id,
          allocated_by: session.id,
          allocation_date: new Date().toISOString().split('T')[0],
          notes: `Allocated from request #${selectedRequest.id.substring(0, 8)}`
        })
        .select()
        .single()

      if (stockOutError) throw stockOutError

      // Process each item with FIFO allocation
      for (const item of allocationItems) {
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

      // Mark allocation request as packed
      const { error: updateRequestError } = await supabase
        .from('allocation_requests')
        .update({ is_packed: true })
        .eq('id', selectedRequest.id)

      if (updateRequestError) throw updateRequestError

      setAlert({ type: 'success', message: 'Stock allocated successfully!' })
      setShowAllocationModal(false)
      fetchAllocationRequests()
    } catch (err) {
      console.error('Error allocating stock:', err)
      setAlert({ 
        type: 'error', 
        message: err.message || 'Failed to allocate stock. Please try again.' 
      })
    } finally {
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

        {/* Filters */}
        <div className="bg-card border-2 border-border rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Date Filter */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Date Range
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              >
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="all">All</option>
              </select>
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
          {allocationRequests.length === 0 ? (
            <div className="text-center py-16">
              <h3 className="text-xl font-bold text-foreground mb-2">
                No allocation requests found
              </h3>
              <p className="text-muted-foreground">
                {dateFilter === 'today' 
                  ? 'No allocation requests for today.' 
                  : 'Try adjusting your filters.'}
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
                  {allocationRequests.map((request) => (
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
                                min="0.001"
                                step="0.001"
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
