import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Checks on a Razorpay payment webhook, kept apart from the endpoint so they
 * can be exercised directly with representative payloads.
 *
 * Files under api/_lib are not routes: Vercel does not serve anything in api/
 * whose name starts with an underscore.
 *
 * TWO CHECKS, AND BOTH ARE REQUIRED. A valid signature proves the message came
 * from Razorpay. It says nothing about whether the payment is the one we asked
 * for: Razorpay can capture less than the order amount, and a real, correctly
 * signed ₹1 payment is still correctly signed. So an order is marked paid only
 * when the signature verifies AND the captured payment matches the order —
 * same Razorpay order, INR, captured, and exactly the amount we froze.
 *
 * When the signature is valid but the payment does not match, the money has
 * still moved. Do not mark the order paid, and do not drop the event either:
 * record it for someone to resolve by hand.
 */

/**
 * Verifies the X-Razorpay-Signature header.
 *
 * `rawBody` must be the request body EXACTLY as received — a Buffer or the
 * original string. If the body has been parsed as JSON and re-serialized, the
 * bytes differ (key order, whitespace, escaping) and every genuine webhook
 * fails here. On Vercel that means disabling body parsing for the endpoint.
 */
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set')
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const received = Buffer.from(signature, 'hex')
  // Constant-time: a plain === leaks how many leading bytes matched.
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/*
 * Razorpay amounts are whole paise, and fofo.orders.amount_paise is a bigint
 * generated from grand_total. Compare them as integers — never by dividing by
 * 100 into a float. A bigint may arrive as a string (node-postgres) or a
 * number (JSON), so accept both and refuse anything that is not a whole
 * number of paise.
 */
function toPaise(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'bigint' && value >= 0n) return value
  return null
}

/**
 * Does this captured-payment event pay for this order, exactly?
 *
 * `order` is the fofo.orders row, needing razorpay_order_id and amount_paise.
 * Returns { ok: true } or { ok: false, reasons: [...] } — every mismatch, not
 * just the first, because the person resolving it by hand needs the whole
 * picture.
 */
export function checkCapturedPayment(event, order) {
  const payment = event?.payload?.payment?.entity
  if (event?.event !== 'payment.captured' || !payment) {
    return { ok: false, reasons: [`not a payment.captured event (got ${event?.event ?? 'nothing'})`] }
  }

  const reasons = []

  if (!order?.razorpay_order_id || payment.order_id !== order.razorpay_order_id) {
    reasons.push(`payment is for Razorpay order ${payment.order_id}, this order is ${order?.razorpay_order_id ?? 'unset'}`)
  }
  if (payment.status !== 'captured') {
    reasons.push(`payment status is ${payment.status}, not captured`)
  }
  if (payment.currency !== 'INR') {
    reasons.push(`payment currency is ${payment.currency}, not INR`)
  }

  const paid = toPaise(payment.amount)
  const owed = toPaise(order?.amount_paise)
  if (paid === null || owed === null) {
    reasons.push(`amount is not a whole number of paise (paid ${payment.amount}, owed ${order?.amount_paise})`)
  } else if (paid !== owed) {
    reasons.push(`paid ${paid} paise, order is ${owed} paise`)
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}
