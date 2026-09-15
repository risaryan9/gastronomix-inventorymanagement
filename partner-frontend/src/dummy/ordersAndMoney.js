// DUMMY DATA — Orders, Pending payments and Store credit, before their API exists.
//
// Nothing here comes from the server. Each export is shaped like the response
// the real endpoint will return, so replacing this module with API calls should
// not change the pages:
//
//   listOrders()               GET /api/franchise/orders
//   getOrder(id)               GET /api/franchise/orders/:id
//   listPendingPayments()      GET /api/franchise/payments/pending
//   storeCreditStatement()     GET /api/franchise/credit/statement
//
// The outlets are the partner app's test outlets. Order numbers, invoice and
// credit-note numbers, quantities and PRICES ARE INVENTED: this file ships in
// the public bundle, and real costs must never reach a browser (spec §11).
//
// The money follows the real rules so the design shows them honestly:
//   - each line is rounded to the paisa, then lines are added (05, 07)
//   - one goods invoice per order, issued when the payment lands, at full value
//   - a trim leaves the invoice alone and issues a credit note, which becomes
//     store credit (decision 0016)
//   - store credit settles part of an invoice like cash; it never changes the
//     invoice or its GST (decision 0013), and is spent oldest first
//   - a pending checkout holds the credit it chose (decision 0020)
//   - a logistics invoice is raised after packing and is a due until paid (§8.4)
// The amounts are worked out below from the lines, not typed in, so every
// total on screen adds up.

const DAY = 864e5
const MINUTE = 6e4
const now = Date.now()
const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 36e5).toISOString()
const inMinutes = (minutes) => new Date(now + minutes * MINUTE).toISOString()

// Dummy-only rounding. The real figures come from the server's exact decimals
// (api/_lib/decimal.js); this is close enough to make the design add up.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

const OUTLETS = {
  EC1027: { id: 'out-ec1027', code: 'EC1027', name: 'El Chaapo EC1027', brand: 'EC', brandName: 'El Chaapo', kitchenName: 'Cloud Kitchen CK2' },
  EC1090: { id: 'out-ec1090', code: 'EC1090', name: 'El Chaapo EC1090', brand: 'EC', brandName: 'El Chaapo', kitchenName: 'Cloud Kitchen CK3' },
  NK1076: { id: 'out-nk1076', code: 'NK1076', name: 'Nippu Kodi NK1076', brand: 'NK', brandName: 'Nippu Kodi', kitchenName: 'Cloud Kitchen CK3' },
}

const BUYER = { name: 'Testing franchise', gstin: '29ABCDE1234F1Z5', address: '14, 3rd Cross, HSR Layout', city: 'Bengaluru' }

// code, name, unit, GST %, HSN, unit price before GST
const ITEMS = {
  paneer: ['RM-DRYP-003', 'Paneer', 'kg', 5, '0406', 318.4],
  cream: ['RM-DRYP-001', 'Fresh Cream', 'kg', 5, '0401', 212.6],
  butter: ['RM-DRYP-008', 'Salted Butter', 'kg', 12, '0405', 486.25],
  chilli: ['RM-FRVG-001', 'Bajji Chilli', 'kg', 0, '0709', 74.5],
  onion: ['RM-FRVG-014', 'Onion', 'kg', 0, '0703', 38.2],
  chicken: ['RM-MTPL-002', 'Chicken Boneless', 'kg', 0, '0207', 268.9],
  mayo: ['RM-SCSN-011', 'Veg Mayonnaise', 'kg', 12, '2103', 164.35],
  marinade: ['SF-037', 'Achari Marinade', 'kg', 5, '2103', 402.8],
  boxes: ['NF-INPK-006', 'Rice Bowl Box 750 ml', 'packets', 18, '4819', 612.0],
  bags: ['NF-INPK-012', 'Paper Carry Bag', 'packets', 18, '4819', 289.5],
}

let lineSeq = 0
function line(key, quantityOrdered, quantityAccepted = null) {
  const [code, name, unit, gstPercent, hsn, unitPriceExGst] = ITEMS[key]
  const unitPriceIncGst = Math.round(unitPriceExGst * (1 + gstPercent / 100) * 10000) / 10000
  const amounts = (qty) => {
    const taxable = round2(qty * unitPriceExGst)
    const gst = round2((taxable * gstPercent) / 100)
    return { taxable, gst, total: round2(taxable + gst) }
  }
  return {
    id: `line-${++lineSeq}`,
    code, name, unit, hsn, gstPercent, unitPriceExGst, unitPriceIncGst,
    quantityOrdered,
    quantityAccepted,
    ordered: amounts(quantityOrdered),
    accepted: quantityAccepted === null ? null : amounts(quantityAccepted),
  }
}

