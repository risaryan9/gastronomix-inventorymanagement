/*
 * What a franchise reads about its orders and money: the order list, one order
 * with its paperwork, invoices with money due, and the store-credit statement.
 *
 *   GET /api/franchise/orders             every order, newest first
 *   GET /api/franchise/orders?id=         one order, its lines, invoices, credit notes
 *   GET /api/franchise/invoices?id=       one invoice as it was issued, for its PDF
 *   GET /api/franchise/payments/pending   invoices with money still due
 *   GET /api/franchise/credit             the store-credit statement
 *
 * Every query is scoped to the session's franchise (api/franchise.js).
 *
 * NOTHING HERE IS STORED THAT COULD BE WORKED OUT (decision 0013). What an
 * invoice has had paid is its captured payments plus the credit applied to it;
 * what is due is the rest. What is left of a credit is its amount less what was
 * applied from it. These are summed in SQL, exactly, and only turned into
 * Numbers for the response.
 *
 * WHAT A FRANCHISE MAY SEE: the prices it was charged, frozen on the order.
 * Never the base cost or margin (spec §11), which order_items also holds; they
 * are not selected here.
 *
 * AN EXPIRED CHECKOUT is still status pending_payment in the table until the
 * outlet checks out again: expiry is compared on read, never swept (05). It is
 * reported here as 'expired', which is what it is.
 */
import { HttpError, isUuid } from './http.js'
import { publicOutlet } from './catalog.js'
import { add, sub } from './decimal.js'
import { lineAmounts, money, unitMoney } from './pricing.js'
import { seller } from './seller.js'

// The order's kitchen is the one frozen on it at checkout, not the outlet's today.
const ORDER_OUTLET = `
  JOIN public.outlets ou ON ou.id = o.outlet_id
  JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id`

const OUTLET_COLUMNS = `ou.id AS outlet_id, ou.code AS outlet_code, ou.name AS outlet_name,
  ck.name AS kitchen_name, ck.code AS kitchen_code`

const outletOf = (row) => publicOutlet({
  id: row.outlet_id, code: row.outlet_code, name: row.outlet_name,
  kitchen_name: row.kitchen_name, kitchen_code: row.kitchen_code,
})

// Per invoice: paid online (captured only), paid with credit, and the rest.
const INVOICE_MONEY = `
  COALESCE((SELECT SUM(p.amount) FROM fofo.payments p
             WHERE p.invoice_id = i.id AND p.status = 'captured'), 0) AS paid_online,
  COALESCE((SELECT SUM(a.amount) FROM fofo.store_credit_applications a
             WHERE a.invoice_id = i.id), 0) AS paid_credit`

const ORDER_STATUS = `CASE WHEN o.status = 'pending_payment' AND o.expires_at <= now()
                           THEN 'expired' ELSE o.status END`

const due = (row) => {
  const left = sub(sub(row.total, row.paid_online), row.paid_credit)
  return left > 0n ? left : 0n
}

