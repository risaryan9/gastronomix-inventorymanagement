/*
 * Turning a Razorpay payment into a paid order. One path, used by the webhook,
 * by the partner app after its payment popup closes, and by resume and cancel.
 *
 * THE BROWSER NEVER SAYS A PAYMENT SUCCEEDED (spec §11). When the popup reports
 * success, the partner app only asks the server to look. The server then asks
 * RAZORPAY what payments exist for the order, and settles the captured ones.
 * The webhook is the same thing pushed from Razorpay's side, and is signed.
 * Either can arrive first, both can arrive, and a retry can arrive days later.
 * fofo.mark_order_paid records each payment once (migration 18), so every
 * order of arrival ends the same way.
 *
 * WHY ASK RAZORPAY rather than verify the popup's signature: the signature
 * proves which payment the popup saw, not that it was captured or for how much.
 * Asking Razorpay answers all three, with nothing the browser supplied, and it
 * also finds a payment whose popup reply was lost (a closed tab, a dropped
 * connection). Locally, where no webhook can reach the laptop, it is the only
 * way a payment is ever seen.
 *
 * AUTHORIZED IS NOT PAID. If the Razorpay account does not capture
 * automatically, a payment waits as `authorized`. It is captured here, for
 * exactly the order's amount, and only then settled.
 *
 * A PAYMENT THAT DOES NOT FIT is kept, never dropped: the wrong amount, or a
 * second payment for an order already paid. The money has moved, so it goes to
 * fofo.payment_exceptions for someone to refund or apply by hand.
 *
 * TWO THINGS ARE PAID THIS WAY, and a Razorpay order id says which:
 *
 *   a checkout   the id is on fofo.orders. The payment creates the goods
 *                invoice (fofo.mark_order_paid, migration 18).
 *   an invoice   one that already exists and has money due, usually logistics.
 *                The id is on a fofo.payments row with status 'created', an
 *                attempt (fofo.mark_invoice_paid, migration 19).
 *
 * Both go through the same checks and the same exceptions table.
 */
import { checkCapturedPayment } from './razorpay.js'
import { capturePayment, fetchPayment, orderPayments, RazorpayError } from './razorpayClient.js'

/** The order columns everything here needs, for one condition. */
export const ORDER_COLUMNS = `o.id, o.order_number, o.franchise_id, o.outlet_id, o.status, o.expires_at,
  o.razorpay_order_id, o.amount_paise::text AS amount_paise, o.grand_total::text AS grand_total,
  o.store_credit_to_apply::text AS store_credit, o.subtotal::text AS subtotal, o.gst_total::text AS gst_total`

async function recordException(db, order, payment, reasons, source, raw) {
  console.error(`Payment ${payment?.id} for order ${order.order_number} not applied:`, reasons.join('; '))
  await db.query(
    'SELECT fofo.record_payment_exception($1, $2, $3, $4, $5, $6)',
    [order.id, order.razorpay_order_id, payment?.id || null, reasons, JSON.stringify(raw ?? payment ?? null), source]
  )
}

/**
 * Settles one captured payment against its order. `raw` is kept as the
 * evidence: the webhook event, or the payment as Razorpay's API returned it.
 * Returns mark_order_paid's answer, or { result: 'exception' }.
 */
export async function settleCapturedPayment(db, order, payment, source, raw) {
  const check = checkCapturedPayment({ event: 'payment.captured', payload: { payment: { entity: payment } } }, order)
  if (!check.ok) {
    await recordException(db, order, payment, check.reasons, source, raw)
    return { result: 'exception' }
  }

  // mark_order_paid refuses with an error (a second payment for a paid order);
  // the savepoint keeps the transaction usable so the refusal can be recorded.
  await db.query('SAVEPOINT settle_payment')
  try {
    const { rows } = await db.query(
      'SELECT fofo.mark_order_paid($1, $2, $3, $4, $5) AS outcome',
      [order.id, payment.id, String(payment.amount), JSON.stringify(raw ?? payment), source]
    )
    await db.query('RELEASE SAVEPOINT settle_payment')
    return rows[0].outcome
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT settle_payment')
    if (err?.code !== 'P0001') throw err
    await recordException(db, order, payment, [err.message], source, raw)
    return { result: 'exception' }
  }
}

// Captures an authorized payment that matches the order. Another caller may
// capture it first; then Razorpay refuses, and the payment is read again.
async function captureIfAuthorized(order, payment) {
  if (payment.status !== 'authorized') return payment
  if (payment.currency !== 'INR' || String(payment.amount) !== String(order.amount_paise)) return payment
  try {
    return await capturePayment(payment.id, payment.amount)
  } catch (err) {
    if (!(err instanceof RazorpayError)) throw err
    return fetchPayment(payment.id)
  }
}

/**
 * Asks Razorpay for the order's payments and settles every captured one.
 * Returns 'paid' when the order is paid (now or already), otherwise null.
 * An authorized payment that does not match is left alone: Razorpay refunds
 * an uncaptured payment by itself.
 */
