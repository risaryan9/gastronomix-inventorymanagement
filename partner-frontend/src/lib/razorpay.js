// Razorpay's payment popup (Standard Checkout).
//
// The script comes from Razorpay, never bundled: it must be theirs, current,
// and served from their domain for the card and UPI flows to work. It is loaded
// only when someone checks out.
//
// NOTHING THE POPUP SAYS IS TRUSTED. When it reports success, the cart page
// asks the server to confirm, and the server asks Razorpay itself
// (api/_lib/payments.js). The popup's reply is only a signal to go and look.

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

// The brand gold, --accent (hsl 49 95% 46%), as the hex Razorpay's theme wants.
const BRAND_GOLD = '#E5BC06'

let loading = null

function loadScript() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT
      script.async = true
      script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not load')))
      script.onerror = () => reject(new Error('Razorpay did not load'))
      document.body.appendChild(script)
    }).catch((err) => {
      loading = null // let the next attempt try again
      throw err
    })
  }
  return loading
}

/**
 * Opens the popup for a checkout the server started. `payment` is the
 * `razorpay` object from POST /api/franchise/checkout.
 *
 * Resolves 'completed' when the popup reports a payment, 'dismissed' when it
 * is closed without one. Either way, the next step is to ask the server.
 */
export async function openPaymentPopup(payment) {
  const Razorpay = await loadScript()
  return new Promise((resolve) => {
    const popup = new Razorpay({
      key: payment.keyId,
      order_id: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      name: 'Gastronomix',
      description: payment.description,
      timeout: payment.timeoutSeconds,
      prefill: payment.email ? { email: payment.email } : undefined,
      theme: { color: BRAND_GOLD },
      retry: { enabled: true },
      handler: () => resolve('completed'),
      modal: {
        ondismiss: () => resolve('dismissed'),
        confirm_close: true,
      },
    })
    popup.open()
  })
}
