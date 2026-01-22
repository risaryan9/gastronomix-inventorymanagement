import { useState, useEffect } from 'react'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

// All available categories
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

const RawMaterials = () => {
  const [rawMaterials, setRawMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'active', 'inactive'
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [alert, setAlert] = useState(null)

  // Fetch raw materials
  useEffect(() => {
    const fetchRawMaterials = async () => {
      try {
        setLoading(true)
        
        const { data, error } = await supabase
          .from('raw_materials')
          .select('*')
          .order('name', { ascending: true })

        if (error) {
          console.error('Error fetching raw materials:', error)
          setAlert({ type: 'error', message: `Error fetching raw materials: ${error.message}` })
          setLoading(false)
          return
        }

        setRawMaterials(data || [])
      } catch (err) {
        console.error('Error fetching data:', err)
        setAlert({ type: 'error', message: 'Failed to fetch raw materials' })
      } finally {
        setLoading(false)
      }
    }

    fetchRawMaterials()
  }, [])

  // Filter raw materials
  const filteredMaterials = rawMaterials.filter(material => {
    // Search filter
    const matchesSearch = searchTerm === '' || 
      material.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      material.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (material.description && material.description.toLowerCase().includes(searchTerm.toLowerCase()))

    // Category filter
    const matchesCategory = categoryFilter === 'all' || material.category === categoryFilter

    // Status filter
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'active' && material.is_active) ||
      (statusFilter === 'inactive' && !material.is_active)

    return matchesSearch && matchesCategory && matchesStatus
  })

  // Pagination calculations
  const totalPages = Math.ceil(filteredMaterials.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedMaterials = filteredMaterials.slice(startIndex, endIndex)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, categoryFilter, statusFilter])

  // Calculate stats
  const stats = {
    totalItems: rawMaterials.length,
    activeItems: rawMaterials.filter(item => item.is_active).length,
    inactiveItems: rawMaterials.filter(item => !item.is_active).length,
  }

  // Export functions
  const exportToCSV = () => {
    const session = getSession()
    const headers = ['Name', 'Code', 'Category', 'Unit', 'Description', 'Low Stock Threshold', 'Status']
    const rows = filteredMaterials.map(material => {
      return [
        material.name || 'N/A',
        material.code || 'N/A',
        material.category || 'N/A',
        material.unit || 'N/A',
        material.description || 'N/A',
        parseFloat(material.low_stock_threshold || 0).toFixed(3),
        material.is_active ? 'Active' : 'Inactive'
      ]
    })

    const csvContent = [
      ['Gastronomix Inventory Management - Raw Materials Report'],
      ['Generated:', new Date().toLocaleString()],
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
    link.setAttribute('download', `raw_materials_${new Date().toISOString().split('T')[0]}.csv`)
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
      ['Gastronomix Inventory Management - Raw Materials Report'],
      ['Generated:', new Date().toLocaleString()],
      [],
      ['User Information'],
      ['Name:', session?.full_name || 'N/A'],
      ['Role:', session?.role || 'N/A'],
      ['Email:', session?.email || 'N/A'],
      [],
      ['Summary Statistics'],
      ['Total Items:', stats.totalItems],
      ['Active Items:', stats.activeItems],
      ['Inactive Items:', stats.inactiveItems]
    ]
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

    // Raw materials data sheet
    const materialsData = [
      ['Name', 'Code', 'Category', 'Unit', 'Description', 'Low Stock Threshold', 'Status'],
      ...filteredMaterials.map(material => {
        return [
          material.name || 'N/A',
          material.code || 'N/A',
          material.category || 'N/A',
          material.unit || 'N/A',
          material.description || 'N/A',
          parseFloat(material.low_stock_threshold || 0).toFixed(3),
          material.is_active ? 'Active' : 'Inactive'
        ]
      })
    ]
    const materialsSheet = XLSX.utils.aoa_to_sheet(materialsData)
    XLSX.utils.book_append_sheet(workbook, materialsSheet, 'Raw Materials')

    XLSX.writeFile(workbook, `raw_materials_${new Date().toISOString().split('T')[0]}.xlsx`)
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
      doc.text('Inventory Management - Raw Materials Report', pageWidth / 2, yPos, { align: 'center' })
      yPos += 10

      // Report metadata
      doc.setFontSize(10)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos)
      yPos += 6

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
      doc.text(`Active Items: ${stats.activeItems}`, 25, yPos)
      yPos += 5
      doc.text(`Inactive Items: ${stats.inactiveItems}`, 25, yPos)
      yPos += 10

      // Check if we need a new page
      if (yPos > pageHeight - 60) {
        doc.addPage()
        yPos = 20
      }

      // Raw Materials Table
      const tableData = filteredMaterials.map(material => {
        return [
          material.name || 'N/A',
          material.code || 'N/A',
          material.category || 'N/A',
          material.unit || 'N/A',
          (material.description || 'N/A').substring(0, 30),
          parseFloat(material.low_stock_threshold || 0).toFixed(3),
          material.is_active ? 'Active' : 'Inactive'
        ]
      })

      autoTable(doc, {
        startY: yPos,
        head: [['Name', 'Code', 'Category', 'Unit', 'Description', 'Low Stock Threshold', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 25 },
          2: { cellWidth: 25 },
          3: { cellWidth: 20 },
          4: { cellWidth: 40 },
          5: { cellWidth: 30 },
          6: { cellWidth: 25 }
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

      doc.save(`raw_materials_${new Date().toISOString().split('T')[0]}.pdf`)
      setShowExportModal(false)
      setAlert({ type: 'success', message: 'Raw materials exported to PDF successfully!' })
    } catch (err) {
      console.error('Error exporting PDF:', err)
      setAlert({ type: 'error', message: 'Failed to export PDF. Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  const handleExport = (format) => {
    if (filteredMaterials.length === 0) {
      setAlert({ type: 'warning', message: 'No raw materials to export' })
      return
    }

    switch (format) {
      case 'csv':
        exportToCSV()
        setShowExportModal(false)
        setAlert({ type: 'success', message: 'Raw materials exported to CSV successfully!' })
        break
      case 'excel':
        exportToExcel()
        setShowExportModal(false)
        setAlert({ type: 'success', message: 'Raw materials exported to Excel successfully!' })
        break
      case 'pdf':
        exportToPDF()
        break
      default:
        break
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading raw materials...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header - Mobile First: Stack on mobile */}
        <div className="flex flex-col gap-3 mb-4 lg:mb-6 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-xl lg:text-3xl font-bold text-foreground">Raw Materials</h1>
          <div className="flex gap-2 w-full lg:w-auto">
            <button 
              onClick={() => setShowExportModal(true)}
              className="flex-1 lg:flex-none bg-transparent text-accent font-semibold px-4 py-3.5 lg:px-5 lg:py-2.5 rounded-lg border-2 border-accent hover:bg-accent/10 transition-all text-sm lg:text-base touch-manipulation"
            >
              Export
            </button>
          </div>
        </div>

        {/* Quick Stats - Single line on all screen sizes */}
        <div className="grid grid-cols-3 gap-2 lg:gap-4 mb-4 lg:mb-6">
          <div className="bg-card border-2 border-border rounded-xl p-2 lg:p-5">
            <p className="text-xs text-muted-foreground font-semibold mb-1">Total Items</p>
            <p className="text-lg lg:text-3xl font-bold text-foreground">{stats.totalItems}</p>
          </div>
          <div className="bg-card border-2 border-border rounded-xl p-2 lg:p-5">
            <p className="text-xs text-muted-foreground font-semibold mb-1">Active Items</p>
            <p className="text-lg lg:text-3xl font-bold text-green-500">{stats.activeItems}</p>
          </div>
          <div className="bg-card border-2 border-border rounded-xl p-2 lg:p-5">
            <p className="text-xs text-muted-foreground font-semibold mb-1">Inactive Items</p>
            <p className="text-lg lg:text-3xl font-bold text-muted-foreground">{stats.inactiveItems}</p>
          </div>
        </div>
        
        {/* Search and Filter - Mobile First: Stack on mobile */}
        <div className="bg-card border-2 border-border rounded-xl p-3 lg:p-4 mb-4 lg:mb-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:gap-3">
            <input
              type="text"
              placeholder="Search by name, code, or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-4 py-3 lg:py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
            />
            <select 
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-4 py-3 lg:py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-4 py-3 lg:py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {/* Raw Materials - Mobile First: Cards on mobile, Table on desktop */}
        <div className="bg-card border-2 border-border rounded-xl overflow-hidden">
          {filteredMaterials.length === 0 ? (
            <div className="text-center py-12 lg:py-16 px-4">
              <h3 className="text-lg lg:text-xl font-bold text-foreground mb-2">No raw materials found</h3>
              <p className="text-sm lg:text-base text-muted-foreground">
                {rawMaterials.length === 0 
                  ? 'No raw materials available.'
                  : 'No items match your current filters.'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card Layout */}
              <div className="lg:hidden divide-y divide-border">
                {paginatedMaterials.map((material) => (
                  <div key={material.id} className="p-4 hover:bg-accent/5 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold text-foreground mb-1 truncate">{material.name}</h3>
                        <p className="text-xs text-muted-foreground">{material.code} • {material.category || 'N/A'}</p>
                      </div>
                      {material.is_active ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-green-500/20 text-green-500 text-xs font-bold ml-2">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-muted-foreground/20 text-muted-foreground text-xs font-bold ml-2">
                          Inactive
                        </span>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Unit</p>
                        <p className="text-base font-semibold text-foreground">{material.unit}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Low Stock Threshold</p>
                        <p className="text-base font-semibold text-foreground">
                          {parseFloat(material.low_stock_threshold || 0).toFixed(3)} {material.unit}
                        </p>
                      </div>
                    </div>
                    
                    {material.description && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Description</p>
                        <p className="text-sm text-foreground">{material.description}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop Table Layout */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-background border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Name</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Code</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Category</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Unit</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Description</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Low Stock Threshold</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMaterials.map((material) => (
                      <tr 
                        key={material.id} 
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
                        <td className="px-4 py-3 text-muted-foreground">
                          {material.unit}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {material.description || 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {parseFloat(material.low_stock_threshold || 0).toFixed(3)} {material.unit}
                        </td>
                        <td className="px-4 py-3">
                          {material.is_active ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-green-500/20 text-green-500 text-xs font-bold">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-muted-foreground/20 text-muted-foreground text-xs font-bold">
                              Inactive
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination - Mobile First: Simplified on mobile */}
              {totalPages > 1 && (
                <div className="border-t border-border px-3 lg:px-4 py-3 lg:py-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="text-xs lg:text-sm text-muted-foreground text-center lg:text-left">
                      Showing {startIndex + 1} to {Math.min(endIndex, filteredMaterials.length)} of {filteredMaterials.length} items
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2.5 lg:px-3 lg:py-2 bg-input border border-border rounded-lg text-foreground hover:bg-accent/10 active:bg-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm touch-manipulation"
                      >
                        Previous
                      </button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                          let page
                          if (totalPages <= 5) {
                            page = i + 1
                          } else if (currentPage <= 3) {
                            page = i + 1
                          } else if (currentPage >= totalPages - 2) {
                            page = totalPages - 4 + i
                          } else {
                            page = currentPage - 2 + i
                          }
                          return (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`px-3 py-2 rounded-lg font-semibold transition-all text-sm touch-manipulation ${
                                currentPage === page
                                  ? 'bg-accent text-background'
                                  : 'bg-input border border-border text-foreground hover:bg-accent/10 active:bg-accent/20'
                              }`}
                            >
                              {page}
                            </button>
                          )
                        })}
                      </div>
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2.5 lg:px-3 lg:py-2 bg-input border border-border rounded-lg text-foreground hover:bg-accent/10 active:bg-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm touch-manipulation"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                Export Raw Materials
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
              Choose a format to export your raw materials data. The export will include all filtered items.
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

export default RawMaterials
