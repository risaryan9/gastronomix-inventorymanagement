// Cloud Kitchen overview — the admin dashboard's landing metrics.
//
// TWO KINDS OF METRIC, AND THEY BEHAVE DIFFERENTLY
//
// *Stock* metrics (inventory value, dead stock, low/out of stock, pending
// requisitions) are point-in-time: they answer "what is true right now" and the
// date range does not apply to them. *Flow* metrics (spend, stock-ins,
// stock-outs) are measured over a period and the date range does apply. Mixing
// the two on one screen is fine as long as the UI says which is which — see
// the `asOfNow` flag the page uses to label tiles.
//
// AGGREGATION HAPPENS HERE, NOT IN POSTGRES
//
// The row counts are small — ~300 batches still holding stock, ~900 inventory
// rows, a few hundred movements per period — so pulling them and folding in JS
// avoids adding database views that would then need migrating and maintaining.
// If these tables grow an order of magnitude, move the folds into SQL views and
// keep this module's shape.

import { supabase } from './supabase'
import { getBusinessDate } from './businessDate'

// Batches still holding stock this long after receipt are capital sitting idle.
const DEAD_STOCK_AFTER_DAYS = 60

// PostgREST caps a response at a server-configured row count. Paging keeps the
// folds correct regardless of where that cap sits.
const PAGE_SIZE = 1000

