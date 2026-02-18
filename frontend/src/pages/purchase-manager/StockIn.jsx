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
  const itemsPerPage = 10

  // Layout mode for desktop panels: 'split' | 'purchase-full' | 'kitchen-full'
  const [layoutMode, setLayoutMode] = useState('split')

  // Filter and search state - Purchase panel
  const [purchaseSearchTerm, setPurchaseSearchTerm] = useState('')
  const [purchaseItemCountFilter, setPurchaseItemCountFilter] = useState('all')
  const [purchaseCostFilter, setPurchaseCostFilter] = useState('all')
  const [purchaseDateFilter, setPurchaseDateFilter] = useState('all')
  const [purchaseDateFrom, setPurchaseDateFrom] = useState('')
  const [purchaseDateTo, setPurchaseDateTo] = useState('')
  const [purchaseCurrentPage, setPurchaseCurrentPage] = useState(1)

  // Filter and search state - Kitchen panel
  const [kitchenSearchTerm, setKitchenSearchTerm] = useState('')
  const [kitchenItemCountFilter, setKitchenItemCountFilter] = useState('all')
  const [kitchenCostFilter, setKitchenCostFilter] = useState('all')
  const [kitchenDateFilter, setKitchenDateFilter] = useState('all')
  const [kitchenDateFrom, setKitchenDateFrom] = useState('')
  const [kitchenDateTo, setKitchenDateTo] = useState('')
  const [kitchenCurrentPage, setKitchenCurrentPage] = useState(1)

  // Stock-in type state ('purchase' or 'kitchen')
  const [stockInType, setStockInType] = useState('purchase')

  // Purchase slip form state
  const [purchaseSlip, setPurchaseSlip] = useState({
    supplier_name: '',
    invoice_number: '',
    receipt_date: new Date().toISOString().split('T')[0],
    notes: ''
  })

  // Invoice image upload state (purchase stock-in only)
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [invoiceFileError, setInvoiceFileError] = useState('')

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
              gst_percent,
              raw_materials:raw_material_id (
                id,
                name,
                code,
                unit,
                material_type
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
        // Fetch materials based on stock-in type
        // Purchase: raw_material only
        // Kitchen: semi_finished and finished only
        const materialTypes = stockInType === 'purchase' 
          ? ['raw_material'] 
          : ['semi_finished', 'finished']

        const { data: materialsData, error } = await supabase
          .from('raw_materials')
          .select('id, name, code, unit, category, material_type')
          .eq('is_active', true)
          .is('deleted_at', null)
          .in('material_type', materialTypes)
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
  }, [showAddModal, stockInType])

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
      gst_percent: '',
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
        total_cost: (() => {
          const quantity = parseFloat(updated[rowIndex].quantity) || 0
          const gstPercent = parseFloat(updated[rowIndex].gst_percent) || 0
          const base = quantity * unitCost
          return base + (base * gstPercent / 100)
        })()
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
      const gstPercent = parseFloat(updated[index].gst_percent) || 0
      const base = quantity * unitCost
      updated[index].total_cost = base + (base * gstPercent / 100)

      return updated
    })
  }

  // Calculate total cost of purchase slip (only valid items)
  const validPurchaseItems = purchaseItems.filter(item => item.raw_material_id && item.material)
  const calculateTotalCost = () => {
    return validPurchaseItems.reduce((sum, item) => sum + (item.total_cost || 0), 0)
  }

  const sanitizeForFilename = (value) => {
    if (!value) return ''
    return value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\-]/g, '')
  }

  const handleInvoiceFileChange = (event) => {
    const file = event.target.files?.[0]

    if (!file) {
      setInvoiceFile(null)
      setInvoiceFileError('Please select an image file.')
      return
    }

    const allowedTypes = ['image/jpeg', 'image/png']
    const maxSizeBytes = 5 * 1024 * 1024 // 5 MB

    if (!allowedTypes.includes(file.type)) {
      setInvoiceFile(null)
      setInvoiceFileError('Only JPEG and PNG images are allowed.')
      return
    }

    if (file.size > maxSizeBytes) {
      setInvoiceFile(null)
      setInvoiceFileError('Maximum file size is 5 MB.')
      return
    }

    setInvoiceFile(file)
    setInvoiceFileError('')
  }

  const uploadInvoiceImage = async (file, session, invoiceNumber) => {
    if (!file) return null

    const cloudKitchenIdentifier = sanitizeForFilename(
      session?.cloud_kitchen_name || session?.cloud_kitchen_id || 'cloud_kitchen'
    )
    const invoiceIdentifier = sanitizeForFilename(invoiceNumber)

    if (!invoiceIdentifier) {
      throw new Error('Invalid invoice number for invoice image naming.')
    }

    const extension = file.type === 'image/png' ? 'png' : 'jpg'
    const folder = cloudKitchenIdentifier || 'cloud_kitchen'
    const baseName = `${cloudKitchenIdentifier || 'cloud_kitchen'}-${invoiceIdentifier}`

    const maxAttempts = 20
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`
      const path = `${folder}/${baseName}${suffix}.${extension}`

      const { error } = await supabase.storage.from('invoices').upload(path, file, {
        upsert: false
      })

      if (!error) {
        const { data: publicData } = supabase.storage.from('invoices').getPublicUrl(path)
        return publicData?.publicUrl || null
      }

      const message = (error.message || '').toLowerCase()
      const isConflict =
        error.status === 409 ||
        error.statusCode === '409' ||
        message.includes('already exists') ||
        message.includes('duplicate') ||
        message.includes('conflict')

      if (!isConflict) {
        throw error
      }
      // If conflict, try next suffix
    }

    throw new Error('Could not store invoice image because too many files share the same name.')
  }

  // Open add modal for purchase stock-in
  const openAddModal = (type = 'purchase') => {
    setStockInType(type)
    // Reset slip
    setPurchaseSlip({
      supplier_name: '',
      invoice_number: '',
      receipt_date: new Date().toISOString().split('T')[0],
      notes: ''
    })
    setInvoiceFile(null)
    setInvoiceFileError('')
    // Initialize with 3 empty rows
    const makeRow = () => ({
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      raw_material_id: null,
      material: null,
      quantity: '',
      unit_cost: 0,
      previous_cost: null,
      gst_percent: '',
      total_cost: 0
    })
    setPurchaseItems([makeRow(), makeRow(), makeRow()])
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
    setInvoiceFile(null)
    setInvoiceFileError('')
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

    // Validate purchase slip based on type
    if (stockInType === 'purchase') {
      if (!purchaseSlip.supplier_name?.trim()) {
        alert('Please select a supplier')
        finalizingRef.current = false
        setFinalizing(false)
        return
      }
      if (!purchaseSlip.invoice_number?.trim()) {
        alert('Please enter an invoice number')
        finalizingRef.current = false
        setFinalizing(false)
        return
      }
      if (!invoiceFile) {
        alert('Please upload an invoice image')
        finalizingRef.current = false
        setFinalizing(false)
        return
      }
      if (invoiceFileError) {
        alert(invoiceFileError || 'Please fix the invoice image before submitting.')
        finalizingRef.current = false
        setFinalizing(false)
        return
      }
    }
    
    if (!purchaseSlip.receipt_date) {
      alert('Please select a date')
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
      let invoiceImageUrl = null
      if (stockInType === 'purchase') {
        try {
          invoiceImageUrl = await uploadInvoiceImage(
            invoiceFile,
            session,
            purchaseSlip.invoice_number
          )
        } catch (uploadError) {
          console.error('Error uploading invoice image:', uploadError)
          alert(`Failed to upload invoice image: ${uploadError.message}`)
          finalizingRef.current = false
          setFinalizing(false)
          return
        }
      }

      const totalCost = calculateTotalCost()

      // Create stock_in record
      const { data: stockInData, error: stockInError } = await supabase
        .from('stock_in')
        .insert({
          cloud_kitchen_id: session.cloud_kitchen_id,
          received_by: session.id,
          receipt_date: purchaseSlip.receipt_date,
          supplier_name: stockInType === 'purchase' ? (purchaseSlip.supplier_name.trim() || null) : null,
          invoice_number: stockInType === 'purchase' ? (purchaseSlip.invoice_number.trim() || null) : null,
          total_cost: totalCost,
          notes: purchaseSlip.notes.trim() || null,
          stock_in_type: stockInType,
          invoice_image_url: invoiceImageUrl
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
        const gstPercent = parseFloat(item.gst_percent) || 0
        return {
          stock_in_id: stockInData.id,
          raw_material_id: item.raw_material_id,
          cloud_kitchen_id: session.cloud_kitchen_id,
          quantity_purchased: quantity,
          quantity_remaining: quantity, // Initially, all purchased quantity is remaining
          unit_cost: parseFloat(item.unit_cost),
          gst_percent: gstPercent
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
            gst_percent,
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

  // Helper to apply filters to a set of records
  // searchByMaterial: when true, also search within material names/codes in stock_in_batches
  const applyFilters = (records, searchTerm, itemCountFilter, costFilter, dateFilter, dateFrom, dateTo, searchByMaterial = false) => {
    return records.filter(record => {
      // Search filter
      if (searchTerm) {
        const lower = searchTerm.toLowerCase()
        let matches = false

        // For kitchen stock-in, allow searching by material name/code in batches
        if (searchByMaterial && Array.isArray(record.stock_in_batches)) {
          matches = record.stock_in_batches.some(batch => {
            const rm = batch.raw_materials
            if (!rm) return false
            const nameMatch = rm.name?.toLowerCase().includes(lower)
            const codeMatch = rm.code?.toLowerCase().includes(lower)
            return nameMatch || codeMatch
          })
        }

        // Always also allow invoice/supplier search
        if (!matches) {
          const invoiceMatch = record.invoice_number?.toLowerCase().includes(lower)
          const supplierMatch = record.supplier_name?.toLowerCase().includes(lower)
          matches = !!(invoiceMatch || supplierMatch)
        }

        if (!matches) return false
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
  }

  // Split records by type
  const purchaseRecords = stockInRecords.filter(
    record => !record.stock_in_type || record.stock_in_type === 'purchase'
  )
  const kitchenRecords = stockInRecords.filter(
    record => record.stock_in_type === 'kitchen'
  )

  // Apply filters per panel
  const purchaseFiltered = applyFilters(
    purchaseRecords,
    purchaseSearchTerm,
    purchaseItemCountFilter,
    purchaseCostFilter,
    purchaseDateFilter,
    purchaseDateFrom,
    purchaseDateTo
  )

  const kitchenFiltered = applyFilters(
    kitchenRecords,
    kitchenSearchTerm,
    kitchenItemCountFilter,
    kitchenCostFilter,
    kitchenDateFilter,
    kitchenDateFrom,
    kitchenDateTo,
    true
  )

  // Reset to page 1 when filters change (per panel)
  useEffect(() => {
    setPurchaseCurrentPage(1)
  }, [purchaseSearchTerm, purchaseItemCountFilter, purchaseCostFilter, purchaseDateFilter, purchaseDateFrom, purchaseDateTo])

  useEffect(() => {
    setKitchenCurrentPage(1)
  }, [kitchenSearchTerm, kitchenItemCountFilter, kitchenCostFilter, kitchenDateFilter, kitchenDateFrom, kitchenDateTo])

  // Pagination per panel
  const purchaseTotalPages = Math.ceil(purchaseFiltered.length / itemsPerPage) || 1
  const purchaseStartIndex = (purchaseCurrentPage - 1) * itemsPerPage
  const purchaseEndIndex = purchaseStartIndex + itemsPerPage
  const purchasePaginated = purchaseFiltered.slice(purchaseStartIndex, purchaseEndIndex)

  const kitchenTotalPages = Math.ceil(kitchenFiltered.length / itemsPerPage) || 1
  const kitchenStartIndex = (kitchenCurrentPage - 1) * itemsPerPage
  const kitchenEndIndex = kitchenStartIndex + itemsPerPage
  const kitchenPaginated = kitchenFiltered.slice(kitchenStartIndex, kitchenEndIndex)

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
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Stock In</h1>
            <p className="text-sm text-muted-foreground">Manage purchase and kitchen stock-in records</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => openAddModal('purchase')}
              className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200"
            >
              + Create Stock-In Invoice
            </button>
            <button
              onClick={() => openAddModal('kitchen')}
              className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200"
            >
              + Create Kitchen Stock-In
            </button>
          </div>
        </div>

        {/* Purchase & Kitchen Stock-In Panels */}
        <div className={`grid grid-cols-1 ${layoutMode === 'split' ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-6 transition-all duration-300`}>
          {/* Purchase Stock-In Panel */}
          {layoutMode !== 'kitchen-full' && (
          <div className={`bg-card border-2 border-border rounded-xl overflow-hidden transition-all duration-300 ${layoutMode === 'purchase-full' ? 'lg:col-span-1' : ''}`}>
            <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">Purchase Stock-In</h2>
                <span className="text-xs text-muted-foreground">
                  {purchaseRecords.length} record(s)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLayoutMode(layoutMode === 'purchase-full' ? 'split' : 'purchase-full')}
                className="hidden lg:inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all"
              >
                {layoutMode === 'purchase-full' ? 'Restore Split' : 'Maximize'}
              </button>
            </div>

            <div className="p-4 border-b border-border">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Search (Invoice # or Supplier)
                  </label>
                  <input
                    type="text"
                    placeholder="Search by invoice number or supplier name..."
                    value={purchaseSearchTerm}
                    onChange={(e) => setPurchaseSearchTerm(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Items
                    </label>
                    <select
                      value={purchaseItemCountFilter}
                      onChange={(e) => setPurchaseItemCountFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All</option>
                      <option value="1-5">1-5 items</option>
                      <option value="6-10">6-10 items</option>
                      <option value="11+">11+ items</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Total Cost
                    </label>
                    <select
                      value={purchaseCostFilter}
                      onChange={(e) => setPurchaseCostFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All</option>
                      <option value="0-1000">₹0 - ₹1,000</option>
                      <option value="1001-5000">₹1,001 - ₹5,000</option>
                      <option value="5001-10000">₹5,001 - ₹10,000</option>
                      <option value="10000+">₹10,000+</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Date Range
                    </label>
                    <select
                      value={purchaseDateFilter}
                      onChange={(e) => setPurchaseDateFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All Dates</option>
                      <option value="today">Today</option>
                      <option value="this-week">This Week</option>
                      <option value="this-month">This Month</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>
                  {purchaseDateFilter === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">
                          From
                        </label>
                        <input
                          type="date"
                          value={purchaseDateFrom}
                          onChange={(e) => setPurchaseDateFrom(e.target.value)}
                          className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">
                          To
                        </label>
                        <input
                          type="date"
                          value={purchaseDateTo}
                          onChange={(e) => setPurchaseDateTo(e.target.value)}
                          className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {(purchaseSearchTerm ||
                  purchaseItemCountFilter !== 'all' ||
                  purchaseCostFilter !== 'all' ||
                  purchaseDateFilter !== 'all') && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        setPurchaseSearchTerm('')
                        setPurchaseItemCountFilter('all')
                        setPurchaseCostFilter('all')
                        setPurchaseDateFilter('all')
                        setPurchaseDateFrom('')
                        setPurchaseDateTo('')
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
              {purchaseFiltered.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground">
                    {purchaseRecords.length === 0
                      ? 'No purchase stock-ins found.'
                      : 'No purchase stock-ins match your filters.'}
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
                          Supplier
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Invoice #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Items
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Total Cost
                        </th>
                        {layoutMode === 'purchase-full' && (
                          <>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Created At
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Notes
                            </th>
                          </>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchasePaginated.map((record) => (
                        <tr
                          key={record.id}
                          className="border-b border-border hover:bg-accent/5 transition-colors"
                        >
                          <td className="px-4 py-3 text-foreground text-sm">
                            {new Date(record.receipt_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm">
                            {record.supplier_name || '—'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                            {record.invoice_number || '—'}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm">
                            {record.stock_in_batches?.length || 0} item(s)
                          </td>
                          <td className="px-4 py-3 text-foreground font-semibold text-sm">
                            ₹{parseFloat(record.total_cost || 0).toFixed(2)}
                          </td>
                          {layoutMode === 'purchase-full' && (
                            <>
                              <td className="px-4 py-3 text-foreground text-xs">
                                {new Date(record.created_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-foreground text-sm">
                                {record.notes || '—'}
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openDetailsModal(record)}
                              className="text-accent hover:text-accent/80 font-semibold text-xs"
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {purchaseTotalPages > 1 && (
                    <div className="border-t border-border px-4 py-3 flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Showing {purchaseStartIndex + 1} to{' '}
                        {Math.min(purchaseEndIndex, purchaseFiltered.length)} of{' '}
                        {purchaseFiltered.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setPurchaseCurrentPage((prev) => Math.max(1, prev - 1))
                          }
                          disabled={purchaseCurrentPage === 1}
                          className="px-2 py-1 bg-input border border-border rounded-lg text-xs text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                        >
                          Previous
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: purchaseTotalPages }, (_, i) => i + 1).map(
                            (page) => (
                              <button
                                key={page}
                                onClick={() => setPurchaseCurrentPage(page)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                                  purchaseCurrentPage === page
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
                            setPurchaseCurrentPage((prev) =>
                              Math.min(purchaseTotalPages, prev + 1)
                            )
                          }
                          disabled={purchaseCurrentPage === purchaseTotalPages}
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

          {/* Kitchen Stock-In Panel */}
          {layoutMode !== 'purchase-full' && (
          <div className={`bg-card border-2 border-border rounded-xl overflow-hidden transition-all duration-300 ${layoutMode === 'kitchen-full' ? 'lg:col-span-1' : ''}`}>
            <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">Kitchen Stock-In</h2>
                <span className="text-xs text-muted-foreground">
                  {kitchenRecords.length} record(s)
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
                    Search (Material Name)
                  </label>
                  <input
                    type="text"
                    placeholder="Search by material name..."
                    value={kitchenSearchTerm}
                    onChange={(e) => setKitchenSearchTerm(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Items
                    </label>
                    <select
                      value={kitchenItemCountFilter}
                      onChange={(e) => setKitchenItemCountFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All</option>
                      <option value="1-5">1-5 items</option>
                      <option value="6-10">6-10 items</option>
                      <option value="11+">11+ items</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Total Cost
                    </label>
                    <select
                      value={kitchenCostFilter}
                      onChange={(e) => setKitchenCostFilter(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    >
                      <option value="all">All</option>
                      <option value="0-1000">₹0 - ₹1,000</option>
                      <option value="1001-5000">₹1,001 - ₹5,000</option>
                      <option value="5001-10000">₹5,001 - ₹10,000</option>
                      <option value="10000+">₹10,000+</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                </div>

                {(kitchenSearchTerm ||
                  kitchenItemCountFilter !== 'all' ||
                  kitchenCostFilter !== 'all' ||
                  kitchenDateFilter !== 'all') && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        setKitchenSearchTerm('')
                        setKitchenItemCountFilter('all')
                        setKitchenCostFilter('all')
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
                    {kitchenRecords.length === 0
                      ? 'No kitchen stock-ins found.'
                      : 'No kitchen stock-ins match your filters.'}
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
                          Items
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Total Cost
                        </th>
                        {layoutMode === 'kitchen-full' && (
                          <>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Created At
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                              Notes
                            </th>
                          </>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                          Actions
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
                            {new Date(record.receipt_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-foreground text-sm">
                            {record.stock_in_batches?.length || 0} item(s)
                          </td>
                          <td className="px-4 py-3 text-foreground font-semibold text-sm">
                            ₹{parseFloat(record.total_cost || 0).toFixed(2)}
                          </td>
                          {layoutMode === 'kitchen-full' && (
                            <>
                              <td className="px-4 py-3 text-foreground text-xs">
                                {new Date(record.created_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-foreground text-sm">
                                {record.notes || '—'}
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openDetailsModal(record)}
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
                    <div className="border-t border-border px-4 py-3 flex items-center justify-between">
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

        {/* Add Stock-In Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-foreground">
                  {stockInType === 'kitchen' ? 'New Kitchen Stock-In' : 'New Purchase Slip'}
                </h2>
                <button
                  onClick={closeAddModal}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Stock-In Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {stockInType === 'purchase' && (
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
                )}

                {stockInType === 'purchase' && (
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Invoice Number <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={purchaseSlip.invoice_number}
                      onChange={(e) => setPurchaseSlip({ ...purchaseSlip, invoice_number: e.target.value })}
                      className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                      placeholder="Invoice #"
                    />
                  </div>
                )}

                {stockInType === 'purchase' && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Invoice Image <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      onChange={handleInvoiceFileChange}
                      className="block w-full text-sm text-foreground file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-background hover:file:bg-accent/90"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Upload a clear photo or scan of the invoice (JPEG or PNG, max 5 MB).
                    </p>
                    {invoiceFile && !invoiceFileError && (
                      <p className="mt-1 text-xs text-foreground">
                        Selected: <span className="font-mono">{invoiceFile.name}</span>{' '}
                        ({(invoiceFile.size / (1024 * 1024)).toFixed(2)} MB)
                      </p>
                    )}
                    {invoiceFileError && (
                      <p className="mt-1 text-xs text-destructive">{invoiceFileError}</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    {stockInType === 'kitchen' ? 'Date' : 'Receipt Date'} <span className="text-destructive">*</span>
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

              {/* Add Items - Spreadsheet Style */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-foreground">Add Items</h3>
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
                        <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-24">GST (%)</th>
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
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.gst_percent ?? ''}
                              onChange={(e) => handleUpdateItem(index, 'gst_percent', e.target.value)}
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
                    if (stockInType === 'purchase' && !purchaseSlip.invoice_number?.trim()) {
                      alert('Please enter an invoice number')
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
                {selectedRecord.invoice_image_url && selectedRecord.stock_in_type === 'purchase' && (
                  <div className="mt-3">
                    <p className="text-sm text-muted-foreground mb-1">Invoice Image</p>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="max-h-64 max-w-full overflow-hidden rounded-lg border border-border bg-background">
                        <img
                          src={selectedRecord.invoice_image_url}
                          alt="Invoice"
                          className="max-h-64 w-full object-contain bg-background"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          window.open(selectedRecord.invoice_image_url, '_blank', 'noopener,noreferrer')
                        }
                        className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-background hover:bg-accent/90 transition-colors"
                      >
                        Open Full Image
                      </button>
                    </div>
                  </div>
                )}
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
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">GST (%)</th>
                          <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRecord.stock_in_batches.map((batch, index) => {
                          const qty = parseFloat(batch.quantity_purchased) || 0
                          const unit = parseFloat(batch.unit_cost || 0)
                          const gstPercent = parseFloat(batch.gst_percent || 0)
                          const base = qty * unit
                          const totalCost = base + (base * gstPercent / 100)
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
                              <td className="px-4 py-3 text-foreground">
                                {gstPercent.toFixed(2)}%
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