const sum = (rows, pick) => round2(rows.reduce((s, r) => s + pick(r), 0))

/*
 * One order and its paperwork.
 *   paid         when the payment landed; null while pending or expired
 *   credit       store credit redeemed at checkout
 *   creditNote   { number, reason, at } when the PM trimmed, or, with
 *                full: true, when the whole order was cancelled and refunded
 *   logistics    { number, at, taxable, gstPercent, payments: [{ amount, at, via }] }
 */
function order({ number, outlet, status, placedDaysAgo, lines, credit = 0, steps = {}, expiresAt = null, creditNote = null, logistics = null, shipping = null, cancelReason = null }) {
  const subtotal = sum(lines, (l) => l.ordered.taxable)
  const gstTotal = sum(lines, (l) => l.ordered.gst)
  const grandTotal = round2(subtotal + gstTotal)
  const moneyTaken = !['pending_payment', 'expired', 'payment_failed'].includes(status)
  const placedAt = ago(placedDaysAgo)
  const id = `ord-${number.toLowerCase()}`

  const invoices = []
  const creditNotes = []

  if (moneyTaken) {
    const goodsNumber = `INV/26-27/${number.slice(-4)}`
    invoices.push({
      id: `inv-${number}-g`,
      invoiceNumber: goodsNumber,
      type: 'goods',
      issuedAt: placedAt,
      buyer: BUYER,
      taxableValue: subtotal,
      gstAmount: gstTotal,
      total: grandTotal,
      // What settled it: store credit chosen at checkout, the rest by Razorpay.
      settlements: [
        ...(credit ? [{ kind: 'store_credit', amount: credit, at: placedAt, reference: 'Redeemed at checkout' }] : []),
        { kind: 'razorpay', amount: round2(grandTotal - credit), at: placedAt, reference: `pay_${number.replace(/\W/g, '')}` },
      ],
    })

    if (creditNote) {
      const trimmed = creditNote.full
        ? lines.map((l) => ({ ...l, quantityAccepted: 0, accepted: { taxable: 0, gst: 0, total: 0 } }))
        : lines.filter((l) => l.accepted && l.quantityAccepted < l.quantityOrdered)
      const amount = sum(trimmed, (l) => l.ordered.total - l.accepted.total)
      creditNotes.push({
        id: `cn-${creditNote.number}`,
        creditNoteNumber: creditNote.number,
        invoiceNumber: goodsNumber,
        amount,
        reason: creditNote.reason,
        issuedAt: creditNote.at,
        lines: trimmed.map((l) => ({
          name: l.name, unit: l.unit,
          quantity: round2(l.quantityOrdered - l.quantityAccepted),
          amount: round2(l.ordered.total - l.accepted.total),
        })),
      })
    }

    if (logistics) {
      const gst = round2((logistics.taxable * logistics.gstPercent) / 100)
      invoices.push({
        id: `inv-${number}-l`,
        invoiceNumber: logistics.number,
        type: 'logistics',
        issuedAt: logistics.at,
        buyer: BUYER,
        description: logistics.description,
        taxableValue: logistics.taxable,
        gstAmount: gst,
        total: round2(logistics.taxable + gst),
        settlements: logistics.payments.map((p) => ({ kind: p.via, amount: p.amount, at: p.at, reference: p.reference })),
      })
    }
  }

  for (const inv of invoices) {
    inv.paid = sum(inv.settlements, (s) => s.amount)
    inv.amountDue = round2(inv.total - inv.paid)
  }

  return {
    id,
    orderNumber: number,
    outlet: OUTLETS[outlet],
    status,
    placedAt,
    expiresAt,
    cancelReason,
    timeline: {
      paid: moneyTaken ? placedAt : null,
      accepted: steps.accepted ?? null,
      packed: steps.packed ?? null,
      ready_to_ship: steps.ready ?? null,
      shipped: steps.shipped ?? null,
      delivered: steps.delivered ?? null,
    },
    shipping,
    lines,
    subtotal,
    gstTotal,
    grandTotal,
    storeCreditApplied: credit,
    amountToPay: round2(grandTotal - credit),
    invoices,
    creditNotes,
    amountDue: sum(invoices, (i) => i.amountDue),
  }
}