/** GET /api/franchise/orders */
export async function listOrders(db, franchiseId) {
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, ${ORDER_STATUS} AS status,
            COALESCE(o.placed_at, o.created_at) AS placed_at, o.expires_at,
            o.grand_total::text AS grand_total, o.store_credit_to_apply::text AS store_credit,
            ${OUTLET_COLUMNS},
            (SELECT array_agg(rm.name ORDER BY rm.name)
               FROM fofo.order_items oi JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
              WHERE oi.order_id = o.id) AS supply_names,
            (SELECT COALESCE(SUM(cn.amount), 0) FROM fofo.credit_notes cn WHERE cn.order_id = o.id)::text AS credit_back,
            (SELECT COALESCE(SUM(GREATEST(inv.total - inv.paid_online - inv.paid_credit, 0)), 0)
               FROM (SELECT i.total, ${INVOICE_MONEY} FROM fofo.invoices i WHERE i.order_id = o.id) inv)::text AS amount_due
       FROM fofo.orders o ${ORDER_OUTLET}
      WHERE o.franchise_id = $1
      ORDER BY COALESCE(o.placed_at, o.created_at) DESC, o.id DESC`,
    [franchiseId]
  )
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    outlet: outletOf(r),
    status: r.status,
    placedAt: r.placed_at,
    expiresAt: r.expires_at,
    supplyNames: r.supply_names || [],
    grandTotal: money(r.grand_total),
    storeCreditApplied: money(r.store_credit),
    amountToPay: money(sub(r.grand_total, r.store_credit)),
    amountDue: money(r.amount_due),
    creditBack: money(r.credit_back),
  }))
}

const lineMoney = (quantity, row) => {
  const a = lineAmounts(quantity, row.unit_price_ex_gst, row.gst_percent)
  return { taxable: money(a.taxable), gst: money(a.gst), total: money(a.total) }
}

/** GET /api/franchise/orders?id= */
export async function getOrder(db, franchiseId, orderId) {
  if (!isUuid(orderId)) throw new HttpError(400, 'Choose an order')
  const { rows: [o] } = await db.query(
    `SELECT o.id, o.order_number, ${ORDER_STATUS} AS status, o.created_at, o.expires_at,
            o.placed_at, o.accepted_at, o.packed_at, o.ready_at, o.shipped_at, o.delivered_at,
            o.shipping_carrier, o.shipping_tracking_ref, o.shipping_notes,
            o.subtotal::text AS subtotal, o.gst_total::text AS gst_total, o.grand_total::text AS grand_total,
            o.store_credit_to_apply::text AS store_credit,
            ${OUTLET_COLUMNS}
       FROM fofo.orders o ${ORDER_OUTLET}
      WHERE o.id = $1 AND o.franchise_id = $2`,
    [orderId, franchiseId]
  )
  if (!o) throw new HttpError(404, 'That order is not one of yours')

  const { rows: lineRows } = await db.query(
    `SELECT oi.id, rm.code, rm.name, rm.unit, oi.hsn_code,
            oi.gst_percent::text AS gst_percent, oi.unit_price_ex_gst::text AS unit_price_ex_gst,
            oi.unit_price_inc_gst::text AS unit_price_inc_gst,
            oi.quantity_ordered::text AS quantity_ordered, oi.quantity_accepted::text AS quantity_accepted
       FROM fofo.order_items oi JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
      WHERE oi.order_id = $1
      ORDER BY rm.name, oi.id`,
    [o.id]
  )
  const lines = lineRows.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    unit: l.unit,
    hsn: l.hsn_code,
    gstPercent: Number(l.gst_percent),
    unitPriceExGst: unitMoney(l.unit_price_ex_gst),
    unitPriceIncGst: unitMoney(l.unit_price_inc_gst),
    quantityOrdered: Number(l.quantity_ordered),
    quantityAccepted: l.quantity_accepted === null ? null : Number(l.quantity_accepted),
    ordered: lineMoney(l.quantity_ordered, l),
    accepted: l.quantity_accepted === null ? null : lineMoney(l.quantity_accepted, l),
    // Kept for the credit-note breakdown below.
    raw: l,
  }))

  const { rows: invoiceRows } = await db.query(
    `SELECT i.id, i.invoice_number, i.invoice_type, i.issued_at,
            i.taxable_value::text AS taxable_value, i.gst_amount::text AS gst_amount, i.total::text AS total,
            CASE WHEN i.invoice_type = 'logistics' THEN
              (SELECT ii.description FROM fofo.invoice_items ii WHERE ii.invoice_id = i.id ORDER BY ii.sort_order, ii.id LIMIT 1)
            END AS description,
            ${INVOICE_MONEY}
       FROM fofo.invoices i
      WHERE i.order_id = $1
      ORDER BY i.issued_at, i.id`,
    [o.id]
  )
  const { rows: settlementRows } = await db.query(
    `SELECT p.invoice_id, 'razorpay' AS kind, p.amount::text AS amount,
            COALESCE(p.signature_verified_at, p.created_at) AS at,
            p.razorpay_payment_id AS reference
       FROM fofo.payments p JOIN fofo.invoices i ON i.id = p.invoice_id
      WHERE i.order_id = $1 AND p.status = 'captured'
     UNION ALL
     SELECT a.invoice_id, 'store_credit', a.amount::text, a.created_at, NULL
       FROM fofo.store_credit_applications a JOIN fofo.invoices i ON i.id = a.invoice_id
      WHERE i.order_id = $1
      ORDER BY at`,
    [o.id]
  )
  const invoices = invoiceRows.map((i) => {
    const owed = due(i)
    return {
      id: i.id,
      invoiceNumber: i.invoice_number,
      type: i.invoice_type,
      issuedAt: i.issued_at,
      description: i.description,
      taxableValue: money(i.taxable_value),
      gstAmount: money(i.gst_amount),
      total: money(i.total),
      settlements: settlementRows
        .filter((s) => s.invoice_id === i.id)
        // reference: Razorpay's payment id, which is what the franchise's bank
        // statement and Razorpay's own receipt quote. Credit has none.
        .map((s) => ({ kind: s.kind, amount: money(s.amount), at: s.at, reference: s.reference })),
      paid: money(add(i.paid_online, i.paid_credit)),
      amountDue: money(owed),
      owed,
    }
  })

  const { rows: noteRows } = await db.query(
    `SELECT cn.id, cn.credit_note_number, cn.amount::text AS amount, cn.reason, cn.issued_at, i.invoice_number
       FROM fofo.credit_notes cn JOIN fofo.invoices i ON i.id = cn.invoice_id
      WHERE cn.order_id = $1
      ORDER BY cn.issued_at, cn.id`,
    [o.id]
  )
  // A credit note stores its amount, not its lines. Which supplies it covers is
  // worked out from the order: ordered less accepted, at the frozen price.
  const trimmed = lines
    .filter((l) => l.quantityAccepted !== null && l.quantityAccepted < l.quantityOrdered)
    .map((l) => {
      const ordered = lineAmounts(l.raw.quantity_ordered, l.raw.unit_price_ex_gst, l.raw.gst_percent)
      const accepted = lineAmounts(l.raw.quantity_accepted, l.raw.unit_price_ex_gst, l.raw.gst_percent)
      return {
        name: l.name,
        unit: l.unit,
        quantity: money(sub(l.raw.quantity_ordered, l.raw.quantity_accepted)),
        amount: money(sub(ordered.total, accepted.total)),
      }
    })
  const creditNotes = noteRows.map((cn) => ({
    id: cn.id,
    creditNoteNumber: cn.credit_note_number,
    invoiceNumber: cn.invoice_number,
    amount: money(cn.amount),
    reason: cn.reason,
    issuedAt: cn.issued_at,
    // With two credit notes on one order, which trim belongs to which is not
    // recorded, so neither claims the lines.
    lines: noteRows.length === 1 ? trimmed : [],
  }))

  const live = o.status === 'pending_payment'
  return {
    id: o.id,
    orderNumber: o.order_number,
    outlet: outletOf(o),
    status: o.status,
    placedAt: o.placed_at || o.created_at,
    expiresAt: o.expires_at,
    checkout: live
      ? { expiresAt: o.expires_at, storeCreditHeld: money(o.store_credit), amountDue: money(sub(o.grand_total, o.store_credit)) }
      : null,
    timeline: {
      paid: o.placed_at,
      accepted: o.accepted_at,
      packed: o.packed_at,
      ready_to_ship: o.ready_at,
      shipped: o.shipped_at,
      delivered: o.delivered_at,
    },
    shipping: o.shipping_carrier || o.shipping_tracking_ref
      ? { carrier: o.shipping_carrier, trackingRef: o.shipping_tracking_ref, notes: o.shipping_notes }
      : null,
    lines: lines.map(({ raw, ...line }) => line),
    subtotal: money(o.subtotal),
    gstTotal: money(o.gst_total),
    grandTotal: money(o.grand_total),
    storeCreditApplied: money(o.store_credit),
    amountToPay: money(sub(o.grand_total, o.store_credit)),
    invoices: invoices.map(({ owed, ...invoice }) => invoice),
    creditNotes,
    amountDue: money(invoices.reduce((s, i) => add(s, i.owed), 0n)),
  }
}

/**
 * GET /api/franchise/invoices?id= — one invoice exactly as issued: the buyer
 * and the lines are the copies frozen on it (07), never the franchise or the
 * order as they are today. With what has settled it, and any credit notes
 * raised against it. This is what the PDF is drawn from (src/lib/invoicePdf.js).
 */
export async function getInvoice(db, franchiseId, invoiceId) {
  if (!isUuid(invoiceId)) throw new HttpError(400, 'Choose an invoice')
  const { rows: [i] } = await db.query(
    `SELECT i.id, i.invoice_number, i.invoice_type, i.issued_at, i.order_id,
            i.buyer_name, i.buyer_gstin, i.buyer_address, i.buyer_city,
            i.taxable_value::text AS taxable_value, i.gst_amount::text AS gst_amount, i.total::text AS total,
            ${INVOICE_MONEY},
            o.order_number, ${OUTLET_COLUMNS}
       FROM fofo.invoices i
       JOIN fofo.orders o ON o.id = i.order_id ${ORDER_OUTLET}
      WHERE i.id = $1 AND i.franchise_id = $2`,
    [invoiceId, franchiseId]
  )
  if (!i) throw new HttpError(404, 'That invoice is not one of yours')

  // An invoice line keeps no unit of its own. For a goods line it is read from
  // the order line it was copied from, matched on what was copied; a line that
  // no longer matches (a renamed material) prints its quantity without one.
  const { rows: lineRows } = await db.query(
    `SELECT ii.id, ii.description, ii.hsn_code, ii.quantity::text AS quantity,
            ii.unit_price_ex_gst::text AS unit_price_ex_gst, ii.gst_percent::text AS gst_percent,
            ii.line_taxable_value::text AS taxable, ii.line_gst::text AS gst, ii.line_total::text AS total,
            (SELECT rm.unit
               FROM fofo.order_items oi JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
              WHERE $2 = 'goods' AND oi.order_id = $3 AND rm.name = ii.description
                AND oi.quantity_ordered = ii.quantity AND oi.unit_price_ex_gst = ii.unit_price_ex_gst
              ORDER BY oi.id LIMIT 1) AS unit
       FROM fofo.invoice_items ii
      WHERE ii.invoice_id = $1
      ORDER BY ii.sort_order, ii.id`,
    [i.id, i.invoice_type, i.order_id]
  )
  const { rows: settlementRows } = await db.query(
    `SELECT 'razorpay' AS kind, p.amount::text AS amount,
            COALESCE(p.signature_verified_at, p.created_at) AS at, p.razorpay_payment_id AS reference
       FROM fofo.payments p WHERE p.invoice_id = $1 AND p.status = 'captured'
     UNION ALL
     SELECT 'store_credit', a.amount::text, a.created_at, NULL
       FROM fofo.store_credit_applications a WHERE a.invoice_id = $1
      ORDER BY at`,
    [i.id]
  )
  const { rows: noteRows } = await db.query(
    `SELECT cn.credit_note_number, cn.amount::text AS amount, cn.reason, cn.issued_at
       FROM fofo.credit_notes cn WHERE cn.invoice_id = $1
      ORDER BY cn.issued_at, cn.id`,
    [i.id]
  )

  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    type: i.invoice_type,
    issuedAt: i.issued_at,
    seller: seller(),
    buyer: { name: i.buyer_name, gstin: i.buyer_gstin, address: i.buyer_address, city: i.buyer_city },
    order: { id: i.order_id, orderNumber: i.order_number, outlet: outletOf(i) },
    lines: lineRows.map((l) => ({
      id: l.id,
      description: l.description,
      hsn: l.hsn_code,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPriceExGst: unitMoney(l.unit_price_ex_gst),
      gstPercent: Number(l.gst_percent),
      taxable: money(l.taxable),
      gst: money(l.gst),
      total: money(l.total),
    })),
    taxableValue: money(i.taxable_value),
    gstAmount: money(i.gst_amount),
    total: money(i.total),
    settlements: settlementRows.map((s) => ({ kind: s.kind, amount: money(s.amount), at: s.at, reference: s.reference })),
    paid: money(add(i.paid_online, i.paid_credit)),
    amountDue: money(due(i)),
    creditNotes: noteRows.map((cn) => ({
      creditNoteNumber: cn.credit_note_number, amount: money(cn.amount), reason: cn.reason, issuedAt: cn.issued_at,
    })),
  }
}

/** GET /api/franchise/payments/pending — invoices with money due, newest first. */
export async function pendingPayments(db, franchiseId) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT i.id, i.invoice_number, i.invoice_type, i.issued_at, i.total::text AS total,
              CASE WHEN i.invoice_type = 'logistics' THEN
                (SELECT ii.description FROM fofo.invoice_items ii WHERE ii.invoice_id = i.id ORDER BY ii.sort_order, ii.id LIMIT 1)
              END AS description,
              ${INVOICE_MONEY},
              o.id AS order_id, o.order_number, ${OUTLET_COLUMNS}
         FROM fofo.invoices i
         JOIN fofo.orders o ON o.id = i.order_id ${ORDER_OUTLET}
        WHERE i.franchise_id = $1
     ) inv
     WHERE inv.total::numeric - inv.paid_online - inv.paid_credit > 0
     ORDER BY inv.issued_at DESC, inv.id DESC`,
    [franchiseId]
  )
  const { rows: [credit] } = await db.query('SELECT fofo.store_credit_available($1)::text AS available', [franchiseId])
  const invoices = rows.map((r) => ({
    id: r.id,
    kind: 'invoice',
    title: r.invoice_type === 'logistics' ? 'Logistics invoice' : 'Goods invoice',
    invoice: { id: r.id, invoiceNumber: r.invoice_number, type: r.invoice_type, description: r.description, issuedAt: r.issued_at },
    order: { id: r.order_id, orderNumber: r.order_number, outlet: outletOf(r) },
    total: money(r.total),
    alreadyPaid: money(add(r.paid_online, r.paid_credit)),
    amountDue: money(due(r)),
    createdAt: r.issued_at,
  }))
  return {
    invoices,
    totalDue: money(rows.reduce((s, r) => add(s, due(r)), 0n)),
    storeCreditAvailable: money(credit.available),
  }
}

