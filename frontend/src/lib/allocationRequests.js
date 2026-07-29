import { supabase } from './supabase'
import { getBusinessDate } from './businessDate'

/**
 * @deprecated Use getBusinessDate from lib/businessDate directly.
 *
 * Kept as an alias so existing call sites keep working. It used to read the
 * *browser's* local timezone, which happened to be right for staff sitting in
 * India and wrong for anyone else; it now resolves to the kitchen's business
 * day (IST) regardless of where the device is.
 */
export const getLocalDateString = (date = new Date()) => getBusinessDate(date)

export const fetchOutletAllocationRequests = async ({ outletId, page = 1, pageSize = 10 }) => {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const query = supabase
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
      ),
      stock_out (
        id,
        allocation_date,
        created_at,
        stock_out_items (
          id,
          raw_material_id,
          quantity
        )
      )
    `, { count: 'exact' })
    .eq('outlet_id', outletId)
    .order('request_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  const { data, error, count } = await query
  if (error) throw error
  return { data: data || [], count: count || 0 }
}

export const fetchTodayAllocationStatus = async ({ cloudKitchenId, outletIds }) => {
  if (!cloudKitchenId || !outletIds?.length) {
    return {}
  }

  const today = getLocalDateString()
  const { data, error } = await supabase
    .from('allocation_requests')
    .select('id, outlet_id, is_packed, request_date')
    .eq('cloud_kitchen_id', cloudKitchenId)
    .eq('request_date', today)
    .in('outlet_id', outletIds)

  if (error) throw error

  const statusMap = {}
  ;(data || []).forEach(req => {
    if (!statusMap[req.outlet_id]) {
      statusMap[req.outlet_id] = { hasRequest: false, isPacked: false, requestId: null }
    }
    statusMap[req.outlet_id].hasRequest = true
    statusMap[req.outlet_id].requestId = req.id
    if (req.is_packed) {
      statusMap[req.outlet_id].isPacked = true
    }
  })

  return statusMap
}

export const fetchReportCloudKitchens = async () => {
  const { data, error } = await supabase
    .from('cloud_kitchens')
    .select('id, name, code')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) throw error
  return data || []
}

export const fetchReportOutlets = async (cloudKitchenId = null) => {
  let query = supabase
    .from('outlets')
    .select(`
      id,
      name,
      cloud_kitchen_id,
      is_active,
      deleted_at,
      cloud_kitchens (
        id,
        name
      )
    `)
    .order('name', { ascending: true })

  if (cloudKitchenId) {
    query = query.eq('cloud_kitchen_id', cloudKitchenId)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export const fetchOutletVarianceCounts = async (outletIds) => {
  if (!outletIds?.length) return []

  const { data, error } = await supabase
    .from('allocation_requests')
    .select(`
      id,
      outlet_id,
      allocation_request_items (
        raw_material_id,
        quantity
      ),
      stock_out!inner (
        stock_out_items (
          raw_material_id,
          quantity
        )
      )
    `)
    .in('outlet_id', outletIds)

  if (error) throw error
  return data || []
}

export const fetchOutletRequisitionReportRows = async (outletId) => {
  const { data, error } = await supabase
    .from('allocation_requests')
    .select(`
      id,
      outlet_id,
      cloud_kitchen_id,
      request_date,
      created_at,
      is_packed,
      notes,
      supervisor_name,
      allocation_request_items (
        id,
        raw_material_id,
        quantity
      ),
      stock_out!inner (
        id,
        allocation_date,
        created_at,
        stock_out_items (
          id,
          raw_material_id,
          quantity
        )
      )
    `)
    .eq('outlet_id', outletId)
    .order('request_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export const fetchRequisitionVarianceDetails = async (allocationRequestId) => {
  const { data, error } = await supabase
    .from('allocation_requests')
    .select(`
      id,
      outlet_id,
      cloud_kitchen_id,
      request_date,
      created_at,
      is_packed,
      notes,
      supervisor_name,
      outlets (
        id,
        name
      ),
      cloud_kitchens (
        id,
        name
      ),
      allocation_request_items (
        id,
        raw_material_id,
        quantity,
        raw_materials (
          id,
          name,
          code,
          unit
        )
      ),
      stock_out (
        id,
        allocation_date,
        created_at,
        stock_out_items (
          id,
          raw_material_id,
          quantity,
          raw_materials (
            id,
            name,
            code,
            unit
          )
        )
      )
    `)
    .eq('id', allocationRequestId)
    .single()

  if (error) throw error
  return data
}

