// What came back from the outlets, for the purchase manager to act on.
//
// Confirming a closing sheet records what an outlet returned and wasted; it
// does not move stock. See docs/decisions/0010-dispatch-and-closing-do-not-move-
// stock.md. This module is the read the purchase manager works from when they
// key that movement in by hand.
//
// It answers the same rows two ways:
//
//   by material   the roll-up for the period, which is what gets keyed in
//   by sheet      the closing sheets behind those totals, for checking one
//                 outlet's night when a figure looks wrong
//
// CONFIRMED SHEETS ONLY. A draft is still being edited by the supervisor;
// acting on it would mean recording stock against a number that can still
// change. Confirming is the point the figures become final and the sheet locks.
//
// WASTAGE IS CARRIED BUT NEVER ADDED TO RETURNS. Wasted stock did not come
// back — it is here because it explains the gap between what went out and what
// returned, and reading a shortfall without it invites the wrong conclusion.

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'

const num = (value) => parseFloat(value) || 0

/**
 * Confirmed closing sheets for one cloud kitchen in a date range, with their
 * return and wastage lines.
 */
export const fetchConfirmedClosings = async ({ cloudKitchenId, startDate, endDate }) => {
  if (!cloudKitchenId || !startDate || !endDate) return []

  return fetchAllRows(() =>
    supabase
      .from('checkout_form')
      .select(`
        id,
        plan_date,
        status,
        supervisor_name,
        confirmed_at,
        outlet_id,
        outlets (
          id,
          name,
          code
        ),
        checkout_form_return_items (
          raw_material_id,
          dispatched_quantity,
          returned_quantity,
          raw_materials (
            id,
            name,
            code,
            unit
          )
        ),
        checkout_form_wastage_items (
          raw_material_id,
          wasted_quantity,
          wastage_reason,
          raw_materials (
            id,
            name,
            code,
            unit
          )
        )
      `)
      .eq('cloud_kitchen_id', cloudKitchenId)
      .eq('status', 'confirmed')
      .gte('plan_date', startDate)
      .lte('plan_date', endDate)
      .order('plan_date', { ascending: false })
      // Sheets share a plan_date by the dozen; without a unique tiebreaker
      // paging can repeat or skip one. See docs/decisions/0009.
      .order('id', { ascending: true })
  )
}

const materialFrom = (line) => ({
  name: line.raw_materials?.name || 'Unknown material',
  code: line.raw_materials?.code || '',
  unit: line.raw_materials?.unit || '',
})

/**
 * The period's totals per material — the list the purchase manager keys in.
 *
 * A material appears if it was returned or wasted at least once. Lines that
 * went out and came back as zero are not interesting here: nothing to record.
 */
export const buildReturnsByMaterial = (closings) => {
  const materials = new Map()

  const touch = (materialId, line) => {
    if (!materials.has(materialId)) {
      materials.set(materialId, {
        materialId,
        ...materialFrom(line),
        dispatched: 0,
        returned: 0,
        wasted: 0,
        outletIds: new Set(),
        sheetIds: new Set(),
      })
    }
    return materials.get(materialId)
  }

  closings.forEach((closing) => {
    ;(closing.checkout_form_return_items || []).forEach((line) => {
      const row = touch(line.raw_material_id, line)
      row.dispatched += num(line.dispatched_quantity)
      row.returned += num(line.returned_quantity)
      if (num(line.returned_quantity) > 0) {
        row.outletIds.add(closing.outlet_id)
        row.sheetIds.add(closing.id)
      }
    })

    ;(closing.checkout_form_wastage_items || []).forEach((line) => {
      const row = touch(line.raw_material_id, line)
      row.wasted += num(line.wasted_quantity)
      if (num(line.wasted_quantity) > 0) {
        row.outletIds.add(closing.outlet_id)
        row.sheetIds.add(closing.id)
      }
    })
  })

  return [...materials.values()]
    .filter((row) => row.returned > 0 || row.wasted > 0)
    .map(({ outletIds, sheetIds, ...row }) => ({
      ...row,
      outletCount: outletIds.size,
      sheetCount: sheetIds.size,
    }))
    .sort((a, b) => b.returned - a.returned || a.name.localeCompare(b.name))
}

/** The closing sheets themselves, newest first, each with its own lines. */
export const buildClosingSheets = (closings) =>
  closings
    .map((closing) => {
      const returns = (closing.checkout_form_return_items || []).map((line) => ({
        materialId: line.raw_material_id,
        ...materialFrom(line),
        dispatched: num(line.dispatched_quantity),
        returned: num(line.returned_quantity),
      }))

      const wastage = (closing.checkout_form_wastage_items || []).map((line) => ({
        materialId: line.raw_material_id,
        ...materialFrom(line),
        wasted: num(line.wasted_quantity),
        reason: line.wastage_reason || '',
      }))

      // One row per material, so a reader sees a material's whole story on the
      // night rather than the same name in two tables.
      const lines = new Map()
      returns.forEach((line) => {
        lines.set(line.materialId, { ...line, wasted: 0, reason: '' })
      })
      wastage.forEach((line) => {
        const existing = lines.get(line.materialId)
        if (existing) {
          existing.wasted = line.wasted
          existing.reason = line.reason
        } else {
          lines.set(line.materialId, { ...line, dispatched: 0, returned: 0 })
        }
      })

      return {
        id: closing.id,
        planDate: closing.plan_date,
        outletId: closing.outlet_id,
        outletName: closing.outlets?.name || 'Unknown outlet',
        outletCode: closing.outlets?.code || '',
        supervisorName: closing.supervisor_name || '',
        confirmedAt: closing.confirmed_at,
        totalReturned: returns.reduce((sum, line) => sum + line.returned, 0),
        totalWasted: wastage.reduce((sum, line) => sum + line.wasted, 0),
        lines: [...lines.values()].sort((a, b) => b.returned - a.returned || a.name.localeCompare(b.name)),
      }
    })
    .sort(
      (a, b) =>
        String(b.planDate).localeCompare(String(a.planDate)) ||
        a.outletName.localeCompare(b.outletName)
    )
