// Kitchen Wise Overview — everything scoped to one cloud kitchen.
//
// Split into a summary load and per-tab loads on purpose. The summary and the
// analytics are cheap and always visible; the ledgers are the bulk of the rows,
// and only the open tab's worth is ever fetched. Line items go one step further
// and load when a record's modal is opened, so opening a movement costs one
// small query rather than the page paying for 800 movements' items up front.
//
// Point-in-time vs period applies here exactly as it does on the cross-kitchen
// overview: stock value, stock health and top-materials are "as of now" and
// ignore the range; spend, movements, allocations and the reason mix are
// measured over it.

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'
import { getBusinessDate } from './businessDate'
import {
  BATCH_VALUATION_COLUMNS,
  batchValue,
  gstInclusiveUnitCost,
  onlyActiveMaterials,
} from './inventoryValuation'
import { loadKitchenThresholds } from './stockThresholds'

const DEAD_STOCK_AFTER_DAYS = 60
const DAILY_BUCKET_MAX_DAYS = 31

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const shiftDays = (businessDate, days) => {
  const date = new Date(`${businessDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return getBusinessDate(date)
}

const daysBetween = (from, to) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000)
  )

export const SELF_STOCK_OUT_REASONS = {
  'staff-food': 'Staff Food',
  'internal-production': 'Internal Production',
  'cullinary-rnd': 'Culinary R&D',
  'inter-cloud-kitchen': 'Inter-Kitchen Transfer',
  wastage: 'Wastage',
}

export const reasonLabel = (reason) =>
  SELF_STOCK_OUT_REASONS[reason] ?? (reason ? reason.replace(/-/g, ' ') : 'Unspecified')

export const STOCK_STATUS = { OUT: 'out', LOW: 'low', OK: 'ok' }

const statusOf = (quantity, threshold) => {
  if (quantity <= 0) return STOCK_STATUS.OUT
  if (threshold > 0 && quantity <= threshold) return STOCK_STATUS.LOW
  return STOCK_STATUS.OK
}

/* ------------------------------------------------------------------ *
 * Kitchen list (for the selector, and for stable colour assignment)
 * ------------------------------------------------------------------ */

export const fetchKitchens = () =>
  fetchAllRows(() =>
    supabase
      .from('cloud_kitchens')
      .select('id, name, code, is_active')
      .is('deleted_at', null)
      .order('name')
  )

/* ------------------------------------------------------------------ *
 * Summary + analytics
 * ------------------------------------------------------------------ */

const buildSpendSeries = (stockIns, { from, to }) => {
  const span = daysBetween(from, to)
  const bucketDays = span <= DAILY_BUCKET_MAX_DAYS ? 1 : 7
  const bucketCount = Math.floor(span / bucketDays) + 1

  const rows = Array.from({ length: bucketCount }, (_, index) => ({
    bucket: shiftDays(from, index * bucketDays),
    bucketDays,
    value: 0,
  }))

  stockIns.forEach((stockIn) => {
    if (!stockIn.receipt_date) return
    const row = rows[Math.floor(daysBetween(from, stockIn.receipt_date) / bucketDays)]
    if (row) row.value += num(stockIn.total_cost)
  })

  return rows
}

/**
 * Headline figures and the analytics block for one kitchen.
 *
 * Inventory value and top materials come from the FIFO batches rather than from
 * `inventory`, because only the batches carry a cost basis.
 */
export const fetchKitchenSummary = async (kitchenId, { from, to }) => {
  const deadStockBefore = new Date(
    Date.now() - DEAD_STOCK_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const [outlets, batches, inventory, stockIns, stockOuts, pending, thresholds] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from('outlets')
        .select('id')
        .eq('cloud_kitchen_id', kitchenId)
        .eq('is_active', true)
        .is('deleted_at', null)
    ),
    fetchAllRows(() =>
      onlyActiveMaterials(
        supabase
          .from('stock_in_batches')
          .select(
            `raw_material_id, created_at, ${BATCH_VALUATION_COLUMNS}, raw_materials!inner(name, unit)`
          )
          .eq('cloud_kitchen_id', kitchenId)
          .gt('quantity_remaining', 0)
      )
    ),
    fetchAllRows(() =>
      onlyActiveMaterials(
        supabase
          .from('inventory')
          .select('raw_material_id, quantity, raw_materials!inner(low_stock_threshold)')
          .eq('cloud_kitchen_id', kitchenId)
      )
    ),
    fetchAllRows(() =>
      supabase
        .from('stock_in')
        .select('total_cost, receipt_date')
        .eq('cloud_kitchen_id', kitchenId)
        .gte('receipt_date', from)
        .lte('receipt_date', to)
    ),
    fetchAllRows(() =>
      supabase
        .from('stock_out')
        .select('self_stock_out, reason')
        .eq('cloud_kitchen_id', kitchenId)
        .gte('allocation_date', from)
        .lte('allocation_date', to)
    ),
    fetchAllRows(() =>
      supabase
        .from('allocation_requests')
        .select('id')
        .eq('cloud_kitchen_id', kitchenId)
        .eq('is_packed', false)
    ),
    loadKitchenThresholds(kitchenId),
  ])

  let inventoryValue = 0
  let deadStockValue = 0
  const valueByMaterial = new Map()

  batches.forEach((batch) => {
    const value = batchValue(batch)
    inventoryValue += value
    if (batch.created_at && batch.created_at < deadStockBefore) deadStockValue += value

    const existing = valueByMaterial.get(batch.raw_material_id)
    if (existing) {
      existing.value += value
      existing.quantity += num(batch.quantity_remaining)
    } else {
      valueByMaterial.set(batch.raw_material_id, {
        id: batch.raw_material_id,
        name: batch.raw_materials?.name ?? 'Unknown material',
        unit: batch.raw_materials?.unit ?? '',
        value,
        quantity: num(batch.quantity_remaining),
      })
    }
  })

  let outOfStock = 0
  let lowStock = 0
  // This kitchen's own thresholds, which may differ from the catalog default
  // and from what the kitchen next door counts as low.
  inventory.forEach((row) => {
    const status = statusOf(
      num(row.quantity),
      thresholds.get(row.raw_material_id, row.raw_materials?.low_stock_threshold)
    )
    if (status === STOCK_STATUS.OUT) outOfStock += 1
    else if (status === STOCK_STATUS.LOW) lowStock += 1
  })

  const reasonCounts = new Map()
  let selfStockOuts = 0
  stockOuts.forEach((row) => {
    if (!row.self_stock_out) return
    selfStockOuts += 1
    const key = row.reason || 'unspecified'
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
  })

  return {
    summary: {
      inventoryValue,
      deadStockValue,
      spend: stockIns.reduce((sum, row) => sum + num(row.total_cost), 0),
      stockInCount: stockIns.length,
      stockOutCount: stockOuts.length,
      selfStockOuts,
      outlets: outlets.length,
      outOfStock,
      lowStock,
      pendingRequisitions: pending.length,
    },
    analytics: {
      spendSeries: buildSpendSeries(stockIns, { from, to }),
      topMaterials: [...valueByMaterial.values()].sort((a, b) => b.value - a.value).slice(0, 8),
      reasonMix: [...reasonCounts.entries()]
        .map(([reason, total]) => ({ reason, label: reasonLabel(reason), value: total }))
        .sort((a, b) => b.value - a.value),
    },
  }
}

/* ------------------------------------------------------------------ *
 * Outlets tab
 * ------------------------------------------------------------------ */

// Outlet codes are prefixed by brand; the brand itself is not a column.
const BRAND_BY_PREFIX = {
  NK: 'Nippu Kodi',
  EC: 'El Chaapo',
  BP: 'Boom Pizza',
}

export const brandForOutletCode = (code) => BRAND_BY_PREFIX[(code ?? '').slice(0, 2)] ?? 'Other'

/**
 * The outlets this kitchen serves, each with how much it drew over the range.
 *
 * Allocation counts exclude self stock-outs and inter-kitchen transfers — those
 * never reach an outlet, and counting them would overstate what an outlet took.
 */
export const fetchKitchenOutlets = async (kitchenId, { from, to }) => {
  const [outlets, allocations, pending] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from('outlets')
        .select('id, name, code, is_active, created_at')
        .eq('cloud_kitchen_id', kitchenId)
        .is('deleted_at', null)
        .order('name')
    ),
    fetchAllRows(() =>
      supabase
        .from('stock_out')
        .select('outlet_id, allocation_date')
        .eq('cloud_kitchen_id', kitchenId)
        .eq('self_stock_out', false)
        .gte('allocation_date', from)
        .lte('allocation_date', to)
    ),
    fetchAllRows(() =>
      supabase
        .from('allocation_requests')
        .select('outlet_id')
        .eq('cloud_kitchen_id', kitchenId)
        .eq('is_packed', false)
    ),
  ])

  const allocationCounts = new Map()
  const lastAllocation = new Map()
  allocations.forEach((row) => {
    if (!row.outlet_id) return
    allocationCounts.set(row.outlet_id, (allocationCounts.get(row.outlet_id) ?? 0) + 1)
    const seen = lastAllocation.get(row.outlet_id)
    if (!seen || row.allocation_date > seen) lastAllocation.set(row.outlet_id, row.allocation_date)
  })

  const pendingCounts = new Map()
  pending.forEach((row) => {
    if (!row.outlet_id) return
    pendingCounts.set(row.outlet_id, (pendingCounts.get(row.outlet_id) ?? 0) + 1)
  })

  return outlets.map((outlet) => ({
    id: outlet.id,
    name: outlet.name,
    code: outlet.code ?? '',
    brand: brandForOutletCode(outlet.code),
    isActive: !!outlet.is_active,
    createdAt: outlet.created_at,
    allocations: allocationCounts.get(outlet.id) ?? 0,
    lastAllocation: lastAllocation.get(outlet.id) ?? null,
    pendingRequisitions: pendingCounts.get(outlet.id) ?? 0,
  }))
}

/* ------------------------------------------------------------------ *
 * Ledgers
 * ------------------------------------------------------------------ */

const fetchUserNames = async () => {
  const users = await fetchAllRows(() => supabase.from('users').select('id, full_name'))
  return new Map(users.map((user) => [user.id, user.full_name]))
}

export const fetchKitchenStockIn = async (kitchenId, { from, to }) => {
  const [rows, userNames] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from('stock_in')
        .select(
          'id, receipt_date, supplier_name, invoice_number, total_cost, stock_in_type, notes, received_by, created_at'
        )
        .eq('cloud_kitchen_id', kitchenId)
        .gte('receipt_date', from)
        .lte('receipt_date', to)
        .order('receipt_date', { ascending: false })
        .order('created_at', { ascending: false })
    ),
    fetchUserNames(),
  ])

  return rows.map((row) => ({
    ...row,
    totalCost: num(row.total_cost),
    receivedByName: userNames.get(row.received_by) ?? '—',
  }))
}

export const fetchStockInLines = async (stockInId) => {
  const rows = await fetchAllRows(() =>
    supabase
      .from('stock_in_batches')
      .select('id, quantity_purchased, unit_cost, gst_percent, quantity_remaining, raw_materials(name, code, unit)')
      .eq('stock_in_id', stockInId)
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.raw_materials?.name ?? 'Unknown material',
    code: row.raw_materials?.code ?? '',
    unit: row.raw_materials?.unit ?? '',
    quantity: num(row.quantity_purchased),
    remaining: num(row.quantity_remaining),
    unitCost: num(row.unit_cost),
    gstPercent: num(row.gst_percent),
    lineTotal: num(row.quantity_purchased) * gstInclusiveUnitCost(row),
  }))
}

/**
 * A stock-out is one of four things and the ledger has to say which: an outlet
 * allocation, an internal consumption (with a reason), a transfer to another
 * kitchen, or a brand dispatch. `kind` collapses that into one label column.
 */
export const fetchKitchenStockOut = async (kitchenId, { from, to }) => {
  const [rows, userNames, kitchens] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from('stock_out')
        .select(
          'id, allocation_date, self_stock_out, reason, dispatch_brand, notes, allocated_by, created_at, transfer_to_cloud_kitchen_id, allocation_request_id, outlets(name)'
        )
        .eq('cloud_kitchen_id', kitchenId)
        .gte('allocation_date', from)
        .lte('allocation_date', to)
        .order('allocation_date', { ascending: false })
        .order('created_at', { ascending: false })
    ),
    fetchUserNames(),
    fetchKitchens(),
  ])

  const kitchenNames = new Map(kitchens.map((kitchen) => [kitchen.id, kitchen.name]))

  return rows.map((row) => {
    const destination = row.transfer_to_cloud_kitchen_id
      ? kitchenNames.get(row.transfer_to_cloud_kitchen_id) ?? 'Another kitchen'
      : row.outlets?.name ?? null

    let kind = 'Outlet allocation'
    if (row.transfer_to_cloud_kitchen_id) kind = 'Inter-kitchen transfer'
    else if (row.self_stock_out) kind = reasonLabel(row.reason)

    return {
      id: row.id,
      date: row.allocation_date,
      kind,
      isSelf: !!row.self_stock_out,
      destination: destination ?? '—',
      dispatchBrand: row.dispatch_brand,
      fromRequisition: !!row.allocation_request_id,
      notes: row.notes,
      allocatedByName: userNames.get(row.allocated_by) ?? '—',
    }
  })
}

/* ------------------------------------------------------------------ *
 * Record detail — batches and audit trail
 * ------------------------------------------------------------------ */

// The audit trail for a record is fetched by fetchEntityAuditEvents in
// lib/auditEvents.js — it owns the column list that describeEvent and EventBody
// expect, and duplicating that here would let the two drift.

export const fetchStockOutLines = async (stockOutId) => {
  const rows = await fetchAllRows(() =>
    supabase
      .from('stock_out_items')
      .select('id, quantity, raw_materials(name, code, unit)')
      .eq('stock_out_id', stockOutId)
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.raw_materials?.name ?? 'Unknown material',
    code: row.raw_materials?.code ?? '',
    unit: row.raw_materials?.unit ?? '',
    quantity: num(row.quantity),
  }))
}
