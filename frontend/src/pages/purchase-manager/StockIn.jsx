import { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const StockIn = () => {
  const [stockInRecords, setStockInRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Filter and search state
  const [searchTerm, setSearchTerm] = useState('')
  const [itemCountFilter, setItemCountFilter] = useState('all')
  const [costFilter, setCostFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Purchase slip form state
  const [purchaseSlip, setPurchaseSlip] = useState({
    supplier_name: '',
    invoice_number: '',
    receipt_date: new Date().toISOString().split('T')[0],
    notes: ''
  })

  // Items in the purchase slip (spreadsheet rows)
  const [purchaseItems, setPurchaseItems] = useState([])

  // Selected rows for bulk remove
  const [selectedRows, setSelectedRows] = useState(new Set())

  // Which row's material dropdown is open (-1 = none)
  const [openDropdownRow, setOpenDropdownRow] = useState(-1)
  const [dropdownSearchTerm, setDropdownSearchTerm] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const dropdownSearchRef = useRef(null)

  // Available materials from raw_materials
  const [availableMaterials, setAvailableMaterials] = useState([])

  // Vendors for supplier dropdown
  const [vendors, setVendors] = useState([])

  const fetchingRef = useRef(false)
  // Prevent double-submit on Confirm & Create (catastrophic if multiple stock_in created)
  const finalizingRef = useRef(false)
  const [finalizing, setFinalizing] = useState(false)

  // Fetch stock in records
  useEffect(() => {
    const fetchStockInRecords = async () => {
      // Prevent multiple simultaneous requests
      if (fetchingRef.current) return
      
      const session = getSession()
      if (!session?.cloud_kitchen_id) {
        setLoading(false)
        return
      }

      try {
        fetchingRef.current = true
        setLoading(true)
        
        const { data, error } = await supabase
          .from('stock_in')
          .select(`
            *,
            stock_in_batches (
              id,
              quantity_purchased,
              quantity_remaining,
              unit_cost,
              raw_materials:raw_material_id (
                id,
                name,
                code,
                unit
              )
            )
          `)
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .order('receipt_date', { ascending: false })
          .order('created_at', { ascending: false })

        if (error) {
          console.error('Error fetching stock in records:', error)
          return
        }

        setStockInRecords(data || [])
      } catch (err) {
        console.error('Error fetching stock in records:', err)
      } finally {
        setLoading(false)
        fetchingRef.current = false
      }
    }

    fetchStockInRecords()
  }, [])

  // Fetch vendors for supplier dropdown
  useEffect(() => {
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
    fetchVendors()
  }, [])

  // Fetch available materials from raw_materials when modal opens
  useEffect(() => {
    const fetchAvailableMaterials = async () => {
      if (!showAddModal) return

      try {
        const { data: materialsData, error } = await supabase
          .from('raw_materials')
          .select('id, name, code, unit, category')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name', { ascending: true })

        if (error) {
          console.error('Error fetching materials:', error)
          return
        }

        setAvailableMaterials(materialsData || [])
      } catch (err) {
        console.error('Error fetching materials:', err)
      }
    }

    fetchAvailableMaterials()
  }, [showAddModal])

  // Focus search input and update position when dropdown opens
  useEffect(() => {
    if (openDropdownRow >= 0) {
      const trigger = document.querySelector(`[data-dropdown-trigger="${openDropdownRow}"]`)
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        setDropdownPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) })
      }
      const t = setTimeout(() => dropdownSearchRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [openDropdownRow])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openDropdownRow >= 0 && !e.target.closest('.material-dropdown-container')) {
        setOpenDropdownRow(-1)
        setDropdownSearchTerm('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openDropdownRow])


  // Filter materials for dropdown search (by row)
  const getFilteredMaterialsForRow = (rowIndex) => {
    const search = openDropdownRow === rowIndex ? dropdownSearchTerm : ''
    const usedIds = purchaseItems
      .filter((item, i) => i !== rowIndex && item.raw_material_id)
      .map(item => item.raw_material_id)
    return availableMaterials.filter(material => {
      if (usedIds.includes(material.id)) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return material.name.toLowerCase().includes(q) || material.code.toLowerCase().includes(q)
    })
  }

  // Add new empty row
  const handleAddRow = () => {
    const rowId = `row-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setPurchaseItems(prev => [...prev, {
      id: rowId,
      raw_material_id: null,
      material: null,
      quantity: '',
      unit_cost: 0,
      previous_cost: null,
      total_cost: 0
    }])
  }

  // Select material for a row (from dropdown)
  const handleSelectMaterial = async (rowIndex, material) => {
    let unitCost = 0
    const session = getSession()
    if (session?.cloud_kitchen_id) {
      try {
        const { data: latestBatch } = await supabase
          .from('stock_in_batches')
          .select('unit_cost')
          .eq('raw_material_id', material.id)
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latestBatch) unitCost = parseFloat(latestBatch.unit_cost) || 0
      } catch (err) {
        console.error('Error fetching unit cost:', err)
      }
    }

    setPurchaseItems(prev => {
      const updated = [...prev]
      updated[rowIndex] = {
        ...updated[rowIndex],
        raw_material_id: material.id,
        material,
        unit_cost: unitCost,
        previous_cost: unitCost,
        total_cost: (parseFloat(updated[rowIndex].quantity) || 0) * unitCost
      }
      return updated
    })
    setOpenDropdownRow(-1)
    setDropdownSearchTerm('')
  }

  // Remove single row
  const handleRemoveRow = (index) => {
    setPurchaseItems(prev => prev.filter((_, i) => i !== index))
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.delete(index)
      return next
    })
  }

  // Toggle row selection
  const handleToggleRowSelect = (index) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // Select/deselect all rows
  const handleToggleSelectAll = (checked) => {
    if (checked) {
      setSelectedRows(new Set(purchaseItems.map((_, i) => i)))
    } else {
      setSelectedRows(new Set())
    }
  }

  // Remove selected rows
  const handleRemoveSelectedRows = () => {
    if (selectedRows.size === 0) return
    setPurchaseItems(prev => prev.filter((_, i) => !selectedRows.has(i)))
    setSelectedRows(new Set())
  }

  // Update item quantity
  const handleUpdateItem = (index, field, value) => {
    setPurchaseItems(prev => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        [field]: value
      }

      // Calculate total cost
      const quantity = parseFloat(updated[index].quantity) || 0
      const unitCost = parseFloat(updated[index].unit_cost) || 0
      updated[index].total_cost = quantity * unitCost

      return updated
    })
  }

  // Calculate total cost of purchase slip (only valid items)
  const validPurchaseItems = purchaseItems.filter(item => item.raw_material_id && item.material)
  const calculateTotalCost = () => {
    return validPurchaseItems.reduce((sum, item) => sum + (item.total_cost || 0), 0)
  }

  // Open add modal
  const openAddModal = () => {
    setPurchaseSlip({
      supplier_name: '',
      invoice_number: '',
      receipt_date: new Date().toISOString().split('T')[0],
      notes: ''
    })
    setPurchaseItems([])
    setShowAddModal(true)
  }

  // Close add modal
  const closeAddModal = () => {
    setShowAddModal(false)
    setPurchaseSlip({
      supplier_name: '',
      invoice_number: '',
      receipt_date: new Date().toISOString().split('T')[0],
      notes: ''
    })
    setPurchaseItems([])
    setSelectedRows(new Set())
    setOpenDropdownRow(-1)
    setDropdownSearchTerm('')
  }

  // Finalize purchase slip
  const handleFinalize = async () => {
    // Prevent double/multiple submit: ref guard blocks immediately, state disables button
    if (finalizingRef.current) return
    finalizingRef.current = true
    setFinalizing(true)

    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      alert('Session expired. Please log in again.')
      finalizingRef.current = false
      setFinalizing(false)
      return
    }

    // Validate purchase slip
    if (!purchaseSlip.supplier_name?.trim()) {
      alert('Please select a supplier')
      finalizingRef.current = false
      setFinalizing(false)
      return
    }
    if (!purchaseSlip.receipt_date) {
      alert('Please select a receipt date')
      finalizingRef.current = false
      setFinalizing(false)
      return
    }

    if (validPurchaseItems.length === 0) {
      alert('Please add at least one item with a material selected')
      finalizingRef.current = false
      setFinalizing(false)
      return
    }

    // Validate all valid items
    for (let i = 0; i < validPurchaseItems.length; i++) {
      const item = validPurchaseItems[i]
      if (!item.quantity || parseFloat(item.quantity) <= 0) {
        alert(`Please enter a valid quantity for ${item.material.name}`)
        finalizingRef.current = false
        setFinalizing(false)
        return
      }
      if (!item.unit_cost || parseFloat(item.unit_cost) <= 0) {
        alert(`Please enter a valid unit cost for ${item.material.name}`)
        finalizingRef.current = false
        setFinalizing(false)
        return
      }
    }

    try {
      const totalCost = calculateTotalCost()

      // Create stock_in record
      const { data: stockInData, error: stockInError } = await supabase
        .from('stock_in')
        .insert({
          cloud_kitchen_id: session.cloud_kitchen_id,
          received_by: session.id,
          receipt_date: purchaseSlip.receipt_date,
          supplier_name: purchaseSlip.supplier_name.trim() || null,
          invoice_number: purchaseSlip.invoice_number.trim() || null,
          total_cost: totalCost,
          notes: purchaseSlip.notes.trim() || null
        })
        .select()
        .single()

      if (stockInError) throw stockInError

      // Check if materials exist in inventory, create entries if they don't
      // This must happen BEFORE creating stock_in_batches
      for (const item of validPurchaseItems) {
        // Check if inventory entry exists
        const { data: existingInventory } = await supabase
          .from('inventory')
          .select('id')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('raw_material_id', item.raw_material_id)
          .maybeSingle()

        // If inventory entry doesn't exist, create it with quantity 0
        // (The trigger should handle this, but we ensure it exists)
        if (!existingInventory) {
          const { error: inventoryError } = await supabase
            .from('inventory')
            .insert({
              cloud_kitchen_id: session.cloud_kitchen_id,
              raw_material_id: item.raw_material_id,
              quantity: 0, // Will be updated when batches are created
              updated_by: session.id
            })

          if (inventoryError) {
            console.error('Error creating inventory entry:', inventoryError)
            // Continue even if inventory creation fails
          }
        }
      }

      // Create stock_in_batches (FIFO tracking)
      const stockInBatches = validPurchaseItems.map(item => {
        const quantity = parseFloat(item.quantity)
        return {
          stock_in_id: stockInData.id,
          raw_material_id: item.raw_material_id,
          cloud_kitchen_id: session.cloud_kitchen_id,
          quantity_purchased: quantity,
          quantity_remaining: quantity, // Initially, all purchased quantity is remaining
          unit_cost: parseFloat(item.unit_cost)
        }
      })

      const { error: batchesError } = await supabase
        .from('stock_in_batches')
        .insert(stockInBatches)

      if (batchesError) throw batchesError

      // Update inventory quantities by incrementing with the new batch quantities
      for (const item of validPurchaseItems) {
        const quantity = parseFloat(item.quantity)
        
        // Fetch current inventory
        const { data: currentInventory } = await supabase
          .from('inventory')
          .select('quantity')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('raw_material_id', item.raw_material_id)
          .maybeSingle()

        if (currentInventory) {
          // Update existing inventory by adding the new quantity
          const newQuantity = parseFloat(currentInventory.quantity || 0) + quantity
          
          const { error: updateError } = await supabase
            .from('inventory')
            .update({
              quantity: newQuantity,
              last_updated_at: new Date().toISOString(),
              updated_by: session.id
            })
            .eq('cloud_kitchen_id', session.cloud_kitchen_id)
            .eq('raw_material_id', item.raw_material_id)

          if (updateError) {
            console.error('Error updating inventory quantity:', updateError)
          }
        } else {
          // If inventory entry still doesn't exist, create it with the quantity
          const { error: insertError } = await supabase
            .from('inventory')
            .insert({
              cloud_kitchen_id: session.cloud_kitchen_id,
              raw_material_id: item.raw_material_id,
              quantity: quantity,
              last_updated_at: new Date().toISOString(),
              updated_by: session.id
            })

          if (insertError) {
            console.error('Error creating inventory entry:', insertError)
          }
        }
      }

      // Close modals and refresh
      setShowConfirmModal(false)
      closeAddModal()

      // Refresh stock in records
      const { data: updatedRecords } = await supabase
        .from('stock_in')
        .select(`
          *,
          stock_in_batches (
            id,
            quantity_purchased,
            quantity_remaining,
            unit_cost,
            raw_materials:raw_material_id (
              id,
              name,
              code,
              unit
            )
          )
        `)
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .order('receipt_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (updatedRecords) {
        setStockInRecords(updatedRecords)
      }

      alert('Purchase slip created successfully! Inventory has been updated.')
    } catch (err) {
      console.error('Error finalizing purchase slip:', err)
      alert(`Failed to create purchase slip: ${err.message}`)
    } finally {
      finalizingRef.current = false
      setFinalizing(false)
    }
  }

  // Filter and search logic
  const filteredRecords = stockInRecords.filter(record => {
    // Search filter (invoice number or supplier name)
    if (searchTerm) {
      const invoiceMatch = record.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase())
      const supplierMatch = record.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase())
      if (!invoiceMatch && !supplierMatch) return false
    }

    // Item count filter
    const itemCount = record.stock_in_batches?.length || 0
    if (itemCountFilter === '1-5' && (itemCount < 1 || itemCount > 5)) return false
    if (itemCountFilter === '6-10' && (itemCount < 6 || itemCount > 10)) return false
    if (itemCountFilter === '11+' && itemCount < 11) return false

    // Cost filter
    const totalCost = parseFloat(record.total_cost || 0)
    if (costFilter === '0-1000' && (totalCost < 0 || totalCost > 1000)) return false
    if (costFilter === '1001-5000' && (totalCost < 1001 || totalCost > 5000)) return false
    if (costFilter === '5001-10000' && (totalCost < 5001 || totalCost > 10000)) return false
    if (costFilter === '10000+' && totalCost < 10001) return false

    // Date filter
    if (dateFilter === 'custom') {
      if (dateFrom || dateTo) {
        const recordDate = new Date(record.receipt_date)
        if (dateFrom && recordDate < new Date(dateFrom)) return false
        if (dateTo && recordDate > new Date(dateTo)) return false
      }
    } else if (dateFilter === 'today') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const recordDate = new Date(record.receipt_date)
      recordDate.setHours(0, 0, 0, 0)
      if (recordDate.getTime() !== today.getTime()) return false
    } else if (dateFilter === 'this-week') {
      const today = new Date()
      const weekAgo = new Date(today)
      weekAgo.setDate(today.getDate() - 7)
      const recordDate = new Date(record.receipt_date)
      if (recordDate < weekAgo || recordDate > today) return false
    } else if (dateFilter === 'this-month') {
      const today = new Date()
      const monthAgo = new Date(today)
      monthAgo.setMonth(today.getMonth() - 1)
      const recordDate = new Date(record.receipt_date)
      if (recordDate < monthAgo || recordDate > today) return false
    }

    return true
  })

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, itemCountFilter, costFilter, dateFilter, dateFrom, dateTo])

  // Pagination
  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex)

  // Open details modal
  const openDetailsModal = (record) => {
    setSelectedRecord(record)
    setShowDetailsModal(true)
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading stock in records...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Stock In</h1>
          <button
            onClick={openAddModal}
            className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200"
          >
            + Add New Purchase Slip
          </button>
        </div>

        {/* Filters and Search */}
        <div className="bg-card border-2 border-border rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* Search */}
            <div className="lg:col-span-2">
              <label className="block text-sm font-semibold text-foreground mb-2">
                Search (Invoice # or Supplier)
              </label>
              <input
                type="text"
                placeholder="Search by invoice number or supplier name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              />
            </div>

            {/* Item Count Filter */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Items
              </label>
              <select
                value={itemCountFilter}
                onChange={(e) => setItemCountFilter(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              >
                <option value="all">All</option>
                <option value="1-5">1-5 items</option>
                <option value="6-10">6-10 items</option>
                <option value="11+">11+ items</option>
              </select>
            </div>

            {/* Cost Filter */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Total Cost
              </label>
              <select
                value={costFilter}
                onChange={(e) => setCostFilter(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              >
                <option value="all">All</option>
                <option value="0-1000">₹0 - ₹1,000</option>
                <option value="1001-5000">₹1,001 - ₹5,000</option>
                <option value="5001-10000">₹5,001 - ₹10,000</option>
                <option value="10000+">₹10,000+</option>
              </select>
            </div>
          </div>

          {/* Date Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Date Range
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="this-week">This Week</option>
                <option value="this-month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {dateFilter === 'custom' && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>
              </>
            )}

            {/* Clear Filters Button */}
            {(searchTerm || itemCountFilter !== 'all' || costFilter !== 'all' || dateFilter !== 'all') && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchTerm('')
                    setItemCountFilter('all')
                    setCostFilter('all')
                    setDateFilter('all')
                    setDateFrom('')
                    setDateTo('')
                  }}
                  className="w-full bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stock In Records Table */}
        <div className="bg-card border-2 border-border rounded-xl overflow-hidden">
          {filteredRecords.length === 0 ? (
            <div className="text-center py-16">
              <h3 className="text-xl font-bold text-foreground mb-2">
                {stockInRecords.length === 0 
                  ? 'No purchase slips found' 
                  : 'No purchase slips match your filters'}
              </h3>
              <p className="text-muted-foreground">
                {stockInRecords.length === 0 
                  ? 'Create your first purchase slip to get started.' 
                  : 'Try adjusting your search or filter criteria.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-background border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Receipt Date</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Supplier</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Invoice #</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Items</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Total Cost</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRecords.map((record) => (
                      <tr key={record.id} className="border-b border-border hover:bg-accent/5 transition-colors">
                        <td className="px-4 py-3 text-foreground">
                          {new Date(record.receipt_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {record.supplier_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-sm">
                          {record.invoice_number || '—'}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {record.stock_in_batches?.length || 0} item(s)
                        </td>
                        <td className="px-4 py-3 text-foreground font-semibold">
                          ₹{parseFloat(record.total_cost || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openDetailsModal(record)}
                            className="text-accent hover:text-accent/80 font-semibold text-sm"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-border px-4 py-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} records
                    {filteredRecords.length !== stockInRecords.length && (
                      <span className="ml-2">(filtered from {stockInRecords.length} total)</span>
                    )}
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

        {/* Add Purchase Slip Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-foreground">New Purchase Slip</h2>
                <button
                  onClick={closeAddModal}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Purchase Slip Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Supplier <span className="text-destructive">*</span>
                  </label>
                  <select
                    required
                    value={purchaseSlip.supplier_name}
                    onChange={(e) => setPurchaseSlip({ ...purchaseSlip, supplier_name: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  >
                    <option value="">Select vendor</option>
                    {vendors.map(vendor => (
                      <option key={vendor.id} value={vendor.name}>{vendor.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Invoice Number
                  </label>
                  <input
                    type="text"
                    value={purchaseSlip.invoice_number}
                    onChange={(e) => setPurchaseSlip({ ...purchaseSlip, invoice_number: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    placeholder="Invoice #"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Receipt Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={purchaseSlip.receipt_date}
                    onChange={(e) => setPurchaseSlip({ ...purchaseSlip, receipt_date: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={purchaseSlip.notes}
                    onChange={(e) => setPurchaseSlip({ ...purchaseSlip, notes: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    placeholder="Additional notes"
                  />
                </div>
              </div>

              {/* Purchase Items - Spreadsheet Style */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-foreground">Purchase Items</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  If the material you're looking for isn't listed, please go to the <strong>Materials</strong> section to add it first, then come back here.
                </p>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-2">
                    {selectedRows.size > 0 && (
                      <button
                        onClick={handleRemoveSelectedRows}
                        className="px-3 py-1.5 text-sm font-semibold text-destructive bg-destructive/10 border border-destructive/30 rounded-lg hover:bg-destructive/20 transition-all"
                      >
                        Remove Selected ({selectedRows.size})
                      </button>
                    )}
                    <button
                      onClick={handleAddRow}
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
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-28">Quantity</th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-28">Prev. Cost (₹)</th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-28">Unit Cost (₹)</th>
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-28">Total (₹)</th>
                        <th className="px-3 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseItems.map((item, index) => (
                        <tr
                          key={item.id || index}
                          className={`border-b border-border hover:bg-accent/5 ${selectedRows.has(index) ? 'bg-accent/10' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedRows.has(index)}
                              onChange={() => handleToggleRowSelect(index)}
                              className="rounded border-border"
                            />
                          </td>
                          <td className="px-3 py-2 relative material-dropdown-container">
                            <div className="min-w-[180px]">
                              <button
                                type="button"
                                data-dropdown-trigger={index}
                                onClick={() => {
                                  setOpenDropdownRow(openDropdownRow === index ? -1 : index)
                                  setDropdownSearchTerm('')
                                }}
                                className="w-full text-left px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm truncate"
                              >
                                {item.material ? (
                                  <span>{item.material.name} <span className="text-muted-foreground text-xs">({item.material.unit})</span></span>
                                ) : (
                                  <span className="text-muted-foreground">Select material...</span>
                                )}
                              </button>
                              {openDropdownRow === index && ReactDOM.createPortal(
                                <div
                                  className="fixed z-[9999] bg-card border-2 border-accent rounded-xl shadow-2xl overflow-hidden material-dropdown-container"
                                  style={{
                                    top: dropdownPosition.top,
                                    left: dropdownPosition.left,
                                    width: dropdownPosition.width,
                                    minWidth: 280
                                  }}
                                >
                                  <input
                                    ref={dropdownSearchRef}
                                    type="text"
                                    value={dropdownSearchTerm}
                                    onChange={(e) => setDropdownSearchTerm(e.target.value)}
                                    placeholder="Search material..."
                                    className="w-full px-4 py-3 border-b-2 border-border focus:outline-none focus:ring-2 focus:ring-accent bg-background text-foreground"
                                  />
                                  <div className="max-h-44 overflow-y-auto bg-card">
                                    {getFilteredMaterialsForRow(index).length === 0 ? (
                                      <div className="p-4 text-center text-sm text-muted-foreground">
                                        No materials found. Add in Materials first.
                                      </div>
                                    ) : (
                                      getFilteredMaterialsForRow(index).map((m) => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onClick={() => handleSelectMaterial(index, m)}
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
                            <input
                              type="number"
                              min="0.5"
                              step="0.5"
                              value={item.quantity}
                              onChange={(e) => handleUpdateItem(index, 'quantity', e.target.value)}
                              placeholder="0"
                              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                              disabled={!item.material}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <span className="block px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm">
                              {item.previous_cost != null && item.previous_cost > 0
                                ? `₹${parseFloat(item.previous_cost).toFixed(2)}`
                                : '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unit_cost || ''}
                              onChange={(e) => handleUpdateItem(index, 'unit_cost', e.target.value)}
                              placeholder="0"
                              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                              disabled={!item.material}
                            />
                          </td>
                          <td className="px-3 py-2 text-sm font-medium text-foreground">
                            {item.total_cost != null ? `₹${parseFloat(item.total_cost || 0).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(index)}
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
                {purchaseItems.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-3">
                    Click <strong>Add Row</strong> to add items. Select material from dropdown, then enter quantity and unit cost.
                  </p>
                )}
              </div>

              {/* Total Cost */}
              {validPurchaseItems.length > 0 && (
                <div className="mb-6 p-4 bg-accent/20 border border-accent rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-foreground">Total Cost:</span>
                    <span className="text-2xl font-bold text-foreground">
                      ₹{calculateTotalCost().toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={closeAddModal}
                  className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (validPurchaseItems.length === 0) {
                      alert('Please add at least one item with a material selected')
                      return
                    }
                    setShowConfirmModal(true)
                  }}
                  disabled={validPurchaseItems.length === 0}
                  className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Finalize Purchase Slip
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-2xl w-full">
              <h2 className="text-2xl font-bold text-foreground mb-4">Confirm Purchase Slip</h2>
              
              <div className="mb-6 space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Receipt Date</p>
                  <p className="font-semibold text-foreground">
                    {new Date(purchaseSlip.receipt_date).toLocaleDateString()}
                  </p>
                </div>
                {purchaseSlip.supplier_name && (
                  <div>
                    <p className="text-sm text-muted-foreground">Supplier</p>
                    <p className="font-semibold text-foreground">{purchaseSlip.supplier_name}</p>
                  </div>
                )}
                {purchaseSlip.invoice_number && (
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Number</p>
                    <p className="font-semibold text-foreground">{purchaseSlip.invoice_number}</p>
                  </div>
                )}
              </div>

              <div className="mb-6">
                <p className="text-sm font-semibold text-foreground mb-3">Items to be added:</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {validPurchaseItems.map((item, index) => (
                    <div key={index} className="bg-background border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{item.material.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantity} {item.material.unit} × ₹{parseFloat(item.unit_cost || 0).toFixed(2)} = ₹{item.total_cost.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-6 p-4 bg-accent/20 border border-accent rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-foreground">Total Cost:</span>
                  <span className="text-2xl font-bold text-foreground">
                    ₹{calculateTotalCost().toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => !finalizing && setShowConfirmModal(false)}
                  disabled={finalizing}
                  className="flex-1 bg-transparent text-foreground font-semibold px-4 py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalize}
                  disabled={finalizing}
                  className="flex-1 bg-accent text-background font-bold px-4 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {finalizing ? 'Creating...' : 'Confirm & Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View Details Modal */}
        {showDetailsModal && selectedRecord && (
          <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-foreground">Purchase Slip Details</h2>
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Purchase Slip Information */}
              <div className="mb-6 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Receipt Date</p>
                    <p className="font-semibold text-foreground">
                      {new Date(selectedRecord.receipt_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Created At</p>
                    <p className="font-semibold text-foreground">
                      {new Date(selectedRecord.created_at).toLocaleString()}
                    </p>
                  </div>
                  {selectedRecord.supplier_name && (
                    <div>
                      <p className="text-sm text-muted-foreground">Supplier</p>
                      <p className="font-semibold text-foreground">{selectedRecord.supplier_name}</p>
                    </div>
                  )}
                  {selectedRecord.invoice_number && (
                    <div>
                      <p className="text-sm text-muted-foreground">Invoice Number</p>
                      <p className="font-semibold text-foreground font-mono">{selectedRecord.invoice_number}</p>
                    </div>
                  )}
                </div>
                {selectedRecord.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Notes</p>
                    <p className="font-semibold text-foreground">{selectedRecord.notes}</p>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-foreground mb-3">Items ({selectedRecord.stock_in_batches?.length || 0})</h3>
                {selectedRecord.stock_in_batches && selectedRecord.stock_in_batches.length > 0 ? (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-background border-b border-border">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Code</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity Purchased</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity Remaining</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Unit Cost</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRecord.stock_in_batches.map((batch, index) => {
                          const totalCost = parseFloat(batch.quantity_purchased) * parseFloat(batch.unit_cost || 0)
                          return (
                            <tr key={batch.id || index} className="border-b border-border hover:bg-accent/5 transition-colors">
                              <td className="px-4 py-3 text-foreground">
                                {batch.raw_materials?.name || 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground font-mono text-sm">
                                {batch.raw_materials?.code || 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-foreground">
                                {parseFloat(batch.quantity_purchased).toFixed(3)} {batch.raw_materials?.unit || ''}
                              </td>
                              <td className="px-4 py-3 text-foreground">
                                {parseFloat(batch.quantity_remaining).toFixed(3)} {batch.raw_materials?.unit || ''}
                              </td>
                              <td className="px-4 py-3 text-foreground">
                                ₹{parseFloat(batch.unit_cost || 0).toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-foreground font-semibold">
                                ₹{totalCost.toFixed(2)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No items found</p>
                )}
              </div>

              {/* Total Cost */}
              <div className="mb-6 p-4 bg-accent/20 border border-accent rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-foreground">Total Cost:</span>
                  <span className="text-2xl font-bold text-foreground">
                    ₹{parseFloat(selectedRecord.total_cost || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="bg-accent text-background font-bold px-6 py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default StockIn
