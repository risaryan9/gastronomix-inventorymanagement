import { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
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
  const [allocationRows, setAllocationRows] = useState([])
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [openDropdownRow, setOpenDropdownRow] = useState(-1)
  const [dropdownSearchTerm, setDropdownSearchTerm] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const dropdownSearchRef = useRef(null)
  const [requesting, setRequesting] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [alert, setAlert] = useState(null) // { type: 'error' | 'success' | 'warning', message: string }
  const [editingRequest, setEditingRequest] = useState(null) // The allocation request being edited

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

  // Check if there's an existing allocation request for today with is_packed = false
  const existingTodayRequest = allocationRequests.find(request => {
    const today = new Date().toISOString().split('T')[0]
    const requestDate = new Date(request.request_date).toISOString().split('T')[0]
    return requestDate === today && !request.is_packed
  })

  const getSelectedItemsForSubmit = () =>
    allocationRows
      .filter(r => r.raw_material_id && r.material)
      .map(r => ({
        raw_material_id: r.raw_material_id,
        name: r.material.name,
        code: r.material.code,
        unit: r.material.unit,
        requested_quantity: r.quantity
      }))

  const handleAllocate = () => {
    if (existingTodayRequest) {
      handleEditRequest(existingTodayRequest)
    } else {
      setShowAllocateModal(true)
      setAllocationRows([])
      setSelectedRows(new Set())
      setOpenDropdownRow(-1)
      setEditingRequest(null)
    }
  }

  const handleEditRequest = (request) => {
    setEditingRequest(request)
    const rows = request.allocation_request_items.map(item => ({
      id: `row-${item.id}`,
      raw_material_id: item.raw_materials.id,
      material: item.raw_materials,
      quantity: parseFloat(item.quantity).toString()
    }))
    setAllocationRows(rows)
    setShowAllocateModal(true)
    setSelectedRows(new Set())
  }

  const getFilteredMaterialsForRow = (rowIndex) => {
    const search = openDropdownRow === rowIndex ? dropdownSearchTerm : ''
    const usedIds = allocationRows.filter((r, i) => i !== rowIndex && r.raw_material_id).map(r => r.raw_material_id)
    return rawMaterials.filter(m => {
      if (usedIds.includes(m.id)) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return m.name.toLowerCase().includes(q) || (m.code || '').toLowerCase().includes(q)
    })
  }

  const handleAddRow = () => {
    const rowId = `row-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setAllocationRows(prev => [...prev, { id: rowId, raw_material_id: null, material: null, quantity: '' }])
  }

  const handleSelectMaterial = (rowIndex, material) => {
    setAllocationRows(prev => {
      const updated = [...prev]
      updated[rowIndex] = { ...updated[rowIndex], raw_material_id: material.id, material, quantity: updated[rowIndex].quantity || '' }
      return updated
    })
    setOpenDropdownRow(-1)
    setDropdownSearchTerm('')
  }

  const handleRemoveRow = (index) => {
    setAllocationRows(prev => prev.filter((_, i) => i !== index))
    setSelectedRows(prev => { const n = new Set(prev); n.delete(index); return n })
  }

  const handleToggleRowSelect = (index) => {
    setSelectedRows(prev => {
      const n = new Set(prev)
      if (n.has(index)) n.delete(index)
      else n.add(index)
      return n
    })
  }

  const handleToggleSelectAll = (checked) => {
    setSelectedRows(checked ? new Set(allocationRows.map((_, i) => i)) : new Set())
  }

  const handleRemoveSelectedRows = () => {
    if (selectedRows.size === 0) return
    setAllocationRows(prev => prev.filter((_, i) => !selectedRows.has(i)))
    setSelectedRows(new Set())
  }

  const handleUpdateQuantity = (index, quantity) => {
    setAllocationRows(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], quantity }
      return updated
    })
  }

  const handleFinalizeAllocation = () => {
    const items = getSelectedItemsForSubmit()
    if (items.length === 0) {
      setAlert({ type: 'warning', message: 'Please add at least one item with a material selected' })
      return
    }
    const materialIds = items.map(item => item.raw_material_id)
    if (materialIds.length !== new Set(materialIds).size) {
      setAlert({ type: 'error', message: 'Duplicate materials detected. Please remove duplicates before proceeding.' })
      return
    }
    for (const item of items) {
      const qty = parseFloat(item.requested_quantity)
      if (isNaN(qty) || qty <= 0) {
        setAlert({ type: 'error', message: `Please enter a valid quantity for ${item.name}` })
        return
      }
    }
    setShowConfirmModal(true)
  }

  const confirmAllocation = async () => {
    const session = getSession()
    if (!session?.id || !session?.cloud_kitchen_id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      return
    }

    const selectedItems = getSelectedItemsForSubmit()
    setRequesting(true)
    setShowConfirmModal(false)
    try {
      if (editingRequest) {
        const materialIds = selectedItems.map(item => item.raw_material_id)
        const uniqueMaterialIds = new Set(materialIds)
        if (materialIds.length !== uniqueMaterialIds.size) {
          throw new Error('Duplicate materials detected. Please remove duplicates.')
        }

        // Update existing allocation request
        const { error: updateError } = await supabase
          .from('allocation_requests')
          .update({
            notes: editingRequest.notes // Preserve notes if any
          })
          .eq('id', editingRequest.id)

        if (updateError) throw updateError

        // Get existing items from the request
        const existingItems = editingRequest.allocation_request_items || []
        const existingItemsMap = new Map(
          existingItems.map(item => [item.raw_materials.id, item])
        )

        // Create maps for efficient lookup
        const newItemsMap = new Map(
          selectedItems.map(item => [item.raw_material_id, item])
        )

        // Separate items into: update, insert, and delete
        const itemsToUpdate = []
        const itemsToInsert = []
        const itemsToDelete = []

        // Check each existing item
        existingItems.forEach(existingItem => {
          const materialId = existingItem.raw_materials.id
          const newItem = newItemsMap.get(materialId)

          if (newItem) {
            // Item exists in both - check if quantity changed (use tolerance for floating point)
            const existingQty = parseFloat(existingItem.quantity)
            const newQty = parseFloat(newItem.requested_quantity)
            // Compare with small tolerance for floating point precision
            if (Math.abs(existingQty - newQty) > 0.0001) {
              itemsToUpdate.push({
                id: existingItem.id,
                quantity: newQty
              })
            }
            // If quantity is same, no update needed
          } else {
            // Item exists in old but not in new - delete it
            itemsToDelete.push(existingItem.id)
          }
        })

        // Check for new items that don't exist in old
        selectedItems.forEach(newItem => {
          if (!existingItemsMap.has(newItem.raw_material_id)) {
            itemsToInsert.push({
              allocation_request_id: editingRequest.id,
              raw_material_id: newItem.raw_material_id,
              quantity: parseFloat(newItem.requested_quantity)
            })
          }
        })

        console.log('Update operations:', {
          itemsToUpdate,
          itemsToInsert,
          itemsToDelete,
          existingItems: existingItems.map(i => ({ id: i.id, material: i.raw_materials.id, qty: i.quantity })),
          selectedItems: selectedItems.map(i => ({ material: i.raw_material_id, qty: i.requested_quantity }))
        })

        // Perform updates, deletes, and inserts
        // Update existing items
        if (itemsToUpdate.length > 0) {
          for (const item of itemsToUpdate) {
            console.log('Updating item:', item.id, 'with quantity:', item.quantity)
            const { data, error } = await supabase
              .from('allocation_request_items')
              .update({ quantity: item.quantity })
              .eq('id', item.id)
              .select()
            
            console.log('Update result:', { data, error })
            if (error) throw error
            if (!data || data.length === 0) {
              console.warn('Update returned no rows for item:', item.id)
            }
          }
        }

        // Delete removed items
        if (itemsToDelete.length > 0) {
          console.log('Deleting items:', itemsToDelete)
          const { data, error: deleteError } = await supabase
            .from('allocation_request_items')
            .delete()
            .in('id', itemsToDelete)
            .select()
          
          console.log('Delete result:', { data, error: deleteError })
          if (deleteError) throw deleteError
        }

        // Insert new items
        if (itemsToInsert.length > 0) {
          console.log('Inserting items:', itemsToInsert)
          const { data, error: insertError } = await supabase
            .from('allocation_request_items')
            .insert(itemsToInsert)
            .select()
          
          console.log('Insert result:', { data, error: insertError })
          if (insertError) throw insertError
        }

        setAlert({ type: 'success', message: 'Allocation request updated successfully!' })
        // Refresh the allocation requests to show updated data
        await fetchAllocationRequests()
      } else {
        // Validate no duplicate materials before proceeding
        const materialIds = selectedItems.map(item => item.raw_material_id)
        const uniqueMaterialIds = new Set(materialIds)
        if (materialIds.length !== uniqueMaterialIds.size) {
          throw new Error('Duplicate materials detected. Please remove duplicates.')
        }

        // Create new allocation request
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

        // Remove any duplicate materials from selectedItems before inserting
        const uniqueItems = selectedItems.filter((item, index, self) =>
          index === self.findIndex(t => t.raw_material_id === item.raw_material_id)
        )

        // Create allocation request items
        const allocationRequestItems = uniqueItems.map(item => ({
          allocation_request_id: allocationRequest.id,
          raw_material_id: item.raw_material_id,
          quantity: parseFloat(item.requested_quantity)
        }))

        const { error: itemsError } = await supabase
          .from('allocation_request_items')
          .insert(allocationRequestItems)

        if (itemsError) throw itemsError

        setAlert({ type: 'success', message: 'Allocation request created successfully!' })
      }

      setShowAllocateModal(false)
      setAllocationRows([])
      setEditingRequest(null)
      fetchAllocationRequests()
    } catch (err) {
      console.error('Error saving allocation request:', err)
      setAlert({ type: 'error', message: `Failed to save allocation request: ${err.message}` })
    } finally {
      setRequesting(false)
    }
  }

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
          onClick={() => navigate('/invmanagement/dashboard/supervisor/outlets')}
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
            className={`w-full lg:w-auto font-bold px-6 py-4 lg:py-3 rounded-xl border-3 transition-all duration-200 text-base touch-manipulation ${
              existingTodayRequest && !existingTodayRequest.is_packed
                ? 'bg-yellow-500 text-black border-yellow-500 shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em]'
                : 'bg-accent text-background border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em]'
            }`}
          >
            {existingTodayRequest && !existingTodayRequest.is_packed
              ? 'Edit Today\'s Allocation Request'
              : '+ Create Allocation Request'}
          </button>
          {existingTodayRequest && !existingTodayRequest.is_packed && (
            <p className="text-xs text-muted-foreground mt-2">
              You already have an allocation request for today. Click the button above to edit it.
            </p>
          )}
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

                  {/* Edit Button - only show if not packed and is today's request */}
                  {!request.is_packed && (() => {
                    const today = new Date().toISOString().split('T')[0]
                    const requestDate = new Date(request.request_date).toISOString().split('T')[0]
                    if (requestDate === today) {
                      return (
                        <div className="mt-4 pt-4 border-t border-border">
                          <button
                            onClick={() => handleEditRequest(request)}
                            className="w-full bg-accent text-background font-semibold px-4 py-2.5 rounded-lg border-2 border-accent hover:bg-accent/90 transition-all text-sm touch-manipulation"
                          >
                            Edit Request
                          </button>
                        </div>
                      )
                    }
                    return null
                  })()}
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
                {editingRequest ? 'Edit Allocation Request' : 'Create Allocation Request'}
              </h2>
              <button
                onClick={() => {
                  setShowAllocateModal(false)
                  setEditingRequest(null)
                  setAllocationRows([])
                }}
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

            <p className="text-sm text-muted-foreground mb-3">
              If the material you're looking for isn't listed, please contact the <strong>Purchase Manager</strong> to add it first, then come back here.
            </p>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
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
                  disabled={requesting}
                  className="ml-auto px-4 py-2 bg-accent text-background font-bold rounded-lg hover:bg-accent/90 transition-all text-sm disabled:opacity-50"
                >
                  + Add Row
                </button>
              </div>

              <div className="overflow-x-auto border-2 border-border rounded-xl">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="bg-background border-b-2 border-border select-none">
                      <th className="px-3 py-2 w-10"></th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-foreground">Name</th>
                      <th className="px-3 py-2 text-left text-sm font-bold text-foreground w-32">Quantity</th>
                      <th className="px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocationRows.map((row, index) => (
                      <tr
                        key={row.id || index}
                        className={`border-b border-border hover:bg-accent/5 ${selectedRows.has(index) ? 'bg-accent/10' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedRows.has(index)}
                            onChange={() => handleToggleRowSelect(index)}
                            className="rounded border-border"
                            disabled={requesting}
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
                              disabled={requesting}
                              className="w-full text-left px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm truncate disabled:opacity-50"
                            >
                              {row.material ? (
                                <span>{row.material.name} <span className="text-muted-foreground text-xs">({row.material.unit})</span></span>
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
                            min="0.001"
                            step="0.001"
                            value={row.quantity}
                            onChange={(e) => handleUpdateQuantity(index, e.target.value)}
                            placeholder="0"
                            disabled={requesting || !row.material}
                            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(index)}
                            disabled={requesting}
                            className="text-destructive hover:text-destructive/80 p-1 disabled:opacity-50"
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
              {allocationRows.length === 0 && (
                <p className="text-sm text-muted-foreground mt-3">
                  Click <strong>Add Row</strong> to add items. Select material from dropdown, then enter quantity.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col lg:flex-row gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAllocateModal(false)
                  setEditingRequest(null)
                  setAllocationRows([])
                }}
                disabled={requesting}
                className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 lg:py-2.5 rounded-lg border-2 border-border hover:bg-accent/10 transition-all disabled:opacity-50 text-base touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={handleFinalizeAllocation}
                disabled={requesting || getSelectedItemsForSubmit().length === 0}
                className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 lg:py-2.5 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-base touch-manipulation"
              >
                {requesting 
                  ? (editingRequest ? 'Updating Request...' : 'Creating Request...')
                  : (editingRequest ? 'Update Request' : 'Create Request')}
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
                {editingRequest ? 'Confirm Update' : 'Confirm Allocation Request'}
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
                Request Summary ({getSelectedItemsForSubmit().length} item{getSelectedItemsForSubmit().length !== 1 ? 's' : ''})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {getSelectedItemsForSubmit().map((item) => (
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
                {requesting 
                  ? (editingRequest ? 'Updating Request...' : 'Creating Request...')
                  : (editingRequest ? 'Confirm & Update Request' : 'Confirm & Create Request')}
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
