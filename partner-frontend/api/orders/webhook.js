/*
 * POST /api/orders/webhook — Razorpay only.
 *
 * Razorpay calls this when a payment is authorized or captured. It is the one
 * endpoint with no session: the X-Razorpay-Signature header, an HMAC of the
 * body keyed with RAZORPAY_WEBHOOK_SECRET, is what proves the message is
 * Razorpay's (api/_lib/razorpay.js). Anything unsigned or wrongly signed gets a
 * 400 and touches nothing.
 *
 * THE BODY MUST BE READ RAW. The signature covers the exact bytes Razorpay sent;
 * parsed and re-serialized JSON has different bytes and never verifies. So this
 * reads the request stream itself and never touches req.body. On Vercel,
 * req.body parses the stream when first read, and after that the bytes are
 * gone. The config below tells the local dev server (vite.config.js) not to
 * parse it either.
 *
 * WHAT IT DOES is what the partner app's confirm does, from the other side
 * (api/_lib/payments.js). A captured payment in the event is settled as
 * delivered. An authorized payment or a paid order sends the server to ask
 * Razorpay, which captures and settles. Every path records a payment once, so
 * Razorpay's retries, and the popup confirming the same payment first, are
 * harmless.
 *
 * The Razorpay order id says what is being paid: a checkout, when it is on
 * fofo.orders, or an existing invoice, when it is a payment attempt
 * (migration 19). Checkouts are looked for first.
 *
 * ANSWERS. 200 once the event is dealt with, including events for orders that
 * are not ours (the Razorpay account may be used elsewhere) and events we do
 * not act on. 5xx when something failed: Razorpay retries those, which is
 * what we want.
 *
 * Set up in the Razorpay dashboard (Test mode first): Settings → Webhooks →
 * URL <partner app>/api/orders/webhook, a secret (= RAZORPAY_WEBHOOK_SECRET),
 * events payment.authorized, payment.captured and order.paid.
 */
import { transaction } from '../_lib/db.js'
import { sendError } from '../_lib/http.js'
import { verifyWebhookSignature } from '../_lib/razorpay.js'
import {
  invoiceAttempt, ORDER_COLUMNS, reconcileAttempt, reconcileOrder, settleCapturedPayment, settleInvoicePayment,
} from '../_lib/payments.js'

export const config = { api: { bodyParser: false } }

const MAX_BODY_BYTES = 1024 * 1024

async function readRawBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Webhook body too large'), { tooLarge: true })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    console.error('Razorpay webhook received, but RAZORPAY_WEBHOOK_SECRET is not set')
    return res.status(503).json({ error: 'Not configured' })
  }

  let raw
  try {
    raw = await readRawBody(req)
  } catch (err) {
    return res.status(err.tooLarge ? 413 : 400).json({ error: 'Unreadable body' })
  }

  if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'], secret)) {
    console.warn('Razorpay webhook with a missing or wrong signature refused')
    return res.status(400).json({ error: 'Invalid signature' })
  }

  let event
  try {
    event = JSON.parse(raw.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  const payment = event?.payload?.payment?.entity
  const razorpayOrderId = payment?.order_id || event?.payload?.order?.entity?.id
  if (!['payment.captured', 'payment.authorized', 'order.paid'].includes(event?.event) || !razorpayOrderId) {
    return res.status(200).json({ ok: true, ignored: event?.event || 'unknown' })
  }

  try {
    const result = await transaction(async (db) => {
      const { rows } = await db.query(`SELECT ${ORDER_COLUMNS} FROM fofo.orders o WHERE o.razorpay_order_id = $1`, [razorpayOrderId])
      const order = rows[0]
      if (!order) {
        const attempt = await invoiceAttempt(db, razorpayOrderId)
        if (!attempt) return { ignored: 'not a FOFO order' }
        if (event.event === 'payment.captured') {
          return settleInvoicePayment(db, attempt, payment, 'webhook', event)
        }
        return { result: (await reconcileAttempt(db, attempt, 'webhook')) || 'not_paid_yet' }
      }
      if (event.event === 'payment.captured') {
        return settleCapturedPayment(db, order, payment, 'webhook', event)
      }
      return { result: (await reconcileOrder(db, order, 'webhook')) || 'not_paid_yet' }
    })
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    return sendError(res, err)
  }
}
