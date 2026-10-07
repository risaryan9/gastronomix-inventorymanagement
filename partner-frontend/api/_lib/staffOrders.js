/*
 * The FOFO orders a kitchen serves, as its staff see and move them.
 *
 *   GET  /api/staff/orders/summary    how many wait to be accepted, and to be packed
 *   GET  /api/staff/orders            the kitchen's orders, newest first
 *   GET  /api/staff/orders?id=        one order with its lines
 *   GET  /api/staff/orders/label?id=  what the shipping label for one order says
 *   POST /api/staff/orders/accept     { order_id }   purchase manager: accept a paid order, in full
 *   POST /api/staff/orders/pack       { order_id }   kitchen executive: mark an accepted order packed
 *
 * The logistics invoice and shipping are separate endpoints, built with the
 * rest of spec §8.4.
 *
 * EVERY QUERY IS SCOPED TO THE PASS HOLDER'S KITCHEN (decision 0023): the
 * kitchen comes from the staff pass, never from the request, and an order id
 * that belongs to another kitchen answers 404, the same as one that does not
 * exist. `orders.cloud_kitchen_id` is the kitchen frozen on the order at
 * checkout, so an outlet that later moves kitchens does not move its old
 * orders with it.
 *
 * WHICH ORDERS EACH ROLE SEES (statusesFor).
 *   purchase manager   everything that has been paid for. An order still
 *                      waiting for its payment, or whose payment failed or ran
 *                      out of time, is a checkout the franchise has not
 *                      finished; it may never become an order. `paid` is the
 *                      first status a purchase manager can act on.
 *   kitchen executive  everything the purchase manager has accepted. Before
 *                      that there is nothing to pack, and the quantities are
 *                      not settled. `accepted` is the first status they act on.
 * An order outside a role's statuses is a 404 for that role, not a 403: to a
 * kitchen executive an unaccepted order does not exist yet.
 *
 * WHAT STAFF MAY SEE: quantities, the stock on hand, and the prices the
 * franchise was charged. Not the base cost or margin frozen on each line: the
 * margin does not leave the server for anyone (spec §11).
 *
 * STOCK ON HAND IS A HINT. It is this kitchen's inventory at the moment of the
 * request, shown so a purchase manager can see a shortfall before accepting.
 * It can be stale a second later; the accept function is what checks.
 *
 * EVERY CHANGE IS ONE DATABASE FUNCTION. fofo.accept_order (migration 16) and
 * fofo.mark_order_packed (22) each commit everything they do or nothing.
 * Nothing here does any of it in JavaScript. What a function refuses, it
 * refuses in words meant for the person pressing the button ("Not enough stock
 * to accept order FO-000012: Marinade short by 2.5 kg…"), and http.js passes
 * those through as they are.
 */
import { HttpError, isUuid } from './http.js'
import { clientIp, userAgent } from './request.js'
import { publicOutlet } from './catalog.js'
import { money } from './pricing.js'
import { seller } from './seller.js'

const ACCEPTED_ONWARD = ['accepted', 'packed', 'ready_to_ship', 'shipped', 'delivered']
const STATUSES_BY_ROLE = {
  purchase_manager: ['paid', ...ACCEPTED_ONWARD, 'cancelled'],
  kitchen_executive: ACCEPTED_ONWARD,
}
// See the header. A role with no entry sees nothing.
const statusesFor = (staff) => STATUSES_BY_ROLE[staff.role] || []

const ORDER_SOURCES = `
  JOIN public.outlets ou ON ou.id = o.outlet_id
  JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id
  JOIN fofo.franchises f ON f.id = o.franchise_id`

const ORDER_COLUMNS = `o.id, o.order_number, o.status,
  COALESCE(o.placed_at, o.created_at) AS placed_at, o.accepted_at,
  o.grand_total::text AS grand_total,
  ou.id AS outlet_id, ou.code AS outlet_code, ou.name AS outlet_name,
  ck.name AS kitchen_name, ck.code AS kitchen_code,
  f.name AS franchise_name`

const orderView = (r) => ({
  id: r.id,
  orderNumber: r.order_number,
  status: r.status,
  placedAt: r.placed_at,
  acceptedAt: r.accepted_at,
  franchiseName: r.franchise_name,
  outlet: publicOutlet({
    id: r.outlet_id, code: r.outlet_code, name: r.outlet_name,
    kitchen_name: r.kitchen_name, kitchen_code: r.kitchen_code,
  }),
  grandTotal: money(r.grand_total),
})

const NOT_YOURS = 'That order is not one of your kitchen’s'

/**
 * GET /api/staff/orders/summary — small enough to ask for on every screen: it
 * is what each dashboard's notice is drawn from. Both counts are the kitchen's;
 * the purchase manager's dashboard reads the first, the kitchen executive's the
 * second.
 */
