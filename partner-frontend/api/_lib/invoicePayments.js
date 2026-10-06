/*
 * Paying an invoice that already exists and has money due: a logistics invoice
 * raised after packing (spec §8.4), or what is left of a goods invoice whose
 * credit ran short (migration 17). Migration 19 is the database half.
 *
 *   POST /api/franchise/invoices/pay          apply credit if asked, and start
 *                                             a Razorpay payment for the rest
 *   POST /api/franchise/invoices/pay/confirm  "the popup closed": look at Razorpay
 *
 * A checkout is not paid here. It has no invoice until its payment lands
 * (api/_lib/checkout.js).
 *
 * STORE CREDIT IS SPENT AT ONCE. At checkout it is held until the money
 * arrives, because there is no invoice yet. Here there is one, so the credit
 * is applied before Razorpay opens, and stays applied if the payment window is
 * then closed: the invoice is simply owed that much less (migration 19 §2).
 *
 * THE RAZORPAY ORDER IS FOR EXACTLY WHAT THE DATABASE SAYS IS OWED, in paise,
 * worked out with the invoice row locked. It is created inside that
 * transaction: if Razorpay refuses, the credit is not spent either.
 *
 * RAZORPAY IS ASKED FIRST, every time. Someone who paid, lost the popup's
 * reply and pressed Pay again must be told it is paid, not charged twice.
 */
import { HttpError, isUuid } from './http.js'
import { money } from './pricing.js'
import { createOrder, paymentsConfigured, publicKeyId } from './razorpayClient.js'
import { reconcileInvoice } from './payments.js'

async function loadInvoice(db, franchiseId, invoiceId) {
  if (!isUuid(invoiceId)) throw new HttpError(400, 'Choose an invoice')
  const { rows } = await db.query(
    `SELECT i.id, i.invoice_number, i.invoice_type, i.total::text AS total,
            GREATEST(fofo.invoice_outstanding(i.id), 0)::text AS outstanding,
            o.id AS order_id, o.order_number, ou.name AS outlet_name, ou.code AS outlet_code
       FROM fofo.invoices i
       JOIN fofo.orders o ON o.id = i.order_id
       JOIN public.outlets ou ON ou.id = o.outlet_id
      WHERE i.id = $1 AND i.franchise_id = $2`,
    [invoiceId, franchiseId]
  )
  if (!rows[0]) throw new HttpError(404, 'That invoice is not one of yours')
  return rows[0]
}

const invoiceSummary = (invoice) => ({
  id: invoice.id,
  invoiceNumber: invoice.invoice_number,
  type: invoice.invoice_type,
  orderId: invoice.order_id,
  orderNumber: invoice.order_number,
  total: money(invoice.total),
  amountDue: money(invoice.outstanding),
})

// Read again, so the answer carries what the database now says is owed.
async function answer(db, user, invoiceId, status, extra = {}) {
  const invoice = await loadInvoice(db, user.franchiseId, invoiceId)
  return { ok: true, status, invoice: invoiceSummary(invoice), ...extra }
}

/** POST /api/franchise/invoices/pay { invoice_id, redeem_store_credit } */
export async function payInvoice(db, user, body) {
  const invoice = await loadInvoice(db, user.franchiseId, body.invoice_id)

  // A payment already made on an earlier attempt settles here, before anything
  // new is opened or any credit is spent.
  if (paymentsConfigured()) await reconcileInvoice(db, invoice.id)

  const { rows } = await db.query(
    'SELECT fofo.begin_invoice_payment($1, $2, $3, $4) AS begun',
    [user.franchiseId, invoice.id, user.franchiseUserId, Boolean(body.redeem_store_credit)]
  )
  const { begun } = rows[0]
  const creditApplied = money(String(begun.credit_applied))
  if (begun.result === 'settled') return answer(db, user, invoice.id, 'paid', { creditApplied })

  // Thrown after credit may have been applied: the transaction rolls back, so
  // it is not spent on a payment that could not be started.
  if (!paymentsConfigured()) throw new HttpError(503, 'Online payment is not set up yet. Please try again later.')

  let razorpayOrderId = begun.razorpay_order_id
  if (!razorpayOrderId) {
    const razorpayOrder = await createOrder({
      amountPaise: begun.amount_paise,
      receipt: invoice.invoice_number,
      notes: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, order_number: invoice.order_number, outlet: invoice.outlet_code },
    })
    razorpayOrderId = razorpayOrder.id
    await db.query(
      'SELECT fofo.open_invoice_payment($1, $2, $3, $4, $5)',
      [user.franchiseId, invoice.id, user.franchiseUserId, razorpayOrderId, String(begun.amount_paise)]
    )
  }

  return answer(db, user, invoice.id, 'awaiting_payment', {
    creditApplied,
    razorpay: {
      keyId: publicKeyId(),
      orderId: razorpayOrderId,
      amount: Number(begun.amount_paise),
      currency: 'INR',
      description: `Invoice ${invoice.invoice_number} · ${invoice.outlet_name}`,
      email: user.email,
    },
  })
}

/*
 * POST /api/franchise/invoices/pay/confirm { invoice_id }
 * The popup closed, one way or another. What it said is not trusted: this asks
 * Razorpay (api/_lib/payments.js), then reports what the invoice is owed.
 */
export async function confirmInvoicePayment(db, user, body) {
  const invoice = await loadInvoice(db, user.franchiseId, body.invoice_id)
  await reconcileInvoice(db, invoice.id)
  const now = await loadInvoice(db, user.franchiseId, invoice.id)
  return { ok: true, status: Number(now.outstanding) > 0 ? 'awaiting_payment' : 'paid', invoice: invoiceSummary(now) }
}
