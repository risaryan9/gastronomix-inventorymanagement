import { useState, useEffect, useRef, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import PaginationControls from '../../components/PaginationControls'
import useAutoScrollOnAdd from '../../hooks/useAutoScrollOnAdd'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'
import { getAnchoredDropdownStyle } from '../../utils/dropdownPosition'

const DISPATCH_STOCK_OUT_SECTIONS = [
  { key: 'finished', label: 'Finished' },
  { key: 'semi_finished', label: 'Semi-finished' },
  { key: 'raw_material', label: 'Raw materials' },
]

function selfStockOutRowSectionKey(materialType) {
  if (materialType === 'finished') return 'finished'
  if (materialType === 'semi_finished') return 'semi_finished'
  return 'raw_material'
}

// Helper: Convert number to words (Indian numbering system)
function numberToWords(num) {
  if (num === 0) return 'Zero'
  
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  
  function convertLessThanThousand(n) {
    if (n === 0) return ''
    if (n < 10) return ones[n]
    if (n < 20) return teens[n - 10]
    if (n < 100) {
      const ten = Math.floor(n / 10)
      const one = n % 10
      return tens[ten] + (one > 0 ? ' ' + ones[one] : '')
    }
    const hundred = Math.floor(n / 100)
    const rest = n % 100
    return ones[hundred] + ' Hundred' + (rest > 0 ? ' ' + convertLessThanThousand(rest) : '')
  }
  
  if (num < 1000) return convertLessThanThousand(num)
  
  if (num < 100000) {
    const thousands = Math.floor(num / 1000)
    const rest = num % 1000
    return convertLessThanThousand(thousands) + ' Thousand' + (rest > 0 ? ' ' + convertLessThanThousand(rest) : '')
  }
  
  if (num < 10000000) {
    const lakhs = Math.floor(num / 100000)
    const rest = num % 100000
    let result = convertLessThanThousand(lakhs) + ' Lakh'
    if (rest >= 1000) {
      const thousands = Math.floor(rest / 1000)
      const remaining = rest % 1000
      result += ' ' + convertLessThanThousand(thousands) + ' Thousand'
      if (remaining > 0) result += ' ' + convertLessThanThousand(remaining)
    } else if (rest > 0) {
      result += ' ' + convertLessThanThousand(rest)
    }
    return result
  }
  
  const crores = Math.floor(num / 10000000)
  const rest = num % 10000000
  let result = convertLessThanThousand(crores) + ' Crore'
  if (rest > 0) {
    result += ' ' + numberToWords(rest)
  }
  return result
}

/** Latest stock_out.created_at (or allocation_date) per material for kitchen self stock-out + reason */
async function fetchLastKitchenStockOutDatesByMaterial(
  cloudKitchenId,
  reason,
  materialIds
) {
  if (!cloudKitchenId || !reason || !materialIds.length) return {}
  const { data, error } = await supabase
    .from('stock_out_items')
    .select(`
      raw_material_id,
      stock_out!inner (
        created_at,
        allocation_date,
        cloud_kitchen_id,
        self_stock_out,
        reason
      )
    `)
    .in('raw_material_id', materialIds)
    .eq('stock_out.cloud_kitchen_id', cloudKitchenId)
    .eq('stock_out.self_stock_out', true)
    .eq('stock_out.reason', reason)

  if (error) {
    console.error('fetchLastKitchenStockOutDatesByMaterial', error)
    return {}
  }
  const map = {}
  for (const row of data || []) {
    const so = row.stock_out
    if (!so) continue
    const ts = so.created_at || so.allocation_date
    if (!ts) continue
    const mid = row.raw_material_id
    const prev = map[mid]
    if (!prev || new Date(ts) > new Date(prev)) {
      map[mid] = ts
    }
  }
  return map
}

/**
 * Most recent prior allocation (date + quantity) of each material to a given
 * outlet — i.e. the last time this item was actually packed/sent to that outlet.
 * Returns a map: raw_material_id -> { date, quantity }.
 */
async function fetchLastOutletAllocationByMaterial(outletId, materialIds) {
  if (!outletId || !materialIds.length) return {}
  const { data, error } = await supabase
    .from('stock_out_items')
    .select(`
      raw_material_id,
      quantity,
      stock_out!inner (
        outlet_id,
        self_stock_out,
        created_at,
        allocation_date
      )
    `)
    .in('raw_material_id', materialIds)
    .eq('stock_out.outlet_id', outletId)
    .eq('stock_out.self_stock_out', false)
    .gt('quantity', 0)

  if (error) {
    console.error('fetchLastOutletAllocationByMaterial', error)
    return {}
  }
  const map = {}
  for (const row of data || []) {
    const so = row.stock_out
    if (!so) continue
    const ts = so.created_at || so.allocation_date
    if (!ts) continue
    const mid = row.raw_material_id
    const prev = map[mid]
    if (!prev || new Date(ts) > new Date(prev.date)) {
      map[mid] = { date: ts, quantity: parseFloat(row.quantity) || 0 }
    }
  }
  return map
}

// Kitchen self stock-out reasons — shared by the Reason filter and the per-reason PDF export buttons
const KITCHEN_REASON_OPTIONS = [
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'wastage', label: 'Wastage' },
  { value: 'staff-food', label: 'Staff Food' },
  { value: 'internal-production', label: 'Internal Production' },
  { value: 'cullinary-rnd', label: 'Culinary R&D' }
]

