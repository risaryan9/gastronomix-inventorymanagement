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

/** Last 30 days inclusive of today, as business days. */
export const defaultReportRange = () => {
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 29)
  return { startDate: getBusinessDate(start), endDate: getBusinessDate(today) }
}

/**
 * Every requisition raised in the range, with what was asked for and what the
 * matching stock-out actually sent.
 *
 * stock_out is embedded without !inner on purpose: a requisition still waiting
 * to be packed is real consumption for report 1, and report 2 filters it out
 * itself rather than having the query decide for both.
 */
export const fetchRequisitionsInRange = async ({ cloudKitchenId = null, startDate, endDate }) => {
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

    if (cloudKitchenId) query = query.eq('cloud_kitchen_id', cloudKitchenId)
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