export async function ordersSummary(db, staff) {
  const { rows: [row] } = await db.query(
    `SELECT count(*) FILTER (WHERE o.status = 'paid')::int AS waiting,
            min(COALESCE(o.placed_at, o.created_at)) FILTER (WHERE o.status = 'paid') AS oldest_waiting,
            count(*) FILTER (WHERE o.status = 'accepted')::int AS to_pack,
            min(o.accepted_at) FILTER (WHERE o.status = 'accepted') AS oldest_to_pack
       FROM fofo.orders o
      WHERE o.cloud_kitchen_id = $1 AND o.status IN ('paid', 'accepted')`,
    [staff.cloudKitchenId]
  )
  return {
    waitingForAcceptance: row.waiting,
    oldestWaitingSince: row.oldest_waiting,
    waitingToPack: row.to_pack,
    oldestToPackSince: row.oldest_to_pack,
  }
}

/** GET /api/staff/orders */
export async function listKitchenOrders(db, staff) {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS},
            (SELECT count(*)::int FROM fofo.order_items oi WHERE oi.order_id = o.id) AS line_count,
            (SELECT array_agg(rm.name ORDER BY rm.name)
               FROM fofo.order_items oi JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
              WHERE oi.order_id = o.id) AS supply_names
       FROM fofo.orders o ${ORDER_SOURCES}
      WHERE o.cloud_kitchen_id = $1 AND o.status = ANY($2)
      ORDER BY COALESCE(o.placed_at, o.created_at) DESC, o.id DESC`,
    [staff.cloudKitchenId, statusesFor(staff)]
  )
  return rows.map((r) => ({
    ...orderView(r),
    lineCount: r.line_count,
    supplyNames: r.supply_names || [],
  }))
}

/** GET /api/staff/orders?id= */
export async function getKitchenOrder(db, staff, orderId) {
  if (!isUuid(orderId)) throw new HttpError(400, 'Choose an order')
  const { rows: [o] } = await db.query(
    `SELECT ${ORDER_COLUMNS},
            o.packed_at, o.ready_at, o.shipped_at, o.delivered_at,
            o.shipping_carrier, o.shipping_tracking_ref, o.shipping_notes,
            f.contact_person, f.contact_phone, f.address AS franchise_address, f.city AS franchise_city,
            (SELECT u.full_name FROM public.users u WHERE u.id = o.accepted_by) AS accepted_by_name,
            (SELECT u.full_name FROM public.users u WHERE u.id = o.packed_by) AS packed_by_name
       FROM fofo.orders o ${ORDER_SOURCES}
      WHERE o.id = $1 AND o.cloud_kitchen_id = $2 AND o.status = ANY($3)`,
    [orderId, staff.cloudKitchenId, statusesFor(staff)]
  )
  // Another kitchen's order and no order at all are the same answer.
  if (!o) throw new HttpError(404, NOT_YOURS)

  const { rows: lineRows } = await db.query(
    `SELECT oi.id, rm.code, rm.name, rm.unit,
            oi.quantity_ordered::text AS quantity_ordered, oi.quantity_accepted::text AS quantity_accepted,
            COALESCE(inv.quantity, 0)::text AS on_hand
       FROM fofo.order_items oi
       JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
       LEFT JOIN public.inventory inv
              ON inv.raw_material_id = oi.raw_material_id AND inv.cloud_kitchen_id = $2
      WHERE oi.order_id = $1
      ORDER BY rm.name, oi.id`,
    [o.id, staff.cloudKitchenId]
  )
  // Stock only matters before the order is accepted: after that it has already
  // left the shelf, and comparing the order with what remains would mislead.
  const awaiting = o.status === 'paid'

  return {
    ...orderView(o),
    franchise: {
      name: o.franchise_name,
      contactPerson: o.contact_person,
      contactPhone: o.contact_phone,
      address: o.franchise_address,
      city: o.franchise_city,
    },
    timeline: {
      placedAt: o.placed_at,
      acceptedAt: o.accepted_at,
      acceptedBy: o.accepted_by_name,
      packedAt: o.packed_at,
      packedBy: o.packed_by_name,
      readyAt: o.ready_at,
      shippedAt: o.shipped_at,
      deliveredAt: o.delivered_at,
    },
    shipping: {
      carrier: o.shipping_carrier,
      trackingRef: o.shipping_tracking_ref,
      notes: o.shipping_notes,
    },
    lines: lineRows.map((l) => {
      const ordered = Number(l.quantity_ordered)
      const onHand = Number(l.on_hand)
      return {
        id: l.id,
        code: l.code,
        name: l.name,
        unit: l.unit,
        quantityOrdered: ordered,
        quantityAccepted: l.quantity_accepted === null ? null : Number(l.quantity_accepted),
        onHand: awaiting ? onHand : null,
        shortBy: awaiting && onHand < ordered ? Number((ordered - onHand).toFixed(3)) : 0,
      }
    }),
  }
}

/**
 * GET /api/staff/orders/label?id= — what the shipping label says: who the
 * parcel goes to, which invoice travels with it, and who sent it. The label
 * itself is drawn in the internal app (lib/shippingLabelPdf.js), as the invoice
 * PDF is drawn in the partner app (decision 0021).
 *
 * Only for an order that has been accepted: before that nothing is being sent.
 *
 * WHERE EACH PART COMES FROM.
 *   name, address   the buyer FROZEN on the goods invoice (07), so the label
 *                   and the invoice in the same box name the same party even
 *                   if the franchise's details are edited afterwards
 *   phone, contact  the franchise as it is today: an invoice does not keep
 *                   them, and for a delivery the current number is the useful one
 *   outlet          the order's outlet, which is where the goods are for
 *   invoice         the goods invoice, issued when the order was paid (18).
 *                   Its number is what the barcode holds
 *   sender          the seller configuration, the same one invoices print
 *                   (seller.js)
 */
export async function getShippingLabel(db, staff, orderId) {
  if (!isUuid(orderId)) throw new HttpError(400, 'Choose an order')
  const { rows: [row] } = await db.query(
    `SELECT o.order_number, ou.name AS outlet_name, ou.code AS outlet_code,
            f.contact_person, f.contact_phone,
            i.invoice_number, i.issued_at, i.buyer_name, i.buyer_address, i.buyer_city
       FROM fofo.orders o
       JOIN public.outlets ou ON ou.id = o.outlet_id
       JOIN fofo.franchises f ON f.id = o.franchise_id
       LEFT JOIN LATERAL (
              SELECT inv.invoice_number, inv.issued_at, inv.buyer_name, inv.buyer_address, inv.buyer_city
                FROM fofo.invoices inv
               WHERE inv.order_id = o.id AND inv.invoice_type = 'goods'
               ORDER BY inv.issued_at, inv.id LIMIT 1) i ON true
      WHERE o.id = $1 AND o.cloud_kitchen_id = $2 AND o.status = ANY($3)`,
    [orderId, staff.cloudKitchenId, ACCEPTED_ONWARD]
  )
  if (!row) throw new HttpError(404, 'There is no label for that order: it is not an accepted order of your kitchen’s')
  // Every paid order has a goods invoice (18). One without is broken data, and
  // a label with no invoice number on it would go out looking finished.
  if (!row.invoice_number) throw new HttpError(422, `Order ${row.order_number} has no goods invoice, so its label cannot be printed`)

  return {
    orderNumber: row.order_number,
    shipTo: {
      name: row.buyer_name,
      contactPerson: row.contact_person,
      phone: row.contact_phone,
      outletName: row.outlet_name,
      outletCode: row.outlet_code,
      address: row.buyer_address,
      city: row.buyer_city,
    },
    invoice: { number: row.invoice_number, issuedAt: row.issued_at },
    sender: seller(),
  }
}

// An order the caller may act on: theirs by kitchen and within their role's
// statuses. Checked before a change so that another kitchen's order is a 404,
// the same as on every read; each fofo function checks again, and is the one
// that counts.
async function requireOwnOrder(db, staff, orderId) {
  if (!isUuid(orderId)) throw new HttpError(400, 'Choose an order')
  const { rows } = await db.query(
    'SELECT 1 FROM fofo.orders o WHERE o.id = $1 AND o.cloud_kitchen_id = $2 AND o.status = ANY($3)',
    [orderId, staff.cloudKitchenId, statusesFor(staff)]
  )
  if (!rows.length) throw new HttpError(404, NOT_YOURS)
}

/**
 * POST /api/staff/orders/accept — { order_id }. In full: every line at the
 * quantity ordered. Answers with the order as it now stands.
 */
export async function acceptOrder(db, staff, body, req) {
  await requireOwnOrder(db, staff, body.order_id)
  await db.query('SELECT fofo.accept_order($1, $2, $3, $4)', [body.order_id, staff.id, clientIp(req), userAgent(req)])
  return getKitchenOrder(db, staff, body.order_id)
}

/**
 * POST /api/staff/orders/pack — { order_id }. The kitchen executive says the
 * order is boxed. Moves only the status. Answers with the order as it now
 * stands.
 */
export async function packOrder(db, staff, body, req) {
  await requireOwnOrder(db, staff, body.order_id)
  await db.query('SELECT fofo.mark_order_packed($1, $2, $3, $4)', [body.order_id, staff.id, clientIp(req), userAgent(req)])
  return getKitchenOrder(db, staff, body.order_id)
}
