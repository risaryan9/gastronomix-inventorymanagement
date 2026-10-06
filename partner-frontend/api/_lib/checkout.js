/*
 * Checkout: an outlet's cart becomes an order, and Razorpay collects for it.
 * Spec §8.2 is the flow, migration 18 the database half, decision 0020 the
 * cart rules this relies on.
 *
 *   POST /api/franchise/checkout          freeze the cart and start the payment,
 *                                         or hand back the one already started
 *   POST /api/franchise/checkout/confirm  "the popup closed": look at Razorpay
 *   POST /api/franchise/checkout/cancel   stop waiting and unlock the cart
 *
 * ONE CHECKOUT PER OUTLET AT A TIME. While an outlet has a live pending order,
 * Checkout returns that order again instead of making another. A double click,
 * a second person at the franchise, or reopening a closed popup all end up
 * paying the same order, which is the one the cart is locked for.
 *
 * THE ORDER, THE INVOICE AND RAZORPAY AGREE TO THE PAISA. The cart is priced
 * once (cart.pricedCart), checked, and the same lines are frozen. The database
 * then works the totals out from the frozen rows, and those totals must equal
 * what was checked or nothing is committed. Razorpay is asked for the order's
 * amount_paise, never a figure computed here.
 *
 * THE RAZORPAY ORDER IS CREATED INSIDE THE TRANSACTION that froze ours. If
 * Razorpay refuses, nothing is frozen and the cart stays unlocked. If our commit
 * fails after Razorpay said yes, Razorpay holds an order nobody can reach, which
 * costs nothing. The outlet's row stays locked meanwhile, so a second checkout
 * waits and then finds this one.
 *
 * STORE CREDIT THAT COVERS THE WHOLE ORDER needs no Razorpay at all: the order
 * is paid in the same transaction that froze it.
 */
import { HttpError, isUuid } from './http.js'
import { outletForFranchise } from './catalog.js'
import { cartView, lockingOrder, pricedCart } from './cart.js'
import { dec, sub, toFixed } from './decimal.js'
import { money } from './pricing.js'
import { createOrder, paymentsConfigured, publicKeyId } from './razorpayClient.js'
import { ORDER_COLUMNS, reconcileOrder } from './payments.js'

const PAID_STATUSES = ['paid', 'accepted', 'packed', 'ready_to_ship', 'shipped', 'delivered']