const ORDERS = [
  order({
    number: 'GX-2609-0041', outlet: 'EC1027', status: 'pending_payment', placedDaysAgo: 0,
    expiresAt: inMinutes(12), credit: 150,
    lines: [line('paneer', 4), line('cream', 2), line('chilli', 3), line('boxes', 2)],
  }),
  order({
    number: 'GX-2609-0038', outlet: 'NK1076', status: 'paid', placedDaysAgo: 1, credit: 250,
    lines: [line('chicken', 12), line('mayo', 3), line('bags', 1)],
  }),
  order({
    number: 'GX-2609-0035', outlet: 'EC1027', status: 'accepted', placedDaysAgo: 2,
    steps: { accepted: ago(1, 20) },
    lines: [line('paneer', 6, 4.5), line('butter', 2, 2), line('onion', 10, 10), line('marinade', 3, 2)],
    creditNote: { number: 'CN/26-27/0012', reason: 'Paneer and Achari Marinade short at CK2 on the day. Supplied what was on hand.', at: ago(1, 20) },
  }),
  order({
    number: 'GX-2609-0031', outlet: 'EC1090', status: 'packed', placedDaysAgo: 3,
    steps: { accepted: ago(2, 22), packed: ago(2, 6) },
    lines: [line('cream', 5, 5), line('chilli', 4, 4), line('boxes', 3, 3)],
  }),
  order({
    number: 'GX-2609-0029', outlet: 'EC1027', status: 'ready_to_ship', placedDaysAgo: 4,
    steps: { accepted: ago(3, 20), packed: ago(3, 4), ready: ago(2, 18) },
    lines: [line('paneer', 5, 5), line('marinade', 2, 2), line('bags', 2, 2)],
    logistics: { number: 'INV/26-27/0112', at: ago(2, 18), description: 'Transport CK2 → EC1027, tempo, 1 trip', taxable: 550, gstPercent: 18, payments: [] },
  }),
  order({
    number: 'GX-2609-0024', outlet: 'NK1076', status: 'shipped', placedDaysAgo: 6,
    steps: { accepted: ago(5, 21), packed: ago(5, 3), ready: ago(4, 20), shipped: ago(4, 2) },
    lines: [line('chicken', 15, 15), line('onion', 8, 8), line('mayo', 4, 4)],
    shipping: { carrier: 'Porter', trackingRef: 'PRT-88412093', notes: 'Driver Manjunath, 98450 00000. Cold box.' },
    logistics: {
      number: 'INV/26-27/0104', at: ago(4, 20), description: 'Transport CK3 → NK1076, cold van, 1 trip', taxable: 406.78, gstPercent: 18,
      payments: [{ via: 'store_credit', amount: 200, at: ago(4, 1), reference: 'Paid with store credit' }],
    },
  }),
  order({
    number: 'GX-2608-0019', outlet: 'EC1027', status: 'delivered', placedDaysAgo: 18,
    steps: { accepted: ago(17, 20), packed: ago(17, 5), ready: ago(16, 22), shipped: ago(16, 4), delivered: ago(15, 23) },
    lines: [line('paneer', 8, 7), line('cream', 3, 3), line('butter', 2, 1.5), line('boxes', 4, 4)],
    shipping: { carrier: 'Own vehicle', trackingRef: 'KA-01-AB-4412', notes: null },
    creditNote: { number: 'CN/26-27/0009', reason: 'Short supply at CK2: paneer and butter.', at: ago(17, 20) },
    logistics: {
      number: 'INV/26-27/0091', at: ago(16, 22), description: 'Transport CK2 → EC1027, tempo, 1 trip', taxable: 550, gstPercent: 18,
      payments: [{ via: 'razorpay', amount: 649, at: ago(16, 10), reference: 'pay_Ox81kd02' }],
    },
  }),
  order({
    number: 'GX-2608-0015', outlet: 'EC1090', status: 'delivered', placedDaysAgo: 24,
    steps: { accepted: ago(23, 21), packed: ago(23, 6), ready: ago(22, 22), shipped: ago(22, 5), delivered: ago(21, 23) },
    lines: [line('chilli', 6, 6), line('onion', 15, 15), line('bags', 3, 3)],
    shipping: { carrier: 'Porter', trackingRef: 'PRT-87100455', notes: null },
    logistics: {
      number: 'INV/26-27/0080', at: ago(22, 22), description: 'Transport CK3 → EC1090, tempo, 1 trip', taxable: 480, gstPercent: 18,
      payments: [{ via: 'razorpay', amount: 566.4, at: ago(22, 9), reference: 'pay_Nq20xk19' }],
    },
  }),
  order({
    number: 'GX-2608-0012', outlet: 'NK1076', status: 'expired', placedDaysAgo: 27,
    expiresAt: ago(27, -1),
    lines: [line('chicken', 10), line('mayo', 2)],
  }),
  order({
    number: 'GX-2608-0010', outlet: 'EC1027', status: 'cancelled', placedDaysAgo: 29,
    steps: {},
    cancelReason: 'Cancelled by Gastronomix at your request. The payment was returned as store credit.',
    lines: [line('butter', 3)],
    creditNote: { number: 'CN/26-27/0007', reason: 'Order cancelled by Gastronomix before packing.', at: ago(28), full: true },
  }),
]

