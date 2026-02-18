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

  // Outlet stock-out panel state (allocation requests)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [outletDateFilter, setOutletDateFilter] = useState('all')
  const [outletDateFrom, setOutletDateFrom] = useState('')
  const [outletDateTo, setOutletDateTo] = useState('')

  // Kitchen stock-out (self stock-out) records panel state
  const [kitchenStockOutRecords, setKitchenStockOutRecords] = useState([])
  const [kitchenSearchTerm, setKitchenSearchTerm] = useState('')
  const [kitchenReasonFilter, setKitchenReasonFilter] = useState('all')
  const [kitchenDateFilter, setKitchenDateFilter] = useState('all')
  const [kitchenDateFrom, setKitchenDateFrom] = useState('')
  const [kitchenDateTo, setKitchenDateTo] = useState('')

  // Pagination per panel
  const itemsPerPage = 10
  const [outletCurrentPage, setOutletCurrentPage] = useState(1)
  const [kitchenCurrentPage, setKitchenCurrentPage] = useState(1)

  // Layout mode for desktop panels: 'split' | 'outlet-full' | 'kitchen-full'
  const [layoutMode, setLayoutMode] = useState('split')

  // Shared details modal state
  const [stockOutDetails, setStockOutDetails] = useState(null)
  const [showStockOutDetailsModal, setShowStockOutDetailsModal] = useState(false)
  
  // Self stock out creation modal states
  const [showSelfStockOutModal, setShowSelfStockOutModal] = useState(false)
  const [selfStockOutItems, setSelfStockOutItems] = useState([])
  const [selfStockOutReason, setSelfStockOutReason] = useState('')
  const [selfStockOutNotes, setSelfStockOutNotes] = useState('')
  const [allMaterials, setAllMaterials] = useState([])
  const [isSelfStockOut, setIsSelfStockOut] = useState(false)
  const [selectedStockOutRows, setSelectedStockOutRows] = useState(new Set())
  // Prevent double-submit on allocation (ref blocks immediately)
  const allocatingRef = useRef(false)
  // Material search popup (same design as Stock In / OutletDetails)
  const [openMaterialDropdownRow, setOpenMaterialDropdownRow] = useState(-1)
  const [materialDropdownSearchTerm, setMaterialDropdownSearchTerm] = useState('')
  const [materialDropdownPosition, setMaterialDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const materialDropdownSearchRef = useRef(null)

  // Fetch allocation requests and kitchen stock-out records
  useEffect(() => {
    fetchAllocationRequests()
  }, [statusFilter])

  const fetchKitchenStockOutRecords = async () => {
    const session = getSession()
    if (!session?.cloud_kitchen_id) return

    try {
      const { data, error } = await supabase
        .from('stock_out')
        .select(`
          *,
          users:allocated_by (
            id,
            full_name
          ),
          stock_out_items (
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
        .eq('self_stock_out', true)
        .order('allocation_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setKitchenStockOutRecords(data || [])
    } catch (err) {
      console.error('Error fetching kitchen stock out records:', err)
      setAlert(prev => prev || { type: 'error', message: 'Failed to fetch kitchen stock out records' })
    }
  }

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

      // Also refresh kitchen stock-out records
      await fetchKitchenStockOutRecords()
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
    setSelfStockOutReason('')
    setSelfStockOutNotes('')
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
      
      // Initialize with 3 empty rows
      const makeRow = () => ({
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        raw_material_id: null,
        name: null,
        code: null,
        unit: null,
        current_inventory: 0,
        todays_total: 0,
        allocated_quantity: ''
      })
      setSelfStockOutItems([makeRow(), makeRow(), makeRow()])
      setSelectedStockOutRows(new Set())
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
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      raw_material_id: null,
      name: null,
      code: null,
      unit: null,
      allocated_quantity: '',
      current_inventory: 0,
      todays_total: 0
    }])
  }

  // Remove material from self stock out
  const removeMaterialFromSelfStockOut = (index) => {
    setSelfStockOutItems(prev => prev.filter((_, i) => i !== index))
    setSelectedStockOutRows(prev => {
      const newSet = new Set(prev)
      newSet.delete(index)
      return newSet
    })
  }

  // Toggle row selection for stock out
  const handleToggleStockOutRowSelect = (index) => {
    setSelectedStockOutRows(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  // Remove selected rows from stock out
  const handleRemoveSelectedStockOutRows = () => {
    setSelfStockOutItems(prev => prev.filter((_, i) => !selectedStockOutRows.has(i)))
    setSelectedStockOutRows(new Set())
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

    // Fetch current inventory and today's stock out total for this material
    try {
      const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .eq('raw_material_id', materialId)
        .single()

      const currentInventory = invData ? parseFloat(invData.quantity || 0) : 0

      // Fetch today's total allocation requests for this material (same as Allocate Stock modal)
      const today = new Date().toISOString().split('T')[0]
      const { data: todayRequests, error: reqError } = await supabase
        .from('allocation_requests')
        .select(`
          allocation_request_items!inner (
            raw_material_id,
            quantity
          )
        `)
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .eq('request_date', today)
        .eq('is_packed', false)

      let todaysTotal = 0
      if (todayRequests) {
        todayRequests.forEach(req => {
          req.allocation_request_items.forEach(item => {
            if (item.raw_material_id === materialId) {
              todaysTotal += parseFloat(item.quantity || 0)
            }
          })
        })
      }

      setSelfStockOutItems(prev => {
        const updated = [...prev]
        updated[index] = {
          raw_material_id: materialId,
          name: material.name,
          code: material.code,
          unit: material.unit,
          allocated_quantity: 0,
          todays_total: todaysTotal,
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

  // FIFO Allocation Logic (no-op when quantity <= 0)
  const allocateStockFIFO = async (rawMaterialId, quantity, cloudKitchenId) => {
    const qty = parseFloat(quantity)
    if (qty <= 0) return true

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
    let itemsToProcess = isSelfStockOut ? selfStockOutItems : allocationItems
    
    // For self stock out, filter only valid items (with material and quantity > 0)
    if (isSelfStockOut) {
      itemsToProcess = itemsToProcess.filter(item => 
        item.raw_material_id && parseFloat(item.allocated_quantity) > 0
      )
    }

    // Validate for self stock out
    if (isSelfStockOut) {
      if (!selfStockOutReason) {
        setAlert({ type: 'error', message: 'Please select a reason for kitchen stock out' })
        allocatingRef.current = false
        setAllocating(false)
        return
      }

      if (itemsToProcess.length === 0) {
        setAlert({ type: 'error', message: 'Please add at least one material with quantity' })
        allocatingRef.current = false
        setAllocating(false)
        return
      }

      // Validate quantities for items
      for (const item of itemsToProcess) {
        // Use the current_inventory already fetched when material was selected
        const availableInventory = item.current_inventory || 0
        if (parseFloat(item.allocated_quantity) > availableInventory) {
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
      // At least one item must have quantity > 0 for regular stock out
      const hasPositiveQty = itemsToProcess.some(item => parseFloat(item.allocated_quantity) > 0)
      if (!hasPositiveQty) {
        setAlert({ type: 'error', message: 'Please enter a quantity greater than 0 for at least one item' })
        allocatingRef.current = false
        setAllocating(false)
        return
      }

      // Validate allocated quantities for regular stock out (allow 0; reject negative; cap by inventory)
      for (const item of itemsToProcess) {
        if (parseFloat(item.allocated_quantity) < 0) {
          setAlert({ type: 'error', message: `Quantity cannot be negative for ${item.name}` })
          allocatingRef.current = false
          setAllocating(false)
          return
        }

        const availableInventory = inventoryData[item.raw_material_id] || 0
        if (parseFloat(item.allocated_quantity) > availableInventory) {
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
        stockOutPayload.reason = selfStockOutReason
        stockOutPayload.notes = selfStockOutNotes.trim() || null
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

      // Process each item: always create stock_out_item; for quantity > 0 run FIFO and decrement inventory
      for (const item of itemsToProcess) {
        const qty = parseFloat(item.allocated_quantity) || 0

        // Create stock_out_item (0 is valid: "packed 0" for this line)
        const { error: itemError } = await supabase
          .from('stock_out_items')
          .insert({
            stock_out_id: stockOutData.id,
            raw_material_id: item.raw_material_id,
            quantity: qty
          })

        if (itemError) throw itemError

        if (qty > 0) {
          // Allocate stock using FIFO and update inventory
          await allocateStockFIFO(
            item.raw_material_id,
            qty,
            session.cloud_kitchen_id
          )

          const { data: currentInv, error: invFetchError } = await supabase
            .from('inventory')
            .select('quantity')
            .eq('cloud_kitchen_id', session.cloud_kitchen_id)
            .eq('raw_material_id', item.raw_material_id)
            .single()

          if (invFetchError) throw invFetchError

          const newQuantity = parseFloat(currentInv.quantity) - qty

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
      }

      // Audit log only for self stock outs
      if (isSelfStockOut) {
        const { error: auditError } = await supabase
          .from('audit_logs')
          .insert({
            user_id: session.id,
            action: 'stock_out',
            entity_type: 'stock_out',
            entity_id: stockOutData.id,
            new_values: {
              self_stock_out: true,
              reason: selfStockOutReason,
              notes: selfStockOutNotes.trim() || null,
              allocation_request_id: null,
              outlet_id: null,
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

  // Apply filters for outlet panel (search + date)
  const filteredRequests = allocationRequests.filter((request) => {
    // Search by outlet name, outlet code, or requested by
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      const outletName = request.outlets?.name?.toLowerCase() || ''
      const outletCode = request.outlets?.code?.toLowerCase() || ''
      const requestedBy = request.users?.full_name?.toLowerCase() || ''
      const matchesSearch =
        outletName.includes(q) ||
        outletCode.includes(q) ||
        requestedBy.includes(q)
      if (!matchesSearch) return false
    }

    // Date filter (request_date)
    if (outletDateFilter === 'custom') {
      if (outletDateFrom || outletDateTo) {
        const recordDate = new Date(request.request_date)
        if (outletDateFrom && recordDate < new Date(outletDateFrom)) return false
        if (outletDateTo && recordDate > new Date(outletDateTo)) return false
      }
    } else if (outletDateFilter === 'today') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const recordDate = new Date(request.request_date)
      recordDate.setHours(0, 0, 0, 0)
      if (recordDate.getTime() !== today.getTime()) return false
    } else if (outletDateFilter === 'this-week') {
      const today = new Date()
      const weekAgo = new Date(today)
      weekAgo.setDate(today.getDate() - 7)
      const recordDate = new Date(request.request_date)
      if (recordDate < weekAgo || recordDate > today) return false
    } else if (outletDateFilter === 'this-month') {
      const today = new Date()
      const monthAgo = new Date(today)
      monthAgo.setMonth(today.getMonth() - 1)
      const recordDate = new Date(request.request_date)
      if (recordDate < monthAgo || recordDate > today) return false
    }

    return true
  })

  // Pagination for outlet panel
  const outletTotalPages = Math.ceil(filteredRequests.length / itemsPerPage) || 1
  const outletStartIndex = (outletCurrentPage - 1) * itemsPerPage
  const outletEndIndex = outletStartIndex + itemsPerPage
  const outletPaginated = filteredRequests.slice(outletStartIndex, outletEndIndex)

  // Helper to filter kitchen/self stock-out records
  const kitchenFiltered = kitchenStockOutRecords.filter((record) => {
    // Search by reason, notes, or material name/code in items
    if (kitchenSearchTerm.trim()) {
      const q = kitchenSearchTerm.toLowerCase()
      let matches = false

      if (record.reason) {
        const reasonDisplay = record.reason.replace(/-/g, ' ')
        if (reasonDisplay.toLowerCase().includes(q)) {
          matches = true
        }
      }

      if (!matches && record.notes && record.notes.toLowerCase().includes(q)) {
        matches = true
      }

      if (!matches && Array.isArray(record.stock_out_items)) {
        matches = record.stock_out_items.some((item) => {
          const rm = item.raw_materials
          if (!rm) return false
          const nameMatch = rm.name?.toLowerCase().includes(q)
          const codeMatch = rm.code?.toLowerCase().includes(q)
          return nameMatch || codeMatch
        })
      }

      if (!matches) return false
    }

    // Reason filter
    if (kitchenReasonFilter !== 'all') {
      if (record.reason !== kitchenReasonFilter) return false
    }

    // Date filter (allocation_date)
    if (kitchenDateFilter === 'custom') {
      if (kitchenDateFrom || kitchenDateTo) {
        const recordDate = new Date(record.allocation_date)
        if (kitchenDateFrom && recordDate < new Date(kitchenDateFrom)) return false
        if (kitchenDateTo && recordDate > new Date(kitchenDateTo)) return false
      }
    } else if (kitchenDateFilter === 'today') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const recordDate = new Date(record.allocation_date)
      recordDate.setHours(0, 0, 0, 0)
      if (recordDate.getTime() !== today.getTime()) return false
    } else if (kitchenDateFilter === 'this-week') {
      const today = new Date()
      const weekAgo = new Date(today)
      weekAgo.setDate(today.getDate() - 7)
      const recordDate = new Date(record.allocation_date)
      if (recordDate < weekAgo || recordDate > today) return false
    } else if (kitchenDateFilter === 'this-month') {
      const today = new Date()
      const monthAgo = new Date(today)
      monthAgo.setMonth(today.getMonth() - 1)
      const recordDate = new Date(record.allocation_date)
      if (recordDate < monthAgo || recordDate > today) return false
    }

    return true
  })

  // Pagination for kitchen panel
  const kitchenTotalPages = Math.ceil(kitchenFiltered.length / itemsPerPage) || 1
  const kitchenStartIndex = (kitchenCurrentPage - 1) * itemsPerPage
  const kitchenEndIndex = kitchenStartIndex + itemsPerPage
  const kitchenPaginated = kitchenFiltered.slice(kitchenStartIndex, kitchenEndIndex)

  // Reset pages when filters change
  useEffect(() => {
    setOutletCurrentPage(1)
  }, [searchTerm, statusFilter, outletDateFilter, outletDateFrom, outletDateTo])

  useEffect(() => {
    setKitchenCurrentPage(1)
  }, [kitchenSearchTerm, kitchenReasonFilter, kitchenDateFilter, kitchenDateFrom, kitchenDateTo])

  const openStockOutDetailsModal = async (request) => {
    try {
      setStockOutDetails(null)
      setShowStockOutDetailsModal(true)

      const { data, error } = await supabase
        .from('stock_out')
        .select(`
          *,
          outlets (
            name,
            code
          ),
          users:allocated_by (
            id,
            full_name
          ),
          stock_out_items (
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
        .eq('allocation_request_id', request.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      if (!data) {
        setShowStockOutDetailsModal(false)
        return
      }
      setStockOutDetails(data)
    } catch (err) {
      console.error('Error fetching stock out details:', err)
      setShowStockOutDetailsModal(false)
    }
  }

  // Open details modal for an existing kitchen/self stock-out record (no extra fetch)
  const openKitchenStockOutDetails = (record) => {
    setStockOutDetails(record)
    setShowStockOutDetailsModal(true)
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading stock out records...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
              Stock Out
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage outlet and kitchen stock-out records
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={openSelfStockOutModal}
              className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200"
            >
              + Kitchen Stock Out
            </button>
          </div>
        </div>

        {/* Outlet & Kitchen Stock-Out Panels */}
        <div className={`grid grid-cols-1 ${layoutMode === 'split' ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-6 transition-all duration-300`}>
          {/* Outlet Stock-Out Panel */}
          {layoutMode !== 'kitchen-full' && (
          <div className="bg-card border-2 border-border rounded-xl overflow-hidden transition-all duration-300">
            <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">Outlet Stock Out</h2>
                <span className="text-xs text-muted-foreground">
                  {allocationRequests.length} request(s)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLayoutMode(layoutMode === 'outlet-full' ? 'split' : 'outlet-full')}
                className="hidden lg:inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all"
              >
                {layoutMode === 'outlet-full' ? 'Restore Split' : 'Maximize'}
              </button>
            </div>

            <div className="p-4 border-b border-border">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Search (Outlet / Code / Requested By)
                  </label>
                  <input
                    type="text"
                    placeholder="Search by outlet name, outlet code, or requested by..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Status
                    </label>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All</option>
                      <option value="unpacked">Unpacked (Pending)</option>
                      <option value="packed">Packed (Completed)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Date Range
                    </label>
                    <select
                      value={outletDateFilter}
                      onChange={(e) => setOutletDateFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All Dates</option>
                      <option value="today">Today</option>
                      <option value="this-week">This Week</option>
                      <option value="this-month">This Month</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>
                </div>

                {outletDateFilter === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        From
                      </label>
                      <input
                        type="date"
                        value={outletDateFrom}
                        onChange={(e) => setOutletDateFrom(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        To
                      </label>
                      <input
                        type="date"
                        value={outletDateTo}
                        onChange={(e) => setOutletDateTo(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              {filteredRequests.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground">
                    {allocationRequests.length === 0
                      ? 'No allocation requests found.'
                      : 'No allocation requests match your filters.'}
                  </p>
                </div>
              ) : (
                <>
                  <table className="w-full">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Outlet
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Items
                        </th>
                        {layoutMode === 'outlet-full' && (
                          <>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Requested By
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Request Date
                            </th>
                          </>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Actions
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Details
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {outletPaginated.map((request) => (
                        <tr
                          key={request.id}
                          className={`border-b border-border transition-colors ${
                            request.is_packed
                              ? 'bg-accent/5 hover:bg-accent/10'
                              : 'hover:bg-background/30'
                          }`}
                        >
                          <td className="px-4 py-3 text-foreground text-sm">
                            {new Date(request.request_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-semibold text-foreground text-sm">
                                {request.outlets?.name || 'N/A'}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {request.outlets?.code || ''}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm">
                            {request.allocation_request_items?.length || 0}
                          </td>
                          {layoutMode === 'outlet-full' && (
                            <>
                              <td className="px-4 py-3 text-foreground text-sm">
                                {request.users?.full_name || 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-foreground text-xs">
                                {new Date(request.created_at).toLocaleString()}
                              </td>
                            </>
                          )}
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
                                className="px-3 py-1.5 bg-accent/10 text-accent border-2 border-accent/30 rounded-lg hover:bg-accent/20 hover:border-accent/50 transition-all duration-200 text-xs font-semibold"
                              >
                                Allocate Stock
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {request.is_packed ? (
                              <button
                                onClick={() => openStockOutDetailsModal(request)}
                                className="text-accent hover:text-accent/80 font-semibold text-xs"
                              >
                                View Details
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {outletTotalPages > 1 && (
                    <div className="border-top border-border px-4 py-3 flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Showing {outletStartIndex + 1} to{' '}
                        {Math.min(outletEndIndex, filteredRequests.length)} of{' '}
                        {filteredRequests.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setOutletCurrentPage((prev) => Math.max(1, prev - 1))
                          }
                          disabled={outletCurrentPage === 1}
                          className="px-2 py-1 bg-input border border-border rounded-lg text-xs text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                        >
                          Previous
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: outletTotalPages }, (_, i) => i + 1).map(
                            (page) => (
                              <button
                                key={page}
                                onClick={() => setOutletCurrentPage(page)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                                  outletCurrentPage === page
                                    ? 'bg-accent text-background'
                                    : 'bg-input border border-border text-foreground hover:bg-accent/10'
                                }`}
                              >
                                {page}
                              </button>
                            )
                          )}
                        </div>
                        <button
                          onClick={() =>
                            setOutletCurrentPage((prev) =>
                              Math.min(outletTotalPages, prev + 1)
                            )
                          }
                          disabled={outletCurrentPage === outletTotalPages}
                          className="px-2 py-1 bg-input border border-border rounded-lg text-xs text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
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
          )}

          {/* Kitchen Stock-Out Panel */}
          {layoutMode !== 'outlet-full' && (
          <div className="bg-card border-2 border-border rounded-xl overflow-hidden transition-all duration-300">
            <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">Kitchen Stock Out</h2>
                <span className="text-xs text-muted-foreground">
                  {kitchenStockOutRecords.length} record(s)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLayoutMode(layoutMode === 'kitchen-full' ? 'split' : 'kitchen-full')}
                className="hidden lg:inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all"
              >
                {layoutMode === 'kitchen-full' ? 'Restore Split' : 'Maximize'}
              </button>
            </div>

            <div className="p-4 border-b border-border">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Search (Material / Reason / Notes)
                  </label>
                  <input
                    type="text"
                    placeholder="Search by material, reason, or notes..."
                    value={kitchenSearchTerm}
                    onChange={(e) => setKitchenSearchTerm(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Reason
                    </label>
                    <select
                      value={kitchenReasonFilter}
                      onChange={(e) => setKitchenReasonFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All</option>
                      <option value="wastage">Wastage</option>
                      <option value="staff-food">Staff Food</option>
                      <option value="internal-production">Internal Production</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Date Range
                    </label>
                    <select
                      value={kitchenDateFilter}
                      onChange={(e) => setKitchenDateFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All Dates</option>
                      <option value="today">Today</option>
                      <option value="this-week">This Week</option>
                      <option value="this-month">This Month</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>
                </div>

                {kitchenDateFilter === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        From
                      </label>
                      <input
                        type="date"
                        value={kitchenDateFrom}
                        onChange={(e) => setKitchenDateFrom(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        To
                      </label>
                      <input
                        type="date"
                        value={kitchenDateTo}
                        onChange={(e) => setKitchenDateTo(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                      />
                    </div>
                  </div>
                )}

                {(kitchenSearchTerm ||
                  kitchenReasonFilter !== 'all' ||
                  kitchenDateFilter !== 'all') && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        setKitchenSearchTerm('')
                        setKitchenReasonFilter('all')
                        setKitchenDateFilter('all')
                        setKitchenDateFrom('')
                        setKitchenDateTo('')
                      }}
                      className="text-xs bg-transparent text-foreground font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-accent/10 transition-all"
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              {kitchenFiltered.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground">
                    {kitchenStockOutRecords.length === 0
                      ? 'No kitchen stock-out records found.'
                      : 'No kitchen stock-out records match your filters.'}
                  </p>
                </div>
              ) : (
                <>
                  <table className="w-full">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Reason
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Items
                        </th>
                        {layoutMode === 'kitchen-full' && (
                          <>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Allocated By
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Notes
                            </th>
                          </>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Details
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitchenPaginated.map((record) => (
                        <tr
                          key={record.id}
                          className="border-b border-border hover:bg-accent/5 transition-colors"
                        >
                          <td className="px-4 py-3 text-foreground text-sm">
                            {new Date(record.allocation_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm capitalize">
                            {record.reason
                              ? record.reason.replace(/-/g, ' ')
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm">
                            {record.stock_out_items?.length || 0}
                          </td>
                          {layoutMode === 'kitchen-full' && (
                            <>
                              <td className="px-4 py-3 text-foreground text-sm">
                                {record.users?.full_name || 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-foreground text-sm">
                                {record.notes
                                  ? (record.notes.length > 60
                                      ? `${record.notes.slice(0, 60)}…`
                                      : record.notes)
                                  : '—'}
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openKitchenStockOutDetails(record)}
                              className="text-accent hover:text-accent/80 font-semibold text-xs"
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {kitchenTotalPages > 1 && (
                    <div className="border-top border-border px-4 py-3 flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Showing {kitchenStartIndex + 1} to{' '}
                        {Math.min(kitchenEndIndex, kitchenFiltered.length)} of{' '}
                        {kitchenFiltered.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setKitchenCurrentPage((prev) => Math.max(1, prev - 1))
                          }
                          disabled={kitchenCurrentPage === 1}
                          className="px-2 py-1 bg-input border border-border rounded-lg text-xs text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                        >
                          Previous
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: kitchenTotalPages }, (_, i) => i + 1).map(
                            (page) => (
                              <button
                                key={page}
                                onClick={() => setKitchenCurrentPage(page)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                                  kitchenCurrentPage === page
                                    ? 'bg-accent text-background'
                                    : 'bg-input border border-border text-foreground hover:bg-accent/10'
                                }`}
                              >
                                {page}
                              </button>
                            )
                          )}
                        </div>
                        <button
                          onClick={() =>
                            setKitchenCurrentPage((prev) =>
                              Math.min(kitchenTotalPages, prev + 1)
                            )
                          }
                          disabled={kitchenCurrentPage === kitchenTotalPages}
                          className="px-2 py-1 bg-input border border-border rounded-lg text-xs text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
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
                                min="0"
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

        {/* Kitchen Stock Out Modal */}
        {showSelfStockOutModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Kitchen Stock Out</h2>
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
              <div className="mb-4">
                <label className="block text-sm font-bold text-foreground mb-2">
                  Reason <span className="text-destructive">*</span>
                </label>
                <select
                  value={selfStockOutReason}
                  onChange={(e) => setSelfStockOutReason(e.target.value)}
                  disabled={allocating}
                  className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                >
                  <option value="">Select reason</option>
                  <option value="wastage">Wastage</option>
                  <option value="staff-food">Staff Food</option>
                  <option value="internal-production">Internal Production</option>
                </select>
              </div>

              {/* Additional Notes Field */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-foreground mb-2">
                  Additional Notes
                </label>
                <textarea
                  value={selfStockOutNotes}
                  onChange={(e) => setSelfStockOutNotes(e.target.value)}
                  placeholder="Enter any additional notes (optional)"
                  disabled={allocating}
                  rows={3}
                  className="w-full bg-input border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all resize-none"
                />
              </div>

              {/* Materials Table */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-foreground">Add Items</h3>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-2">
                    {selectedStockOutRows.size > 0 && (
                      <button
                        onClick={handleRemoveSelectedStockOutRows}
                        className="px-3 py-1.5 text-sm font-semibold text-destructive bg-destructive/10 border border-destructive/30 rounded-lg hover:bg-destructive/20 transition-all"
                      >
                        Remove Selected ({selectedStockOutRows.size})
                      </button>
                    )}
                    <button
                      onClick={addSelfStockOutRow}
                      disabled={allocating}
                      className="px-4 py-2 bg-accent text-background font-bold rounded-lg hover:bg-accent/90 transition-all text-sm"
                    >
                      + Add Row
                    </button>
                  </div>
                </div>
                
                <div className="overflow-x-auto border-2 border-border rounded-xl">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="bg-background border-b-2 border-border select-none">
                        <th className="px-3 py-2 w-10"></th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground">Name</th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-32">Current Stock</th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-32">Today's Total</th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-28">Quantity</th>
                        <th className="px-3 py-2 w-12"></th>
                      </tr>
                    </thead>
                      <tbody>
                        {selfStockOutItems.map((item, index) => (
                          <tr 
                            key={item.id || index} 
                            className={`border-b border-border hover:bg-accent/5 ${selectedStockOutRows.has(index) ? 'bg-accent/10' : ''}`}
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedStockOutRows.has(index)}
                                onChange={() => handleToggleStockOutRowSelect(index)}
                                className="rounded border-border"
                              />
                            </td>
                            <td className="px-3 py-2 relative material-dropdown-container">
                              <div className="min-w-[180px]">
                                <button
                                  type="button"
                                  data-self-stock-out-trigger={index}
                                  onClick={() => {
                                    setOpenMaterialDropdownRow(openMaterialDropdownRow === index ? -1 : index)
                                    setMaterialDropdownSearchTerm('')
                                  }}
                                  disabled={allocating}
                                  className="w-full text-left px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm truncate"
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
                            <td className="px-3 py-2">
                              <span className={`block px-3 py-2 border border-border rounded-lg text-sm font-medium ${
                                item.raw_material_id ? (
                                  item.current_inventory === 0 ? 'bg-destructive/10 text-destructive' :
                                  item.current_inventory < 10 ? 'bg-yellow-500/10 text-yellow-600' :
                                  'bg-muted/50 text-foreground'
                                ) : 'bg-muted/50 text-muted-foreground'
                              }`}>
                                {item.raw_material_id ? `${item.current_inventory.toFixed(3)} ${item.unit}` : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="block px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-medium">
                                {item.raw_material_id ? `${item.todays_total.toFixed(3)} ${item.unit}` : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={item.allocated_quantity}
                                onChange={(e) => handleUpdateSelfStockOutQuantity(index, e.target.value)}
                                disabled={!item.raw_material_id}
                                placeholder="0"
                                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => removeMaterialFromSelfStockOut(index)}
                                className="text-destructive hover:text-destructive/80 p-1"
                                title="Remove row"
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
                {selfStockOutItems.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-3">
                    Click <strong>Add Row</strong> to add items. Select material from dropdown, then enter quantity.
                  </p>
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
                    !selfStockOutReason ||
                    selfStockOutItems.filter(item => item.raw_material_id && parseFloat(item.allocated_quantity) > 0).length === 0
                  }
                  className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {allocating ? 'Processing...' : 'Confirm Kitchen Stock Out'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stock Out Details Modal */}
        {showStockOutDetailsModal && stockOutDetails && (
          <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-foreground">
                  {stockOutDetails.self_stock_out ? 'Kitchen Stock Out Details' : 'Stock Out Details'}
                </h2>
                <button
                  onClick={() => setShowStockOutDetailsModal(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-6 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Allocation Date</p>
                    <p className="font-semibold text-foreground">
                      {new Date(stockOutDetails.allocation_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Created At</p>
                    <p className="font-semibold text-foreground">
                      {new Date(stockOutDetails.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!stockOutDetails.self_stock_out && (
                    <div>
                      <p className="text-sm text-muted-foreground">Outlet</p>
                      <p className="font-semibold text-foreground">
                        {stockOutDetails.outlets?.name || 'N/A'}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {stockOutDetails.outlets?.code || ''}
                      </p>
                    </div>
                  )}
                  {stockOutDetails.users?.full_name && (
                    <div>
                      <p className="text-sm text-muted-foreground">Allocated By</p>
                      <p className="font-semibold text-foreground">{stockOutDetails.users.full_name}</p>
                    </div>
                  )}
                </div>
                {stockOutDetails.self_stock_out && stockOutDetails.reason && (
                  <div>
                    <p className="text-sm text-muted-foreground">Reason</p>
                    <p className="font-semibold text-foreground capitalize">
                      {stockOutDetails.reason.replace(/-/g, ' ')}
                    </p>
                  </div>
                )}
                {stockOutDetails.self_stock_out && stockOutDetails.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Additional Notes</p>
                    <p className="font-semibold text-foreground">{stockOutDetails.notes}</p>
                  </div>
                )}
                {!stockOutDetails.self_stock_out && stockOutDetails.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Notes</p>
                    <p className="font-semibold text-foreground">{stockOutDetails.notes}</p>
                  </div>
                )}
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-bold text-foreground mb-3">
                  Items ({stockOutDetails.stock_out_items?.length || 0})
                </h3>
                {stockOutDetails.stock_out_items && stockOutDetails.stock_out_items.length > 0 ? (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-background border-b border-border">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Code</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockOutDetails.stock_out_items.map((item) => (
                          <tr key={item.id} className="border-b border-border">
                            <td className="px-4 py-3 text-sm text-foreground">
                              {item.raw_materials?.name || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                              {item.raw_materials?.code || '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-foreground">
                              {parseFloat(item.quantity || 0).toFixed(3)} {item.raw_materials?.unit || ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No items found for this stock out.</p>
                )}
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