/** GET /api/franchise/credit — each credit, what it was spent on, and what is left. */
export async function creditStatement(db, franchiseId) {
  const { rows: creditRows } = await db.query(
    `SELECT sc.id, sc.amount::text AS amount, sc.created_at, cn.credit_note_number, cn.reason,
            i.invoice_number, o.id AS order_id, o.order_number, ${OUTLET_COLUMNS},
            COALESCE((SELECT SUM(a.amount) FROM fofo.store_credit_applications a WHERE a.credit_id = sc.id), 0)::text AS applied
       FROM fofo.store_credits sc
       JOIN fofo.credit_notes cn ON cn.id = sc.credit_note_id
       JOIN fofo.invoices i ON i.id = cn.invoice_id
       JOIN fofo.orders o ON o.id = cn.order_id ${ORDER_OUTLET}
      WHERE sc.franchise_id = $1
      ORDER BY sc.created_at DESC, sc.id DESC`,
    [franchiseId]
  )
  const { rows: applicationRows } = await db.query(
    `SELECT a.credit_id, a.amount::text AS amount, a.created_at, i.invoice_number, i.invoice_type,
            o.id AS order_id, o.order_number, fu.email AS franchise_user, a.applied_by IS NOT NULL AS by_staff
       FROM fofo.store_credit_applications a
       JOIN fofo.store_credits sc ON sc.id = a.credit_id
       JOIN fofo.invoices i ON i.id = a.invoice_id
       JOIN fofo.orders o ON o.id = i.order_id
       LEFT JOIN fofo.franchise_users fu ON fu.id = a.applied_by_franchise_user_id
      WHERE sc.franchise_id = $1
      ORDER BY a.created_at, a.id`,
    [franchiseId]
  )
  const { rows: [totals] } = await db.query(
    `SELECT fofo.store_credit_balance($1)::text AS balance, fofo.store_credit_held($1)::text AS held,
            fofo.store_credit_available($1)::text AS available`,
    [franchiseId]
  )

  const credits = creditRows.map((c) => ({
    id: c.id,
    creditNoteNumber: c.credit_note_number,
    invoiceNumber: c.invoice_number,
    reason: c.reason,
    issuedAt: c.created_at,
    amount: money(c.amount),
    amountApplied: money(c.applied),
    amountRemaining: money(sub(c.amount, c.applied)),
    order: { id: c.order_id, orderNumber: c.order_number, outlet: outletOf(c) },
    applications: applicationRows
      .filter((a) => a.credit_id === c.id)
      .map((a) => ({
        invoiceNumber: a.invoice_number,
        invoiceType: a.invoice_type,
        orderId: a.order_id,
        orderNumber: a.order_number,
        amount: money(a.amount),
        at: a.created_at,
        // Staff are not named to a franchise; the franchise's own people are.
        appliedBy: a.franchise_user || (a.by_staff ? 'Gastronomix' : null),
      })),
  }))

  return {
    balance: money(totals.balance),
    heldByCheckouts: money(totals.held),
    available: money(totals.available),
    earnedTotal: money(creditRows.reduce((s, c) => add(s, c.amount), 0n)),
    spentTotal: money(creditRows.reduce((s, c) => add(s, c.applied), 0n)),
    credits,
  }
}
