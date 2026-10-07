/*
 * What a FOFO franchise pays for a material, in one serving kitchen.
 *
 * docs/fofo-dashboard-spec.md §6 is the rule; this is it as code, with no
 * database access, so it can be exercised directly with representative data.
 * api/_lib/catalog.js loads the rows and calls in.
 *
 *   base cost          what the unit cost US, GST-inclusive (§6.1–6.3)
 *   × (1 + margin%)    → unit price before GST
 *   × (1 + sale GST%)  → unit price with GST
 *
 * THE BASE COST IS GST-INCLUSIVE ON PURPOSE. This reads like tax on tax and is
 * not: there is no input tax credit, so vendor GST is part of what the material
 * cost (decision 0014). Do not "fix" it to the bare unit_cost.
 *
 * WHERE THE BASE COST COMES FROM, always in the serving kitchen, never another:
 *   raw_material, non_food   the purchase cost (costs, below)
 *   semi_finished, finished  the recipe, recursing into made components
 * No cost in this kitchen → the material is unavailable here (§6.4). Never fall
 * back to another kitchen's price.
 *
 * A RECIPE IS A RATIO BY WEIGHT (decision 0022, migration 20). Each line's
 * quantity is the ingredient's SHARE of the mix, the shares adding up to 1, and
 * yield_quantity is the fraction of the mix that comes out. So a recipe is
 * costed per kilogram, whatever the product is sold in:
 *
 *   cost of 1 kg of output = Σ share × cost of 1 kg of ingredient ÷ yield
 *
 * and each material's cost per kilogram comes from its unit:
 *   kg             its cost, as it is
 *   liter          its cost: a litre is taken as 1,000 g
 *   nos, packets   bought → none: nothing says what a piece weighs, so it
 *                  cannot be in a recipe (save_recipe refuses it too)
 *                  made   → its recipe's cost per kg
 * A made material sold by the piece costs its per-kg cost × the recipe's
 * piece_weight_grams ÷ 1000.
 *
 * The internal app's Recipes page previews the same sum from
 * frontend/src/lib/recipeCost.js. The two apps share no code: change the rule
 * in both, or the preview and the price a franchise pays will disagree.
 *
 * PRECISION, the same everywhere a price is frozen (05-create-fofo-orders-and-carts.sql):
 * unit figures to 4 places, each LINE rounded to the paisa, lines added up.
 *
 * NOTHING FROM HERE REACHES A BROWSER EXCEPT THE FINAL PRICES. baseCost and
 * marginPercent exist for freezing an order; catalog.js strips them from every
 * response (spec §11).
 */
import { add, dec, div, mul, percent, round, toFixed, toNumber } from './decimal.js'

const MADE = new Set(['semi_finished', 'finished'])
// Counted, not weighed. Everything else (kg, liter) has a cost per kilogram.
const COUNTED = new Set(['nos', 'packets'])
const GRAMS_PER_KG = '1000'

// A BOM can predate the loop guard, so the read defends itself too (spec §5).
const MAX_RECIPE_DEPTH = 10

/**
 * Base costs for every material that can be costed in one kitchen.
 *
 *   materials  Map id → { id, name, material_type, unit }  every material a
 *              recipe may mention, not just the sellable ones
 *   costs      Map id → purchase cost string, GST-inclusive, already rounded
 *              to 4 places in SQL (the weighted average of batches with stock
 *              left, else the most recent batch)
 *   recipes    Map material id → { yieldQuantity, pieceWeightGrams,
 *              items: [{ componentId, quantity }] }, active recipes only.
 *              quantity is a share of the mix; yieldQuantity a fraction.
 *
 * Returns a function: id → { cost, perKg } | { cost: null, reason }. `cost` is
 * for one of the material's own unit, which is what a price is built on.
 * `perKg` is what a recipe that uses it reads, and is null for something that
 * can be sold but not weighed.
 */