export async function reconcileOrder(db, order, source = 'api') {
  if (!order.razorpay_order_id) return null
  let paid = null
  for (const found of await orderPayments(order.razorpay_order_id)) {
    const payment = await captureIfAuthorized(order, found)
    if (payment.status !== 'captured') continue
    const outcome = await settleCapturedPayment(db, order, payment, source, payment)
    if (outcome.result === 'paid' || outcome.result === 'already_recorded') paid = 'paid'
  }
  return paid
}

/* ------------------------------------------------------------------ *
 * Invoices that already exist (migration 19)
 * ------------------------------------------------------------------ */

// An attempt, shaped so the checks written for orders read it too:
// razorpay_order_id and amount_paise mean the same thing on both.
const ATTEMPT_COLUMNS = `p.id AS attempt_id, p.invoice_id, p.razorpay_order_id,
  (p.amount * 100)::bigint::text AS amount_paise,
  i.invoice_number, i.order_id, o.order_number`

const ATTEMPT_FROM = `fofo.payments p
  JOIN fofo.invoices i ON i.id = p.invoice_id
  JOIN fofo.orders o ON o.id = i.order_id`

// payment_exceptions is keyed to an order; an invoice's exception is filed
// under the order it bills, and says which invoice in its reasons.
const exceptionSubject = (attempt) => ({
  id: attempt.order_id,
  order_number: `${attempt.order_number} (invoice ${attempt.invoice_number})`,
  razorpay_order_id: attempt.razorpay_order_id,
})

/**
 * The attempt opened for a Razorpay order, or null when the id is not an
 * invoice payment's. The webhook calls this after finding no checkout with
 * that id.
 */
export async function invoiceAttempt(db, razorpayOrderId) {
  const { rows } = await db.query(
    `SELECT ${ATTEMPT_COLUMNS} FROM ${ATTEMPT_FROM}
      WHERE p.razorpay_order_id = $1
      ORDER BY p.created_at DESC, p.id DESC LIMIT 1`,
    [razorpayOrderId]
  )
  return rows[0] || null
}

/**
 * Settles one captured payment against the invoice its attempt was opened
 * for. Returns mark_invoice_paid's answer, or { result: 'exception' }.
 */
export async function settleInvoicePayment(db, attempt, payment, source, raw) {
  const check = checkCapturedPayment({ event: 'payment.captured', payload: { payment: { entity: payment } } }, attempt)
  if (!check.ok) {
    await recordException(db, exceptionSubject(attempt), payment, [`invoice ${attempt.invoice_number}`, ...check.reasons], source, raw)
    return { result: 'exception' }
  }

  // As for an order: a refusal is an error, and the savepoint keeps the
  // transaction usable so it can be recorded.
  await db.query('SAVEPOINT settle_invoice_payment')
  try {
    const { rows } = await db.query(
      'SELECT fofo.mark_invoice_paid($1, $2, $3, $4, $5) AS outcome',
      [attempt.razorpay_order_id, payment.id, String(payment.amount), JSON.stringify(raw ?? payment), source]
    )
    await db.query('RELEASE SAVEPOINT settle_invoice_payment')
    return rows[0].outcome
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT settle_invoice_payment')
    if (err?.code !== 'P0001') throw err
    await recordException(db, exceptionSubject(attempt), payment, [err.message], source, raw)
    return { result: 'exception' }
  }
}

/**
 * Asks Razorpay about one attempt and settles what it finds captured.
 * Returns 'paid' when a payment was recorded (now or already), otherwise null.
 */
export async function reconcileAttempt(db, attempt, source = 'api') {
  let paid = null
  for (const found of await orderPayments(attempt.razorpay_order_id)) {
    const payment = await captureIfAuthorized(attempt, found)
    if (payment.status !== 'captured') continue
    const outcome = await settleInvoicePayment(db, attempt, payment, source, payment)
    if (outcome.result === 'paid' || outcome.result === 'already_recorded') paid = 'paid'
  }
  return paid
}

// How many open attempts one confirm will ask Razorpay about. An invoice
// normally has one; each is a call to Razorpay, so the newest few are enough.
// A payment on an older one still arrives by webhook.
const ATTEMPTS_TO_CHECK = 5

/**
 * Asks Razorpay about an invoice's open attempts, newest first, and settles
 * every captured payment. A payment that no longer fits (the invoice was paid
 * by another attempt meanwhile) is filed as an exception, as it should be.
 */
export async function reconcileInvoice(db, invoiceId, source = 'api') {
  const { rows } = await db.query(
    `SELECT ${ATTEMPT_COLUMNS} FROM ${ATTEMPT_FROM}
      WHERE p.invoice_id = $1 AND p.status = 'created' AND p.razorpay_order_id IS NOT NULL
      ORDER BY p.created_at DESC, p.id DESC LIMIT ${ATTEMPTS_TO_CHECK}`,
    [invoiceId]
  )
  let paid = null
  for (const attempt of rows) {
    if (await reconcileAttempt(db, attempt, source)) paid = 'paid'
  }
  return paid
}
