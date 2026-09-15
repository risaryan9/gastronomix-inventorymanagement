/*
 * The FOFO catalogue: which materials an outlet can buy, and at what price.
 *
 * Loads rows and hands them to pricing.js. Every function takes a transaction
 * client from db.js and the franchise from the session, and every query is
 * scoped to that franchise (api/franchise.js explains why).
 *
 * WHICH MATERIALS APPEAR (spec §6.5), for one outlet:
 *   1. is_fofo_sellable
 *   2. active and not deleted
 *   3. brand_codes NULL (all brands) or containing the OUTLET's brand — the
 *      first two letters of its code — and never internal production ('ip')
 *   4. priceable in the outlet's serving kitchen; if not, the item is still
 *      listed, as unavailable (§6.4), so a franchise sees "contact us" rather
 *      than wondering where it went
 * The brand is the outlet's rather than any the franchise owns: an order is for
 * one outlet, and an El Chaapo outlet has no use for Nippu Kodi's supplies.
 *
 * WHAT NEVER LEAVES THIS FILE: base cost, margin, stock. publicItem() is the
 * one place a priced material becomes a response, and it copies named fields
 * only (spec §11).
 */
import { HttpError, isUuid } from './http.js'
import { costResolver, lineAmounts, money, unitMoney, unitPrices } from './pricing.js'

// Statuses that mean money was taken: what an outlet has actually bought.
export const BOUGHT_STATUSES = ['paid', 'accepted', 'packed', 'ready_to_ship', 'shipped', 'delivered']
export const IN_PROCESS_STATUSES = ['paid', 'accepted', 'packed', 'ready_to_ship', 'shipped']

const BRAND_NAMES = { EC: 'El Chaapo', NK: 'Nippu Kodi', BP: 'Boom Pizza' }
export const brandOfOutletCode = (code) => String(code || '').slice(0, 2).toUpperCase()

/*
 * How much an item is ordered in. There is no column for it; the unit decides.
 * Weighed and poured goods go in half units, counted goods in ones. Mirrored by
 * nothing in the browser — the catalogue response carries the step.
 */
const ORDER_STEP_BY_UNIT = { kg: '0.5', liter: '0.5', nos: '1', packets: '1' }
export const orderStepForUnit = (unit) => ORDER_STEP_BY_UNIT[unit] || '1'

/** Is `quantity` a positive whole number of steps? Both as decimal strings. */
export function isWholeSteps(quantity, step) {
  const q = Number(quantity), s = Number(step)
  if (!Number.isFinite(q) || q <= 0 || q > 100000) return false
  const steps = q / s
  return Math.abs(steps - Math.round(steps)) < 1e-9
}

/**
 * One of this franchise's outlets, with its serving kitchen, or HttpError 404.
 * An outlet id from the request is only ever used through this.
 */
export async function outletForFranchise(db, franchiseId, outletId) {
  if (!isUuid(outletId)) throw new HttpError(400, 'Choose an outlet')
  const { rows } = await db.query(
    `SELECT o.id, o.code, o.name, o.cloud_kitchen_id,
            ck.name AS kitchen_name, ck.code AS kitchen_code
       FROM fofo.franchise_outlets fo
       JOIN public.outlets o ON o.id = fo.outlet_id
       JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id
      WHERE fo.franchise_id = $1 AND o.id = $2
        AND o.is_active = true AND o.deleted_at IS NULL`,
    [franchiseId, outletId]
  )
  if (!rows.length) throw new HttpError(404, 'That outlet is not one of yours')
  return rows[0]
}

export const publicOutlet = (outlet) => ({
  id: outlet.id,
  code: outlet.code,
  name: outlet.name,
  brand: brandOfOutletCode(outlet.code),
  brandName: BRAND_NAMES[brandOfOutletCode(outlet.code)] || brandOfOutletCode(outlet.code),
  kitchenName: outlet.kitchen_name,
  kitchenCode: outlet.kitchen_code,
})

/*
 * Everything pricing.js needs for one kitchen, in three queries:
 *   - every material (a recipe may name one that is not itself sellable)
 *   - its purchase cost in this kitchen, GST-inclusive, rounded to 4 places:
 *     the quantity-weighted average of batches with stock left, else the most
 *     recent batch, however old (§6.2). Weighted by what is left, and averaged
 *     GST-inclusive per batch, because gst_percent differs between batches.
 *   - active recipes and their lines
 */