export function costResolver({ materials, costs, recipes }) {
  const memo = new Map()

  const resolve = (id, depth, path) => {
    if (memo.has(id)) return memo.get(id)
    const material = materials.get(id)
    if (!material) return { cost: null, reason: 'unknown material' }

    const counted = COUNTED.has(material.unit)
    let result
    if (!MADE.has(material.material_type)) {
      const cost = costs.get(id)
      result = cost === undefined || cost === null
        ? { cost: null, reason: `no purchase of ${material.name} in this kitchen` }
        : { cost: dec(cost), perKg: counted ? null : dec(cost) }
    } else {
      const recipe = recipes.get(id)
      if (!recipe || !recipe.items.length) {
        result = { cost: null, reason: `no recipe for ${material.name}` }
      } else if (depth >= MAX_RECIPE_DEPTH || path.has(id)) {
        result = { cost: null, reason: `the recipe for ${material.name} contains itself` }
      } else {
        const nextPath = new Set(path).add(id)
        let total = 0n
        result = null
        for (const item of recipe.items) {
          const component = resolve(item.componentId, depth + 1, nextPath)
          if (component.cost === null) {
            result = { cost: null, reason: component.reason }
            break
          }
          if (component.perKg === null) {
            result = { cost: null, reason: `${materials.get(item.componentId).name} is bought by the piece and cannot be weighed into a recipe` }
            break
          }
          total = add(total, mul(item.quantity, component.perKg))
        }
        if (!result) {
          const perKg = round(div(total, recipe.yieldQuantity), 4)
          if (!counted) {
            result = { cost: perKg, perKg }
          } else if (!recipe.pieceWeightGrams) {
            result = { cost: null, reason: `the recipe for ${material.name} does not say what one piece weighs` }
          } else {
            result = { cost: round(div(mul(perKg, recipe.pieceWeightGrams), GRAMS_PER_KG), 4), perKg }
          }
        }
      }
    }
    // A loop answer depends on the path it was reached by; do not memoise it.
    if (!(result.cost === null && /contains itself/.test(result.reason))) memo.set(id, result)
    return result
  }

  return (id) => resolve(id, 0, new Set())
}

/**
 * The unit prices for a sellable material, given its base cost.
 * `material` needs sale_margin_percent and sale_gst_percent.
 */
export function unitPrices(baseCost, material) {
  const base = round(baseCost, 4)
  const exGst = round(add(base, percent(base, material.sale_margin_percent)), 4)
  const incGst = round(add(exGst, percent(exGst, material.sale_gst_percent)), 4)
  return { baseCost: base, exGst, incGst }
}

/**
 * One line's money, exactly as fofo.invoice_items checks it:
 *   taxable = round(quantity × unit price before GST, 2)
 *   gst     = round(taxable × GST% / 100, 2)
 *   total   = taxable + gst
 * Note the total is NOT quantity × unit price with GST; that rounds differently.
 */
export function lineAmounts(quantity, exGst, gstPercent) {
  const taxable = round(mul(quantity, exGst), 2)
  const gst = round(percent(taxable, gstPercent), 2)
  return { taxable, gst, total: add(taxable, gst) }
}

/** Lines added up: the rounded lines, never a rounded sum of unrounded ones. */
export function sumLines(lines) {
  return lines.reduce(
    (acc, line) => ({ taxable: add(acc.taxable, line.taxable), gst: add(acc.gst, line.gst), total: add(acc.total, line.total) }),
    { taxable: 0n, gst: 0n, total: 0n }
  )
}

/** Did the price move since it was agreed? Compared to the paisa (decision 0020). */
export const priceChanged = (agreedIncGst, currentIncGst) =>
  round(agreedIncGst, 2) !== round(currentIncGst, 2)

// Razorpay cannot collect less than ₹1 (migration 17).
const RAZORPAY_MINIMUM = dec('1.00')

/**
 * How much store credit a checkout can redeem: all it has, up to the order
 * total, but never leaving Razorpay between 1 and 99 paise to collect —
 * orders_razorpay_amount_collectable would refuse that order.
 */
export function redeemableCredit(available, grandTotal) {
  const total = dec(grandTotal)
  let credit = dec(available) < total ? dec(available) : total
  if (credit < 0n) credit = 0n
  const remainder = total - credit
  if (remainder > 0n && remainder < RAZORPAY_MINIMUM) {
    credit = total - RAZORPAY_MINIMUM
    if (credit < 0n) credit = 0n
  }
  return round(credit, 2)
}

export const money = (value) => toNumber(value, 2)
export const unitMoney = (value) => toNumber(value, 4)
export const moneyString = (value) => toFixed(value, 2)
