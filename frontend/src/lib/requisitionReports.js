// Admin requisition reports — the two downloadable views of what outlets asked
// for and what they were actually given.
//
// Both reports read the same two tables, so they share one fetch and one cost
// map and differ only in how they fold the rows:
//
//   Item-wise consumption   what each outlet asked for, priced
//   Requested vs allocated  where the purchase manager changed the ask
//
// COST. Every rupee here comes from a weighted average of what the material
// actually cost to buy inside the selected range:
//
//   avg = SUM(quantity_purchased * unit_cost * (1 + gst/100))
//       / SUM(quantity_purchased)
//
// weighted so a 2kg top-up cannot swing the average as hard as a 500kg
// delivery. A material that was requisitioned but not bought during the range
// falls back to its most recent batch before the range — a real historical
// price rather than a zero that would silently understate a total. Materials
// with no purchase history at all price at zero and are flagged in the export,
// because there is no honest number to use and hiding the row would lose the
// quantity too.
//
// DATES. request_date and the batch timestamps are both read as UTC business
// days, matching lib/businessDate.js and public.business_today(). See that
// module for why the day rolls at 05:30 IST.

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'
import { getBusinessDate } from './businessDate'

const num = (value) => parseFloat(value) || 0

/** The last `days` days inclusive of today, as business days. */
export const reportRangeForDays = (days) => {
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (Math.max(1, days) - 1))
  return { startDate: getBusinessDate(start), endDate: getBusinessDate(today) }
}

/** Last 30 days inclusive of today, as business days. */
export const defaultReportRange = () => reportRangeForDays(30)

/**
 * Every requisition raised in the range, with what was asked for and what the
 * matching stock-out actually sent.
 *
 * stock_out is embedded without !inner on purpose: a requisition still waiting
 * to be packed is real consumption for report 1, and report 2 filters it out
 * itself rather than having the query decide for both.
 */
