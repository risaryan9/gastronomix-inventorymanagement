/**
 * Finished-material outlet costs for dispatch plans using latest stock-in batch unit_cost
 * per material at the cloud kitchen (recipe ingredient rows are excluded — only material_type === 'finished').
 */

export function formatRupee(amount) {
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  if (Number.isNaN(n)) return '₹0.00'
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} cloudKitchenId
 * @param {string[]} rawMaterialIds
 * @returns {Promise<Record<string, number>>} raw_material_id -> latest unit_cost (0 if no batch)
 */
export async function fetchLatestBatchUnitCosts(supabase, cloudKitchenId, rawMaterialIds) {
  const unique = [...new Set(rawMaterialIds)].filter(Boolean)
  const result = {}
  if (!cloudKitchenId || unique.length === 0) return result

  const { data, error } = await supabase
    .from('stock_in_batches')
    .select('raw_material_id, unit_cost, created_at')
    .eq('cloud_kitchen_id', cloudKitchenId)
    .in('raw_material_id', unique)
    .order('created_at', { ascending: false })

  if (error) throw error

  ;(data || []).forEach((batch) => {
    if (!result[batch.raw_material_id]) {
      const uc = parseFloat(batch.unit_cost)
      result[batch.raw_material_id] = Number.isNaN(uc) ? 0 : uc
    }
  })

  unique.forEach((id) => {
    if (result[id] === undefined) result[id] = 0
  })

  return result
}

/**
 * @param {Array<{ id: string, name?: string, code?: string, unit?: string, material_type?: string }>} materials
 * @param {Array<{ id: string }>} outlets
 * @param {Record<string, Record<string, string|number>>} quantities materialId -> outletId -> qty
 * @param {Record<string, number>} batchUnitCosts
 */
export function computeOutletFinishedCosts(materials, outlets, quantities, batchUnitCosts) {
  /** @type {Record<string, { total: number, lines: Array<{ materialId: string, name: string, code: string, unitLabel: string, qty: number, unitCost: number, lineCost: number }> }>} */
  const byOutlet = {}

  outlets.forEach((o) => {
    byOutlet[o.id] = { total: 0, lines: [] }
  })

  for (const material of materials) {
    if (!material || material.material_type !== 'finished') continue

    const unitCostRaw = batchUnitCosts[material.id]
    const unitCost =
      unitCostRaw != null && unitCostRaw !== ''
        ? parseFloat(unitCostRaw)
        : 0
    const uc = Number.isNaN(unitCost) ? 0 : unitCost

    for (const outlet of outlets) {
      const rawQty = quantities[material.id]?.[outlet.id]
      const qty =
        rawQty === '' || rawQty === undefined || rawQty === null
          ? NaN
          : parseFloat(rawQty)
      if (Number.isNaN(qty) || qty <= 0) continue

      const lineCost = qty * uc
      const entry = byOutlet[outlet.id]
      if (!entry) continue

      entry.total += lineCost
      entry.lines.push({
        materialId: material.id,
        name: material.name || '',
        code: material.code || '',
        unitLabel: material.unit || '',
        qty,
        unitCost: uc,
        lineCost
      })
    }
  }

  Object.keys(byOutlet).forEach((oid) => {
    byOutlet[oid].lines.sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    )
  })

  return byOutlet
}