async function kitchenPricing(db, kitchenId) {
  // One after another: a node-postgres client runs one query at a time, and
  // queueing several on it at once is deprecated.
  const materials = await db.query(
    `SELECT id, code, name, unit, category, description, material_type, brand_codes,
            is_fofo_sellable, is_active, deleted_at, hsn_code,
            sale_gst_percent, sale_margin_percent
       FROM public.raw_materials`
  )
  const costs = await db.query(
    `WITH on_shelf AS (
       SELECT raw_material_id,
              round(SUM(quantity_remaining * unit_cost * (1 + COALESCE(gst_percent, 0) / 100))
                    / SUM(quantity_remaining), 4) AS cost
         FROM public.stock_in_batches
        WHERE cloud_kitchen_id = $1 AND quantity_remaining > 0
        GROUP BY raw_material_id
     ),
     latest AS (
       SELECT DISTINCT ON (raw_material_id) raw_material_id,
              round(unit_cost * (1 + COALESCE(gst_percent, 0) / 100), 4) AS cost
         FROM public.stock_in_batches
        WHERE cloud_kitchen_id = $1
        ORDER BY raw_material_id, created_at DESC, id DESC
       )
     SELECT l.raw_material_id AS id, COALESCE(s.cost, l.cost)::text AS cost
       FROM latest l LEFT JOIN on_shelf s USING (raw_material_id)`,
    [kitchenId]
  )
  const recipes = await db.query(
    `SELECT r.material_id, r.yield_quantity::text AS yield_quantity,
            ri.component_material_id, ri.quantity::text AS quantity
       FROM public.recipes r
       JOIN public.recipe_items ri ON ri.recipe_id = r.id
      WHERE r.is_active = true AND r.deleted_at IS NULL
      ORDER BY r.material_id, ri.sort_order, ri.id`
  )

  const materialMap = new Map(materials.rows.map((m) => [m.id, m]))
  const costMap = new Map(costs.rows.map((c) => [c.id, c.cost]))
  const recipeMap = new Map()
  for (const row of recipes.rows) {
    if (!recipeMap.has(row.material_id)) recipeMap.set(row.material_id, { yieldQuantity: row.yield_quantity, items: [] })
    recipeMap.get(row.material_id).items.push({ componentId: row.component_material_id, quantity: row.quantity })
  }
  return { materials: materialMap, cost: costResolver({ materials: materialMap, costs: costMap, recipes: recipeMap }) }
}

const brandCodesOf = (material) =>
  Array.isArray(material.brand_codes) ? material.brand_codes.map((c) => String(c).toLowerCase()) : null

/** Would this material be listed for this outlet at all (rules 1–3)? */
function listedFor(material, outletBrand) {
  if (!material.is_fofo_sellable || !material.is_active || material.deleted_at) return false
  const codes = brandCodesOf(material)
  if (codes?.includes('ip')) return false
  return codes === null || codes.length === 0 || codes.includes(outletBrand.toLowerCase())
}

/**
 * The priced catalogue for one outlet: Map material id → priced item, for every
 * listed material. Unlisted materials are absent; unpriceable ones are present
 * with available: false. Prices stay BigInt decimals here — call publicItem()
 * to put one in a response.
 */
export async function pricedCatalog(db, outlet) {
  const { materials, cost } = await kitchenPricing(db, outlet.cloud_kitchen_id)
  const brand = brandOfOutletCode(outlet.code)
  const items = new Map()
  for (const material of materials.values()) {
    if (!listedFor(material, brand)) continue
    const resolved = cost(material.id)
    items.set(material.id, {
      material,
      available: resolved.cost !== null,
      ...(resolved.cost !== null ? unitPrices(resolved.cost, material) : {}),
      orderStep: orderStepForUnit(material.unit),
    })
  }
  return { items, materials }
}

/** A priced item as the browser may see it: final prices only. */
export function publicItem(item) {
  const m = item.material
  const codes = brandCodesOf(m)
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    category: m.category || 'Uncategorised',
    type: m.material_type,
    unit: m.unit,
    description: m.description || null,
    hsn: m.hsn_code || null,
    brands: codes && codes.length ? codes.map((c) => c.toUpperCase()) : null,
    gstPercent: Number(m.sale_gst_percent),
    priceExGst: item.available ? unitMoney(item.exGst) : null,
    priceIncGst: item.available ? unitMoney(item.incGst) : null,
    orderStep: Number(item.orderStep),
    available: item.available,
  }
}