const StockOut = () => {
  const [allocationRequests, setAllocationRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [showAllocationModal, setShowAllocationModal] = useState(false)
  const [challanNotes, setChallanNotes] = useState('')
  const [allocationItems, setAllocationItems] = useState([])
  // Last prior allocation (date + qty) per material for the selected request's outlet
  const [lastAllocationByMaterial, setLastAllocationByMaterial] = useState({})
  const [inventoryData, setInventoryData] = useState({})
  const [todayTotals, setTodayTotals] = useState({})
  const [allocating, setAllocating] = useState(false)
  const [cancelingId, setCancelingId] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [alert, setAlert] = useState(null)
  const [lastStockOutId, setLastStockOutId] = useState(null)

  // Outlet stock-out panel state (allocation requests)
  const [searchTerm, setSearchTerm] = useState('')
  const [outletPreviousDaysPage, setOutletPreviousDaysPage] = useState(1)
  const outletPreviousDaysPerPage = 15
  // View all allocation requests modal (non-today's requests, with search + pagination)
  const [showViewAllAllocationModal, setShowViewAllAllocationModal] = useState(false)
  const [viewAllSearchTerm, setViewAllSearchTerm] = useState('')
  const [viewAllPage, setViewAllPage] = useState(1)
  const viewAllPerPage = 15
  // Date range for PDF exports
  const [pdfDateRange, setPdfDateRange] = useState({
    from: new Date().toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  })

  // Kitchen stock-out (self stock-out) records panel state
  const [kitchenStockOutRecords, setKitchenStockOutRecords] = useState([])
  const [kitchenSearchTerm, setKitchenSearchTerm] = useState('')
  // Date range for kitchen stock-out per-reason PDF exports
  const [kitchenPdfDateRange, setKitchenPdfDateRange] = useState({
    from: new Date().toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  })
  // Reason currently generating a PDF (for per-button loading state), or null
  const [downloadingKitchenPdf, setDownloadingKitchenPdf] = useState(null)

  // Pagination per panel
  const kitchenPerPage = 15
  const [kitchenCurrentPage, setKitchenCurrentPage] = useState(1)

  // Layout mode for desktop panels: 'split' | 'outlet-full' | 'kitchen-full'
  const [layoutMode, setLayoutMode] = useState('split')

  // Shared details modal state
  const [stockOutDetails, setStockOutDetails] = useState(null)
  const [showStockOutDetailsModal, setShowStockOutDetailsModal] = useState(false)
  
  // Self stock out creation modal states
  const [showSelfStockOutModal, setShowSelfStockOutModal] = useState(false)
  const [selfStockOutItems, setSelfStockOutItems] = useState([])
  // Keep the self stock-out items table pinned to the newest row as rows are added
  const selfStockOutScrollRef = useAutoScrollOnAdd(selfStockOutItems.length, showSelfStockOutModal)
  // Lock the page behind the item modals so scrolling their tables can't move it
  useBodyScrollLock(showSelfStockOutModal || showAllocationModal)
  const [selfStockOutReason, setSelfStockOutReason] = useState('')
  const [selfStockOutNotes, setSelfStockOutNotes] = useState('')
  const [transferToCloudKitchenId, setTransferToCloudKitchenId] = useState('')
  const [otherCloudKitchens, setOtherCloudKitchens] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [isSelfStockOut, setIsSelfStockOut] = useState(false)
  const [selectedStockOutRows, setSelectedStockOutRows] = useState(new Set())
  const [wastageImageFile, setWastageImageFile] = useState(null)
  const [wastageImageError, setWastageImageError] = useState('')
  // Dispatch brand states
  const [dispatchBrands, setDispatchBrands] = useState([])
  const [selectedDispatchBrand, setSelectedDispatchBrand] = useState('')
  // Prevent double-submit on allocation (ref blocks immediately)
  const allocatingRef = useRef(false)
  // Material search popup (same design as Stock In / OutletDetails)
  const [openMaterialDropdownRow, setOpenMaterialDropdownRow] = useState(-1)
  const [materialDropdownSearchTerm, setMaterialDropdownSearchTerm] = useState('')
  const [materialDropdownPosition, setMaterialDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const materialDropdownSearchRef = useRef(null)
  // "Add item" dropdown in the Allocate Stock modal (lets the PM add a material the
  // supervisor forgot, before packing — see docs/AUDIT_TRAIL_REQUIREMENTS.md E1-adjacent note)
  const [showAddItemDropdown, setShowAddItemDropdown] = useState(false)
  const [addItemSearchTerm, setAddItemSearchTerm] = useState('')
  const [addItemDropdownPosition, setAddItemDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const addItemSearchRef = useRef(null)

  const [selfStockOutLastDates, setSelfStockOutLastDates] = useState({})
  const [lastStockOutDatesLoading, setLastStockOutDatesLoading] = useState(false)

  const selfStockOutMaterialIdsKey = useMemo(() => {
    const ids = selfStockOutItems.map((i) => i.raw_material_id).filter(Boolean)
    return [...new Set(ids)].sort().join(',')
  }, [selfStockOutItems])

  /** Dispatch reason: table order — section headers + rows (indices match selfStockOutItems) */
  const selfStockOutDispatchTableRows = useMemo(() => {
    if (selfStockOutReason !== 'dispatch') return null

    const buckets = { finished: [], semi_finished: [], raw_material: [] }
    const empties = []

    const typeFor = (item) => {
      if (item.material_type) return item.material_type
      const m = allMaterials.find((x) => x.id === item.raw_material_id)
      return m?.material_type
    }

    selfStockOutItems.forEach((item, index) => {
      if (!item.raw_material_id) {
        empties.push({ item, index })
        return
      }
      const sk = selfStockOutRowSectionKey(typeFor(item))
      buckets[sk].push({ item, index })
    })

    const out = []
    DISPATCH_STOCK_OUT_SECTIONS.forEach((section, sectionIdx) => {
      const rows = buckets[section.key]
      if (!rows.length) return
      out.push({
        kind: 'section',
        key: section.key,
        label: section.label,
        sectionIdx,
      })
      rows.forEach((r) => out.push({ kind: 'row', ...r }))
    })
    empties.forEach((r) => out.push({ kind: 'row', ...r }))
    return out
  }, [selfStockOutReason, selfStockOutItems, allMaterials])

  // When kitchen stock-out modal is open: last self stock-out date per material for the selected reason
  useEffect(() => {
    if (!showSelfStockOutModal || !selfStockOutReason) {
      setSelfStockOutLastDates({})
      setLastStockOutDatesLoading(false)
      return
    }
    const session = getSession()
    const ck = session?.cloud_kitchen_id
    if (!ck) {
      setSelfStockOutLastDates({})
      return
    }
    const materialIds = selfStockOutMaterialIdsKey
      ? selfStockOutMaterialIdsKey.split(',').filter(Boolean)
      : []
    if (materialIds.length === 0) {
      setSelfStockOutLastDates({})
      setLastStockOutDatesLoading(false)
      return
    }

    let cancelled = false
    setLastStockOutDatesLoading(true)
    fetchLastKitchenStockOutDatesByMaterial(ck, selfStockOutReason, materialIds)
      .then((map) => {
        if (!cancelled) setSelfStockOutLastDates(map)
      })
      .finally(() => {
        if (!cancelled) setLastStockOutDatesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [showSelfStockOutModal, selfStockOutReason, selfStockOutMaterialIdsKey])

  // Fetch allocation requests and kitchen stock-out records
  useEffect(() => {
    fetchAllocationRequests()
  }, [])

  // When reason is inter-cloud-kitchen, fetch other cloud kitchens for destination dropdown
  useEffect(() => {
    if (selfStockOutReason !== 'inter-cloud-kitchen' || !showSelfStockOutModal) {
      setTransferToCloudKitchenId('')
      return
    }
    const session = getSession()
    if (!session?.cloud_kitchen_id) return

    const fetchOtherCloudKitchens = async () => {
      try {
        const { data, error } = await supabase
          .from('cloud_kitchens')
          .select('id, name, code')
          .eq('is_active', true)
          .neq('id', session.cloud_kitchen_id)
          .order('name')

        if (error) throw error
        setOtherCloudKitchens(data || [])
      } catch (err) {
        console.error('Error fetching cloud kitchens:', err)
        setAlert(prev => prev || { type: 'error', message: 'Failed to load cloud kitchens' })
        setOtherCloudKitchens([])
      }
    }
    fetchOtherCloudKitchens()
  }, [selfStockOutReason, showSelfStockOutModal])

  // Clear transfer destination when reason changes away from inter-cloud
  useEffect(() => {
    if (selfStockOutReason !== 'inter-cloud-kitchen') {
      setTransferToCloudKitchenId('')
    }
  }, [selfStockOutReason])

  // Clear wastage image when reason changes away from wastage
  useEffect(() => {
    if (selfStockOutReason !== 'wastage') {
      setWastageImageFile(null)
      setWastageImageError('')
    }
  }, [selfStockOutReason])

  // Fetch dispatch brands when reason is dispatch
  useEffect(() => {
    if (selfStockOutReason !== 'dispatch' || !showSelfStockOutModal) {
      setSelectedDispatchBrand('')
      return
    }

    const fetchDispatchBrands = async () => {
      try {
        const { data, error } = await supabase
          .from('brand_dispatch')
          .select('id, name, code, sort_order')
          .eq('is_active', true)
          .order('sort_order')

        if (error) throw error
        setDispatchBrands(data || [])
      } catch (err) {
        console.error('Error fetching dispatch brands:', err)
        setAlert(prev => prev || { type: 'error', message: 'Failed to load dispatch brands' })
        setDispatchBrands([])
      }
    }
    fetchDispatchBrands()
  }, [selfStockOutReason, showSelfStockOutModal])

  // Clear dispatch brand when reason changes away from dispatch
  useEffect(() => {
    if (selfStockOutReason !== 'dispatch') {
      setSelectedDispatchBrand('')
    }
  }, [selfStockOutReason])

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
          destination_kitchen:cloud_kitchens!transfer_to_cloud_kitchen_id (
            id,
            name,
            code
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

      const { data, error } = await supabase
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

  const sanitizeForFilename = (value) => {
    if (!value) return ''
    return value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\-]/g, '')
  }

  const handleWastageFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      setWastageImageFile(null)
      setWastageImageError('')
      return
    }
    const allowedTypes = ['image/jpeg', 'image/png']
    const maxSizeBytes = 5 * 1024 * 1024 // 5 MB
    if (!allowedTypes.includes(file.type)) {
      setWastageImageFile(null)
      setWastageImageError('Only JPEG or PNG images are allowed.')
      return
    }
    if (file.size > maxSizeBytes) {
      setWastageImageFile(null)
      setWastageImageError('Maximum file size is 5 MB.')
      return
    }
    setWastageImageFile(file)
    setWastageImageError('')
  }

  const uploadWastageImage = async (file, session, stockOutId) => {
    if (!file || !stockOutId) return null
    const cloudKitchenId = sanitizeForFilename(session?.cloud_kitchen_id || 'cloud_kitchen')
    const ext = file.type === 'image/png' ? 'png' : 'jpg'
    const path = `wastage/${cloudKitchenId}/${stockOutId}.${ext}`
    const { error } = await supabase.storage.from('invoices').upload(path, file, { upsert: true })
    if (error) throw error
    const { data } = supabase.storage.from('invoices').getPublicUrl(path)
    return data?.publicUrl || null
  }

  const downloadStockOutCSV = (record) => {
    if (!record) return
    const session = getSession()
    const isKitchen = record.self_stock_out

    const headers = ['Material Name', 'Code', 'Unit', 'Quantity']
    const rows = (record.stock_out_items || []).map((item) => [
      item.raw_materials?.name || 'N/A',
      item.raw_materials?.code || 'N/A',
      item.raw_materials?.unit || 'N/A',
      parseFloat(item.quantity || 0).toFixed(2)
    ])

    const metaLines = [
      isKitchen ? 'Kitchen Stock-Out Details' : 'Outlet Stock-Out Details',
      `Generated: ${new Date().toLocaleString()}`,
      `Cloud Kitchen: ${session?.cloud_kitchen_name || session?.cloud_kitchen_id || 'N/A'}`,
      `User: ${session?.full_name || 'N/A'}`,
      `Role: ${session?.role || 'N/A'}`,
      `Email: ${session?.email || 'N/A'}`,
      '',
      `Allocation Date: ${new Date(record.allocation_date).toLocaleDateString()}`,
      !isKitchen && record.outlets?.name ? `Outlet: ${record.outlets.name} (${record.outlets.code || ''})` : null,
      isKitchen && record.reason ? `Reason: ${record.reason.replace(/-/g, ' ')}` : null,
      isKitchen && record.reason === 'dispatch' && record.dispatch_brand ? `Brand: ${record.dispatch_brand}` : null,
      record.notes ? `Notes: ${record.notes}` : null
    ].filter(Boolean)

    const csvContent = [
      ['Gastronomix Inventory Management - Stock-Out Record'],
      ...metaLines.map(line => [line]),
      [],
      headers,
      ...rows
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `stock_out_${record.id}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Weighted-average GST-inclusive cost per material (mirrors Inventory valuation).
  // Falls back to quantity_purchased weighting, then a simple average, when no live stock remains.
  const fetchAverageRatesByMaterial = async (materialIds, cloudKitchenId) => {
    const rateMap = {}
    if (!materialIds.length) return rateMap
    const { data, error } = await supabase
      .from('stock_in_batches')
      .select('raw_material_id, quantity_remaining, quantity_purchased, unit_cost, gst_percent')
      .eq('cloud_kitchen_id', cloudKitchenId)
      .in('raw_material_id', materialIds)
    if (error) {
      console.error('Error fetching batch rates for average:', error)
      return rateMap
    }

    const agg = {}
    ;(data || []).forEach((batch) => {
      const id = batch.raw_material_id
      const unitCost = parseFloat(batch.unit_cost || 0)
      const gstPercent = parseFloat(batch.gst_percent || 0)
      const gstInclusiveRate = unitCost * (1 + gstPercent / 100)
      const remaining = parseFloat(batch.quantity_remaining || 0)
      const purchased = parseFloat(batch.quantity_purchased || 0)
      if (!agg[id]) {
        agg[id] = {
          valByRemaining: 0, qtyRemaining: 0,
          valByPurchased: 0, qtyPurchased: 0,
          rateSum: 0, count: 0
        }
      }
      const a = agg[id]
      a.valByRemaining += gstInclusiveRate * remaining
      a.qtyRemaining += remaining
      a.valByPurchased += gstInclusiveRate * purchased
      a.qtyPurchased += purchased
      a.rateSum += gstInclusiveRate
      a.count += 1
    })

    Object.entries(agg).forEach(([id, a]) => {
      if (a.qtyRemaining > 0) rateMap[id] = a.valByRemaining / a.qtyRemaining
      else if (a.qtyPurchased > 0) rateMap[id] = a.valByPurchased / a.qtyPurchased
      else if (a.count > 0) rateMap[id] = a.rateSum / a.count
      else rateMap[id] = 0
    })
    return rateMap
  }

  const downloadStockOutExcel = async (record) => {
    if (!record) return
    const session = getSession()
    const workbook = XLSX.utils.book_new()
    const isKitchen = record.self_stock_out

    const summaryData = [
      ['Gastronomix Inventory Management - Stock-Out Record'],
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
      ['Stock-Out Summary'],
      ['Type:', isKitchen ? 'Kitchen Stock-Out' : 'Outlet Stock-Out'],
      ['Allocation Date:', new Date(record.allocation_date).toLocaleDateString()],
      !isKitchen && record.outlets?.name ? ['Outlet:', `${record.outlets.name} (${record.outlets.code || ''})`] : null,
      isKitchen && record.reason ? ['Reason:', record.reason.replace(/-/g, ' ')] : null,
      isKitchen && record.reason === 'dispatch' && record.dispatch_brand ? ['Brand:', record.dispatch_brand] : null,
      record.notes ? ['Notes:', record.notes] : null
    ].filter(Boolean)

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

    // Average (GST-inclusive) rate per material for the record's items.
    // The detail fetch embeds the material via `raw_materials:raw_material_id`, so the
    // scalar column isn't returned — read the id from the embedded row.
    const items = record.stock_out_items || []
    const itemMaterialId = (item) => item.raw_material_id || item.raw_materials?.id
    const materialIds = [...new Set(items.map(itemMaterialId).filter(Boolean))]
    const rateMap = await fetchAverageRatesByMaterial(
      materialIds,
      record.cloud_kitchen_id || session?.cloud_kitchen_id
    )

    const itemRows = items.map((item) => {
      const quantity = parseFloat(item.quantity || 0)
      const rate = rateMap[itemMaterialId(item)] || 0
      const amount = quantity * rate
      return [
        item.raw_materials?.name || 'N/A',
        item.raw_materials?.code || 'N/A',
        item.raw_materials?.unit || 'N/A',
        quantity,
        Number(rate.toFixed(2)),
        Number(amount.toFixed(2))
      ]
    })
    const totalAmount = itemRows.reduce((sum, row) => sum + (row[5] || 0), 0)

    const data = [
      ['Material Name', 'Code', 'Unit', 'Quantity', 'Rate (Avg, incl. GST)', 'Amount'],
      ...itemRows,
      [],
      ['', '', '', '', 'Grand Total', Number(totalAmount.toFixed(2))]
    ]

    const sheet = XLSX.utils.aoa_to_sheet(data)

    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: C })
      const cell = sheet[cellAddress]
      if (cell) {
        cell.s = {
          font: { bold: true },
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } }
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, sheet, 'Items')
    XLSX.writeFile(workbook, `stock_out_${record.id}.xlsx`)
  }

  const downloadStockOutPDF = (record) => {
    if (!record) return
    const session = getSession()
    const isKitchen = record.self_stock_out

    const doc = new jsPDF('p', 'mm', 'a4')
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    let yPos = 20

    doc.setFontSize(20)
    doc.setFont(undefined, 'bold')
    doc.text('Gastronomix', pageWidth / 2, yPos, { align: 'center' })
    yPos += 8
    doc.setFontSize(14)
    doc.setFont(undefined, 'normal')
    doc.text(
      isKitchen ? 'Kitchen Stock-Out Details' : 'Outlet Stock-Out Details',
      pageWidth / 2,
      yPos,
      { align: 'center' }
    )
    yPos += 10

    doc.setFontSize(10)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos)
    yPos += 6

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

    doc.setFont(undefined, 'bold')
    doc.setFontSize(12)
    doc.text('User Information', 20, yPos)
    yPos += 7
    doc.setFont(undefined, 'normal')
    doc.setFontSize(10)
    doc.text(`Name: ${session?.full_name || 'N/A'}`, 25, yPos)
    yPos += 5
    doc.text(
      `Role: ${
        session?.role
          ? session.role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          : 'N/A'
      }`,
      25,
      yPos
    )
    yPos += 5
    doc.text(`Email: ${session?.email || 'N/A'}`, 25, yPos)
    yPos += 8

    doc.setFont(undefined, 'bold')
    doc.setFontSize(12)
    doc.text('Stock-Out Summary', 20, yPos)
    yPos += 7
    doc.setFont(undefined, 'normal')
    doc.setFontSize(10)
    doc.text(`Allocation Date: ${new Date(record.allocation_date).toLocaleDateString()}`, 25, yPos)
    yPos += 5
    if (!isKitchen && record.outlets?.name) {
      doc.text(`Outlet: ${record.outlets.name}${record.outlets.code ? ` (${record.outlets.code})` : ''}`, 25, yPos)
      yPos += 5
    }
    if (isKitchen && record.reason) {
      doc.text(`Reason: ${record.reason.replace(/-/g, ' ')}`, 25, yPos)
      yPos += 5
      if (record.reason === 'dispatch' && record.dispatch_brand) {
        doc.text(`Brand: ${record.dispatch_brand}`, 25, yPos)
        yPos += 5
      }
    }
    if (record.notes) {
      doc.text(`Notes: ${record.notes}`, 25, yPos)
      yPos += 7
    }

    if (yPos > pageHeight - 60) {
      doc.addPage()
      yPos = 20
    }

    const tableData = (record.stock_out_items || []).map((item) => [
      item.raw_materials?.name || 'N/A',
      item.raw_materials?.code || 'N/A',
      `${parseFloat(item.quantity || 0).toFixed(2)} ${item.raw_materials?.unit || ''}`
    ])

    autoTable(doc, {
      startY: yPos,
      head: [['Material', 'Code', 'Quantity']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 20, right: 20 }
    })

    const finalY = doc.lastAutoTable?.finalY || yPos
    doc.setFontSize(8)
    doc.text(
      `This report was generated on ${new Date().toLocaleString()} by ${session?.full_name || 'System'}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    )

    doc.save(`stock_out_${record.id}.pdf`)
  }

  const handleExportStockOut = (format, record) => {
    if (!record) return
    switch (format) {
      case 'csv':
        downloadStockOutCSV(record)
        break
      case 'excel':
        downloadStockOutExcel(record).catch((err) => {
          console.error('Error generating stock-out Excel:', err)
          setAlert({ type: 'error', message: err.message || 'Failed to generate Excel.' })
        })
        break
      case 'pdf':
        downloadStockOutPDF(record)
        break
      default:
        break
    }
  }

  // Download allocation requests as PDF with date range filter (outlet-wise, no page cut inside an outlet)
  const [downloadingAllocationPdf, setDownloadingAllocationPdf] = useState(false)
  const downloadAllocationRequestsPDF = (mode = 'all') => {
    const fromDate = new Date(pdfDateRange.from)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(pdfDateRange.to)
    toDate.setHours(23, 59, 59, 999)
    
    const isInRange = (req) => {
      const reqDate = new Date(req.request_date)
      return reqDate >= fromDate && reqDate <= toDate
    }
    
    const filteredRequests = allocationRequests
      .filter(isInRange)
      .filter((req) => {
        if (mode === 'requested') return !req.is_packed
        if (mode === 'confirmed') return !!req.is_packed
        return true
      })
    
    if (filteredRequests.length === 0) {
      const emptyMessage =
        mode === 'requested'
          ? `No requested (pending) allocation requests available for the selected date range.`
          : mode === 'confirmed'
            ? `No confirmed (packed) allocation requests available for the selected date range.`
            : `No allocation requests available for the selected date range.`
      setAlert({
        type: 'error',
        message: emptyMessage
      })
      return
    }

    setDownloadingAllocationPdf(true)
    try {
      const session = getSession()
      const doc = new jsPDF('p', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 20
      const safeBottom = pageHeight - 18

      // Aggregate total quantity per material across all filtered requests
      const totalByMaterial = new Map()
      filteredRequests.forEach((req) => {
        (req.allocation_request_items || []).forEach((item) => {
          const id = item.raw_material_id || item.raw_materials?.id
          const name = item.raw_materials?.name || 'N/A'
          const code = item.raw_materials?.code || '—'
          const unit = item.raw_materials?.unit || ''
          const qty = parseFloat(item.quantity ?? 0)
          const key = id || `${name}|${code}|${unit}`
          if (!totalByMaterial.has(key)) {
            totalByMaterial.set(key, { name, code, unit, totalQty: 0 })
          }
          totalByMaterial.get(key).totalQty += qty
        })
      })
      const summaryRows = Array.from(totalByMaterial.values())
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((r) => [
          r.name,
          r.code,
          r.totalQty.toFixed(2),
          r.unit
        ])

      // Group by outlet (outlet_id), preserve request order per outlet
      const byOutlet = new Map()
      filteredRequests.forEach((req) => {
        const key = req.outlet_id || req.outlets?.id || 'unknown'
        if (!byOutlet.has(key)) {
          byOutlet.set(key, {
            name: req.outlets?.name || 'Unknown Outlet',
            code: req.outlets?.code || '',
            requests: []
          })
        }
        byOutlet.get(key).requests.push(req)
      })
      const outletList = Array.from(byOutlet.entries())
        .map(([_, info]) => info)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

      // Format date range for display
      const fromDateStr = new Date(pdfDateRange.from).toLocaleDateString()
      const toDateStr = new Date(pdfDateRange.to).toLocaleDateString()
      const dateRangeDisplay = fromDateStr === toDateStr 
        ? fromDateStr 
        : `${fromDateStr} to ${toDateStr}`

      // —— Page 1: Total quantity summary ——
      let yPos = margin
      doc.setFontSize(20)
      doc.setFont(undefined, 'bold')
      doc.text('Gastronomix', pageWidth / 2, yPos, { align: 'center' })
      yPos += 8
      doc.setFontSize(14)
      doc.setFont(undefined, 'normal')
      const reportTypeLabel =
        mode === 'requested'
          ? 'Requested (Pending)'
          : mode === 'confirmed'
            ? 'Confirmed (Packed)'
            : 'All'
      doc.text(
        `Allocation Requests (${reportTypeLabel})`,
        pageWidth / 2,
        yPos,
        { align: 'center' }
      )
      yPos += 6
      doc.setFontSize(11)
      doc.setFont(undefined, 'bold')
      doc.text(
        `Date Range: ${dateRangeDisplay}`,
        pageWidth / 2,
        yPos,
        { align: 'center' }
      )
      yPos += 5
      doc.setFontSize(9)
      doc.setFont(undefined, 'normal')
      doc.setTextColor(100, 100, 100)
      doc.text(
        `Generated: ${new Date().toLocaleString()} • ${session?.cloud_kitchen_name || 'Cloud Kitchen'}`,
        pageWidth / 2,
        yPos,
        { align: 'center' }
      )
      doc.setTextColor(0, 0, 0)
      yPos += 12

      doc.setFontSize(12)
      doc.setFont(undefined, 'bold')
      const summaryTitle =
        mode === 'requested'
          ? 'Total quantity requested (pending, all outlets)'
          : mode === 'confirmed'
            ? 'Total quantity confirmed (packed, all outlets)'
            : 'Total quantity requested (all outlets)'
      doc.text(summaryTitle, margin, yPos)
      yPos += 8

      if (summaryRows.length > 0) {
        autoTable(doc, {
          startY: yPos,
          head: [['Material', 'Code', 'Total quantity', 'Unit']],
          body: summaryRows,
          theme: 'striped',
          headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
          styles: { fontSize: 9, cellPadding: 3 },
          margin: { left: margin, right: margin },
          rowPageBreak: 'avoid'
        })
        yPos = doc.lastAutoTable?.finalY ?? yPos
      } else {
        doc.setFont(undefined, 'normal')
        doc.setFontSize(10)
        doc.text('No items in requests.', margin, yPos)
      }

      // —— From page 2: Outlet-wise requests (multiple outlets per page when they fit; flow to next page when an outlet's content would be cut)
      doc.addPage()
      let yPosOut = margin
      const minSpaceForOutletHeader = 15

      outletList.forEach((outlet) => {
        if (yPosOut + minSpaceForOutletHeader > safeBottom) {
          doc.addPage()
          yPosOut = margin
        }

        doc.setFontSize(12)
        doc.setFont(undefined, 'bold')
        const outletTitle = outlet.code
          ? `${outlet.name} (${outlet.code})`
          : outlet.name
        doc.text(outletTitle, margin, yPosOut)
        yPosOut += 7

        outlet.requests.forEach((req) => {
          doc.setFont(undefined, 'normal')
          doc.setFontSize(9)
          const reqDate = new Date(req.created_at).toLocaleString()
          const requestedBy = req.users?.full_name || '—'
          const supervisorName = req.supervisor_name || '—'
          doc.text(`Request: ${req.id.substring(0, 8)} • Requested by: ${requestedBy} • Supervisor: ${supervisorName} • ${reqDate}`, margin, yPosOut)
          yPosOut += 5

          const items = req.allocation_request_items || []
          const tableData = items.map((item) => [
            item.raw_materials?.name || 'N/A',
            item.raw_materials?.code || '—',
            `${parseFloat(item.quantity ?? 0).toFixed(2)}`,
            item.raw_materials?.unit || ''
          ])

          if (tableData.length > 0) {
            const tableHeightEstimate = 8 + tableData.length * 4
            if (yPosOut + tableHeightEstimate > safeBottom) {
              doc.addPage()
              yPosOut = margin
            }
            autoTable(doc, {
              startY: yPosOut,
              head: [['Material', 'Code', 'Quantity', 'Unit']],
              body: tableData,
              theme: 'striped',
              headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
              styles: { fontSize: 8, cellPadding: 2 },
              margin: { left: margin, right: margin },
              rowPageBreak: 'avoid'
            })
            yPosOut = doc.lastAutoTable?.finalY ?? yPosOut
            yPosOut += 6
          }

          if (yPosOut > safeBottom) {
            doc.addPage()
            yPosOut = margin
          }
        })
      })

      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(
          `Generated on ${new Date().toLocaleString()} by ${session?.full_name || 'System'} • Page ${p} of ${totalPages}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: 'center' }
        )
        doc.setTextColor(0, 0, 0)
      }

      const modeSuffix =
        mode === 'requested'
          ? 'requested_pending'
          : mode === 'confirmed'
            ? 'confirmed_packed'
            : 'all'
      const dateRangeSuffix = pdfDateRange.from === pdfDateRange.to
        ? pdfDateRange.from
        : `${pdfDateRange.from}_to_${pdfDateRange.to}`
      const filename = `allocation_requests_${modeSuffix}_${dateRangeSuffix}.pdf`
      doc.save(filename)
      const successMessage =
        mode === 'requested'
          ? 'Requested (pending) allocation PDF downloaded.'
          : mode === 'confirmed'
            ? 'Confirmed (packed) allocation PDF downloaded.'
            : 'Allocation requests PDF downloaded.'
      setAlert({ type: 'success', message: successMessage })
    } catch (err) {
      console.error('Error generating allocation PDF:', err)
      setAlert({ type: 'error', message: err.message || 'Failed to generate PDF.' })
    } finally {
      setDownloadingAllocationPdf(false)
    }
  }

  // Download kitchen (self) stock-out records, filtered by the PDF date range.
  // Pass 'all' to include every reason, or a specific reason value.
  const downloadKitchenStockOutPDF = (reason) => {
    const isAll = reason === 'all'
    const fromDate = new Date(kitchenPdfDateRange.from)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(kitchenPdfDateRange.to)
    toDate.setHours(23, 59, 59, 999)

    const reasonLabel = isAll
      ? 'All Reasons'
      : KITCHEN_REASON_OPTIONS.find((o) => o.value === reason)?.label ||
        reason.replace(/-/g, ' ')

    const records = kitchenStockOutRecords.filter((r) => {
      if (!isAll && r.reason !== reason) return false
      const d = new Date(r.allocation_date)
      return d >= fromDate && d <= toDate
    })

    if (records.length === 0) {
      setAlert({
        type: 'error',
        message: `No ${reasonLabel} stock-out records available for the selected date range.`
      })
      return
    }

    setDownloadingKitchenPdf(reason)
    try {
      const session = getSession()
      const doc = new jsPDF('p', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 20
      const safeBottom = pageHeight - 18

      // Aggregate total quantity per material across all records for this reason
      const totalByMaterial = new Map()
      records.forEach((rec) => {
        (rec.stock_out_items || []).forEach((item) => {
          const rm = item.raw_materials
          const id = item.raw_material_id || rm?.id
          const name = rm?.name || 'N/A'
          const code = rm?.code || '—'
          const unit = rm?.unit || ''
          const qty = parseFloat(item.quantity ?? 0)
          const key = id || `${name}|${code}|${unit}`
          if (!totalByMaterial.has(key)) {
            totalByMaterial.set(key, { name, code, unit, totalQty: 0 })
          }
          totalByMaterial.get(key).totalQty += qty
        })
      })
      const summaryRows = Array.from(totalByMaterial.values())
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((r) => [r.name, r.code, r.totalQty.toFixed(2), r.unit])

      const fromDateStr = new Date(kitchenPdfDateRange.from).toLocaleDateString()
      const toDateStr = new Date(kitchenPdfDateRange.to).toLocaleDateString()
      const dateRangeDisplay =
        fromDateStr === toDateStr ? fromDateStr : `${fromDateStr} to ${toDateStr}`

      // —— Page 1: Total quantity summary ——
      let yPos = margin
      doc.setFontSize(20)
      doc.setFont(undefined, 'bold')
      doc.text('Gastronomix', pageWidth / 2, yPos, { align: 'center' })
      yPos += 8
      doc.setFontSize(14)
      doc.setFont(undefined, 'normal')
      doc.text(`Kitchen Stock-Out — ${reasonLabel}`, pageWidth / 2, yPos, { align: 'center' })
      yPos += 6
      doc.setFontSize(11)
      doc.setFont(undefined, 'bold')
      doc.text(`Date Range: ${dateRangeDisplay}`, pageWidth / 2, yPos, { align: 'center' })
      yPos += 5
      doc.setFontSize(9)
      doc.setFont(undefined, 'normal')
      doc.setTextColor(100, 100, 100)
      doc.text(
        `Generated: ${new Date().toLocaleString()} • ${session?.cloud_kitchen_name || 'Cloud Kitchen'} • ${records.length} record(s)`,
        pageWidth / 2,
        yPos,
        { align: 'center' }
      )
      doc.setTextColor(0, 0, 0)
      yPos += 12

      doc.setFontSize(12)
      doc.setFont(undefined, 'bold')
      doc.text(`Total quantity (${reasonLabel})`, margin, yPos)
      yPos += 8

      if (summaryRows.length > 0) {
        autoTable(doc, {
          startY: yPos,
          head: [['Material', 'Code', 'Total quantity', 'Unit']],
          body: summaryRows,
          theme: 'striped',
          headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
          styles: { fontSize: 9, cellPadding: 3 },
          margin: { left: margin, right: margin },
          rowPageBreak: 'avoid'
        })
        yPos = doc.lastAutoTable?.finalY ?? yPos
      } else {
        doc.setFont(undefined, 'normal')
        doc.setFontSize(10)
        doc.text('No items in these records.', margin, yPos)
      }

      // —— From page 2: record-wise detail ——
      doc.addPage()
      let yPosD = margin
      records.forEach((rec) => {
        if (yPosD + 15 > safeBottom) {
          doc.addPage()
          yPosD = margin
        }

        doc.setFontSize(10)
        doc.setFont(undefined, 'bold')
        let recHeader = `${new Date(rec.allocation_date).toLocaleDateString()} • ${
          rec.stock_out_items?.length || 0
        } item(s)`
        if (isAll && rec.reason) {
          recHeader += ` • ${rec.reason.replace(/-/g, ' ')}`
        }
        if (rec.reason === 'dispatch' && rec.dispatch_brand) {
          recHeader += ` • Brand: ${rec.dispatch_brand}`
        }
        if (rec.reason === 'inter-cloud-kitchen' && rec.destination_kitchen) {
          recHeader += ` • → ${rec.destination_kitchen.name}`
        }
        doc.text(recHeader, margin, yPosD)
        yPosD += 5

        if (rec.notes) {
          doc.setFont(undefined, 'normal')
          doc.setFontSize(8)
          doc.text(`Notes: ${rec.notes}`, margin, yPosD)
          yPosD += 5
        }

        const tableData = (rec.stock_out_items || []).map((item) => [
          item.raw_materials?.name || 'N/A',
          item.raw_materials?.code || '—',
          `${parseFloat(item.quantity ?? 0).toFixed(2)}`,
          item.raw_materials?.unit || ''
        ])

        if (tableData.length > 0) {
          const tableHeightEstimate = 8 + tableData.length * 4
          if (yPosD + tableHeightEstimate > safeBottom) {
            doc.addPage()
            yPosD = margin
          }
          autoTable(doc, {
            startY: yPosD,
            head: [['Material', 'Code', 'Quantity', 'Unit']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [225, 187, 7], textColor: [0, 0, 0], fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 2 },
            margin: { left: margin, right: margin },
            rowPageBreak: 'avoid'
          })
          yPosD = doc.lastAutoTable?.finalY ?? yPosD
          yPosD += 6
        }

        if (yPosD > safeBottom) {
          doc.addPage()
          yPosD = margin
        }
      })

      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(
          `Generated on ${new Date().toLocaleString()} by ${session?.full_name || 'System'} • Page ${p} of ${totalPages}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: 'center' }
        )
        doc.setTextColor(0, 0, 0)
      }

      const dateRangeSuffix =
        kitchenPdfDateRange.from === kitchenPdfDateRange.to
          ? kitchenPdfDateRange.from
          : `${kitchenPdfDateRange.from}_to_${kitchenPdfDateRange.to}`
      doc.save(`kitchen_stock_out_${reason}_${dateRangeSuffix}.pdf`)
      setAlert({ type: 'success', message: `${reasonLabel} stock-out PDF downloaded.` })
    } catch (err) {
      console.error('Error generating kitchen stock-out PDF:', err)
      setAlert({ type: 'error', message: err.message || 'Failed to generate PDF.' })
    } finally {
      setDownloadingKitchenPdf(null)
    }
  }

  // Download Stock Out Challan for a stock_out record
  const downloadStockOutChallan = async (stockOutId, requestData = null) => {
    try {
      const session = getSession()
      if (!session) {
        setAlert({ type: 'error', message: 'Session not found.' })
        return
      }

      // Fetch stock_out record with items and allocation request details
      const { data: stockOutRecord, error: stockOutError } = await supabase
        .from('stock_out')
        .select(`
          *,
          stock_out_items (
            raw_material_id,
            quantity
          ),
          allocation_requests (
            outlets (
              name,
              code
            ),
            supervisor_name,
            request_date,
            users (
              full_name
            )
          )
        `)
        .eq('id', stockOutId)
        .single()

      if (stockOutError || !stockOutRecord) {
        throw new Error('Stock out record not found')
      }

      const allocationRequest = Array.isArray(stockOutRecord.allocation_requests) 
        ? stockOutRecord.allocation_requests[0] 
        : stockOutRecord.allocation_requests

      const outlet = allocationRequest?.outlets || requestData?.outlets
      const outletCode = outlet?.code || 'UNKNOWN'

      // Generate challan number from stock_out.created_at timestamp
      const challanTimestamp = new Date(stockOutRecord.created_at)
      const dd = String(challanTimestamp.getDate()).padStart(2, '0')
      const mm = String(challanTimestamp.getMonth() + 1).padStart(2, '0')
      const yy = String(challanTimestamp.getFullYear()).slice(-2)
      const hh = String(challanTimestamp.getHours()).padStart(2, '0')
      const min = String(challanTimestamp.getMinutes()).padStart(2, '0')
      const challanNumber = `${dd}${mm}${yy}${hh}${min}/${outletCode}`

      // Fetch raw material details for stock_out_items
      const materialIds = stockOutRecord.stock_out_items.map(item => item.raw_material_id)
      const { data: materialsData, error: materialsError } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit')
        .in('id', materialIds)

      if (materialsError) throw materialsError

      const materialsMap = {}
      ;(materialsData || []).forEach(m => {
        materialsMap[m.id] = m
      })

      // Fetch latest batch costs for all materials
      const { data: batchData, error: batchError } = await supabase
        .from('stock_in_batches')
        .select('raw_material_id, unit_cost, gst_percent')
        .in('raw_material_id', materialIds)
        .order('created_at', { ascending: false })

      if (batchError) {
        console.error('Error fetching batch rates:', batchError)
      }

      // Map material_id to latest GST-inclusive rate from the latest batch
      const rateMap = {}
      if (batchData) {
        batchData.forEach(batch => {
          if (!rateMap[batch.raw_material_id]) {
            const unitCost = parseFloat(batch.unit_cost || 0)
            const gstPercent = parseFloat(batch.gst_percent || 0)
            const gstInclusiveRate = unitCost * (1 + gstPercent / 100)
            rateMap[batch.raw_material_id] = gstInclusiveRate
          }
        })
      }

      // Prepare table data from stock_out_items
      const tableRows = stockOutRecord.stock_out_items.map((item, index) => {
        const material = materialsMap[item.raw_material_id] || {}
        const quantity = parseFloat(item.quantity || 0)
        const rate = rateMap[item.raw_material_id] || 0
        const amount = quantity * rate

        return {
          srNo: index + 1,
          materialName: material.name || 'N/A',
          hsn: '', // Blank for manual entry
          uom: material.unit || '',
          quantity: quantity.toFixed(2),
          rate: rate.toFixed(2),
          amount: amount.toFixed(2)
        }
      })

      // Calculate totals
      const grandTotal = tableRows.reduce((sum, row) => sum + parseFloat(row.amount), 0)

      // Create PDF
      const doc = new jsPDF('p', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 15

      let yPos = margin

      // Title
      doc.setFontSize(18)
      doc.setFont(undefined, 'bold')
      doc.text('TRANSFER CHALLAN', pageWidth / 2, yPos, { align: 'center' })
      yPos += 12

      // Information + Notes split box
      doc.setFontSize(10)
      const boxX = margin
      const boxY = yPos
      const boxWidth = pageWidth - 2 * margin
      const boxHeight = 32

      const leftBoxWidth = Math.floor(boxWidth * 0.4)
      const rightBoxWidth = boxWidth - leftBoxWidth
      const rightBoxX = boxX + leftBoxWidth

      doc.rect(boxX, boxY, leftBoxWidth, boxHeight)
      doc.rect(rightBoxX, boxY, rightBoxWidth, boxHeight)

      let leftY = boxY + 5
      doc.setFont(undefined, 'bold')
      doc.text(`Outlet: ${outlet?.name || 'N/A'}`, boxX + 3, leftY)
      leftY += 4.5
      doc.setFont(undefined, 'normal')
      doc.text(`Outlet Code: ${outletCode}`, boxX + 3, leftY)
      leftY += 4.5
      doc.text(`Supervisor: ${allocationRequest?.supervisor_name || allocationRequest?.users?.full_name || 'N/A'}`, boxX + 3, leftY)
      leftY += 4.5
      doc.text(`Request Date: ${allocationRequest?.request_date ? new Date(allocationRequest.request_date).toLocaleDateString() : 'N/A'}`, boxX + 3, leftY)
      leftY += 4.5
      doc.text('Place of Supply: Karnataka', boxX + 3, leftY)
      leftY += 4.5
      doc.setFont(undefined, 'bold')
      doc.text(`Challan Number: ${challanNumber}`, boxX + 3, leftY)

      doc.setFont(undefined, 'bold')
      doc.text('Notes', rightBoxX + 3, boxY + 5)
      doc.setFont(undefined, 'normal')
      doc.setFontSize(8)
      const notesValue = stockOutRecord.notes?.trim() || '—'
      const wrappedNotes = doc.splitTextToSize(notesValue, rightBoxWidth - 6)
      const notesStartY = boxY + 8
      const notesBottomPadding = 2
      const approxLineHeight = 3.5
      const availableHeight = boxY + boxHeight - notesStartY - notesBottomPadding
      const maxNoteLines = Math.max(1, Math.floor(availableHeight / approxLineHeight))
      doc.text(wrappedNotes.slice(0, maxNoteLines), rightBoxX + 3, notesStartY)
      doc.setFontSize(10)
      
      yPos = boxY + boxHeight + 10

      // Materials Table (as wide as info box + centered)
      const challanTableWidth = boxWidth
      const challanTableMarginX = boxX
      autoTable(doc, {
        startY: yPos,
        head: [['Sr. No', 'Material Name', 'HSN/SAC', 'UOM', 'Quantity', 'Rate', 'Amount']],
        body: tableRows.map(row => [
          row.srNo,
          row.materialName,
          row.hsn,
          row.uom,
          row.quantity,
          row.rate,
          row.amount
        ]),
        foot: [[
          '',
          '',
          '',
          '',
          { content: 'Total', styles: { halign: 'right', fontStyle: 'bold' } },
          { content: `₹${grandTotal.toFixed(2)}`, colSpan: 2, styles: { halign: 'center', fontStyle: 'bold' } }
        ]],
        showFoot: 'lastPage',
        theme: 'grid',
        headStyles: { 
          fillColor: [240, 240, 240], 
          textColor: [0, 0, 0], 
          fontStyle: 'bold',
          fontSize: 8,
          lineWidth: 0.1,
          lineColor: [0, 0, 0],
          cellPadding: 2
        },
        styles: { 
          fontSize: 8,
          cellPadding: 2,
          minCellHeight: 5,
          lineWidth: 0.1,
          lineColor: [0, 0, 0]
        },
        footStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          fontSize: 8,
          cellPadding: 2,
          lineWidth: 0.1,
          lineColor: [0, 0, 0]
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 14 },
          1: { halign: 'left', cellWidth: 58 },
          2: { halign: 'center', cellWidth: 23 },
          3: { halign: 'center', cellWidth: 19 },
          4: { halign: 'right', cellWidth: 22 },
          5: { halign: 'right', cellWidth: 22 },
          6: { halign: 'right', cellWidth: 22 }
        },
        tableWidth: challanTableWidth,
        margin: { left: challanTableMarginX, right: challanTableMarginX }
      })

      yPos = doc.lastAutoTable.finalY + 2

      yPos += 4

      // Signature Section - 3 boxes
      const sigBoxWidth = (pageWidth - 2 * margin) / 3
      const sigBoxHeight = 24
      const requiredSignatureSpace = sigBoxHeight + 18
      if (yPos + requiredSignatureSpace > pageHeight - margin) {
        doc.addPage()
        yPos = margin
      }
      const sigBoxY = yPos

      // Left box - Terms & Conditions
      doc.rect(margin, sigBoxY, sigBoxWidth, sigBoxHeight)
      doc.setFontSize(8)
      doc.setFont(undefined, 'bold')
      doc.text('Terms & Conditions', margin + 2, sigBoxY + 4)
      doc.setFont(undefined, 'normal')
      doc.setFontSize(7)
      doc.text('SUBJECT TO BENGALURU', margin + 2, sigBoxY + 8)
      doc.text('JURISDICTION', margin + 2, sigBoxY + 11.5)

      // Middle box - Receiver Sign
      doc.rect(margin + sigBoxWidth, sigBoxY, sigBoxWidth, sigBoxHeight)
      doc.setFontSize(8)
      doc.setFont(undefined, 'bold')
      doc.text('Receiver Sign', margin + sigBoxWidth + 2, sigBoxY + 4)
      doc.setFont(undefined, 'normal')
      doc.setFontSize(7)
      doc.text('___________________', margin + sigBoxWidth + 2, sigBoxY + 20)

      // Right box - Authorised Sign
      doc.rect(margin + 2 * sigBoxWidth, sigBoxY, sigBoxWidth, sigBoxHeight)
      doc.setFontSize(8)
      doc.setFont(undefined, 'bold')
      doc.text('Authorised Sign', margin + 2 * sigBoxWidth + 2, sigBoxY + 4)
      doc.setFont(undefined, 'normal')
      doc.setFontSize(7)
      doc.text('___________________', margin + 2 * sigBoxWidth + 2, sigBoxY + 20)

      // Bottom-left: Cloud Kitchen + Purchase Manager
      const bottomY = pageHeight - 15
      doc.setFontSize(8)
      doc.setFont(undefined, 'normal')
      doc.text(`Cloud Kitchen: ${session?.cloud_kitchen_name || 'N/A'}`, margin, bottomY)
      doc.text(`Purchase Manager: ${session?.full_name || 'N/A'}`, margin, bottomY + 4)

      // Add page numbers on all pages
      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        doc.setFontSize(8)
        doc.setTextColor(0, 0, 0)
        doc.text(
          `Page ${p} of ${totalPages}`,
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        )
      }

      // Save PDF
      const filename = `stock-out-challan-${challanNumber.replace('/', '-')}.pdf`
      doc.save(filename)
      setAlert({ type: 'success', message: 'Stock Out Challan downloaded successfully.' })

    } catch (err) {
      console.error('Error generating Stock Out Challan:', err)
      setAlert({ type: 'error', message: err.message || 'Failed to generate challan PDF.' })
    }
  }

  // Open self stock out modal
  const openSelfStockOutModal = async () => {
    setIsSelfStockOut(true)
    setSelfStockOutReason('')
    setSelfStockOutNotes('')
    setTransferToCloudKitchenId('')
    setOtherCloudKitchens([])
    setSelectedDispatchBrand('')
    setDispatchBrands([])
    const session = getSession()

    try {
      // Fetch all active raw materials
      const { data: materials, error: matError } = await supabase
        .from('raw_materials')
        .select('id, name, code, unit, category, material_type')
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
      setWastageImageFile(null)
      setWastageImageError('')
      setOpenMaterialDropdownRow(-1)
      setMaterialDropdownSearchTerm('')
      setShowSelfStockOutModal(true)
    } catch (err) {
      console.error('Error loading materials:', err)
      setAlert({ type: 'error', message: 'Failed to load materials' })
    }
  }

  const makeEmptySelfStockOutRow = () => ({
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    raw_material_id: null,
    name: null,
    code: null,
    unit: null,
    allocated_quantity: '',
    current_inventory: 0,
    todays_total: 0
  })

  // Remove material from self stock out
  const removeMaterialFromSelfStockOut = (index) => {
    setSelfStockOutItems(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : [makeEmptySelfStockOutRow()]
    })
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
    setSelfStockOutItems(prev => {
      const next = prev.filter((_, i) => !selectedStockOutRows.has(i))
      return next.length > 0 ? next : [makeEmptySelfStockOutRow()]
    })
    setSelectedStockOutRows(new Set())
  }

  // Handle dispatch brand selection - auto-populate materials
  const handleDispatchBrandChange = async (brandId) => {
    setSelectedDispatchBrand(brandId)
    
    if (!brandId) {
      // Clear to empty rows if brand is deselected
      setSelfStockOutItems([makeEmptySelfStockOutRow(), makeEmptySelfStockOutRow(), makeEmptySelfStockOutRow()])
      return
    }

    const session = getSession()
    if (!session?.cloud_kitchen_id) return

    try {
      // Fetch brand dispatch items with material details
      const { data: brandItems, error: itemsError } = await supabase
        .from('brand_dispatch_items')
        .select(`
          id,
          raw_material_id,
          sort_order,
          raw_materials (
            id,
            name,
            code,
            unit,
            material_type
          )
        `)
        .eq('brand_dispatch_id', brandId)
        .order('sort_order')

      if (itemsError) throw itemsError

      if (!brandItems || brandItems.length === 0) {
        setAlert({ type: 'info', message: 'No materials configured for this brand yet. Add materials in Admin Settings.' })
        setSelfStockOutItems([makeEmptySelfStockOutRow(), makeEmptySelfStockOutRow(), makeEmptySelfStockOutRow()])
        return
      }

      // Fetch inventory and today's totals for all materials in parallel
      const materialIds = brandItems.map(item => item.raw_material_id)
      
      // Fetch inventory for all materials
      const { data: inventoryData, error: invError } = await supabase
        .from('inventory')
        .select('raw_material_id, quantity')
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .in('raw_material_id', materialIds)

      const inventoryMap = {}
      if (inventoryData) {
        inventoryData.forEach(inv => {
          inventoryMap[inv.raw_material_id] = parseFloat(inv.quantity || 0)
        })
      }

      // Fetch today's allocation totals
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

      const todaysTotalsMap = {}
      if (todayRequests) {
        todayRequests.forEach(req => {
          req.allocation_request_items.forEach(item => {
            if (materialIds.includes(item.raw_material_id)) {
              todaysTotalsMap[item.raw_material_id] = 
                (todaysTotalsMap[item.raw_material_id] || 0) + parseFloat(item.quantity || 0)
            }
          })
        })
      }

      // Build rows from brand items
      const newRows = brandItems.map(item => ({
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        raw_material_id: item.raw_materials.id,
        name: item.raw_materials.name,
        code: item.raw_materials.code,
        unit: item.raw_materials.unit,
        material_type: item.raw_materials.material_type,
        allocated_quantity: '',
        current_inventory: inventoryMap[item.raw_materials.id] || 0,
        todays_total: todaysTotalsMap[item.raw_materials.id] || 0
      }))

      // Add one empty row at the end for manual additions
      newRows.push(makeEmptySelfStockOutRow())

      setSelfStockOutItems(newRows)
      setSelectedStockOutRows(new Set())
    } catch (err) {
      console.error('Error loading brand materials:', err)
      setAlert({ type: 'error', message: 'Failed to load brand materials' })
      setSelfStockOutItems([makeEmptySelfStockOutRow(), makeEmptySelfStockOutRow(), makeEmptySelfStockOutRow()])
    }
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
        const isLastRow = index === updated.length - 1
        const wasMaterialUnselected = !updated[index]?.raw_material_id
        updated[index] = {
          raw_material_id: materialId,
          name: material.name,
          code: material.code,
          unit: material.unit,
          material_type: material.material_type,
          allocated_quantity: '',
          todays_total: todaysTotal,
          current_inventory: currentInventory
        }
        if (isLastRow && wasMaterialUnselected) {
          updated.push(makeEmptySelfStockOutRow())
        }
        return updated
      })
    } catch (err) {
      console.error('Error fetching inventory:', err)
      // Still update the material info even if inventory fetch fails
      setSelfStockOutItems(prev => {
        const updated = [...prev]
        const isLastRow = index === updated.length - 1
        const wasMaterialUnselected = !updated[index]?.raw_material_id
        updated[index] = {
          raw_material_id: materialId,
          name: material.name,
          code: material.code,
          unit: material.unit,
          material_type: material.material_type,
          allocated_quantity: '',
          current_inventory: 0
        }
        if (isLastRow && wasMaterialUnselected) {
          updated.push(makeEmptySelfStockOutRow())
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
        setMaterialDropdownPosition(getAnchoredDropdownStyle(rect))
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

  // Focus search input and update position when the "add item" dropdown opens
  useEffect(() => {
    if (showAddItemDropdown && showAllocationModal) {
      const trigger = document.querySelector('[data-add-item-trigger]')
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        setAddItemDropdownPosition(getAnchoredDropdownStyle(rect))
      }
      const t = setTimeout(() => addItemSearchRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [showAddItemDropdown, showAllocationModal])

  // Close "add item" dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showAddItemDropdown && !e.target.closest('.add-item-dropdown-container')) {
        setShowAddItemDropdown(false)
        setAddItemSearchTerm('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddItemDropdown])

  // Open allocation modal
  const openAllocationModal = async (request) => {
    setIsSelfStockOut(false)
    setSelectedRequest(request)
    setChallanNotes('')
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
      today_total: 0,
      addedByPm: false
    }))

    setAllocationItems(items)
    setLastAllocationByMaterial({})
    setShowAddItemDropdown(false)
    setAddItemSearchTerm('')

    // Full active materials catalog, for the "add item" dropdown (lets the PM add a
    // material the supervisor forgot before packing)
    supabase
      .from('raw_materials')
      .select('id, name, code, unit, category, material_type')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          console.error('Error loading materials for add-item dropdown:', error)
          return
        }
        setAllMaterials(data || [])
      })

    // Fetch current inventory for all materials
    try {
      const materialIds = items.map(item => item.raw_material_id)

      // Previous allocation (date + qty) of each material to this outlet
      fetchLastOutletAllocationByMaterial(request.outlet_id, materialIds)
        .then(setLastAllocationByMaterial)
        .catch(err => console.error('Error fetching previous allocations:', err))

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

  // Materials available to add to the requisition: active, not already on the list
  const getFilteredMaterialsForAddItem = () => {
    const usedIds = new Set(allocationItems.map(item => item.raw_material_id))
    const search = addItemSearchTerm.trim().toLowerCase()
    return allMaterials.filter(material => {
      if (usedIds.has(material.id)) return false
      if (!search) return true
      return material.name.toLowerCase().includes(search) ||
        (material.code || '').toLowerCase().includes(search)
    })
  }

  // PM adds a material the supervisor forgot to request. Appended with requested_quantity: 0
  // and addedByPm: true so it's visually distinct and only persisted once a quantity is set.
  const handleAddItemToAllocation = async (materialId) => {
    const material = allMaterials.find(m => m.id === materialId)
    if (!material) return

    setShowAddItemDropdown(false)
    setAddItemSearchTerm('')

    setAllocationItems(prev => [
      ...prev,
      {
        raw_material_id: material.id,
        name: material.name,
        code: material.code,
        unit: material.unit,
        requested_quantity: 0,
        allocated_quantity: 0,
        current_inventory: 0,
        today_total: 0,
        addedByPm: true
      }
    ])

    const session = getSession()
    try {
      const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('cloud_kitchen_id', session.cloud_kitchen_id)
        .eq('raw_material_id', materialId)
        .maybeSingle()

      if (invError) throw invError
      setInventoryData(prev => ({ ...prev, [materialId]: parseFloat(invData?.quantity || 0) }))

      if (selectedRequest?.outlet_id) {
        const prevAlloc = await fetchLastOutletAllocationByMaterial(selectedRequest.outlet_id, [materialId])
        setLastAllocationByMaterial(prev => ({ ...prev, ...prevAlloc }))
      }
    } catch (err) {
      console.error('Error fetching inventory for added item:', err)
    }
  }

  // Remove a PM-added item before submitting (original requested items aren't removable here)
  const removeAddedAllocationItem = (index) => {
    setAllocationItems(prev => prev.filter((item, i) => i !== index || !item.addedByPm))
  }

  // FIFO Allocation Logic (no-op when quantity <= 0). Returns { totalCost, totalQty } for inter-cloud transfer costing.
  // Delegates to the atomic fifo_consume RPC, which decrements stock_in_batches oldest-first
  // and records a stock_out_batch_consumption row per batch touched (so the stock-out is reversible).
  const allocateStockFIFO = async (stockOutId, rawMaterialId, quantity, cloudKitchenId) => {
    const qty = parseFloat(quantity)
    if (qty <= 0) return { totalCost: 0, totalQty: 0 }

    const { data, error } = await supabase.rpc('fifo_consume', {
      p_stock_out_id: stockOutId,
      p_raw_material_id: rawMaterialId,
      p_quantity: qty,
      p_cloud_kitchen_id: cloudKitchenId
    })

    if (error) throw error

    return {
      totalCost: parseFloat(data?.total_cost) || 0,
      totalQty: parseFloat(data?.total_consumed) || qty
    }
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

      if (selfStockOutReason === 'inter-cloud-kitchen') {
        if (!transferToCloudKitchenId || transferToCloudKitchenId === session.cloud_kitchen_id) {
          setAlert({ type: 'error', message: 'Please select the destination cloud kitchen to transfer to' })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }

      if (selfStockOutReason === 'wastage') {
        if (!wastageImageFile) {
          setAlert({ type: 'error', message: 'Please upload a photo of the wasted items (required for wastage).' })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
        if (wastageImageError) {
          setAlert({ type: 'error', message: wastageImageError })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }

      if (selfStockOutReason === 'cullinary-rnd' && !selfStockOutNotes.trim()) {
        setAlert({ type: 'error', message: 'Please mention what product the Culinary R&D is for.' })
        allocatingRef.current = false
        setAllocating(false)
        return
      }

      if (selfStockOutReason === 'dispatch' && !selectedDispatchBrand) {
        setAlert({ type: 'error', message: 'Please select a brand for dispatch stock out' })
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
            message: `Insufficient stock for ${item.name}. Available: ${availableInventory.toFixed(2)} ${item.unit}` 
          })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }
    } else {
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
            message: `Insufficient stock for ${item.name}. Available: ${availableInventory.toFixed(2)} ${item.unit}`
          })
          allocatingRef.current = false
          setAllocating(false)
          return
        }

        if (item.addedByPm && parseFloat(item.allocated_quantity) <= 0) {
          setAlert({
            type: 'error',
            message: `Enter a quantity for ${item.name}, or remove it — items you add need a quantity to be included.`
          })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }
    }

    try {
      // Regular requisition packing: handled atomically server-side via RPC.
      // The RPC creates the stock_out + items, FIFO-consumes (logging each batch
      // in stock_out_batch_consumption), and marks the request packed — all in one
      // transaction, so it can be cleanly reversed by cancel_allocation_packing.
      if (!isSelfStockOut) {
        // Persist any PM-added materials onto the requisition itself first, so the
        // original ask stays reconstructable even though it was extended after the
        // supervisor submitted it. TODO(audit): once server-side audit logging for
        // requisition edits lands (see docs/AUDIT_TRAIL_REQUIREMENTS.md, "PM adds
        // item to requisition"), this insert should move into a SECURITY DEFINER
        // RPC that logs it, matching the pack_allocation_request pattern.
        const pmAddedItems = allocationItems.filter(item => item.addedByPm)
        if (pmAddedItems.length > 0) {
          const { error: addItemsError } = await supabase
            .from('allocation_request_items')
            .insert(pmAddedItems.map(item => ({
              allocation_request_id: selectedRequest.id,
              raw_material_id: item.raw_material_id,
              quantity: parseFloat(item.allocated_quantity)
            })))

          if (addItemsError) throw addItemsError
        }

        const items = allocationItems.map((item) => ({
          raw_material_id: item.raw_material_id,
          quantity: parseFloat(item.allocated_quantity) || 0
        }))

        const { data: packResult, error: packError } = await supabase.rpc('pack_allocation_request', {
          p_allocation_request_id: selectedRequest.id,
          p_items: items,
          p_notes: challanNotes,
          p_acting_user_id: session.id
        })

        if (packError) throw packError

        if (packResult?.stock_out_id) {
          setLastStockOutId(packResult.stock_out_id)
        }

        setAlert({ type: 'success', message: 'Stock allocated successfully!', showChallanDownload: true })
        setShowAllocationModal(false)
        fetchAllocationRequests()
        return
      }

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
        if (selfStockOutReason === 'inter-cloud-kitchen') {
          stockOutPayload.transfer_to_cloud_kitchen_id = transferToCloudKitchenId
        }
        if (selfStockOutReason === 'dispatch') {
          const selectedBrand = dispatchBrands.find(b => b.id === selectedDispatchBrand)
          stockOutPayload.dispatch_brand = selectedBrand?.code || null
        }
      } else {
        // Regular stock out
        stockOutPayload.allocation_request_id = selectedRequest.id
        stockOutPayload.outlet_id = selectedRequest.outlet_id
        stockOutPayload.notes = challanNotes.trim() || null
      }

      const { data: stockOutData, error: stockOutError } = await supabase
        .from('stock_out')
        .insert(stockOutPayload)
        .select()
        .single()

      if (stockOutError) throw stockOutError

      // If wastage, upload image and update stock_out with wastage_image_url
      if (isSelfStockOut && selfStockOutReason === 'wastage' && wastageImageFile) {
        try {
          const wastageImageUrl = await uploadWastageImage(wastageImageFile, session, stockOutData.id)
          if (wastageImageUrl) {
            const { error: updateError } = await supabase
              .from('stock_out')
              .update({ wastage_image_url: wastageImageUrl })
              .eq('id', stockOutData.id)
            if (updateError) throw updateError
          }
        } catch (uploadErr) {
          console.error('Error uploading wastage image:', uploadErr)
          setAlert({ type: 'error', message: `Failed to upload wastage photo: ${uploadErr.message}` })
          allocatingRef.current = false
          setAllocating(false)
          return
        }
      }

      // For inter-cloud transfer, collect FIFO cost per item to create destination stock_in
      const interCloudFifoResults = []

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
          // Allocate stock using FIFO and update inventory (returns { totalCost, totalQty } for inter-cloud)
          const fifoResult = await allocateStockFIFO(
            stockOutData.id,
            item.raw_material_id,
            qty,
            session.cloud_kitchen_id
          )
          if (isSelfStockOut && selfStockOutReason === 'inter-cloud-kitchen') {
            interCloudFifoResults.push({
              raw_material_id: item.raw_material_id,
              quantity: qty,
              totalCost: fifoResult.totalCost,
              totalQty: fifoResult.totalQty
            })
          }

          // Note: inventory.quantity is automatically updated by the trigger
          // sync_inventory_quantity_from_batches when batches are updated via FIFO
        }
      }

      // Inter-cloud transfer: create destination stock_in, batches, and increment destination inventory
      if (isSelfStockOut && selfStockOutReason === 'inter-cloud-kitchen' && interCloudFifoResults.length > 0) {
        const destinationKitchenId = transferToCloudKitchenId
        const sourceKitchenName = session.cloud_kitchen_name || session.cloud_kitchen_id || 'Source kitchen'
        const totalTransferCost = interCloudFifoResults.reduce((sum, r) => sum + (r.totalCost || 0), 0)

        const { data: stockInData, error: stockInError } = await supabase
          .from('stock_in')
          .insert({
            cloud_kitchen_id: destinationKitchenId,
            received_by: session.id,
            receipt_date: new Date().toISOString().split('T')[0],
            supplier_name: null,
            invoice_number: null,
            total_cost: totalTransferCost,
            notes: `Transfer from ${sourceKitchenName}`,
            stock_in_type: 'inter_cloud',
            invoice_image_url: null,
            source_stock_out_id: stockOutData.id
          })
          .select()
          .single()

        if (stockInError) throw stockInError

        for (const row of interCloudFifoResults) {
          const unitCost = row.totalQty > 0 ? row.totalCost / row.totalQty : 0.01
          const { error: batchError } = await supabase
            .from('stock_in_batches')
            .insert({
              stock_in_id: stockInData.id,
              raw_material_id: row.raw_material_id,
              cloud_kitchen_id: destinationKitchenId,
              quantity_purchased: row.quantity,
              quantity_remaining: row.quantity,
              unit_cost: Math.max(0.01, unitCost),
              gst_percent: 0
            })

          if (batchError) throw batchError

          // Ensure destination inventory entry exists (trigger will set quantity from batches)
          const { data: destInv } = await supabase
            .from('inventory')
            .select('id')
            .eq('cloud_kitchen_id', destinationKitchenId)
            .eq('raw_material_id', row.raw_material_id)
            .maybeSingle()

          if (!destInv) {
            // Create inventory entry; trigger will set quantity from batches
            const { error: invInsErr } = await supabase
              .from('inventory')
              .insert({
                cloud_kitchen_id: destinationKitchenId,
                raw_material_id: row.raw_material_id,
                quantity: 0, // Trigger will update this
                updated_by: session.id
              })
            if (invInsErr) throw invInsErr
          }
          // Note: inventory.quantity is automatically updated by trigger when batches are inserted
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

      const successMessage = isSelfStockOut
        ? (selfStockOutReason === 'inter-cloud-kitchen'
            ? `Transfer completed successfully! Stock sent to ${otherCloudKitchens.find(c => c.id === transferToCloudKitchenId)?.name || 'destination'}.`
            : 'Self stock out completed successfully!')
        : 'Stock allocated successfully!'
      
      // Store stock_out ID for challan download
      if (!isSelfStockOut && stockOutData?.id) {
        setLastStockOutId(stockOutData.id)
      }
      
      setAlert({ type: 'success', message: successMessage, showChallanDownload: !isSelfStockOut })
      
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

  // Open the cancellation confirmation modal for a packed requisition.
  const handleCancelPacking = (request) => {
    if (!request?.id || cancelingId) return
    setCancelTarget(request)
  }

  // Cancel the packing of a requisition. Reverses FIFO consumption by restoring stock to the
  // exact batches it was taken from (via cancel_allocation_packing RPC), then reopens the request.
  // Only valid on the same day the packing was done; the RPC enforces this and returns a clear error.
  const confirmCancelPacking = async () => {
    const request = cancelTarget
    if (!request?.id || cancelingId) return

    const session = getSession()
    if (!session?.id) {
      setAlert({ type: 'error', message: 'Session expired. Please log in again.' })
      setCancelTarget(null)
      return
    }

    setCancelingId(request.id)
    try {
      const { data, error } = await supabase.rpc('cancel_allocation_packing', {
        p_allocation_request_id: request.id,
        p_acting_user_id: session.id
      })

      if (error) throw error

      const restored = parseFloat(data?.restored_qty) || 0
      setAlert({
        type: 'success',
        message: `Packing cancelled. ${restored > 0 ? `${restored} units returned to inventory.` : 'Stock returned to inventory.'}`
      })
      setCancelTarget(null)
      fetchAllocationRequests()
    } catch (err) {
      console.error('Error cancelling packing:', err)
      setAlert({ type: 'error', message: err.message || 'Failed to cancel packing. Please try again.' })
    } finally {
      setCancelingId(null)
    }
  }

  // Helper: request matches search by term (outlet name, code, requested by, supervisor name)
  const allocationRequestMatchesSearch = (request, term) => {
    if (!(term || '').trim()) return true
    const q = (term || '').toLowerCase()
    const outletName = request.outlets?.name?.toLowerCase() || ''
    const outletCode = request.outlets?.code?.toLowerCase() || ''
    const requestedBy = request.users?.full_name?.toLowerCase() || ''
    const supervisorName = (request.supervisor_name || '').toLowerCase()
    return (
      outletName.includes(q) ||
      outletCode.includes(q) ||
      requestedBy.includes(q) ||
      supervisorName.includes(q)
    )
  }

  const outletMatchesSearch = (request) => allocationRequestMatchesSearch(request, searchTerm)

  const todayStart = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()

  const isRequestDateToday = (request) => {
    const recordDate = new Date(request.request_date)
    recordDate.setHours(0, 0, 0, 0)
    return recordDate.getTime() === todayStart
  }

  // Segment 1: Today's requests (pending + packed for today), search applied, pending first then packed
  const todayRequests = allocationRequests
    .filter((r) => isRequestDateToday(r) && outletMatchesSearch(r))
    .sort((a, b) => {
      if (a.is_packed !== b.is_packed) return a.is_packed ? 1 : -1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  // Segment 2: Previous days — request_date < today; sort unpacked first then packed, then date desc
  const previousDaysRequests = allocationRequests
    .filter((r) => !isRequestDateToday(r) && outletMatchesSearch(r))
    .sort((a, b) => {
      if (a.is_packed !== b.is_packed) return a.is_packed ? 1 : -1
      const da = new Date(a.request_date).getTime()
      const db = new Date(b.request_date).getTime()
      if (da !== db) return db - da
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const outletPreviousDaysTotalPages =
    Math.ceil(previousDaysRequests.length / outletPreviousDaysPerPage) || 1
  const outletPreviousDaysStart =
    (outletPreviousDaysPage - 1) * outletPreviousDaysPerPage
  const outletPreviousDaysPaginated = previousDaysRequests.slice(
    outletPreviousDaysStart,
    outletPreviousDaysStart + outletPreviousDaysPerPage
  )

  // View all modal: filter previous-days requests by modal search, then paginate (15 per page)
  const viewAllFilteredRequests = previousDaysRequests.filter((r) =>
    allocationRequestMatchesSearch(r, viewAllSearchTerm)
  )
  const viewAllTotalPages = Math.ceil(viewAllFilteredRequests.length / viewAllPerPage) || 1
  const viewAllStart = (viewAllPage - 1) * viewAllPerPage
  const viewAllPaginated = viewAllFilteredRequests.slice(
    viewAllStart,
    viewAllStart + viewAllPerPage
  )

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

    return true
  })

  // Pagination for kitchen panel (15 per page, same design as Outlet Stock Out)
  const kitchenTotalPages = Math.ceil(kitchenFiltered.length / kitchenPerPage) || 1
  const kitchenStartIndex = (kitchenCurrentPage - 1) * kitchenPerPage
  const kitchenPaginated = kitchenFiltered.slice(
    kitchenStartIndex,
    kitchenStartIndex + kitchenPerPage
  )

  // Reset previous-days page when search changes
  useEffect(() => {
    setOutletPreviousDaysPage(1)
  }, [searchTerm])

  // Reset View all modal page when modal opens or modal search changes
  useEffect(() => {
    if (showViewAllAllocationModal) setViewAllPage(1)
  }, [showViewAllAllocationModal, viewAllSearchTerm])

  useEffect(() => {
    setKitchenCurrentPage(1)
  }, [kitchenSearchTerm])

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
            <div className="px-4 pt-4 pb-2 border-b border-border">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-foreground">Outlet Stock Out</h2>
                  <span className="text-xs text-muted-foreground">
                    {allocationRequests.length} request(s)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowViewAllAllocationModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all"
                  >
                    View all
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayoutMode(layoutMode === 'outlet-full' ? 'split' : 'outlet-full')}
                    className="hidden lg:inline-flex items-center px-2 py-1 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all"
                  >
                    {layoutMode === 'outlet-full' ? 'Restore Split' : 'Maximize'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    PDF Date Range
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={pdfDateRange.from}
                      onChange={(e) => setPdfDateRange({ ...pdfDateRange, from: e.target.value })}
                      className="flex-1 bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <span className="text-muted-foreground self-center text-xs">to</span>
                    <input
                      type="date"
                      value={pdfDateRange.to}
                      onChange={(e) => setPdfDateRange({ ...pdfDateRange, to: e.target.value })}
                      className="flex-1 bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadAllocationRequestsPDF('requested')}
                  disabled={downloadingAllocationPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadingAllocationPdf ? (
                    'Generating…'
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Requested PDF
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => downloadAllocationRequestsPDF('confirmed')}
                  disabled={downloadingAllocationPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadingAllocationPdf ? (
                    'Generating…'
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Confirmed PDF
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-border">
              <label className="block text-xs font-semibold text-foreground mb-1">
                Search (Outlet / Code / Requested By / Supervisor)
              </label>
              <input
                type="text"
                placeholder="Search by outlet name, code, requested by, or supervisor name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              />
            </div>

            <div className="overflow-x-auto">
              {/* Segment 1: Today's requests (pending + packed) */}
              <div className="px-4 pt-4 pb-2 border-b border-border/60">
                <h3 className="text-sm font-semibold text-foreground text-opacity-90">
                  Today&apos;s requests
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pending and packed allocation requests for today. Empty if none.
                </p>
              </div>
              <div className="min-h-[80px]">
                {todayRequests.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      No requests for today.
                    </p>
                  </div>
                ) : (
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
                              Supervisor
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
                      {todayRequests.map((request) => (
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
                              <td className="px-4 py-3 text-foreground text-sm">
                                {request.supervisor_name || '—'}
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
                              <button
                                onClick={() => handleCancelPacking(request)}
                                disabled={cancelingId === request.id}
                                className="px-3 py-1.5 bg-red-500/10 text-red-600 border-2 border-red-500/30 rounded-lg hover:bg-red-500/20 hover:border-red-500/50 transition-all duration-200 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {cancelingId === request.id ? 'Cancelling…' : 'Cancel Packing'}
                              </button>
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
                )}
              </div>
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

            {/* PDF Date Range + per-reason download */}
            <div className="p-4 border-b border-border">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    PDF Date Range
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={kitchenPdfDateRange.from}
                      onChange={(e) => setKitchenPdfDateRange({ ...kitchenPdfDateRange, from: e.target.value })}
                      className="flex-1 bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <span className="text-muted-foreground self-center text-xs">to</span>
                    <input
                      type="date"
                      value={kitchenPdfDateRange.to}
                      onChange={(e) => setKitchenPdfDateRange({ ...kitchenPdfDateRange, to: e.target.value })}
                      className="flex-1 bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Download PDF by reason
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadKitchenStockOutPDF('all')}
                    disabled={downloadingKitchenPdf !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-accent bg-accent/10 hover:bg-accent/20 text-accent transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {downloadingKitchenPdf === 'all' ? (
                      'Generating…'
                    ) : (
                      <>
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        All Reasons
                      </>
                    )}
                  </button>
                  {KITCHEN_REASON_OPTIONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => downloadKitchenStockOutPDF(r.value)}
                      disabled={downloadingKitchenPdf !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-input hover:bg-accent/10 text-foreground transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {downloadingKitchenPdf === r.value ? (
                        'Generating…'
                      ) : (
                        <>
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {r.label}
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </div>
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
                            {record.reason === 'dispatch' && record.dispatch_brand && (
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                Brand: {record.dispatch_brand}
                              </span>
                            )}
                            {record.reason === 'inter-cloud-kitchen' && record.destination_kitchen && (
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                → {record.destination_kitchen.name}
                                {record.destination_kitchen.code ? ` (${record.destination_kitchen.code})` : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className="inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold">
                              {record.stock_out_items?.length || 0}
                            </span>
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

                  {kitchenFiltered.length > 0 && (
                    <div className="border-t border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        Showing {kitchenStartIndex + 1} to{' '}
                        {Math.min(
                          kitchenStartIndex + kitchenPerPage,
                          kitchenFiltered.length
                        )}{' '}
                        of {kitchenFiltered.length} • {kitchenPerPage} per page
                      </div>
                      <PaginationControls
                        variant="compact"
                        currentPage={kitchenCurrentPage}
                        totalPages={kitchenTotalPages}
                        onPageChange={setKitchenCurrentPage}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Cancel Packing Confirmation Modal */}
        {cancelTarget && (
          <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-md w-full">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Cancel Packing?</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {cancelTarget.outlets?.name || 'This requisition'}
                    {cancelTarget.outlets?.code && (
                      <span className="font-mono"> • {cancelTarget.outlets.code}</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <p className="text-sm text-foreground">
                  The packed stock will be returned to the exact inventory batches it was taken
                  from, and the request will reopen for re-packing.
                </p>
                <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
                  <svg className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-yellow-700">
                    This can only be done on the <strong>same day</strong> the packing was made.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelingId === cancelTarget.id}
                  className="px-4 py-2 rounded-lg border-2 border-border bg-input text-foreground hover:bg-accent/10 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Keep Packing
                </button>
                <button
                  onClick={confirmCancelPacking}
                  disabled={cancelingId === cancelTarget.id}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cancelingId === cancelTarget.id ? 'Cancelling…' : 'Yes, Cancel Packing'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Allocation Modal */}
        {showAllocationModal && selectedRequest && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl p-6 max-w-6xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Allocate Stock</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedRequest.outlets?.name} • {new Date(selectedRequest.request_date).toLocaleDateString()}
                    {selectedRequest.supervisor_name && (
                      <> • Supervisor: {selectedRequest.supervisor_name}</>
                    )}
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
                <div className="overflow-x-auto overflow-y-auto max-h-[45vh] scroll-smooth overscroll-contain rounded-lg border border-border">
                  <table className="w-full">
                    <thead className="sticky top-0 z-20 bg-background border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Requested</th>
                        <th
                          className="px-4 py-3 text-left text-sm font-bold text-foreground"
                          title="Last time this material was allocated to this outlet"
                        >
                          Previously Allocated
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Today's Total</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Current Stock</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Allocate Qty</th>
                        <th className="px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {allocationItems.map((item, index) => {
                        const currentInventory = inventoryData[item.raw_material_id] || 0
                        const todayTotal = todayTotals[item.raw_material_id] || 0
                        const isLowStock = currentInventory < item.allocated_quantity

                        return (
                          <tr key={item.raw_material_id} className={`border-b border-border ${item.addedByPm ? 'bg-accent/5' : ''}`}>
                            <td className="px-4 py-3">
                              <div>
                                <p className="font-semibold text-foreground flex items-center gap-2">
                                  {item.name}
                                  {item.addedByPm && (
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/15 px-1.5 py-0.5 rounded">
                                      Added by you
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">{item.code}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              {item.addedByPm ? (
                                <span className="text-muted-foreground italic">not requested</span>
                              ) : (
                                <>{item.requested_quantity.toFixed(2)} {item.unit}</>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {lastAllocationByMaterial[item.raw_material_id] ? (
                                <div>
                                  <p className="text-foreground font-medium">
                                    {lastAllocationByMaterial[item.raw_material_id].quantity.toFixed(2)} {item.unit}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {new Date(lastAllocationByMaterial[item.raw_material_id].date).toLocaleDateString()}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              {todayTotal.toFixed(2)} {item.unit}
                            </td>
                            <td className={`px-4 py-3 font-semibold ${isLowStock ? 'text-destructive' : 'text-foreground'}`}>
                              {currentInventory.toFixed(2)} {item.unit}
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
                            <td className="px-2 py-3">
                              {item.addedByPm && (
                                <button
                                  type="button"
                                  onClick={() => removeAddedAllocationItem(index)}
                                  disabled={allocating}
                                  title="Remove this item"
                                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Add a material the supervisor forgot to request */}
                <div className="relative add-item-dropdown-container mt-3">
                  <button
                    type="button"
                    data-add-item-trigger
                    onClick={() => {
                      setShowAddItemDropdown(prev => !prev)
                      setAddItemSearchTerm('')
                    }}
                    disabled={allocating}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add item the supervisor missed
                  </button>
                  {showAddItemDropdown && ReactDOM.createPortal(
                    <div
                      className="fixed z-[9999] flex flex-col bg-card border-2 border-accent rounded-xl shadow-2xl overflow-hidden add-item-dropdown-container"
                      style={{ ...addItemDropdownPosition, minWidth: 280 }}
                    >
                      <input
                        ref={addItemSearchRef}
                        type="text"
                        value={addItemSearchTerm}
                        onChange={(e) => setAddItemSearchTerm(e.target.value)}
                        placeholder="Search material..."
                        className="w-full shrink-0 px-4 py-3 border-b-2 border-border focus:outline-none focus:ring-2 focus:ring-accent bg-background text-foreground"
                      />
                      <div className="flex-1 min-h-0 max-h-64 overflow-y-auto overscroll-contain bg-card">
                        {getFilteredMaterialsForAddItem().length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No matching materials.
                          </div>
                        ) : (
                          getFilteredMaterialsForAddItem().map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => handleAddItemToAllocation(m.id)}
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
              </div>

              <div className="mb-6">
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Notes (for challan only)
                </label>
                <textarea
                  value={challanNotes}
                  onChange={(e) => setChallanNotes(e.target.value)}
                  placeholder="Enter notes to appear on the downloadable challan..."
                  rows={3}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all resize-y"
                />
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

        {/* View all allocation requests modal (non-today's, search + pagination 15) */}
        {showViewAllAllocationModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-card border-2 border-border rounded-xl overflow-hidden flex flex-col max-w-6xl w-full max-h-[90vh]">
              <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-bold text-foreground">All allocation requests (other than today)</h2>
                <button
                  type="button"
                  onClick={() => setShowViewAllAllocationModal(false)}
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 border-b border-border">
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Search (Outlet / Code / Requested By / Supervisor)
                </label>
                <input
                  type="text"
                  placeholder="Search by outlet name, code, requested by, or supervisor name..."
                  value={viewAllSearchTerm}
                  onChange={(e) => setViewAllSearchTerm(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                />
              </div>
              <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
                {viewAllFilteredRequests.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      {previousDaysRequests.length === 0
                        ? 'No allocation requests from previous days.'
                        : 'No requests match your search.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <table className="w-full">
                      <thead className="bg-background border-b border-border sticky top-0 z-10">
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
                          <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                            Requested By
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                            Supervisor
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-foreground uppercase tracking-wide">
                            Request Date
                          </th>
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
                        {viewAllPaginated.map((request) => (
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
                            <td className="px-4 py-3 text-foreground text-sm">
                              {request.users?.full_name || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-foreground text-sm">
                              {request.supervisor_name || '—'}
                            </td>
                            <td className="px-4 py-3 text-foreground text-xs">
                              {new Date(request.created_at).toLocaleString()}
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
                                <button
                                  onClick={() => handleCancelPacking(request)}
                                  disabled={cancelingId === request.id}
                                  className="px-3 py-1.5 bg-red-500/10 text-red-600 border-2 border-red-500/30 rounded-lg hover:bg-red-500/20 hover:border-red-500/50 transition-all duration-200 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {cancelingId === request.id ? 'Cancelling…' : 'Cancel Packing'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setShowViewAllAllocationModal(false)
                                    openAllocationModal(request)
                                  }}
                                  className="px-3 py-1.5 bg-accent/10 text-accent border-2 border-accent/30 rounded-lg hover:bg-accent/20 hover:border-accent/50 transition-all duration-200 text-xs font-semibold"
                                >
                                  Allocate Stock
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {request.is_packed ? (
                                <button
                                  onClick={() => {
                                    setShowViewAllAllocationModal(false)
                                    openStockOutDetailsModal(request)
                                  }}
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
                  </>
                )}
              </div>
              {viewAllFilteredRequests.length > 0 && (
                <div className="border-t border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-card">
                  <div className="text-xs text-muted-foreground">
                    Showing {viewAllStart + 1} to{' '}
                    {Math.min(viewAllStart + viewAllPerPage, viewAllFilteredRequests.length)} of{' '}
                    {viewAllFilteredRequests.length} • {viewAllPerPage} per page
                  </div>
                  <PaginationControls
                    variant="compact"
                    currentPage={viewAllPage}
                    totalPages={viewAllTotalPages}
                    onPageChange={setViewAllPage}
                  />
                </div>
              )}
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
                  <option value="dispatch">Dispatch</option>
                  <option value="wastage">Wastage</option>
                  <option value="staff-food">Staff Food</option>
                  <option value="internal-production">Internal Production</option>
                  <option value="inter-cloud-kitchen">Inter Cloud Kitchen Transfer</option>
                  <option value="cullinary-rnd">Culinary R&D</option>
                </select>
              </div>

              {/* Brand selector (only when reason is dispatch) */}
              {selfStockOutReason === 'dispatch' && (
                <div className="mb-4">
                  <label className="block text-sm font-bold text-foreground mb-2">
                    Brand <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={selectedDispatchBrand}
                    onChange={(e) => handleDispatchBrandChange(e.target.value)}
                    disabled={allocating}
                    className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  >
                    <option value="">Select brand</option>
                    {dispatchBrands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name} ({brand.code})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Selecting a brand will auto-populate materials configured for that brand.
                  </p>
                </div>
              )}

              {/* Wastage photo (required when reason is wastage) */}
              {selfStockOutReason === 'wastage' && (
                <div className="mb-4">
                  <label className="block text-sm font-bold text-foreground mb-2">
                    Photo of wasted items <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={handleWastageFileChange}
                    disabled={allocating}
                    className="block w-full text-sm text-foreground file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-background hover:file:bg-accent/90"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload a clear photo of the wasted items (JPEG or PNG, max 5 MB).
                  </p>
                  {wastageImageFile && !wastageImageError && (
                    <p className="mt-1 text-xs text-foreground">
                      Selected: <span className="font-mono">{wastageImageFile.name}</span>{' '}
                      ({(wastageImageFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                  {wastageImageError && (
                    <p className="mt-1 text-xs text-destructive">{wastageImageError}</p>
                  )}
                </div>
              )}

              {/* Destination kitchen (only when reason is inter-cloud-kitchen) */}
              {selfStockOutReason === 'inter-cloud-kitchen' && (
                <div className="mb-4">
                  <label className="block text-sm font-bold text-foreground mb-2">
                    Transfer to <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={transferToCloudKitchenId}
                    onChange={(e) => setTransferToCloudKitchenId(e.target.value)}
                    disabled={allocating}
                    className="w-full bg-input border-2 border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                  >
                    <option value="">Select destination cloud kitchen</option>
                    {otherCloudKitchens.map((ck) => (
                      <option key={ck.id} value={ck.id}>
                        {ck.name} ({ck.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Additional Notes Field */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-foreground mb-2">
                  {selfStockOutReason === 'cullinary-rnd' ? (
                    <>
                      R&D Product <span className="text-destructive">*</span>
                    </>
                  ) : (
                    'Additional Notes'
                  )}
                </label>
                <textarea
                  value={selfStockOutNotes}
                  onChange={(e) => setSelfStockOutNotes(e.target.value)}
                  placeholder={
                    selfStockOutReason === 'cullinary-rnd'
                      ? 'Enter the product for this Culinary R&D stock-out'
                      : 'Enter any additional notes (optional)'
                  }
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
                  </div>
                </div>
                
                <div className="rounded-xl border-2 border-border overflow-hidden bg-background">
                  <div
                    ref={selfStockOutScrollRef}
                    className="overflow-x-auto overflow-y-auto max-h-[42vh] scroll-smooth overscroll-contain"
                  >
                    <table className="w-full table-fixed border-collapse min-w-0">
                      <thead className="sticky top-0 z-20 bg-background">
                        <tr className="bg-muted/40 border-b-2 border-border select-none">
                          <th className="px-2 py-2.5 w-9 align-middle"></th>
                          <th className="px-2 py-2.5 text-left text-sm font-bold text-foreground w-[38%] min-w-0 align-middle">
                            Name
                          </th>
                          <th className="px-2 py-2.5 text-left text-sm font-bold text-foreground w-[17%] min-w-0 align-middle">
                            Current Stock
                          </th>
                          <th
                            className="px-2 py-2.5 text-left text-sm font-bold text-foreground w-[19%] min-w-0 align-middle"
                            title="Most recent kitchen stock-out for this material with the reason selected above"
                          >
                            Last stock out
                          </th>
                          <th className="px-2 py-2.5 text-left text-sm font-bold text-foreground w-16 min-w-[4rem] align-middle">
                            Quantity
                          </th>
                          <th className="px-1 py-2.5 w-9 align-middle"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(selfStockOutDispatchTableRows != null
                          ? selfStockOutDispatchTableRows
                          : selfStockOutItems.map((item, index) => ({ kind: 'row', item, index }))
                        ).map((entry) => {
                          if (entry.kind === 'section') {
                            return (
                            <tr
                              key={`dispatch-sec-${entry.key}`}
                              className={`bg-muted/20 ${entry.sectionIdx > 0 ? 'border-t border-border/80' : ''}`}
                            >
                              <td
                                colSpan={6}
                                className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                              >
                                {entry.label}
                              </td>
                            </tr>
                            )
                          }
                          const { item, index } = entry
                          return (
                          <tr
                            key={item.id || `row-${index}`}
                            className={`animate-row-in hover:bg-accent/5 ${selectedStockOutRows.has(index) ? 'bg-accent/10' : ''}`}
                          >
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={selectedStockOutRows.has(index)}
                                onChange={() => handleToggleStockOutRowSelect(index)}
                                className="rounded border-border"
                              />
                            </td>
                            <td className="px-2 py-2 relative material-dropdown-container min-w-0 max-w-full">
                              <div className="min-w-0 w-full">
                                <button
                                  type="button"
                                  data-self-stock-out-trigger={index}
                                  onClick={() => {
                                    setOpenMaterialDropdownRow(openMaterialDropdownRow === index ? -1 : index)
                                    setMaterialDropdownSearchTerm('')
                                  }}
                                  disabled={allocating}
                                  className="w-full min-w-0 text-left px-2 py-1.5 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm truncate"
                                >
                                  {item.raw_material_id ? (
                                    <span>{item.name} <span className="text-muted-foreground text-xs">({item.unit})</span></span>
                                  ) : (
                                    <span className="text-muted-foreground">Select material...</span>
                                  )}
                                </button>
                                {openMaterialDropdownRow === index && ReactDOM.createPortal(
                                  <div
                                    className="fixed z-[9999] flex flex-col bg-card border-2 border-accent rounded-xl shadow-2xl overflow-hidden material-dropdown-container"
                                    style={{ ...materialDropdownPosition, minWidth: 280 }}
                                  >
                                    <input
                                      ref={materialDropdownSearchRef}
                                      type="text"
                                      value={materialDropdownSearchTerm}
                                      onChange={(e) => setMaterialDropdownSearchTerm(e.target.value)}
                                      placeholder="Search material..."
                                      className="w-full shrink-0 px-4 py-3 border-b-2 border-border focus:outline-none focus:ring-2 focus:ring-accent bg-background text-foreground"
                                    />
                                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-card">
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
                            <td className="px-2 py-2 min-w-0">
                              <span className={`block px-2 py-1.5 border border-border rounded-lg text-xs font-medium truncate ${
                                item.raw_material_id ? (
                                  item.current_inventory === 0 ? 'bg-destructive/10 text-destructive' :
                                  item.current_inventory < 10 ? 'bg-yellow-500/10 text-yellow-600' :
                                  'bg-muted/50 text-foreground'
                                ) : 'bg-muted/50 text-muted-foreground'
                              }`}>
                                {item.raw_material_id ? `${item.current_inventory.toFixed(2)} ${item.unit}` : '—'}
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top min-w-0">
                              {!selfStockOutReason ? (
                                <span className="block px-2 py-1.5 text-xs text-muted-foreground border border-border rounded-lg bg-muted/30 truncate">
                                  —
                                </span>
                              ) : !item.raw_material_id ? (
                                <span className="block px-2 py-1.5 text-xs text-muted-foreground border border-border rounded-lg bg-muted/30 truncate">
                                  —
                                </span>
                              ) : lastStockOutDatesLoading ? (
                                <span className="block px-2 py-1.5 text-xs text-muted-foreground border border-border rounded-lg bg-muted/30">
                                  …
                                </span>
                              ) : selfStockOutLastDates[item.raw_material_id] ? (
                                <span className="block px-2 py-1.5 text-xs font-medium text-foreground border border-border rounded-lg bg-muted/50 leading-tight line-clamp-2 break-words">
                                  {new Date(selfStockOutLastDates[item.raw_material_id]).toLocaleString(
                                    undefined,
                                    { dateStyle: 'short', timeStyle: 'short' }
                                  )}
                                </span>
                              ) : (
                                <span className="block px-2 py-1.5 text-[11px] text-muted-foreground border border-dashed border-border rounded-lg bg-muted/20 leading-tight">
                                  No prior stock out
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2 w-16 min-w-[4rem]">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={item.allocated_quantity}
                                onChange={(e) => handleUpdateSelfStockOutQuantity(index, e.target.value)}
                                disabled={!item.raw_material_id}
                                className="w-full max-w-[4.25rem] min-w-0 px-2 py-1.5 bg-input border border-border rounded-lg text-foreground text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </td>
                            <td className="px-1 py-2">
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
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
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
                    (selfStockOutReason === 'dispatch' && !selectedDispatchBrand) ||
                    (selfStockOutReason === 'wastage' && !wastageImageFile) ||
                    (selfStockOutReason === 'inter-cloud-kitchen' && !transferToCloudKitchenId) ||
                    (selfStockOutReason === 'cullinary-rnd' && !selfStockOutNotes.trim()) ||
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

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => handleExportStockOut('csv', stockOutDetails)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border-2 border-border bg-input hover:bg-accent/10 text-foreground transition-all"
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => handleExportStockOut('excel', stockOutDetails)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border-2 border-green-500/70 bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-all"
              >
                Download Excel
              </button>
              <button
                type="button"
                onClick={() => downloadStockOutChallan(stockOutDetails.id, stockOutDetails)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border-2 border-red-500/70 bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-all"
              >
                Download Challan
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
                    {stockOutDetails.reason === 'dispatch' && stockOutDetails.dispatch_brand && (
                      <p className="text-sm text-foreground mt-1">
                        Brand: <span className="font-semibold">{stockOutDetails.dispatch_brand}</span>
                      </p>
                    )}
                    {stockOutDetails.reason === 'inter-cloud-kitchen' && stockOutDetails.destination_kitchen && (
                      <p className="text-sm text-foreground mt-1">
                        Transfer to: <span className="font-semibold">{stockOutDetails.destination_kitchen.name}</span>
                        {stockOutDetails.destination_kitchen.code ? ` (${stockOutDetails.destination_kitchen.code})` : ''}
                      </p>
                    )}
                  </div>
                )}
                {stockOutDetails.self_stock_out && stockOutDetails.reason === 'wastage' && stockOutDetails.wastage_image_url && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Photo of wasted items</p>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="max-h-64 max-w-full overflow-hidden rounded-lg border border-border bg-background">
                        <img
                          src={stockOutDetails.wastage_image_url}
                          alt="Wasted items"
                          className="max-h-64 w-full object-contain bg-background"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => window.open(stockOutDetails.wastage_image_url, '_blank', 'noopener,noreferrer')}
                        className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-background hover:bg-accent/90 transition-colors"
                      >
                        Open full image
                      </button>
                    </div>
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
                              {parseFloat(item.quantity || 0).toFixed(2)} {item.raw_materials?.unit || ''}
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
              <div className="mt-4 flex flex-col gap-2">
                {alert.showChallanDownload && lastStockOutId && (
                  <button
                    onClick={() => {
                      downloadStockOutChallan(lastStockOutId)
                      setAlert(null)
                    }}
                    className="w-full font-bold px-4 py-3 rounded-xl transition-all duration-200 text-base touch-manipulation bg-accent text-background hover:bg-accent/90 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download Transfer Challan
                  </button>
                )}
                <button
                  onClick={() => setAlert(null)}
                  className={`w-full font-bold px-4 py-3 rounded-xl transition-all duration-200 text-base touch-manipulation ${
                    alert.type === 'error' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' :
                    alert.type === 'success' ? 'bg-green-500 text-white hover:bg-green-600' :
                    'bg-yellow-500 text-white hover:bg-yellow-600'
                  }`}
                >
                  {alert.showChallanDownload ? 'Close' : 'OK'}
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
