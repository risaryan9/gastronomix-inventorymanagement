// What a recipe is, and what it costs to make: the rule the Recipes page
// previews with.
//
// A RECIPE IS A RATIO BY WEIGHT, NOT A BATCH (decision 0022). The kitchen
// types one batch in grams; what is saved is each ingredient's SHARE of the
// mix, the shares adding up to 1, and a YIELD FRACTION, how much of the mix
// comes out. 1,440.9 g of chicken in a 1,533.5 g batch is a share of 0.9396,
// and it is the same recipe whatever size the batch was.
//
//   cost of 1 kg of output = Σ share × cost of 1 kg of ingredient ÷ yield
//
// EVERYTHING IS WEIGHED, so each material needs a cost per kilogram:
//   kg             its cost, as it is
//   liter          its cost: a litre is taken as 1,000 g
//   nos, packets   bought → none. Nothing says what a piece weighs, so it
//                  cannot go into a recipe.
//                  made   → its own recipe's cost per kg (recipes nest)
// A made material counted in pieces costs its per-kg cost × the recipe's
// piece weight in grams ÷ 1000.
//
// THIS IS A PREVIEW. The price a franchise is charged is worked out by the
// partner app's server, exactly, in partner-frontend/api/_lib/pricing.js. The
// two apps share no code, so the rule is written in both: change one and the
// other must follow, or this screen and the catalogue will disagree. The
// shares themselves are worked out in the database (save_recipe, migration
// 20); sharesFromGrams below only shows what they will be.
//
// Costs are per cloud kitchen, because stock is (spec §6.2): the quantity-
// weighted average of batches with stock left, GST-inclusive, else the most
// recent batch. No history in the kitchen means no cost there, and nothing
// made from it can be costed there either.

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'
import { gstInclusiveUnitCost } from './inventoryValuation'

export const MADE_TYPES = ['semi_finished', 'finished']
const COUNTED_UNITS = ['nos', 'packets']

// A recipe can predate the loop guard, so a read defends itself too.
const MAX_RECIPE_DEPTH = 10

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const isMade = (material) => MADE_TYPES.includes(material?.material_type)

/** Counted in pieces rather than weighed. */
export const isCounted = (material) => COUNTED_UNITS.includes(material?.unit)

/** Can it be an ingredient? Anything weighed, and anything made. */
export const canBeWeighed = (material) => isMade(material) || !isCounted(material)

/** Each row's share of the batch: grams ÷ total grams. Rows with no weight get 0. */
export function sharesFromGrams(rows) {
  const total = rows.reduce((sum, row) => sum + Math.max(num(row.grams), 0), 0)
  return rows.map((row) => ({ ...row, share: total > 0 ? Math.max(num(row.grams), 0) / total : 0 }))
}

/**
 * Would putting `componentId` into `productId`'s recipe make the product
 * contain itself, directly or through a chain of recipes?
 * `recipes` is Map material id → { items: [{ componentId }] }.
 */
export function wouldContainItself(recipes, productId, componentId) {
  const seen = new Set()
  const walk = (id, depth) => {
    if (id === productId) return true
    if (seen.has(id) || depth > 50) return false
    seen.add(id)
    return (recipes.get(id)?.items || []).some((item) => walk(item.componentId, depth + 1))
  }
  return walk(componentId, 0)
}

/**
 * One kitchen's purchase cost per material, GST-inclusive, from its batches.
 * `batches` must be newest first (created_at, then id), so the first batch seen
 * for a material is its most recent.
 */
export function kitchenCostsFromBatches(batches) {
  const onShelf = new Map() // id → { value, quantity }
  const latest = new Map()
  for (const batch of batches) {
    const id = batch.raw_material_id
    if (!latest.has(id)) latest.set(id, gstInclusiveUnitCost(batch))
    const remaining = num(batch.quantity_remaining)
    if (remaining > 0) {
      const sum = onShelf.get(id) || { value: 0, quantity: 0 }
      sum.value += remaining * gstInclusiveUnitCost(batch)
      sum.quantity += remaining
      onShelf.set(id, sum)
    }
  }
  const costs = new Map()
  for (const [id, cost] of latest) {
    const shelf = onShelf.get(id)
    costs.set(id, shelf ? shelf.value / shelf.quantity : cost)
  }
  return costs
}