/** GET /api/franchise/catalog?outlet_id= */
export async function catalogForOutlet(db, franchiseId, outletId) {
  const outlet = await outletForFranchise(db, franchiseId, outletId)
  const { items } = await pricedCatalog(db, outlet)

  // When this outlet last bought each item, from orders money was taken for.
  const { rows: last } = await db.query(
    `SELECT DISTINCT ON (oi.raw_material_id)
            oi.raw_material_id, oi.quantity_ordered::text AS quantity,
            COALESCE(o.placed_at, o.created_at) AS at, o.order_number
       FROM fofo.order_items oi
       JOIN fofo.orders o ON o.id = oi.order_id
      WHERE o.franchise_id = $1 AND o.outlet_id = $2 AND o.status = ANY($3)
      ORDER BY oi.raw_material_id, COALESCE(o.placed_at, o.created_at) DESC, o.id DESC`,
    [franchiseId, outlet.id, BOUGHT_STATUSES]
  )
  const lastByMaterial = new Map(last.map((r) => [r.raw_material_id, r]))

  return {
    outlet: publicOutlet(outlet),
    items: [...items.values()]
      .map((item) => {
        const l = lastByMaterial.get(item.material.id)
        return {
          ...publicItem(item),
          lastOrdered: l ? { at: l.at, quantity: Number(l.quantity), orderNumber: l.order_number } : null,
        }
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
  }
}

/** GET /api/franchise/catalog/history?outlet_id=&material_id= — every time this outlet bought it. */
export async function purchaseHistory(db, franchiseId, outletId, materialId) {
  const outlet = await outletForFranchise(db, franchiseId, outletId)
  if (!isUuid(materialId)) throw new HttpError(400, 'Choose a supply')
  const { rows } = await db.query(
    `SELECT o.id AS order_id, o.order_number, o.status,
            COALESCE(o.placed_at, o.created_at) AS placed_at,
            oi.quantity_ordered::text AS quantity,
            oi.unit_price_ex_gst::text AS unit_price_ex_gst,
            oi.unit_price_inc_gst::text AS unit_price_inc_gst,
            oi.gst_percent::text AS gst_percent
       FROM fofo.order_items oi
       JOIN fofo.orders o ON o.id = oi.order_id
      WHERE o.franchise_id = $1 AND o.outlet_id = $2 AND oi.raw_material_id = $3
        AND o.status = ANY($4)
      ORDER BY COALESCE(o.placed_at, o.created_at) DESC, o.id DESC`,
    [franchiseId, outlet.id, materialId, BOUGHT_STATUSES]
  )
  return rows.map((r) => ({
    orderId: r.order_id,
    orderNumber: r.order_number,
    placedAt: r.placed_at,
    status: r.status,
    quantity: Number(r.quantity),
    unitPriceIncGst: unitMoney(r.unit_price_inc_gst),
    lineTotal: money(lineAmounts(r.quantity, r.unit_price_ex_gst, r.gst_percent).total),
  }))
}

/** GET /api/franchise/outlets — each outlet with where its orders stand. */
export async function outletsWithOrderSummary(db, franchiseId) {
  const { rows } = await db.query(
    `SELECT o.id, o.code, o.name, ck.name AS kitchen_name, ck.code AS kitchen_code,
            COUNT(ord.id) FILTER (WHERE ord.status = ANY($2))                           AS in_process,
            COUNT(ord.id) FILTER (WHERE ord.status = 'delivered')                       AS completed,
            MAX(COALESCE(ord.placed_at, ord.created_at)) FILTER (WHERE ord.status = ANY($3)) AS last_order_at,
            COALESCE(SUM(ord.grand_total) FILTER (
              WHERE ord.status = ANY($3)
                AND COALESCE(ord.placed_at, ord.created_at) >= now() - interval '30 days'), 0)::text AS spend_30d
       FROM fofo.franchise_outlets fo
       JOIN public.outlets o ON o.id = fo.outlet_id
       JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id
       LEFT JOIN fofo.orders ord ON ord.outlet_id = o.id AND ord.franchise_id = fo.franchise_id
      WHERE fo.franchise_id = $1 AND o.is_active = true AND o.deleted_at IS NULL
      GROUP BY o.id, o.code, o.name, ck.name, ck.code
      ORDER BY o.code, o.id`,
    [franchiseId, IN_PROCESS_STATUSES, BOUGHT_STATUSES]
  )
  return rows.map((r) => ({
    ...publicOutlet(r),
    inProcessCount: Number(r.in_process),
    completedCount: Number(r.completed),
    lastOrderAt: r.last_order_at,
    spendLast30Days: money(r.spend_30d),
  }))
}