async function loadOrder(db, where, params) {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS}, ou.name AS outlet_name,
            (o.expires_at IS NULL OR o.expires_at > now()) AS live
       FROM fofo.orders o JOIN public.outlets ou ON ou.id = o.outlet_id
      WHERE ${where}`,
    params
  )
  return rows[0] || null
}

const orderSummary = (order) => ({
  id: order.id,
  orderNumber: order.order_number,
  total: money(order.grand_total),
  storeCredit: money(order.store_credit),
  payable: money(sub(order.grand_total, order.store_credit)),
  expiresAt: order.expires_at,
})

async function paidAnswer(db, orderId) {
  const order = await loadOrder(db, 'o.id = $1', [orderId])
  const { rows } = await db.query(
    `SELECT invoice_number FROM fofo.invoices WHERE order_id = $1 AND invoice_type = 'goods'`,
    [orderId]
  )
  return { ok: true, status: 'paid', order: orderSummary(order), invoiceNumber: rows[0]?.invoice_number || null }
}

// What the payment popup needs. The amount is the order's amount_paise.
function awaitingAnswer(order, user) {
  const secondsLeft = Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000)
  return {
    ok: true,
    status: 'awaiting_payment',
    order: orderSummary(order),
    razorpay: {
      keyId: publicKeyId(),
      orderId: order.razorpay_order_id,
      amount: Number(order.amount_paise),
      currency: 'INR',
      description: `Order ${order.order_number} · ${order.outlet_name}`,
      // The popup gives up when the order expires. Razorpay wants at least a minute.
      timeoutSeconds: Math.max(60, secondsLeft),
      email: user.email,
    },
  }
}

const expiredAnswer = (order) => ({
  ok: false,
  status: 'expired',
  order: orderSummary(order),
  reason: `The time to pay for order ${order.order_number} ran out, so nothing was charged. Your cart is unlocked: check out again to pay.`,
})

/*
 * Where an order stands once Razorpay has been asked: paid, still waiting, or
 * expired. A payment that lands after expiry still counts (spec §8.2 rule 1),
 * which is why Razorpay is asked before expiry is looked at.
 */
async function standing(db, user, order) {
  if (PAID_STATUSES.includes(order.status)) return paidAnswer(db, order.id)
  if (await reconcileOrder(db, order)) return paidAnswer(db, order.id)
  if (order.status === 'pending_payment' && order.live) return awaitingAnswer(order, user)
  return expiredAnswer(order)
}

/** POST /api/franchise/checkout { outlet_id, redeem_store_credit } */
export async function checkout(db, user, body) {
  const outlet = await outletForFranchise(db, user.franchiseId, body.outlet_id)

  // A payment already under way for this outlet: that is the one to pay.
  if (await lockingOrder(db, outlet.id)) {
    const live = await loadOrder(db, `o.outlet_id = $1 AND o.status = 'pending_payment'`, [outlet.id])
    return standing(db, user, live)
  }

  const priced = await pricedCart(db, user.franchiseId, outlet)
  const view = await cartView(db, user, outlet, priced)

  if (!view.lines.length) throw new HttpError(422, 'This cart is empty')
  if (view.needsAnswer) {
    const unavailable = view.lines.filter((l) => l.status === 'unavailable').length
    const changed = view.lines.filter((l) => l.status === 'price_changed').length
    const parts = []
    if (unavailable) parts.push(`remove ${unavailable} unavailable ${unavailable === 1 ? 'supply' : 'supplies'}`)
    if (changed) parts.push(`keep or remove ${changed} ${changed === 1 ? 'supply whose price has' : 'supplies whose prices have'} changed`)
    return { ok: false, reason: `Before checking out, ${parts.join(' and ')}.`, cart: view }
  }

  const total = priced.totals.total
  // A Razorpay order cannot be for less than ₹1, and neither can what is left
  // after credit (orders_razorpay_amount_collectable).
  const credit = body.redeem_store_credit ? dec(String(view.storeCredit.redeemable)) : 0n
  const payable = sub(total, credit)
  if (payable > 0n && payable < dec('1')) {
    return { ok: false, reason: 'The amount to pay must be at least ₹1.', cart: view }
  }
  if (payable > 0n && !paymentsConfigured()) {
    throw new HttpError(503, 'Online payment is not set up yet. Please try again later.')
  }

  const lines = priced.lines.map(({ materialId, quantity, item }) => ({
    raw_material_id: materialId,
    quantity,
    unit_base_cost: toFixed(item.baseCost, 4),
    margin_percent: String(item.material.sale_margin_percent),
    gst_percent: String(item.material.sale_gst_percent),
    hsn_code: item.material.hsn_code || null,
    unit_price_ex_gst: toFixed(item.exGst, 4),
    unit_price_inc_gst: toFixed(item.incGst, 4),
  }))

  const { rows } = await db.query(
    'SELECT fofo.freeze_order($1, $2, $3, $4, $5) AS frozen',
    [user.franchiseId, outlet.id, user.franchiseUserId, JSON.stringify(lines), toFixed(credit, 2)]
  )
  const { order_id: orderId, resumed } = rows[0].frozen
  let order = await loadOrder(db, 'o.id = $1', [orderId])
  if (resumed) return standing(db, user, order)

  // The database's totals, from the frozen rows, against the ones just checked.
  // A difference means the two roundings disagree: charge nothing.
  if (dec(order.grand_total) !== total || dec(order.store_credit) !== credit) {
    throw new Error(`Order ${order.order_number} froze at ${order.grand_total} with credit ${order.store_credit}, `
      + `but checkout priced ${toFixed(total, 2)} with credit ${toFixed(credit, 2)}`)
  }

  if (order.amount_paise === '0') {
    await db.query('SELECT fofo.mark_order_paid($1, NULL, NULL, NULL, $2)', [order.id, 'store_credit'])
    return paidAnswer(db, order.id)
  }

  const razorpayOrder = await createOrder({
    amountPaise: order.amount_paise,
    receipt: order.order_number,
    notes: { order_id: order.id, order_number: order.order_number, outlet: outlet.code },
  })
  await db.query(
    'UPDATE fofo.orders SET razorpay_order_id = $2, updated_at = now() WHERE id = $1 AND razorpay_order_id IS NULL',
    [order.id, razorpayOrder.id]
  )
  order = await loadOrder(db, 'o.id = $1', [orderId])
  return awaitingAnswer(order, user)
}

/*
 * POST /api/franchise/checkout/confirm { order_id }
 * The popup closed, one way or another. What the popup said is not trusted:
 * this asks Razorpay (api/_lib/payments.js).
 */
export async function confirmCheckout(db, user, body) {
  if (!isUuid(body.order_id)) throw new HttpError(400, 'Choose an order')
  const order = await loadOrder(db, 'o.id = $1 AND o.franchise_id = $2', [body.order_id, user.franchiseId])
  if (!order) throw new HttpError(404, 'That order is not one of yours')
  return standing(db, user, order)
}

/*
 * POST /api/franchise/checkout/cancel { outlet_id }
 * Stops waiting for a payment and unlocks the cart. Razorpay is asked first:
 * a payment that already went through is kept, not cancelled.
 */
export async function cancelCheckout(db, user, body) {
  const outlet = await outletForFranchise(db, user.franchiseId, body.outlet_id)
  const live = await loadOrder(
    db,
    `o.outlet_id = $1 AND o.franchise_id = $2 AND o.status = 'pending_payment'
       AND (o.expires_at IS NULL OR o.expires_at > now())`,
    [outlet.id, user.franchiseId]
  )
  if (live && await reconcileOrder(db, live)) return paidAnswer(db, live.id)
  if (live) {
    await db.query('SELECT fofo.cancel_checkout($1, $2, $3)', [user.franchiseId, outlet.id, user.franchiseUserId])
  }
  return { ok: true, status: 'cancelled', cart: await cartView(db, user, outlet) }
}
