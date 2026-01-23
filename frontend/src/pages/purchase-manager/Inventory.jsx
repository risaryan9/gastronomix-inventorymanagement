import { useState, useEffect } from 'react'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

// All available categories (matching Materials.jsx)
const CATEGORIES = [
  'Meat',
  'Grains',
  'Vegetables',
  'Oils',
  'Spices',
  'Dairy',
  'Packaging',
  'Sanitary',
  'Misc'
]

const Inventory = () => {
  const [inventory, setInventory] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockLevelFilter, setStockLevelFilter] = useState('all')
  const [editingItem, setEditingItem] = useState(null)
  const [editForm, setEditForm] = useState({ quantity: '' })
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [adjustmentForm, setAdjustmentForm] = useState({
    reason: '',
    details: ''
  })
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [alert, setAlert] = useState(null) // { type: 'error' | 'success' | 'warning', message: string }

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
        
        // Fetch inventory with raw_materials join
        const { data: inventoryData, error: inventoryError } = await supabase
          .from('inventory')
          .select(`
            *,
            raw_materials (
              id,
              name,
              code,
              unit,
              category,
              low_stock_threshold
            )
          `)
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)

        console.log('Inventory query result:', { inventoryData, inventoryError })

        if (inventoryError) {
          console.error('Error fetching inventory:', inventoryError)
          setAlert({ type: 'error', message: `Error fetching inventory: ${inventoryError.message}` })
          setLoading(false)
          return
        }

        if (!inventoryData || inventoryData.length === 0) {
          console.log('No inventory data returned')
          setInventory([])
          setMaterials([])
          setLoading(false)
          return
        }

        // Fetch stock_in_batches to calculate FIFO-based valuation
        const rawMaterialIds = inventoryData.map(item => item.raw_material_id)
        const { data: batchesData, error: batchesError } = await supabase
          .from('stock_in_batches')
          .select('raw_material_id, quantity_remaining, unit_cost')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .in('raw_material_id', rawMaterialIds)
          .gt('quantity_remaining', 0)

        // Calculate total value per material using FIFO (sum of quantity_remaining * unit_cost)
        const materialValuationMap = new Map()
        if (batchesData) {
          batchesData.forEach(batch => {
            const materialId = batch.raw_material_id
            const batchValue = parseFloat(batch.quantity_remaining) * parseFloat(batch.unit_cost)
            
            if (!materialValuationMap.has(materialId)) {
              materialValuationMap.set(materialId, {
                totalValue: 0,
                totalQuantity: 0,
                averageCost: 0
              })
            }
            
            const current = materialValuationMap.get(materialId)
            current.totalValue += batchValue
            current.totalQuantity += parseFloat(batch.quantity_remaining)
          })
          
          // Calculate average cost per unit for each material
          materialValuationMap.forEach((value, materialId) => {
            if (value.totalQuantity > 0) {
              value.averageCost = value.totalValue / value.totalQuantity
            }
          })
        }

        // Join inventory with FIFO-based valuation
        const inventoryWithMaterials = inventoryData.map(item => {
          const valuation = materialValuationMap.get(item.raw_material_id) || {
            totalValue: 0,
            totalQuantity: 0,
            averageCost: 0
          }
          
          return {
            ...item,
            fifo_total_value: valuation.totalValue,
            fifo_average_cost: valuation.averageCost
          }
        })

        // Sort by material name
        inventoryWithMaterials.sort((a, b) => {
          const nameA = a.raw_materials?.name || ''
          const nameB = b.raw_materials?.name || ''
          return nameA.localeCompare(nameB)
        })

        setInventory(inventoryWithMaterials)

        // Extract unique categories from materials
        const uniqueCategories = [...new Set(
          inventoryWithMaterials
            .map(item => item.raw_materials?.category)
            .filter(Boolean)
        )]
        setMaterials(uniqueCategories.length > 0 ? uniqueCategories : CATEGORIES)
      } catch (err) {
        console.error('Error fetching data:', err)
        setAlert({ type: 'error', message: 'Failed to fetch inventory data' })
      } finally {
        setLoading(false)
      }
    }

    fetchInventory()
  }, []) // Empty dependency array - only fetch once on mount

  // Open edit modal
  const openEditModal = (item) => {
    setEditingItem(item)
    setEditForm({
      quantity: parseFloat(item.quantity).toString()
    })
    setAdjustmentForm({
      reason: '',
      details: ''
    })
    setShowConfirmModal(false)
  }

  // Close edit modal
  const closeEditModal = () => {
    setEditingItem(null)
    setEditForm({ quantity: '' })
    setAdjustmentForm({
      reason: '',
      details: ''
    })
    setShowConfirmModal(false)
  }

  // Calculate adjustment type based on quantity change
  const calculateAdjustmentType = (newQty, oldQty) => {
    if (isNaN(newQty) || isNaN(oldQty)) return 'increment'
    return newQty > oldQty ? 'increment' : 'decrement'
  }

  // Handle quantity change and show confirmation
  const handleQuantityChange = () => {
    if (!editingItem) return
    
    const session = getSession()
    if (!session?.id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      return
    }

    const newQuantity = parseFloat(editForm.quantity)
    const oldQuantity = parseFloat(editingItem.quantity)

    if (isNaN(newQuantity) || newQuantity < 0) {
      setAlert({ type: 'error', message: 'Please enter a valid quantity (>= 0)' })
      return
    }

    if (newQuantity === oldQuantity) {
      setAlert({ type: 'warning', message: 'Quantity has not changed' })
      return
    }

    // Adjustment type will be calculated automatically in the confirmation modal
    // Show confirmation modal
    setShowConfirmModal(true)
  }

  // Confirm and update inventory
  const confirmUpdateInventory = async () => {
    if (!editingItem) return
    
    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      return
    }

    // Validate reason
    if (!adjustmentForm.reason || adjustmentForm.reason.trim() === '') {
      setAlert({ type: 'error', message: 'Please provide a reason for this inventory adjustment' })
      return
    }

    const newQuantity = parseFloat(editForm.quantity)
    const oldQuantity = parseFloat(editingItem.quantity)

    setUpdating(true)
    try {
      // Update inventory
      const { data: updatedData, error: updateError } = await supabase
        .from('inventory')
        .update({
          quantity: newQuantity,
          last_updated_at: new Date().toISOString(),
          updated_by: session.id
        })
        .eq('id', editingItem.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating inventory:', updateError)
        setAlert({ type: 'error', message: `Failed to update inventory: ${updateError.message}` })
        setUpdating(false)
        return
      }

      // Create audit log entry
      // Calculate adjustment type automatically
      const calculatedAdjustmentType = calculateAdjustmentType(newQuantity, oldQuantity)
      const adjustmentAmount = Math.abs(newQuantity - oldQuantity)
      const auditLogData = {
        user_id: session.id,
        action: `inventory_${calculatedAdjustmentType}`,
        entity_type: 'inventory',
        entity_id: editingItem.id,
        old_values: {
          quantity: oldQuantity,
          raw_material_id: editingItem.raw_material_id,
          cloud_kitchen_id: session.cloud_kitchen_id
        },
        new_values: {
          quantity: newQuantity,
          raw_material_id: editingItem.raw_material_id,
          cloud_kitchen_id: session.cloud_kitchen_id
        },
        ip_address: null, // Could be captured from request if available
        user_agent: navigator.userAgent || null
      }

      // Add reason and details to audit log
      auditLogData.old_values.reason = adjustmentForm.reason
      auditLogData.old_values.details = adjustmentForm.details || null
      auditLogData.old_values.adjustment_type = calculatedAdjustmentType
      auditLogData.old_values.adjustment_amount = adjustmentAmount

      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert(auditLogData)

      if (auditError) {
        console.error('Error creating audit log:', auditError)
        // Don't fail the update if audit log fails, but log it
      }

      // Update local state
      setInventory(prev => prev.map(item => 
        item.id === editingItem.id 
          ? { 
              ...item, 
              quantity: parseFloat(updatedData.quantity),
              last_updated_at: updatedData.last_updated_at,
              updated_by: updatedData.updated_by
            }
          : item
      ))

      setAlert({ type: 'success', message: 'Inventory updated successfully!' })
      closeEditModal()
    } catch (err) {
      console.error('Error updating inventory:', err)
      setAlert({ type: 'error', message: `Failed to update inventory: ${err.message}` })
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

    // Stock level filter - use low_stock_threshold from raw_materials
    let matchesStockLevel = true
    const lowStockThreshold = parseFloat(material.low_stock_threshold || 0)
    const quantity = parseFloat(item.quantity) || 0

    if (stockLevelFilter === 'low') {
      matchesStockLevel = quantity > 0 && quantity <= lowStockThreshold
    } else if (stockLevelFilter === 'out') {
      matchesStockLevel = quantity === 0
    } else if (stockLevelFilter === 'in') {
      matchesStockLevel = quantity > lowStockThreshold
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
    lowStockItems: inventory.filter(item => {
      const lowStockThreshold = parseFloat(item.raw_materials?.low_stock_threshold || 0)
      return item.quantity <= lowStockThreshold
    }).length,
    // Total value calculated from FIFO batches (quantity_remaining * unit_cost)
    totalValue: inventory.reduce((sum, item) => {
      // Use FIFO-based total value from stock_in_batches
      return sum + (item.fifo_total_value || 0)
    }, 0)
  }

  // Export functions
  const exportToCSV = () => {
    const session = getSession()
    const headers = ['Material Name', 'Code', 'Category', 'Quantity', 'Unit', 'Low Stock Threshold', 'Status', 'Avg Cost per Unit', 'Total Value (FIFO)']
    const rows = filteredInventory.map(item => {
      const material = item.raw_materials
      const lowStockThreshold = parseFloat(material?.low_stock_threshold || 0)
      const isLowStock = item.quantity > 0 && item.quantity <= lowStockThreshold
      const isOutOfStock = item.quantity === 0
      const status = isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock'
      const totalValue = item.fifo_total_value || 0
      const avgCost = item.fifo_average_cost || 0
      
      return [
        material?.name || 'N/A',
        material?.code || 'N/A',
        material?.category || 'N/A',
        parseFloat(item.quantity).toFixed(3),
        material?.unit || 'N/A',
        lowStockThreshold.toFixed(3),
        status,
        `₹${avgCost.toFixed(2)}`,
        `₹${totalValue.toFixed(2)}`
      ]
    })

    const csvContent = [
      ['Gastronomix Inventory Management - Inventory Report'],
      ['Generated:', new Date().toLocaleString()],
      ['Cloud Kitchen:', session?.cloud_kitchen_name || session?.cloud_kitchen_id || 'N/A'],
      ['User:', session?.full_name || 'N/A'],
      ['Role:', session?.role || 'N/A'],
      ['Email:', session?.email || 'N/A'],
      [],
      headers,
      ...rows
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `inventory_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportToExcel = () => {
    const session = getSession()
    const workbook = XLSX.utils.book_new()
    
    // Summary sheet
    const summaryData = [
      ['Gastronomix Inventory Management - Inventory Report'],
      ['Generated:', new Date().toLocaleString()],
      [],
      ['Cloud Kitchen Information'],
      ['Name:', session?.cloud_kitchen_name || 'N/A'],
      ['ID:', session?.cloud_kitchen_id || 'N/A'],
      [],
      ['User Information'],
      ['Name:', session?.full_name || 'N/A'],
      ['Role:', session?.role || 'N/A'],
      ['Email:', session?.email || 'N/A'],
      [],
      ['Summary Statistics'],
      ['Total Items:', stats.totalItems],
      ['Low Stock Items:', stats.lowStockItems],
      ['Total Inventory Value:', `₹${stats.totalValue.toFixed(2)}`]
    ]
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

    // Inventory data sheet
    const inventoryData = [
      ['Material Name', 'Code', 'Category', 'Quantity', 'Unit', 'Low Stock Threshold', 'Status', 'Avg Cost per Unit', 'Total Value (FIFO)'],
      ...filteredInventory.map(item => {
        const material = item.raw_materials
        const lowStockThreshold = parseFloat(material?.low_stock_threshold || 0)
        const isLowStock = item.quantity > 0 && item.quantity <= lowStockThreshold
        const isOutOfStock = item.quantity === 0
        const status = isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock'
        const totalValue = item.fifo_total_value || 0
        const avgCost = item.fifo_average_cost || 0
        
        return [
          material?.name || 'N/A',
          material?.code || 'N/A',
          material?.category || 'N/A',
          parseFloat(item.quantity).toFixed(3),
          material?.unit || 'N/A',
          lowStockThreshold.toFixed(3),
          status,
          avgCost,
          totalValue
        ]
      })
    ]
    const inventorySheet = XLSX.utils.aoa_to_sheet(inventoryData)
    XLSX.utils.book_append_sheet(workbook, inventorySheet, 'Inventory')

    XLSX.writeFile(workbook, `inventory_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const exportToPDF = () => {
    const session = getSession()
    setExporting(true)
    
    try {
      const doc = new jsPDF('p', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      let yPos = 20

      // Header with logo and title
      doc.setFontSize(20)
      doc.setFont(undefined, 'bold')
      doc.text('Gastronomix', pageWidth / 2, yPos, { align: 'center' })
      yPos += 8
      doc.setFontSize(14)
      doc.setFont(undefined, 'normal')
      doc.text('Inventory Management - Inventory Report', pageWidth / 2, yPos, { align: 'center' })
      yPos += 10

      // Report metadata
      doc.setFontSize(10)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos)
      yPos += 6

      // Cloud Kitchen Information
      doc.setFont(undefined, 'bold')
      doc.setFontSize(12)
      doc.text('Cloud Kitchen Information', 20, yPos)
      yPos += 7
      doc.setFont(undefined, 'normal')
      doc.setFontSize(10)
      doc.text(`Name: ${session?.cloud_kitchen_name || 'N/A'}`, 25, yPos)
      yPos += 5
      doc.text(`ID: ${session?.cloud_kitchen_id || 'N/A'}`, 25, yPos)
      yPos += 8

      // User Information
      doc.setFont(undefined, 'bold')
      doc.setFontSize(12)
      doc.text('User Information', 20, yPos)
      yPos += 7
      doc.setFont(undefined, 'normal')
      doc.setFontSize(10)
      doc.text(`Name: ${session?.full_name || 'N/A'}`, 25, yPos)
      yPos += 5
      doc.text(`Role: ${session?.role ? session.role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'N/A'}`, 25, yPos)
      yPos += 5
      doc.text(`Email: ${session?.email || 'N/A'}`, 25, yPos)
      yPos += 8

      // Summary Statistics
      doc.setFont(undefined, 'bold')
      doc.setFontSize(12)
      doc.text('Summary Statistics', 20, yPos)
      yPos += 7
      doc.setFont(undefined, 'normal')
      doc.setFontSize(10)
      doc.text(`Total Items: ${stats.totalItems}`, 25, yPos)
      yPos += 5
      doc.text(`Low Stock Items: ${stats.lowStockItems}`, 25, yPos)
      yPos += 5
      doc.text(`Total Inventory Value: ₹${stats.totalValue.toFixed(2)}`, 25, yPos)
      yPos += 10

      // Check if we need a new page
      if (yPos > pageHeight - 60) {
        doc.addPage()
        yPos = 20
      }

      // Inventory Table
      const tableData = filteredInventory.map(item => {
        const material = item.raw_materials
        const lowStockThreshold = parseFloat(material?.low_stock_threshold || 0)
        const isLowStock = item.quantity > 0 && item.quantity <= lowStockThreshold
        const isOutOfStock = item.quantity === 0
        const status = isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock'
        const totalValue = item.fifo_total_value || 0
        const avgCost = item.fifo_average_cost || 0
        
        return [
          material?.name || 'N/A',
          material?.code || 'N/A',
          material?.category || 'N/A',
          `${parseFloat(item.quantity).toFixed(3)} ${material?.unit || ''}`,
          lowStockThreshold.toFixed(3),
          status,
          `₹${avgCost.toFixed(2)}`,
          `₹${totalValue.toFixed(2)}`
        ]
      })

      autoTable(doc, {
        startY: yPos,
        head: [['Material Name', 'Code', 'Category', 'Quantity', 'Low Stock Threshold', 'Status', 'Avg Cost/Unit', 'Total Value (FIFO)']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 25 },
          2: { cellWidth: 25 },
          3: { cellWidth: 25 },
          4: { cellWidth: 30 },
          5: { cellWidth: 25 },
          6: { cellWidth: 25 },
          7: { cellWidth: 25 }
        },
        margin: { left: 20, right: 20 }
      })

      // Footer
      const finalY = doc.lastAutoTable.finalY || yPos
      doc.setFontSize(8)
      doc.text(
        `This report was generated on ${new Date().toLocaleString()} by ${session?.full_name || 'System'}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      )

      doc.save(`inventory_${new Date().toISOString().split('T')[0]}.pdf`)
      setShowExportModal(false)
      setAlert({ type: 'success', message: 'Inventory exported to PDF successfully!' })
    } catch (err) {
      console.error('Error exporting PDF:', err)
      setAlert({ type: 'error', message: 'Failed to export PDF. Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  const handleExport = (format) => {
    try {
      if (!filteredInventory || filteredInventory.length === 0) {
        setAlert({ type: 'warning', message: 'No inventory items to export. Please adjust your filters.' })
        return
      }

      switch (format) {
        case 'csv':
          exportToCSV()
          setShowExportModal(false)
          setAlert({ type: 'success', message: 'Inventory exported to CSV successfully!' })
          break
        case 'excel':
          exportToExcel()
          setShowExportModal(false)
          setAlert({ type: 'success', message: 'Inventory exported to Excel successfully!' })
          break
        case 'pdf':
          exportToPDF()
          break
        default:
          break
      }
    } catch (err) {
      console.error('Error in handleExport:', err)
      setAlert({ type: 'error', message: 'An error occurred during export. Please try again.' })
    }
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
              onClick={() => setShowExportModal(true)}
              className="bg-transparent text-accent font-semibold px-5 py-2.5 rounded-lg border-2 border-accent hover:bg-accent/10 transition-all touch-manipulation"
            >
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

                    const lowStockThreshold = parseFloat(material.low_stock_threshold || 0)
                    const isLowStock = item.quantity > 0 && item.quantity <= lowStockThreshold
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
                          {lowStockThreshold.toFixed(3)}
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
      {editingItem && !showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                Edit Inventory
              </h2>
              <button
                onClick={closeEditModal}
                className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
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
              <p className="text-xs text-muted-foreground mt-1">
                Current Quantity: <span className="font-semibold">{parseFloat(editingItem.quantity).toFixed(3)} {editingItem.raw_materials?.unit}</span>
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="quantity" className="block text-sm font-semibold text-foreground mb-2">
                  New Quantity ({editingItem.raw_materials?.unit})
                </label>
                <input
                  id="quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                  className="w-full bg-input border-2 border-border rounded-lg px-4 py-3.5 lg:py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
                  disabled={updating}
                />
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-3 mt-6">
              <button
                onClick={closeEditModal}
                disabled={updating}
                className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 lg:py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={handleQuantityChange}
                disabled={updating}
                className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 lg:py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && editingItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                Confirm Inventory Adjustment
              </h2>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                disabled={updating}
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Material Info */}
            <div className="mb-4 p-3 bg-accent/20 border border-accent rounded-lg">
              <p className="text-sm font-semibold text-foreground">{editingItem.raw_materials?.name}</p>
              <p className="text-xs text-muted-foreground">{editingItem.raw_materials?.code} • {editingItem.raw_materials?.unit}</p>
            </div>

            {/* Quantity Change Summary */}
            <div className="mb-4 p-3 bg-background border border-border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">Current Quantity</p>
                <p className="text-base font-bold text-foreground">
                  {parseFloat(editingItem.quantity).toFixed(3)} {editingItem.raw_materials?.unit}
                </p>
              </div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">New Quantity</p>
                <p className="text-base font-bold text-foreground">
                  {parseFloat(editForm.quantity).toFixed(3)} {editingItem.raw_materials?.unit}
                </p>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <p className="text-sm font-semibold text-foreground">
                  {calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment' ? 'Increase' : 'Decrease'}
                </p>
                <p className={`text-base font-bold ${
                  calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment' ? 'text-green-500' : 'text-destructive'
                }`}>
                  {calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment' ? '+' : '-'}
                  {Math.abs(parseFloat(editForm.quantity) - parseFloat(editingItem.quantity)).toFixed(3)} {editingItem.raw_materials?.unit}
                </p>
              </div>
            </div>

            {/* Adjustment Form */}
            <div className="mb-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Adjustment Type
                </label>
                <div className={`px-4 py-3 rounded-lg border-2 ${
                  calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment'
                    ? 'bg-green-500/20 border-green-500/50'
                    : 'bg-destructive/20 border-destructive/50'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">
                      {calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment' ? 'Increment' : 'Decrement'}
                    </span>
                    <span className={`text-sm font-bold ${
                      calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment'
                        ? 'text-green-500'
                        : 'text-destructive'
                    }`}>
                      {calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment' ? '↑' : '↓'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Automatically determined based on quantity change
                  </p>
                </div>
              </div>

              <div>
                <label htmlFor="reason" className="block text-sm font-semibold text-foreground mb-2">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="reason"
                  rows={3}
                  value={adjustmentForm.reason}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })}
                  className="w-full bg-input border-2 border-border rounded-lg px-4 py-3.5 lg:py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base resize-none"
                  placeholder="Please provide a reason for this inventory adjustment..."
                  disabled={updating}
                  required
                />
              </div>

              <div>
                <label htmlFor="details" className="block text-sm font-semibold text-foreground mb-2">
                  Additional Details
                </label>
                <textarea
                  id="details"
                  rows={3}
                  value={adjustmentForm.details}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, details: e.target.value })}
                  className="w-full bg-input border-2 border-border rounded-lg px-4 py-3.5 lg:py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base resize-none"
                  placeholder="Any additional details or notes..."
                  disabled={updating}
                />
              </div>
            </div>

            {/* Warning Message */}
            <div className="mb-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
              <p className="text-xs lg:text-sm text-foreground">
                <span className="font-semibold">⚠️ Warning:</span> This will {calculateAdjustmentType(parseFloat(editForm.quantity), parseFloat(editingItem.quantity)) === 'increment' ? 'increase' : 'decrease'} the inventory quantity. This action will be logged in the audit trail.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col lg:flex-row gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={updating}
                className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 lg:py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpdateInventory}
                disabled={updating || !adjustmentForm.reason.trim()}
                className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 lg:py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation"
              >
                {updating ? 'Updating...' : 'Confirm & Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                Export Inventory
              </h2>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                disabled={exporting}
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              Choose a format to export your inventory data. The export will include all filtered items.
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting}
                className="w-full bg-accent text-background font-bold px-4 py-3.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export as CSV
              </button>

              <button
                onClick={() => handleExport('excel')}
                disabled={exporting}
                className="w-full bg-green-500 text-white font-bold px-4 py-3.5 rounded-xl border-3 border-green-500 shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export as Excel
              </button>

              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting}
                className="w-full bg-red-500 text-white font-bold px-4 py-3.5 rounded-xl border-3 border-red-500 shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation flex items-center justify-center gap-2"
              >
                {exporting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Export as PDF
                  </>
                )}
              </button>
            </div>

            <button
              onClick={() => setShowExportModal(false)}
              disabled={exporting}
              className="w-full mt-4 bg-transparent text-foreground font-semibold px-4 py-3.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
            >
              Cancel
            </button>
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

export default Inventory
