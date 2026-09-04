// Low-stock thresholds, which are per cloud kitchen.
//
// WHY THIS EXISTS
//
// A material's threshold used to be one number for the whole company, sitting
// on raw_materials.low_stock_threshold, and seven screens read it straight off
// the joined row. It is now two numbers: that column is the default, and
// material_stock_thresholds may hold an override for one (material, kitchen).
//
// The rule for combining them is three lines long, which is exactly why it
// belongs here rather than in seven places — the same reason
// lib/inventoryValuation.js exists. Compute it inline on the Inventory page
// and the dashboard badge and the admin overview and you get three answers
// the first time somebody edits one of them.
//
// THE RULE
//
//   effective threshold = the kitchen's override, if a row exists
//                         otherwise the material's default
//
// No row means inherit. A stored 0 does not mean inherit — it means "never
// flag this material as low", which is what `threshold > 0` in the status
// checks has always meant and still does. So the loaders below distinguish
// "no entry" from "an entry whose value is 0", and callers must not collapse
// the two with `|| defaultThreshold`.
//
// WHAT USES IT. Anything that turns a quantity into a stock status:
// purchase-manager Inventory and Overview, PurchaseManagerDashboard's
// notification counts, lib/adminOverview.js, lib/adminKitchenDetail.js,
// supervisor RawMaterials, and the Materials catalog list. The admin sets the
// values from the material form in Materials.jsx.

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Combines a default with a possible override.
 *
 * `override` is undefined when the kitchen has no row — not null and not 0,
 * both of which are real stored values a kitchen can be given.
 */
export const effectiveThreshold = (defaultThreshold, override) =>
  override === undefined || override === null ? num(defaultThreshold) : num(override)

/**
 * Every override for one cloud kitchen, as a lookup keyed by material id.
 *
 * Returns a resolver rather than the raw Map so call sites read as the
 * question they are asking — `thresholds.get(materialId, material.low_stock_threshold)`
 * — and cannot forget the default.
 */
export const loadKitchenThresholds = async (cloudKitchenId) => {
  if (!cloudKitchenId) return emptyResolver()

  // Paged with a unique tiebreaker: this table grows as materials × kitchens,
  // which is already within one page of PostgREST's cap and will not stay
  // there. See docs/decisions/0009.
  const rows = await fetchAllRows(() =>
    supabase
      .from('material_stock_thresholds')
      .select('raw_material_id, low_stock_threshold')
      .eq('cloud_kitchen_id', cloudKitchenId)
      .order('id', { ascending: true })
  )

  const byMaterial = new Map()
  rows.forEach((row) => byMaterial.set(row.raw_material_id, num(row.low_stock_threshold)))

  return {
    get: (materialId, defaultThreshold) =>
      effectiveThreshold(defaultThreshold, byMaterial.get(materialId)),
    has: (materialId) => byMaterial.has(materialId),
    size: byMaterial.size,
  }
}

/**
 * Every override across every kitchen, for the screens that report on all of
 * them at once (the admin Cloud Kitchen Overview).
 */
export const loadAllKitchenThresholds = async () => {
  const rows = await fetchAllRows(() =>
    supabase
      .from('material_stock_thresholds')
      .select('raw_material_id, cloud_kitchen_id, low_stock_threshold')
      .order('id', { ascending: true })
  )

  const byPair = new Map()
  rows.forEach((row) =>
    byPair.set(
      `${row.raw_material_id}|${row.cloud_kitchen_id}`,
      num(row.low_stock_threshold)
    )
  )

  return {
    get: (materialId, cloudKitchenId, defaultThreshold) =>
      effectiveThreshold(defaultThreshold, byPair.get(`${materialId}|${cloudKitchenId}`)),
    size: byPair.size,
  }
}

const emptyResolver = () => ({
  get: (_materialId, defaultThreshold) => num(defaultThreshold),
  has: () => false,
  size: 0,
})

/**
 * The overrides for one material, as { [cloudKitchenId]: number }, for the
 * admin form. A kitchen missing from the object inherits the default — which
 * is the same thing the form's empty field means.
 */
export const fetchMaterialThresholds = async (materialId) => {
  if (!materialId) return {}

  const { data, error } = await supabase
    .from('material_stock_thresholds')
    .select('cloud_kitchen_id, low_stock_threshold')
    .eq('raw_material_id', materialId)

  if (error) throw error

  const byKitchen = {}
  ;(data ?? []).forEach((row) => {
    byKitchen[row.cloud_kitchen_id] = num(row.low_stock_threshold)
  })
  return byKitchen
}

/**
 * Writes the admin form's per-kitchen fields back.
 *
 * `byKitchen` is { [cloudKitchenId]: number | null }, where null is the
 * cleared field: the override is deleted and the kitchen returns to the
 * default. Kitchens absent from the object are left alone, so a caller that
 * only knows about the kitchens it rendered cannot silently drop the rest.
 */
export const saveMaterialThresholds = async (materialId, byKitchen) => {
  const entries = Object.entries(byKitchen ?? {})
  if (!materialId || entries.length === 0) return

  const toRemove = entries.filter(([, value]) => value === null).map(([id]) => id)
  const toStore = entries
    .filter(([, value]) => value !== null)
    .map(([cloudKitchenId, value]) => ({
      raw_material_id: materialId,
      cloud_kitchen_id: cloudKitchenId,
      low_stock_threshold: num(value),
    }))

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('material_stock_thresholds')
      .delete()
      .eq('raw_material_id', materialId)
      .in('cloud_kitchen_id', toRemove)
    if (error) throw error
  }

  if (toStore.length > 0) {
    const { error } = await supabase
      .from('material_stock_thresholds')
      .upsert(toStore, { onConflict: 'raw_material_id,cloud_kitchen_id' })
    if (error) throw error
  }
}

/**
 * Reads one field of the admin form into what saveMaterialThresholds wants:
 * a blank field is null (inherit), anything else is the number.
 *
 * '0' is deliberately not blank. Returns undefined for input that is not a
 * number at all, so a caller can reject it rather than store a NaN.
 */
export const parseThresholdField = (value) => {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') return null
  const parsed = parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

/**
 * The kitchens the admin form shows a field for, in a stable order. Inactive
 * kitchens are excluded — a threshold for a kitchen nobody is stocking is a
 * field to get wrong, and reactivating one restores any override it still has.
 */
export const fetchThresholdKitchens = () =>
  fetchAllRows(() =>
    supabase
      .from('cloud_kitchens')
      .select('id, name, code')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('code', { ascending: true })
      .order('id', { ascending: true })
  )