// Newest first, the order the API will return them in.
ORDERS.sort((a, b) => b.placedAt.localeCompare(a.placedAt))

export const listOrders = () => ORDERS
export const getOrder = (id) => ORDERS.find((o) => o.id === id) || null

/*
 * What the franchise still owes, newest first:
 *   checkout  a checkout whose payment has not landed and has not expired.
 *             Its store credit was chosen at checkout and is held.
 *   invoice   an invoice with money still due, usually a logistics invoice
 */
export function listPendingPayments() {
  const checkouts = ORDERS
    .filter((o) => o.status === 'pending_payment' && new Date(o.expiresAt).getTime() > Date.now())
    .map((o) => ({
      kind: 'checkout',
      id: `pp-${o.id}`,
      order: o,
      title: `Checkout for ${o.outlet.name}`,
      total: o.grandTotal,
      alreadyPaid: 0,
      storeCreditHeld: o.storeCreditApplied,
      amountDue: o.amountToPay,
      createdAt: o.placedAt,
      expiresAt: o.expiresAt,
    }))
  const invoices = ORDERS.flatMap((o) =>
    o.invoices
      .filter((inv) => inv.amountDue > 0)
      .map((inv) => ({
        kind: 'invoice',
        id: `pp-${inv.id}`,
        order: o,
        invoice: inv,
        title: inv.type === 'logistics' ? 'Logistics invoice' : 'Goods invoice',
        total: inv.total,
        alreadyPaid: inv.paid,
        storeCreditHeld: 0,
        amountDue: inv.amountDue,
        createdAt: inv.issuedAt,
      }))
  )
  return [...checkouts, ...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/*
 * Store credit, as a statement: one row per credit note, what it earned, what
 * each part was spent on, and what is left. Nothing is stored as a balance —
 * the balance is earned less spent (decision 0013).
 */
export function storeCreditStatement() {
  const byNote = new Map()
  for (const o of ORDERS) {
    for (const cn of o.creditNotes) {
      byNote.set(cn.creditNoteNumber, { ...cn, order: { id: o.id, orderNumber: o.orderNumber, outlet: o.outlet }, applications: [] })
    }
  }
  // Spent: every store-credit settlement on an invoice, drawn oldest credit first.
  const notesOldestFirst = [...byNote.values()].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
  const spends = ORDERS.flatMap((o) =>
    o.invoices.flatMap((inv) =>
      inv.settlements
        .filter((s) => s.kind === 'store_credit')
        .map((s) => ({ amount: s.amount, at: s.at, invoiceNumber: inv.invoiceNumber, invoiceType: inv.type, orderId: o.id, orderNumber: o.orderNumber }))
    )
  ).sort((a, b) => a.at.localeCompare(b.at))

  for (const spend of spends) {
    let left = spend.amount
    for (const note of notesOldestFirst) {
      if (left <= 0) break
      if (note.issuedAt > spend.at) continue
      const remaining = round2(note.amount - sum(note.applications, (a) => a.amount))
      const take = Math.min(remaining, left)
      if (take > 0) {
        note.applications.push({ ...spend, amount: round2(take), appliedBy: 'priya@testingfranchise.in' })
        left = round2(left - take)
      }
    }
  }

  const credits = notesOldestFirst
    .map((n) => {
      const applied = sum(n.applications, (a) => a.amount)
      return { ...n, amountApplied: applied, amountRemaining: round2(n.amount - applied) }
    })
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))

  const balance = sum(credits, (c) => c.amountRemaining)
  const held = sum(
    ORDERS.filter((o) => o.status === 'pending_payment' && new Date(o.expiresAt).getTime() > Date.now()),
    (o) => o.storeCreditApplied
  )
  return {
    balance,
    heldByCheckouts: held,
    available: round2(balance - held),
    earnedTotal: sum(credits, (c) => c.amount),
    spentTotal: sum(credits, (c) => c.amountApplied),
    credits,
  }
}

/*
 * How much credit a payment can use: all that is available, up to what is due,
 * never leaving Razorpay between 1 and 99 paise (its minimum is ₹1). The real
 * rule is on the server (api/_lib/pricing.js redeemableCredit); this mirrors it
 * only until these pages fetch.
 */
export function redeemableCredit(available, due) {
  let credit = Math.max(0, Math.min(available, due))
  const remainder = round2(due - credit)
  if (remainder > 0 && remainder < 1) credit = Math.max(0, due - 1)
  return round2(credit)
}
