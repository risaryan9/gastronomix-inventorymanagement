// One definition of what stock is worth, and one definition of what counts as
// stock at all. Every screen that reports an inventory figure reads from here.
//
// Two rules the whole app has to agree on:
//
//   1. A batch is worth its remaining quantity at the GST-inclusive cost it was
//      bought at. GST is money that left the bank; a valuation without it
//      understates the stock by the blended tax rate, and two screens that
//      disagree on it report different totals for the same shelf.
//
//   2. A deactivated or deleted material is not stock. It does not contribute
//      to a value, a material count, or a low-stock alert anywhere.
//
// Rule 2 is enforced in the query rather than left to RLS. The SELECT policy on
// raw_materials does hide inactive rows, but relying on it makes an embed come
// back null instead of dropping the row — and a null embed reads as "unknown",
// which is exactly how a deactivated material used to keep its value in the
// totals.

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Unit cost with GST folded in — what a unit actually cost to buy. */
export const gstInclusiveUnitCost = (batch) =>
  num(batch?.unit_cost) * (1 + num(batch?.gst_percent) / 100)

/** What is still on the shelf from one batch, in rupees. */
export const batchValue = (batch) =>
  num(batch?.quantity_remaining) * gstInclusiveUnitCost(batch)

/**
 * The columns every valuation query needs. Selecting fewer silently drops GST
 * back out of the number, so select this rather than hand-listing them.
 */
export const BATCH_VALUATION_COLUMNS = 'quantity_remaining, unit_cost, gst_percent'

/**
 * Narrows a query to live materials only.
 *
 * The embedded `raw_materials` must be declared `!inner` in the select, or
 * PostgREST keeps the parent row with a null embed instead of dropping it.
 *
 * @param {object} query a PostgREST query builder
 * @param {string} embed the alias the raw_materials join was given
 */
export const onlyActiveMaterials = (query, embed = 'raw_materials') =>
  query.eq(`${embed}.is_active`, true).is(`${embed}.deleted_at`, null)

/** The same rule for rows already in hand. */
export const isActiveMaterial = (material) =>
  !!material && material.is_active !== false && !material.deleted_at
