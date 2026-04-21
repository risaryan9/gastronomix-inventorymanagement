import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { fetchOutletAllocationRequests, fetchTodayAllocationStatus, getLocalDateString } from '../../lib/allocationRequests'
import nippuKodiLogo from '../../assets/nippu-kodi-logo.png'
import elChaapoLogo from '../../assets/el-chaapo-logo.png'
import boomPizzaLogo from '../../assets/boom-pizza-logo.png'

const BRANDS = [
  { id: 'NK', name: 'Nippu Kodi', color: 'bg-black', hoverColor: 'hover:bg-gray-900', logo: nippuKodiLogo },
  { id: 'EC', name: 'El Chaapo', color: 'bg-green-500', hoverColor: 'hover:bg-green-600', logo: elChaapoLogo },
  { id: 'BP', name: 'Boom Pizza', color: 'bg-red-500', hoverColor: 'hover:bg-red-600', logo: boomPizzaLogo },
]

const makeEmptyAllocationRow = () => ({
  id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  raw_material_id: null,
  material: null,
  quantity: ''
})

const normalizeBrandCodes = (brandCodes) => {
  if (Array.isArray(brandCodes)) return brandCodes.map(code => String(code).toLowerCase().trim()).filter(Boolean)
  if (typeof brandCodes === 'string' && brandCodes.trim()) {
    return brandCodes
      .toLowerCase()
      .replace(/[\[\]"']/g, ' ')
      .split(/[\s,]+/)
      .map(code => code.trim())
      .filter(code => ['bp', 'ec', 'nk'].includes(code))
  }
  return []
}

const OutletsPageBase = ({ role }) => {
  const isSupervisor = role === 'supervisor'
  const isBpOperator = role === 'bp_operator'
  const treatsAsSupervisor = isSupervisor || isBpOperator
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [outlets, setOutlets] = useState([])
  const [allOutlets, setAllOutlets] = useState([])
  const [loading, setLoading] = useState(false)
  const [cloudKitchenId, setCloudKitchenId] = useState(null)
  const [outletMapId, setOutletMapId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [todayAllocationStatus, setTodayAllocationStatus] = useState({})
  const [alert, setAlert] = useState(null)
  const [rawMaterials, setRawMaterials] = useState([])
  const [showAllocateModal, setShowAllocateModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showPackedModal, setShowPackedModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [activeOutlet, setActiveOutlet] = useState(null)
  const [allocationRows, setAllocationRows] = useState([])
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [openDropdownRow, setOpenDropdownRow] = useState(-1)
  const [dropdownSearchTerm, setDropdownSearchTerm] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const [requesting, setRequesting] = useState(false)
  const [editingRequest, setEditingRequest] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRequests, setHistoryRequests] = useState([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [supervisorName, setSupervisorName] = useState('')
  const dropdownSearchRef = useRef(null)
  const requestingRef = useRef(false)
  const historyPageSize = 5

  useEffect(() => {
    const session = getSession()
    if (session?.cloud_kitchen_id) {
      setCloudKitchenId(session.cloud_kitchen_id)
    }
    if (isBpOperator && session?.outlet_map) {
      setOutletMapId(session.outlet_map)
      // For bp_operator, auto-select BP brand and skip brand selection
      setSelectedBrand('BP')
    }
  }, [isBpOperator])

  useEffect(() => {
    fetchRawMaterials()
  }, [])

  useEffect(() => {
    if (selectedBrand && cloudKitchenId) {
      fetchOutlets()
    } else {
      setOutlets([])
      setAllOutlets([])
      setSearchTerm('')
    }
  }, [selectedBrand, cloudKitchenId])

  useEffect(() => {
    if (!searchTerm.trim()) {
      setOutlets(allOutlets)
      return
    }

    const term = searchTerm.toLowerCase()
    setOutlets(
      allOutlets.filter(outlet =>
        outlet.name.toLowerCase().includes(term) ||
        (outlet.code && outlet.code.toLowerCase().includes(term))
      )
    )
  }, [searchTerm, allOutlets])

  useEffect(() => {
    if (openDropdownRow >= 0) {
      const trigger = document.querySelector(`[data-dropdown-trigger="${openDropdownRow}"]`)
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        setDropdownPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) })
      }
      const timeout = setTimeout(() => dropdownSearchRef.current?.focus(), 50)
      return () => clearTimeout(timeout)
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
      setAlert({ type: 'error', message: `Failed to fetch raw materials: ${err.message}` })
    }
  }

  const fetchOutlets = async () => {
    if (!cloudKitchenId || !selectedBrand) return
    setLoading(true)
    try {
      let query = supabase
        .from('outlets')
        .select('*')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .eq('is_active', true)
        .is('deleted_at', null)

      // For bp_operator, fetch only their mapped outlet
      if (isBpOperator && outletMapId) {
        query = query.eq('id', outletMapId)
      } else {
        // For supervisor and purchase_manager, filter by brand code
        query = query.ilike('code', `${selectedBrand}%`)
      }
      
      query = query.order('name', { ascending: true })

      const { data, error } = await query

      if (error) throw error

      const fetchedOutlets = data || []
      
      // Validate bp_operator has their outlet
      if (isBpOperator && fetchedOutlets.length === 0 && outletMapId) {
        setAlert({ 
          type: 'error', 
          message: 'Your assigned outlet could not be found. Please contact admin.' 
        })
        setLoading(false)
        return
      }

      setAllOutlets(fetchedOutlets)
      setOutlets(fetchedOutlets)

      const statusMap = await fetchTodayAllocationStatus({
        cloudKitchenId,
        outletIds: fetchedOutlets.map(o => o.id)
      })
      setTodayAllocationStatus(statusMap)
    } catch (err) {
      setAlert({ type: 'error', message: `Failed to fetch outlets: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  const openAllocateFlow = async (outlet) => {
    setActiveOutlet(outlet)
    const today = getLocalDateString()

    try {
      const { data: requests, error } = await supabase
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
        .eq('outlet_id', outlet.id)
        .eq('request_date', today)
        .order('created_at', { ascending: false })

      if (error) throw error

      const packedRequest = (requests || []).find(req => req.is_packed)
      if (packedRequest) {
        setShowPackedModal(true)
        return
      }

      const existingRequest = (requests || []).find(req => !req.is_packed)
      if (existingRequest) {
        setEditingRequest(existingRequest)
        setAllocationRows(
          [
            ...(existingRequest.allocation_request_items || []).map(item => ({
              id: `row-${item.id}`,
              raw_material_id: item.raw_materials.id,
              material: item.raw_materials,
              quantity: parseFloat(item.quantity).toString()
            })),
            makeEmptyAllocationRow()
          ]
        )
        if (treatsAsSupervisor) setSupervisorName(existingRequest.supervisor_name || '')
      } else {
        setEditingRequest(null)
        setAllocationRows([makeEmptyAllocationRow(), makeEmptyAllocationRow(), makeEmptyAllocationRow()])
        if (treatsAsSupervisor) setSupervisorName('')
      }

      setSelectedRows(new Set())
      setOpenDropdownRow(-1)
      setShowAllocateModal(true)
    } catch (err) {
      setAlert({ type: 'error', message: `Failed to open allocation request: ${err.message}` })
    }
  }

  const handleOutletClick = (outlet) => openAllocateFlow(outlet)

  const openHistoryModal = async (outlet, page = 1) => {
    setActiveOutlet(outlet)
    setShowHistoryModal(true)
    setHistoryLoading(true)
    try {
      const { data, count } = await fetchOutletAllocationRequests({
        outletId: outlet.id,
        page,
        pageSize: historyPageSize
      })
      setHistoryRequests(data)
      setHistoryTotal(count)
      setHistoryPage(page)
    } catch (err) {
      setAlert({ type: 'error', message: `Failed to fetch request history: ${err.message}` })
    } finally {
      setHistoryLoading(false)
    }
  }

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

  const getFilteredMaterialsForRow = (rowIndex) => {
    const search = openDropdownRow === rowIndex ? dropdownSearchTerm : ''
    const usedIds = allocationRows.filter((r, i) => i !== rowIndex && r.raw_material_id).map(r => r.raw_material_id)
    const selectedBrandCode = selectedBrand ? selectedBrand.toLowerCase() : null

    return rawMaterials.filter(m => {
      if (usedIds.includes(m.id)) return false
      if (m.material_type !== 'non_food') return false
      if (!selectedBrandCode) return false

      const materialBrandCodes = normalizeBrandCodes(m.brand_codes)
      if (!materialBrandCodes.includes(selectedBrandCode)) return false

      if (!search.trim()) return true
      const q = search.toLowerCase()
      return m.name.toLowerCase().includes(q) || (m.code || '').toLowerCase().includes(q)
    })
  }

  const handleSelectMaterial = (rowIndex, material) => {
    setAllocationRows(prev => {
      const updated = [...prev]
      const isLastRow = rowIndex === updated.length - 1
      const wasMaterialUnselected = !updated[rowIndex]?.raw_material_id
      updated[rowIndex] = { ...updated[rowIndex], raw_material_id: material.id, material, quantity: updated[rowIndex].quantity || '' }
      if (isLastRow && wasMaterialUnselected) {
        updated.push(makeEmptyAllocationRow())
      }
      return updated
    })
    setOpenDropdownRow(-1)
    setDropdownSearchTerm('')
  }
  const handleRemoveRow = (index) => {
    setAllocationRows(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : [makeEmptyAllocationRow()]
    })
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.delete(index)
      return next
    })
  }
  const handleToggleRowSelect = (index) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  const handleRemoveSelectedRows = () => {
    if (selectedRows.size === 0) return
    setAllocationRows(prev => {
      const next = prev.filter((_, i) => !selectedRows.has(i))
      return next.length > 0 ? next : [makeEmptyAllocationRow()]
    })
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
      setAlert({ type: 'warning', message: 'Please add at least one item with a material selected.' })
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
        setAlert({ type: 'error', message: `Please enter a valid quantity for ${item.name}.` })
        return
      }
    }

    if (treatsAsSupervisor && !supervisorName.trim()) {
      setAlert({ type: 'error', message: 'Supervisor name is required.' })
      return
    }

    setShowConfirmModal(true)
  }

  const refreshStatusForActiveBrand = async () => {
    const statusMap = await fetchTodayAllocationStatus({
      cloudKitchenId,
      outletIds: allOutlets.map(o => o.id)
    })
    setTodayAllocationStatus(statusMap)
  }

  const confirmAllocation = async () => {
    if (requestingRef.current || !activeOutlet) return
    requestingRef.current = true
    setRequesting(true)
    setShowConfirmModal(false)

    try {
      const session = getSession()
      if (!session?.id || !session?.cloud_kitchen_id) {
        throw new Error('Session expired. Please log in again.')
      }

      const selectedItems = getSelectedItemsForSubmit()
      const materialIds = selectedItems.map(item => item.raw_material_id)
      if (materialIds.length !== new Set(materialIds).size) {
        throw new Error('Duplicate materials detected. Please remove duplicates.')
      }

      const today = getLocalDateString()
      const { data: packedRequest, error: packedError } = await supabase
        .from('allocation_requests')
        .select('id')
        .eq('outlet_id', activeOutlet.id)
        .eq('request_date', today)
        .eq('is_packed', true)
        .maybeSingle()
      if (packedError) throw packedError
      if (packedRequest) throw new Error('Today\'s allocation request for this outlet has already been packed and cannot be edited.')

      if (editingRequest) {
        const requestPatch = isSupervisor
          ? { notes: editingRequest.notes, supervisor_name: supervisorName.trim() || null }
          : { notes: editingRequest.notes }

        const { error: updateError } = await supabase
          .from('allocation_requests')
          .update(requestPatch)
          .eq('id', editingRequest.id)
        if (updateError) throw updateError

        const existingItems = editingRequest.allocation_request_items || []
        const existingItemsMap = new Map(existingItems.map(item => [item.raw_materials.id, item]))
        const newItemsMap = new Map(selectedItems.map(item => [item.raw_material_id, item]))

        const itemsToUpdate = []
        const itemsToInsert = []
        const itemsToDelete = []

        existingItems.forEach(existingItem => {
          const materialId = existingItem.raw_materials.id
          const newItem = newItemsMap.get(materialId)
          if (newItem) {
            const existingQty = parseFloat(existingItem.quantity)
            const newQty = parseFloat(newItem.requested_quantity)
            if (Math.abs(existingQty - newQty) > 0.0001) {
              itemsToUpdate.push({ id: existingItem.id, quantity: newQty })
            }
          } else {
            itemsToDelete.push(existingItem.id)
          }
        })

        selectedItems.forEach(newItem => {
          if (!existingItemsMap.has(newItem.raw_material_id)) {
            itemsToInsert.push({
              allocation_request_id: editingRequest.id,
              raw_material_id: newItem.raw_material_id,
              quantity: parseFloat(newItem.requested_quantity)
            })
          }
        })

        for (const item of itemsToUpdate) {
          const { error } = await supabase
            .from('allocation_request_items')
            .update({ quantity: item.quantity })
            .eq('id', item.id)
          if (error) throw error
        }

        if (itemsToDelete.length > 0) {
          const { error } = await supabase
            .from('allocation_request_items')
            .delete()
            .in('id', itemsToDelete)
          if (error) throw error
        }

        if (itemsToInsert.length > 0) {
          const { error } = await supabase
            .from('allocation_request_items')
            .insert(itemsToInsert)
          if (error) throw error
        }

        setAlert({ type: 'success', message: 'Allocation request updated successfully.' })
      } else {
        const payload = {
          outlet_id: activeOutlet.id,
          cloud_kitchen_id: session.cloud_kitchen_id,
          requested_by: session.id,
          request_date: today,
          is_packed: false
        }
        if (treatsAsSupervisor) payload.supervisor_name = supervisorName.trim() || null

        const { data: allocationRequest, error: allocationError } = await supabase
          .from('allocation_requests')
          .insert(payload)
          .select()
          .single()
        if (allocationError) throw allocationError

        const allocationRequestItems = selectedItems.map(item => ({
          allocation_request_id: allocationRequest.id,
          raw_material_id: item.raw_material_id,
          quantity: parseFloat(item.requested_quantity)
        }))

        const { error: itemsError } = await supabase
          .from('allocation_request_items')
          .insert(allocationRequestItems)
        if (itemsError) throw itemsError

        setAlert({ type: 'success', message: 'Allocation request created successfully.' })
      }

      setShowAllocateModal(false)
      setEditingRequest(null)
      setAllocationRows([])
      await refreshStatusForActiveBrand()
      if (showHistoryModal && activeOutlet) {
        await openHistoryModal(activeOutlet, historyPage)
      }
    } catch (err) {
      setAlert({ type: 'error', message: `Failed to save allocation request: ${err.message}` })
    } finally {
      requestingRef.current = false
      setRequesting(false)
    }
  }

  const closeAllocateModal = () => {
    setShowAllocateModal(false)
    setEditingRequest(null)
    setAllocationRows([])
    if (isSupervisor) setSupervisorName('')
  }

  const totalHistoryPages = Math.max(1, Math.ceil(historyTotal / historyPageSize))

  return (
    <div className="p-3 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-xl lg:text-3xl font-bold text-foreground mb-4 lg:mb-6">Requisition</h1>
        {!isBpOperator && (
          <div className="mb-4 lg:mb-6">
            <h2 className="text-sm lg:text-lg font-semibold text-foreground mb-2 lg:mb-4">Select Brand</h2>
            <div className="flex flex-row lg:grid lg:grid-cols-3 gap-2 lg:gap-4">
              {BRANDS.map((brand) => (
                <button
                  key={brand.id}
                  onClick={() => {
                    setSelectedBrand(brand.id)
                    setSearchTerm('')
                  }}
                  className={`${brand.color} ${brand.hoverColor} text-white font-bold py-2.5 lg:py-8 px-3 lg:px-6 rounded-lg lg:rounded-xl transition-all duration-200 shadow-md lg:shadow-lg hover:shadow-lg lg:hover:shadow-xl transform hover:scale-105 active:scale-95 touch-manipulation flex-1 lg:flex-none ${
                    selectedBrand === brand.id ? 'ring-2 lg:ring-4 ring-white ring-offset-1 lg:ring-offset-2' : ''
                  }`}
                >
                  <div className="text-center flex flex-col items-center">
                    <img src={brand.logo} alt={brand.name} className="h-6 lg:h-12 w-auto mb-1 lg:mb-2 object-contain" />
                    <div className="text-xs lg:text-2xl font-black mb-0.5 lg:mb-1 truncate">{brand.name}</div>
                    <div className="hidden lg:block text-xs lg:text-sm opacity-90">Tap to view outlets</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedBrand && (
          <div>
            <div className="flex items-center justify-between mb-3 lg:mb-4">
              <h2 className="text-base lg:text-lg font-semibold text-foreground">
                {isBpOperator ? 'Your Outlet' : `${BRANDS.find(b => b.id === selectedBrand)?.name} Outlets`}
              </h2>
              {outlets.length > 0 && !isBpOperator && (
                <span className="text-xs lg:text-sm text-muted-foreground">
                  {outlets.length} outlet{outlets.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {!isBpOperator && (
              <div className="mb-4 lg:mb-6">
                <div className="bg-card border-2 border-border rounded-xl p-3 lg:p-4">
                  <label htmlFor="outlet-search" className="block text-sm font-semibold text-foreground mb-2">
                    Search Outlets
                  </label>
                  <input
                    id="outlet-search"
                    type="text"
                    placeholder="Search by outlet name or code (e.g. NK1001)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-4 py-3 lg:py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
                  />
                </div>
              </div>
            )}

            {loading ? (
              <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12 text-center text-muted-foreground">Loading outlets...</div>
            ) : outlets.length === 0 ? (
              <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12 text-center text-muted-foreground">No outlets found.</div>
            ) : (
              <div className="bg-card border-2 border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border">
                  {outlets.map((outlet) => {
                    const status = todayAllocationStatus[outlet.id]
                    return (
                      <div
                        key={outlet.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOutletClick(outlet)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleOutletClick(outlet)
                          }
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 lg:px-5 lg:py-4 text-left hover:bg-accent/5 transition-all duration-200 touch-manipulation ${
                          status?.isPacked ? 'bg-green-500/5' : status?.hasRequest ? 'bg-yellow-500/5' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm lg:text-base font-semibold text-foreground truncate">{outlet.name}</p>
                          <p className="text-xs lg:text-sm text-muted-foreground font-mono">{outlet.code}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-3">
                          {status?.isPacked && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 text-[10px] font-semibold">Today: Packed</span>}
                          {!status?.isPacked && status?.hasRequest && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-700 text-[10px] font-semibold">Today: Request sent</span>}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              openHistoryModal(outlet)
                            }}
                            className="p-2 rounded-lg hover:bg-accent/20 text-accent"
                            aria-label={`View request history for ${outlet.name}`}
                          >
                            <svg className="w-4 h-4 lg:w-5 lg:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 5h8m-8 5h8M4 7h.01M4 12h.01M4 17h.01" />
                            </svg>
                          </button>
                          <svg className="w-4 h-4 lg:w-5 lg:h-5 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showPackedModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-yellow-500 mb-2">Request already packed</h3>
            <p className="text-sm text-foreground mb-4">Today's allocation request for {activeOutlet?.name} has already been packed and cannot be edited again.</p>
            <button onClick={() => setShowPackedModal(false)} className="w-full bg-yellow-500 text-white font-bold px-4 py-3 rounded-xl">OK</button>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">Allocation History - {activeOutlet?.name}</h2>
              <button onClick={() => setShowHistoryModal(false)} className="p-2 text-muted-foreground hover:text-foreground">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {historyLoading ? (
              <p className="text-muted-foreground">Loading history...</p>
            ) : historyRequests.length === 0 ? (
              <p className="text-muted-foreground">No previous requests found.</p>
            ) : (
              <div className="space-y-3">
                {historyRequests.map((request) => (
                  <div key={request.id} className="bg-background border border-border rounded-lg p-3">
                    <div className="flex justify-between">
                      <p className="text-sm font-semibold text-foreground">{new Date(request.request_date).toLocaleDateString()}</p>
                      <span className={`text-xs font-semibold ${request.is_packed ? 'text-green-500' : 'text-yellow-600'}`}>{request.is_packed ? 'Packed' : 'Open'}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(request.allocation_request_items || []).map(item => (
                        <p key={item.id} className="text-xs text-muted-foreground">{item.raw_materials?.name}: {parseFloat(item.quantity || 0).toFixed(2)} {item.raw_materials?.unit}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => openHistoryModal(activeOutlet, historyPage - 1)}
                disabled={historyPage <= 1 || historyLoading}
                className="px-4 py-2 border border-border rounded-lg disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">Page {historyPage} / {totalHistoryPages}</span>
              <button
                onClick={() => openHistoryModal(activeOutlet, historyPage + 1)}
                disabled={historyPage >= totalHistoryPages || historyLoading}
                className="px-4 py-2 border border-border rounded-lg disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {showAllocateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">{editingRequest ? 'Edit Allocation Request' : 'Create Allocation Request'}</h2>
              <button onClick={closeAllocateModal} className="p-2 -mr-2 text-muted-foreground hover:text-foreground" disabled={requesting}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="mb-4 p-3 bg-accent/20 border border-accent rounded-lg">
              <p className="text-sm font-semibold text-foreground">{activeOutlet?.name}</p>
              <p className="text-xs text-muted-foreground">{activeOutlet?.code}</p>
            </div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                {selectedRows.size > 0 && (
                  <button onClick={handleRemoveSelectedRows} className="px-3 py-1.5 text-sm font-semibold text-destructive bg-destructive/10 border border-destructive/30 rounded-lg">
                    Remove Selected ({selectedRows.size})
                  </button>
                )}
              </div>
              <div className="overflow-x-auto border-2 border-border rounded-xl">
                <table className="w-full min-w-[500px]">
                  <thead><tr className="bg-background border-b-2 border-border"><th className="px-3 py-2 w-10"></th><th className="px-3 py-2 text-left text-sm font-bold text-foreground">Name</th><th className="px-3 py-2 text-left text-sm font-bold text-foreground w-32">Quantity</th><th className="px-3 py-2 w-12"></th></tr></thead>
                  <tbody>
                    {allocationRows.map((row, index) => (
                      <tr key={row.id || index} className={`border-b border-border ${selectedRows.has(index) ? 'bg-accent/10' : ''}`}>
                        <td className="px-3 py-2"><input type="checkbox" checked={selectedRows.has(index)} onChange={() => handleToggleRowSelect(index)} disabled={requesting} /></td>
                        <td className="px-3 py-2 relative material-dropdown-container">
                          <button type="button" data-dropdown-trigger={index} onClick={() => { setOpenDropdownRow(openDropdownRow === index ? -1 : index); setDropdownSearchTerm('') }} className="w-full text-left px-3 py-2 bg-input border border-border rounded-lg text-sm truncate">
                            {row.material ? <span>{row.material.name} <span className="text-muted-foreground text-xs">({row.material.unit})</span></span> : <span className="text-muted-foreground">Select material...</span>}
                          </button>
                          {openDropdownRow === index && ReactDOM.createPortal(
                            <div className="fixed z-[9999] bg-card border-2 border-accent rounded-xl shadow-2xl overflow-hidden material-dropdown-container" style={{ top: dropdownPosition.top, left: dropdownPosition.left, width: dropdownPosition.width, minWidth: 280 }}>
                              <input ref={dropdownSearchRef} type="text" value={dropdownSearchTerm} onChange={(e) => setDropdownSearchTerm(e.target.value)} placeholder="Search material..." className="w-full px-4 py-3 border-b-2 border-border bg-background text-foreground" />
                              <div className="max-h-44 overflow-y-auto bg-card">
                                {getFilteredMaterialsForRow(index).map((m) => (
                                  <button key={m.id} type="button" onClick={() => handleSelectMaterial(index, m)} className="w-full text-left px-4 py-3 hover:bg-accent/30 border-b border-border/50">
                                    <div className="text-sm">{m.name}</div>
                                    <div className="text-xs text-muted-foreground">{m.code} • {m.unit}</div>
                                  </button>
                                ))}
                              </div>
                            </div>,
                            document.body
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min="0.5" step="0.5" value={row.quantity} onChange={(e) => handleUpdateQuantity(index, e.target.value)} disabled={!row.material || requesting} className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm" />
                        </td>
                        <td className="px-3 py-2"><button type="button" onClick={() => handleRemoveRow(index)} disabled={requesting} className="text-destructive p-1">x</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {treatsAsSupervisor && (
              <div className="mt-4">
                <label htmlFor="supervisor-name" className="block text-sm font-semibold text-foreground mb-2">Supervisor name <span className="text-destructive">*</span></label>
                <input id="supervisor-name" type="text" value={supervisorName} onChange={(e) => setSupervisorName(e.target.value)} placeholder="Enter your name" disabled={requesting} className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm" />
              </div>
            )}
            <div className="flex flex-col lg:flex-row gap-3 mt-6">
              <button onClick={closeAllocateModal} disabled={requesting} className="w-full lg:flex-1 bg-transparent text-foreground font-semibold px-4 py-3.5 rounded-lg border-2 border-border">Cancel</button>
              <button onClick={handleFinalizeAllocation} disabled={requesting || getSelectedItemsForSubmit().length === 0 || (treatsAsSupervisor && !supervisorName.trim())} className="w-full lg:flex-1 bg-accent text-background font-bold px-4 py-3.5 rounded-xl border-2 border-accent disabled:opacity-50">
                {requesting ? (editingRequest ? 'Updating Request...' : 'Creating Request...') : (editingRequest ? 'Update Request' : 'Create Request')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-lg w-full">
            <h2 className="text-xl lg:text-2xl font-bold text-foreground mb-4">{editingRequest ? 'Confirm Update' : 'Confirm Allocation Request'}</h2>
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {getSelectedItemsForSubmit().map((item) => (
                <div key={item.raw_material_id} className="bg-background border border-border rounded-lg p-3">
                  <p className="text-sm font-semibold text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{parseFloat(item.requested_quantity).toFixed(2)} {item.unit}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmModal(false)} className="flex-1 border-2 border-border rounded-lg py-2.5">Cancel</button>
              <button onClick={confirmAllocation} disabled={requesting} className="flex-1 bg-accent text-background rounded-lg py-2.5 font-bold">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {alert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full shadow-xl">
            <h3 className={`text-base lg:text-lg font-bold mb-1 ${alert.type === 'error' ? 'text-destructive' : alert.type === 'success' ? 'text-green-500' : 'text-yellow-500'}`}>
              {alert.type === 'error' ? 'Error' : alert.type === 'success' ? 'Success' : 'Warning'}
            </h3>
            <p className="text-sm lg:text-base text-foreground break-words">{alert.message}</p>
            <button onClick={() => setAlert(null)} className="mt-4 w-full font-bold px-4 py-3 rounded-xl bg-accent text-background">OK</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default OutletsPageBase