/** Loads one kitchen's batches and returns Map material id → cost. */
export async function fetchKitchenCosts(cloudKitchenId) {
  if (!cloudKitchenId) return new Map()
  // id breaks ties between batches created in the same instant, so paging
  // cannot skip or repeat a row (decision 0009).
  const batches = await fetchAllRows(() =>
    supabase
      .from('stock_in_batches')
      .select('id, raw_material_id, quantity_remaining, unit_cost, gst_percent, created_at')
      .eq('cloud_kitchen_id', cloudKitchenId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  )
  return kitchenCostsFromBatches(batches)
}

/**
 * Costs for every material in one kitchen.
 *
 *   materials  Map id → { id, name, unit, material_type }
 *   costs      Map id → purchase cost (kitchenCostsFromBatches)
 *   recipes    Map material id → { yield, pieceWeightGrams, items: [{ componentId, share }] }
 *
 * Returns a function: id → { cost, perKg } | { cost: null, reason }. `cost` is
 * for one of the material's own unit; `perKg` is what a recipe using it reads,
 * and is null for something bought by the piece.
 */
export function recipeCostResolver({ materials, costs, recipes }) {
  const memo = new Map()

  const resolve = (id, depth, path) => {
    if (memo.has(id)) return memo.get(id)
    const material = materials.get(id)
    if (!material) return { cost: null, reason: 'a material that is no longer in the list' }

    const counted = isCounted(material)
    let result
    if (!isMade(material)) {
      const cost = costs.get(id)
      result = cost === undefined
        ? { cost: null, reason: `${material.name} has never been bought in this kitchen` }
        : { cost, perKg: counted ? null : cost }
    } else {
      const recipe = recipes.get(id)
      if (!recipe || !recipe.items.length) {
        result = { cost: null, reason: `${material.name} has no recipe yet` }
      } else if (depth >= MAX_RECIPE_DEPTH || path.has(id)) {
        return { cost: null, reason: `the recipe for ${material.name} contains itself` }
      } else {
        const nextPath = new Set(path).add(id)
        let total = 0
        for (const item of recipe.items) {
          const component = resolve(item.componentId, depth + 1, nextPath)
          if (component.cost === null) { result = { cost: null, reason: component.reason }; break }
          if (component.perKg === null) {
            result = { cost: null, reason: `${materials.get(item.componentId)?.name} is bought by the piece and cannot be weighed` }
            break
          }
          total += num(item.share) * component.perKg
        }
        if (!result) {
          const perKg = total / num(recipe.yield)
          if (!counted) result = { cost: perKg, perKg }
          else if (!num(recipe.pieceWeightGrams)) result = { cost: null, reason: `the recipe for ${material.name} does not say what one piece weighs` }
          else result = { cost: (perKg * num(recipe.pieceWeightGrams)) / 1000, perKg }
        }
      }
    }
    memo.set(id, result)
    return result
  }

  return (id) => resolve(id, 0, new Set())
}

/**
 * The cost of a recipe being typed, before it is saved.
 *   rows     [{ componentId, grams }]
 *   resolve  from recipeCostResolver
 * Returns each row with its share, cost per kg and cost in this batch, and the
 * mix's cost per kg, or why it cannot be worked out.
 */
export function previewRecipe({ rows, yieldFraction, pieceWeightGrams, counted, resolve }) {
  const shared = sharesFromGrams(rows)
  const totalGrams = shared.reduce((sum, row) => sum + Math.max(num(row.grams), 0), 0)
  let mixPerKg = 0
  const missing = []
  const lines = shared.map((row) => {
    if (!row.componentId) return { ...row, perKg: null, batchCost: null, reason: null }
    const component = resolve(row.componentId)
    const perKg = component.cost === null ? null : component.perKg
    if (perKg === null || perKg === undefined) {
      const reason = component.reason || 'It is bought by the piece and cannot be weighed'
      if (!missing.includes(reason)) missing.push(reason)
      return { ...row, perKg: null, batchCost: null, reason }
    }
    mixPerKg += row.share * perKg
    return { ...row, perKg, batchCost: (num(row.grams) / 1000) * perKg, reason: null }
  })

  const yieldValue = num(yieldFraction)
  const costed = missing.length === 0 && totalGrams > 0
  const outputPerKg = costed && yieldValue > 0 ? mixPerKg / yieldValue : null
  const perPiece = outputPerKg !== null && counted && num(pieceWeightGrams) > 0
    ? (outputPerKg * num(pieceWeightGrams)) / 1000
    : null
  return {
    lines,
    totalGrams,
    batchCost: costed ? (totalGrams / 1000) * mixPerKg : null,
    mixPerKg: costed ? mixPerKg : null,
    outputPerKg,
    perPiece,
    missing,
  }
}