export const fetchRequisitionsInRange = async ({ cloudKitchenId = null, outletId = null, startDate, endDate }) => {
  if (!startDate || !endDate) return []

  return fetchAllRows(() => {
    let query = supabase
      .from('allocation_requests')
      .select(`
        id,
        outlet_id,
        cloud_kitchen_id,
        request_date,
        is_packed,
        supervisor_name,
        outlets (
          id,
          name,
          code,
          is_active,
          deleted_at
        ),
        cloud_kitchens (
          id,
          name
        ),
        allocation_request_items (
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
          stock_out_items (
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
      .gte('request_date', startDate)
      .lte('request_date', endDate)
      .order('request_date', { ascending: false })
      // Paging without a unique tiebreaker can repeat or skip rows when many
      // requisitions share a request_date, which they routinely do.
      .order('id', { ascending: true })

    // An outlet belongs to exactly one cloud kitchen, so picking an outlet
    // already pins the kitchen and the kitchen filter adds nothing.
    if (outletId) query = query.eq('outlet_id', outletId)
    else if (cloudKitchenId) query = query.eq('cloud_kitchen_id', cloudKitchenId)
    return query
  })
}

const costKey = (cloudKitchenId, materialId) => `${cloudKitchenId}:${materialId}`

/**
 * Weighted-average GST-inclusive cost per material per cloud kitchen.
 *
 * Returns a Map of `${cloudKitchenId}:${materialId}` -> { rate, basis }, where
 * basis is 'range' (bought during the period), 'historic' (priced off the last
 * batch before it) or 'none' (never bought — rate 0).
 */
export const fetchAverageMaterialCosts = async ({ materialIds, cloudKitchenIds, startDate, endDate }) => {
  const costs = new Map()
  if (!materialIds?.length) return costs

  const batches = await fetchAllRows(() => {
    let query = supabase
      .from('stock_in_batches')
      .select('id, raw_material_id, cloud_kitchen_id, quantity_purchased, unit_cost, gst_percent, created_at')
      .in('raw_material_id', materialIds)
      // Nothing bought after the range can price it, and the fallback only
      // ever looks backwards, so this bounds the query without losing either.
      .lte('created_at', `${endDate}T23:59:59.999Z`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })

    if (cloudKitchenIds?.length) query = query.in('cloud_kitchen_id', cloudKitchenIds)
    return query
  })

  const rangeStart = `${startDate}T00:00:00.000Z`
  const aggregates = new Map()

  batches.forEach((batch) => {
    const key = costKey(batch.cloud_kitchen_id, batch.raw_material_id)
    if (!aggregates.has(key)) {
      aggregates.set(key, { value: 0, quantity: 0, latestRate: null })
    }
    const aggregate = aggregates.get(key)
    const rate = num(batch.unit_cost) * (1 + num(batch.gst_percent) / 100)

    // Rows arrive newest first, so the first one seen for a material is its
    // most recent purchase — the fallback price.
    if (aggregate.latestRate === null) aggregate.latestRate = rate

    if (batch.created_at >= rangeStart) {
      const purchased = num(batch.quantity_purchased)
      aggregate.value += rate * purchased
      aggregate.quantity += purchased
    }
  })

  aggregates.forEach((aggregate, key) => {
    if (aggregate.quantity > 0) {
      costs.set(key, { rate: aggregate.value / aggregate.quantity, basis: 'range' })
    } else if (aggregate.latestRate !== null) {
      costs.set(key, { rate: aggregate.latestRate, basis: 'historic' })
    } else {
      costs.set(key, { rate: 0, basis: 'none' })
    }
  })

  return costs
}

const lookupCost = (costs, cloudKitchenId, materialId) =>
  costs.get(costKey(cloudKitchenId, materialId)) || { rate: 0, basis: 'none' }

const COST_BASIS_LABEL = {
  range: 'Purchased in range',
  historic: 'Last known price',
  none: 'Never purchased',
}

export const costBasisLabel = (basis) => COST_BASIS_LABEL[basis] || COST_BASIS_LABEL.none

/** An outlet counts only if it is live and actually asked for something. */
const isReportableOutlet = (requisition) => {
  const outlet = requisition.outlets
  return !!outlet && outlet.is_active !== false && !outlet.deleted_at
}

/**
 * Report 1 — what each outlet consumed, by item.
 *
 * "Consumed" is what the outlet asked for, not what it was sent: an unpacked
 * requisition still counts. Report 2 is where the two are compared.
 */
export const buildItemWiseConsumption = (requisitions, costs) => {
  const outletMap = new Map()

  requisitions.filter(isReportableOutlet).forEach((requisition) => {
    const outletId = requisition.outlet_id
    if (!outletMap.has(outletId)) {
      outletMap.set(outletId, {
        outletId,
        outletName: requisition.outlets?.name || 'Unknown outlet',
        outletCode: requisition.outlets?.code || '',
        kitchenName: requisition.cloud_kitchens?.name || 'Unknown kitchen',
        cloudKitchenId: requisition.cloud_kitchen_id,
        requisitionCount: 0,
        totalAmount: 0,
        itemMap: new Map(),
      })
    }

    const outlet = outletMap.get(outletId)
    outlet.requisitionCount += 1

    ;(requisition.allocation_request_items || []).forEach((item) => {
      const materialId = item.raw_material_id
      if (!outlet.itemMap.has(materialId)) {
        const cost = lookupCost(costs, requisition.cloud_kitchen_id, materialId)
        outlet.itemMap.set(materialId, {
          materialId,
          name: item.raw_materials?.name || 'Unknown material',
          code: item.raw_materials?.code || '',
          unit: item.raw_materials?.unit || '',
          quantity: 0,
          avgCost: cost.rate,
          costBasis: cost.basis,
          amount: 0,
        })
      }
      const row = outlet.itemMap.get(materialId)
      row.quantity += num(item.quantity)
      row.amount = row.quantity * row.avgCost
    })
  })

  const outlets = [...outletMap.values()]
    .map((outlet) => {
      const items = [...outlet.itemMap.values()].sort((a, b) => b.amount - a.amount)
      return {
        outletId: outlet.outletId,
        outletName: outlet.outletName,
        outletCode: outlet.outletCode,
        kitchenName: outlet.kitchenName,
        cloudKitchenId: outlet.cloudKitchenId,
        requisitionCount: outlet.requisitionCount,
        items,
        totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
      }
    })
    // An outlet with requisitions that carried no items is not worth a section.
    .filter((outlet) => outlet.items.length > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount)

  return {
    outlets,
    totalAmount: outlets.reduce((sum, outlet) => sum + outlet.totalAmount, 0),
    requisitionCount: outlets.reduce((sum, outlet) => sum + outlet.requisitionCount, 0),
  }
}

/**
 * Report 2 — where what was allocated differs from what was asked for.
 *
 * Only packed requisitions are compared. One still waiting to be packed has no
 * allocation to differ from, and counting it would read as the purchase manager
 * having cut every line to zero.
 *
 * Quantities are summed as line counts rather than as numbers: an outlet's
 * items are measured in kg, litres and pieces, and adding those together
 * produces a figure with no unit and no meaning. Rupees are the one dimension
 * every item shares, so the money columns are the comparable ones.
 */
export const buildRequestedVsAllocated = (requisitions, costs) => {
  const outletMap = new Map()
  let pendingExcluded = 0

  requisitions.filter(isReportableOutlet).forEach((requisition) => {
    const stockOut = Array.isArray(requisition.stock_out)
      ? requisition.stock_out[0]
      : requisition.stock_out
    if (!stockOut) {
      pendingExcluded += 1
      return
    }

    const outletId = requisition.outlet_id
    if (!outletMap.has(outletId)) {
      outletMap.set(outletId, {
        outletId,
        outletName: requisition.outlets?.name || 'Unknown outlet',
        outletCode: requisition.outlets?.code || '',
        kitchenName: requisition.cloud_kitchens?.name || 'Unknown kitchen',
        requisitionsCompared: 0,
        itemsIncreased: 0,
        itemsDecreased: 0,
        increaseValue: 0,
        decreaseValue: 0,
        details: [],
      })
    }
    const outlet = outletMap.get(outletId)
    outlet.requisitionsCompared += 1

    const requested = new Map()
    ;(requisition.allocation_request_items || []).forEach((item) => {
      requested.set(item.raw_material_id, {
        quantity: num(item.quantity),
        material: item.raw_materials,
      })
    })

    const allocated = new Map()
    ;(stockOut.stock_out_items || []).forEach((item) => {
      allocated.set(item.raw_material_id, {
        quantity: num(item.quantity),
        material: item.raw_materials,
      })
    })

    new Set([...requested.keys(), ...allocated.keys()]).forEach((materialId) => {
      const requestedQty = requested.get(materialId)?.quantity || 0
      const allocatedQty = allocated.get(materialId)?.quantity || 0
      const difference = allocatedQty - requestedQty
      if (difference === 0) return

      const material = requested.get(materialId)?.material || allocated.get(materialId)?.material
      const cost = lookupCost(costs, requisition.cloud_kitchen_id, materialId)
      const value = difference * cost.rate

      if (difference > 0) {
        outlet.itemsIncreased += 1
        outlet.increaseValue += value
      } else {
        outlet.itemsDecreased += 1
        outlet.decreaseValue += value
      }

      outlet.details.push({
        requisitionId: requisition.id,
        requestDate: requisition.request_date,
        materialId,
        name: material?.name || 'Unknown material',
        code: material?.code || '',
        unit: material?.unit || '',
        requested: requestedQty,
        allocated: allocatedQty,
        difference,
        avgCost: cost.rate,
        costBasis: cost.basis,
        value,
      })
    })
  })

  const rows = [...outletMap.values()]
    .map((outlet) => ({
      ...outlet,
      netValue: outlet.increaseValue + outlet.decreaseValue,
      absoluteValue: Math.abs(outlet.increaseValue) + Math.abs(outlet.decreaseValue),
      details: outlet.details.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    }))
    .sort((a, b) => b.absoluteValue - a.absoluteValue)

  return {
    rows,
    pendingExcluded,
    totals: {
      requisitionsCompared: rows.reduce((sum, row) => sum + row.requisitionsCompared, 0),
      itemsIncreased: rows.reduce((sum, row) => sum + row.itemsIncreased, 0),
      itemsDecreased: rows.reduce((sum, row) => sum + row.itemsDecreased, 0),
      increaseValue: rows.reduce((sum, row) => sum + row.increaseValue, 0),
      decreaseValue: rows.reduce((sum, row) => sum + row.decreaseValue, 0),
      absoluteValue: rows.reduce((sum, row) => sum + row.absoluteValue, 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Single-outlet variants
//
// The all-outlet reports above answer "who is spending what". Narrowed to one
// outlet those columns become a constant repeated on every row, and the reader
// wants a different cut: how this outlet's asks moved over the period, and
// which materials the purchase manager keeps adjusting for it. So these two
// builders fold the same rows along requisition and material instead of outlet.
//
// They also skip the active-outlet filter the wide reports apply. That filter
// exists to keep dead outlets out of a list nobody asked for; here the outlet
// was named explicitly, and a closed outlet's history is a fair thing to pull.

const outletHeader = (requisition, outletId) => ({
  outletId,
  outletName: requisition?.outlets?.name || 'Unknown outlet',
  outletCode: requisition?.outlets?.code || '',
  kitchenName: requisition?.cloud_kitchens?.name || 'Unknown kitchen',
  cloudKitchenId: requisition?.cloud_kitchen_id || null,
})

/** Newest requisition first, id breaking ties so the order is stable. */
const byRequestDateDesc = (a, b) =>
  String(b.requestDate).localeCompare(String(a.requestDate)) || String(a.id).localeCompare(String(b.id))

/**
 * Report 1, for one outlet — what it asked for, by item and by requisition.
 *
 * Returns null when the outlet raised nothing in the period, which the caller
 * reports as an empty period rather than downloading a blank workbook.
 */
export const buildOutletConsumption = (requisitions, costs, outletId) => {
  const scoped = requisitions.filter((requisition) => requisition.outlet_id === outletId)
  if (scoped.length === 0) return null

  const itemMap = new Map()
  const requisitionRows = []

  scoped.forEach((requisition) => {
    let amount = 0
    let lineCount = 0

    ;(requisition.allocation_request_items || []).forEach((item) => {
      const materialId = item.raw_material_id
      const quantity = num(item.quantity)
      const cost = lookupCost(costs, requisition.cloud_kitchen_id, materialId)

      lineCount += 1
      amount += quantity * cost.rate

      if (!itemMap.has(materialId)) {
        itemMap.set(materialId, {
          materialId,
          name: item.raw_materials?.name || 'Unknown material',
          code: item.raw_materials?.code || '',
          unit: item.raw_materials?.unit || '',
          quantity: 0,
          // Counted as requisitions, not lines, so a material listed twice on
          // one requisition does not read as two separate asks.
          requisitionIds: new Set(),
          avgCost: cost.rate,
          costBasis: cost.basis,
          amount: 0,
        })
      }
      const row = itemMap.get(materialId)
      row.quantity += quantity
      row.requisitionIds.add(requisition.id)
      row.amount = row.quantity * row.avgCost
    })

    requisitionRows.push({
      id: requisition.id,
      requestDate: requisition.request_date,
      supervisorName: requisition.supervisor_name || '',
      isPacked: !!requisition.is_packed,
      lineCount,
      amount,
    })
  })

  const items = [...itemMap.values()]
    .map(({ requisitionIds, ...item }) => ({ ...item, requisitionCount: requisitionIds.size }))
    .sort((a, b) => b.amount - a.amount)

  return {
    ...outletHeader(scoped[0], outletId),
    items,
    requisitions: requisitionRows.sort(byRequestDateDesc),
    requisitionCount: requisitionRows.length,
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
  }
}

/**
 * Report 2, for one outlet — requested against allocated, folded two ways.
 *
 * By material: the period's totals per item, so a material this outlet is
 * routinely short-shipped stands out across requisitions rather than only
 * inside one. Every material on a compared requisition appears, including the
 * ones that matched exactly — confirming an ask was met is part of the answer.
 *
 * By requisition: the same differences dated, so a bad week is visible.
 *
 * Unpacked requisitions are excluded for the reason given on the wide report:
 * they have no allocation yet, and counting them reads as every line cut to
 * zero. Returns null when nothing in the period was packed.
 */
export const buildOutletRequestedVsAllocated = (requisitions, costs, outletId) => {
  const scoped = requisitions.filter((requisition) => requisition.outlet_id === outletId)
  if (scoped.length === 0) return null

  const materialMap = new Map()
  const requisitionRows = []
  let pendingExcluded = 0

  scoped.forEach((requisition) => {
    const stockOut = Array.isArray(requisition.stock_out)
      ? requisition.stock_out[0]
      : requisition.stock_out
    if (!stockOut) {
      pendingExcluded += 1
      return
    }

    const requested = new Map()
    ;(requisition.allocation_request_items || []).forEach((item) => {
      requested.set(item.raw_material_id, {
        quantity: num(item.quantity),
        material: item.raw_materials,
      })
    })

    const allocated = new Map()
    ;(stockOut.stock_out_items || []).forEach((item) => {
      allocated.set(item.raw_material_id, {
        quantity: num(item.quantity),
        material: item.raw_materials,
      })
    })

    const row = {
      id: requisition.id,
      requestDate: requisition.request_date,
      allocationDate: stockOut.allocation_date || '',
      supervisorName: requisition.supervisor_name || '',
      linesIncreased: 0,
      linesDecreased: 0,
      increaseValue: 0,
      decreaseValue: 0,
      details: [],
    }

    new Set([...requested.keys(), ...allocated.keys()]).forEach((materialId) => {
      const requestedQty = requested.get(materialId)?.quantity || 0
      const allocatedQty = allocated.get(materialId)?.quantity || 0
      const material = requested.get(materialId)?.material || allocated.get(materialId)?.material
      const cost = lookupCost(costs, requisition.cloud_kitchen_id, materialId)

      if (!materialMap.has(materialId)) {
        materialMap.set(materialId, {
          materialId,
          name: material?.name || 'Unknown material',
          code: material?.code || '',
          unit: material?.unit || '',
          requested: 0,
          allocated: 0,
          timesIncreased: 0,
          timesDecreased: 0,
          avgCost: cost.rate,
          costBasis: cost.basis,
        })
      }
      const materialRow = materialMap.get(materialId)
      materialRow.requested += requestedQty
      materialRow.allocated += allocatedQty

      const difference = allocatedQty - requestedQty
      if (difference === 0) return

      const value = difference * cost.rate
      if (difference > 0) {
        materialRow.timesIncreased += 1
        row.linesIncreased += 1
        row.increaseValue += value
      } else {
        materialRow.timesDecreased += 1
        row.linesDecreased += 1
        row.decreaseValue += value
      }

      row.details.push({
        requisitionId: requisition.id,
        requestDate: requisition.request_date,
        materialId,
        name: materialRow.name,
        code: materialRow.code,
        unit: materialRow.unit,
        requested: requestedQty,
        allocated: allocatedQty,
        difference,
        avgCost: cost.rate,
        costBasis: cost.basis,
        value,
      })
    })

    row.netValue = row.increaseValue + row.decreaseValue
    row.absoluteValue = Math.abs(row.increaseValue) + Math.abs(row.decreaseValue)
    row.details.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    requisitionRows.push(row)
  })

  if (requisitionRows.length === 0) return null

  const materials = [...materialMap.values()]
    .map((material) => {
      const difference = material.allocated - material.requested
      return { ...material, difference, value: difference * material.avgCost }
    })
    // Adjustment count breaks the tie so a material that was cut one week and
    // topped up the next — netting to zero — does not sink to the bottom
    // alongside the ones that were never touched.
    .sort(
      (a, b) =>
        Math.abs(b.value) - Math.abs(a.value) ||
        b.timesIncreased + b.timesDecreased - (a.timesIncreased + a.timesDecreased) ||
        a.name.localeCompare(b.name)
    )

  return {
    ...outletHeader(scoped[0], outletId),
    materials,
    requisitions: requisitionRows.sort(byRequestDateDesc),
    pendingExcluded,
    totals: {
      requisitionsCompared: requisitionRows.length,
      itemsIncreased: requisitionRows.reduce((sum, row) => sum + row.linesIncreased, 0),
      itemsDecreased: requisitionRows.reduce((sum, row) => sum + row.linesDecreased, 0),
      increaseValue: requisitionRows.reduce((sum, row) => sum + row.increaseValue, 0),
      decreaseValue: requisitionRows.reduce((sum, row) => sum + row.decreaseValue, 0),
      absoluteValue: requisitionRows.reduce((sum, row) => sum + row.absoluteValue, 0),
    },
  }
}