const fetchAll = async (build) => {
  const rows = []

  for (let page = 0; ; page += 1) {
    const { data, error } = await build().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw error

    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/* ------------------------------------------------------------------ *
 * Date ranges
 * ------------------------------------------------------------------ */

export const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
]

const shiftDays = (businessDate, days) => {
  const date = new Date(`${businessDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return getBusinessDate(date)
}

const daysBetween = (from, to) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000)
  )

// Past roughly a month, daily points stop being readable and start being noise,
// so the spend series switches to weekly buckets.
const DAILY_BUCKET_MAX_DAYS = 31

/**
 * Resolves a range option to inclusive business dates. Business days are UTC
 * here for the reasons documented in businessDate.js — a range built from local
 * dates would disagree with the date columns it filters.
 */
export const resolveRange = (range, customFrom = '', customTo = '') => {
  const today = getBusinessDate()

  switch (range) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: shiftDays(today, -6), to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'custom':
      return customFrom && customTo ? { from: customFrom, to: customTo } : { from: today, to: today }
    case '30d':
    default:
      return { from: shiftDays(today, -29), to: today }
  }
}

/** The equal-length window ending the day before `from`, for period-on-period deltas. */
export const previousRange = ({ from, to }) => {
  const span = daysBetween(from, to)
  const previousTo = shiftDays(from, -1)
  return { from: shiftDays(previousTo, -span), to: previousTo }
}

/* ------------------------------------------------------------------ *
 * Spend series
 * ------------------------------------------------------------------ */

/**
 * Buckets in-range stock-in spend into one row per period, with a column per
 * kitchen — the shape a Recharts line chart consumes directly.
 *
 * Every bucket in the range is emitted even when nothing was spent, so a quiet
 * week reads as a run along zero rather than as a gap the line hops over.
 */
const buildSpendSeries = (stockIns, kitchens, { from, to }) => {
  const span = daysBetween(from, to)
  const bucketDays = span <= DAILY_BUCKET_MAX_DAYS ? 1 : 7
  const bucketCount = Math.floor(span / bucketDays) + 1

  const rows = Array.from({ length: bucketCount }, (_, index) => {
    const start = shiftDays(from, index * bucketDays)
    const row = { bucket: start, bucketDays }
    kitchens.forEach((kitchen) => {
      row[kitchen.id] = 0
    })
    return row
  })

  stockIns.forEach((stockIn) => {
    if (!stockIn.receipt_date || !stockIn.cloud_kitchen_id) return

    const index = Math.floor(daysBetween(from, stockIn.receipt_date) / bucketDays)
    const row = rows[index]
    if (!row || !(stockIn.cloud_kitchen_id in row)) return

    row[stockIn.cloud_kitchen_id] += num(stockIn.total_cost)
  })

  return rows
}

/* ------------------------------------------------------------------ *
 * Folds
 * ------------------------------------------------------------------ */

const emptyMetrics = () => ({
  inventoryValue: 0,
  deadStockValue: 0,
  spend: 0,
  stockInCount: 0,
  stockOutCount: 0,
  pendingRequisitions: 0,
  outOfStock: 0,
  lowStock: 0,
  outlets: 0,
})

const addTo = (byKitchen, kitchenId, apply) => {
  if (!kitchenId) return
  if (!byKitchen.has(kitchenId)) byKitchen.set(kitchenId, emptyMetrics())
  apply(byKitchen.get(kitchenId))
}

/**
 * Loads every figure the Cloud Kitchen overview shows, for all kitchens at once.
 *
 * `costDataAvailable` is false when the cost tables come back empty while stock
 * quantities did not — the signature of the admin lacking a read policy on
 * stock_in / stock_in_batches (see migrations/add-admin-read-policies-for-stock-in.sql).
 * The page shows those tiles as unavailable rather than as a confident zero,
 * because a wrong number is worse than a missing one.
 */
export const fetchCloudKitchenOverview = async ({ from, to }) => {
  const previous = previousRange({ from, to })
  const deadStockBefore = new Date(
    Date.now() - DEAD_STOCK_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const [kitchens, outlets, users, batches, inventory, stockIns, previousStockIns, stockOuts, pending] =
    await Promise.all([
      fetchAll(() =>
        supabase
          .from('cloud_kitchens')
          .select('id, name, code, is_active')
          .is('deleted_at', null)
          .order('name')
      ),
      fetchAll(() =>
        supabase.from('outlets').select('cloud_kitchen_id').eq('is_active', true).is('deleted_at', null)
      ),
      fetchAll(() => supabase.from('users').select('id').eq('is_active', true).is('deleted_at', null)),
      fetchAll(() =>
        supabase
          .from('stock_in_batches')
          .select('cloud_kitchen_id, quantity_remaining, unit_cost, created_at')
          .gt('quantity_remaining', 0)
      ),
      // !inner means RLS on raw_materials also filters this join, so inactive and
      // deleted materials drop out of the low-stock counts for free.
      fetchAll(() =>
        supabase
          .from('inventory')
          .select('cloud_kitchen_id, quantity, raw_materials!inner(low_stock_threshold)')
      ),
      fetchAll(() =>
        supabase
          .from('stock_in')
          .select('cloud_kitchen_id, total_cost, receipt_date')
          .gte('receipt_date', from)
          .lte('receipt_date', to)
      ),
      fetchAll(() =>
        supabase
          .from('stock_in')
          .select('total_cost')
          .gte('receipt_date', previous.from)
          .lte('receipt_date', previous.to)
      ),
      fetchAll(() =>
        supabase
          .from('stock_out')
          .select('cloud_kitchen_id')
          .gte('allocation_date', from)
          .lte('allocation_date', to)
      ),
      fetchAll(() =>
        supabase.from('allocation_requests').select('cloud_kitchen_id').eq('is_packed', false)
      ),
    ])

  const byKitchen = new Map()
  kitchens.forEach((kitchen) => byKitchen.set(kitchen.id, emptyMetrics()))

  outlets.forEach((outlet) => addTo(byKitchen, outlet.cloud_kitchen_id, (m) => (m.outlets += 1)))

  batches.forEach((batch) => {
    const value = num(batch.quantity_remaining) * num(batch.unit_cost)
    addTo(byKitchen, batch.cloud_kitchen_id, (m) => {
      m.inventoryValue += value
      if (batch.created_at && batch.created_at < deadStockBefore) m.deadStockValue += value
    })
  })

  // Matches the purchase manager dashboard's definition so the two never
  // disagree: nothing on hand is "out", some on hand but at or under the
  // threshold is "low". A material with no threshold set can only ever be out.
  inventory.forEach((row) => {
    const quantity = num(row.quantity)
    const threshold = num(row.raw_materials?.low_stock_threshold)
    addTo(byKitchen, row.cloud_kitchen_id, (m) => {
      if (quantity <= 0) m.outOfStock += 1
      else if (quantity <= threshold) m.lowStock += 1
    })
  })

  stockIns.forEach((row) =>
    addTo(byKitchen, row.cloud_kitchen_id, (m) => {
      m.spend += num(row.total_cost)
      m.stockInCount += 1
    })
  )

  stockOuts.forEach((row) =>
    addTo(byKitchen, row.cloud_kitchen_id, (m) => (m.stockOutCount += 1))
  )

  pending.forEach((row) =>
    addTo(byKitchen, row.cloud_kitchen_id, (m) => (m.pendingRequisitions += 1))
  )

  const perKitchen = kitchens.map((kitchen) => ({
    ...kitchen,
    ...(byKitchen.get(kitchen.id) ?? emptyMetrics()),
  }))

  const totals = perKitchen.reduce((acc, kitchen) => {
    Object.keys(emptyMetrics()).forEach((key) => {
      acc[key] = (acc[key] ?? 0) + kitchen[key]
    })
    return acc
  }, emptyMetrics())

  return {
    kitchens: perKitchen,
    totals,
    spendSeries: buildSpendSeries(stockIns, kitchens, { from, to }),
    previousSpend: previousStockIns.reduce((sum, row) => sum + num(row.total_cost), 0),
    org: { kitchens: kitchens.length, outlets: outlets.length, users: users.length },
    costDataAvailable: batches.length > 0 || inventory.length === 0,
    range: { from, to },
    previousRange: previous,
  }
}
