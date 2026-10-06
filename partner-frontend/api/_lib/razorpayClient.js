/*
 * The three calls the partner server makes to Razorpay: create an order, list
 * an order's payments, capture a payment. Plain fetch with the key pair as
 * Basic auth; Razorpay's Node SDK would add a dependency for this little.
 *
 * RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are server-only (.env.example). The
 * key id is also sent to the browser, because the payment popup needs it; it
 * identifies the account and grants nothing. The secret never leaves here.
 *
 * Test keys (rzp_test_…) and live keys work the same way. Which account money
 * goes to is decided by the keys alone.
 */
import { HttpError } from './http.js'

const API = 'https://api.razorpay.com/v1'
const TIMEOUT_MS = 10_000

export class RazorpayError extends Error {
  constructor(status, description, code) {
    super(description || `Razorpay answered ${status}`)
    this.status = status
    this.code = code
  }
}

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw new HttpError(503, 'Online payment is not set up yet. Please try again later.')
  return { keyId, keySecret }
}

/** Whether payments can be taken at all. Checked before an order is frozen. */
export const paymentsConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)

/** The public key id, for the browser's payment popup. */
export const publicKeyId = () => credentials().keyId

async function call(method, path, body) {
  const { keyId, keySecret } = credentials()
  let response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.error(`Razorpay ${method} ${path} did not answer:`, err.message)
    throw new HttpError(502, 'The payment service did not answer. Please try again.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new RazorpayError(response.status, payload?.error?.description, payload?.error?.code)
  }
  return payload
}

/**
 * A Razorpay order for exactly `amountPaise`. `receipt` is our order number,
 * so the Razorpay dashboard and ours can be matched by eye.
 */
export async function createOrder({ amountPaise, receipt, notes }) {
  try {
    return await call('POST', '/orders', { amount: Number(amountPaise), currency: 'INR', receipt, notes })
  } catch (err) {
    if (err instanceof RazorpayError) {
      console.error('Razorpay refused to create an order:', err.status, err.message)
      throw new HttpError(502, 'The payment service could not start this payment. Please try again.')
    }
    throw err
  }
}

/** Every payment attempt on a Razorpay order, oldest first. */
export async function orderPayments(razorpayOrderId) {
  const { items = [] } = await call('GET', `/orders/${encodeURIComponent(razorpayOrderId)}/payments`)
  return [...items].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
}

export const fetchPayment = (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`)

/** Captures an authorized payment for exactly the amount it was authorized for. */
export const capturePayment = (paymentId, amountPaise) =>
  call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: Number(amountPaise), currency: 'INR' })
