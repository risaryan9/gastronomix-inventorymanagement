/*
 * The cart and the checkout check. Decision 0020 is the design; migration 17
 * holds the database half.
 *
 *   - One cart per outlet, shared by everyone at the franchise.
 *   - Each line remembers the price it was agreed at. THE SERVER STAMPS IT with
 *     the live price whenever someone sets a quantity or keeps a changed price.
 *     It never comes from the browser, and nothing charges it.
 *   - A line is `ok`, `price_changed` (live price, to the paisa, differs from
 *     the agreed one: keep or remove) or `unavailable` (no longer listed or no
 *     longer priceable here: remove).
 *   - While the outlet has a live pending order the cart is locked. The trigger
 *     refuses additions and changes; removals and "clear" are refused here,
 *     because the trigger cannot tell a person's delete from a cascade.
 *   - Checkout is one outlet at a time, and is refused while any line needs an
 *     answer.
 *
 * PAYMENTS ARE NOT LIVE. checkout() runs every check and works out the exact
 * amounts, then stops before freezing an order or calling Razorpay. Creating a
 * pending order now would lock the cart behind a payment nobody can make. The
 * freeze, Razorpay and the webhook are the next step (spec §13 Phase 4).
 *
 * UNPAID DUES are not checked yet. Spec §8.2 blocks checkout while a franchise
 * owes money, but no invoice exists to owe on until invoicing is built; the
 * check belongs in checkout() alongside it.
 */
import { HttpError, isUuid } from './http.js'
import { isWholeSteps, outletForFranchise, pricedCatalog, publicItem, publicOutlet } from './catalog.js'
import { dec, sub, toFixed } from './decimal.js'
import { lineAmounts, money, priceChanged, redeemableCredit, sumLines, unitMoney } from './pricing.js'

const LOCKED = 'This cart is locked while a payment for it is in progress. Wait for the payment to finish or expire.'

/** The live pending order locking an outlet's cart, or null. */
async function lockingOrder(db, outletId) {
  const { rows } = await db.query(
    `SELECT order_number, expires_at FROM fofo.orders
      WHERE outlet_id = $1 AND status = 'pending_payment'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [outletId]
  )
  return rows[0] || null
}

async function refuseIfLocked(db, outletId) {
  if (await lockingOrder(db, outletId)) throw new HttpError(409, LOCKED)
}

// The trigger is the backstop; a request that races the lock gets the same answer.
async function lockAware(work) {
  try {
    return await work()
  } catch (err) {
    if (err?.code === '23514' && /locked while payment/i.test(err.message)) throw new HttpError(409, LOCKED)
    throw err
  }
}

async function storeCreditAvailable(db, franchiseId) {
  const { rows } = await db.query('SELECT fofo.store_credit_available($1)::text AS available', [franchiseId])
  return rows[0].available
}

/*
 * One outlet's cart, priced now. Returns decimals for checkout and the public
 * shape for responses.
 */
async function pricedCart(db, franchiseId, outlet) {
  const { rows } = await db.query(
    `SELECT ci.raw_material_id, ci.quantity::text AS quantity,
            ci.agreed_unit_price_inc_gst::text AS agreed_price, ci.agreed_at,
            fu.email AS agreed_by_email
       FROM fofo.carts c
       JOIN fofo.cart_items ci ON ci.cart_id = c.id
       LEFT JOIN fofo.franchise_users fu ON fu.id = ci.agreed_by
      WHERE c.outlet_id = $1 AND c.franchise_id = $2
      ORDER BY ci.created_at, ci.id`,
    [outlet.id, franchiseId]
  )
  const { items, materials } = rows.length ? await pricedCatalog(db, outlet) : { items: new Map(), materials: new Map() }

  const lines = rows.map((row) => {
    const item = items.get(row.raw_material_id)
    const quantity = row.quantity
    if (!item || !item.available) {
      // No longer sold to this outlet, or no longer priceable here. What it
      // was is still worth showing, so the person knows what to remove.
      const m = item?.material || materials.get(row.raw_material_id) || {}
      return {
        status: 'unavailable',
        public: {
          id: row.raw_material_id,
          code: m.code || null,
          name: m.name || 'A supply that is no longer listed',
          unit: m.unit || null,
          category: m.category || null,
          quantity: Number(quantity),
          agreedPriceIncGst: unitMoney(row.agreed_price),
          status: 'unavailable',
        },
      }
    }
    const amounts = lineAmounts(quantity, item.exGst, item.material.sale_gst_percent)
    const status = priceChanged(row.agreed_price, item.incGst) ? 'price_changed' : 'ok'
    return {
      status,
      materialId: row.raw_material_id,
      quantity,
      amounts,
      public: {
        ...publicItem(item),
        quantity: Number(quantity),
        agreedPriceIncGst: unitMoney(row.agreed_price),
        agreedAt: row.agreed_at,
        agreedBy: row.agreed_by_email,
        lineTaxable: money(amounts.taxable),
        lineGst: money(amounts.gst),
        lineTotal: money(amounts.total),
        status,
      },
    }
  })

  // Totals at today's prices, over the lines that can be bought. An unavailable
  // line has no price to add.
  const priced = lines.filter((l) => l.status !== 'unavailable')
  const totals = sumLines(priced.map((l) => l.amounts))
  return { lines, totals }
}

async function cartView(db, user, outlet) {
  // Sequential: one client runs one query at a time.
  const { lines, totals } = await pricedCart(db, user.franchiseId, outlet)
  const lock = await lockingOrder(db, outlet.id)
  const available = await storeCreditAvailable(db, user.franchiseId)
  const needsAnswer = lines.filter((l) => l.status !== 'ok').length
  return {
    outlet: publicOutlet(outlet),
    lines: lines.map((l) => l.public),
    totals: {
      subtotal: money(totals.taxable),
      gst: money(totals.gst),
      total: money(totals.total),
    },
    storeCredit: {
      available: money(available),
      // What checkout would redeem if asked to: everything available, up to the
      // total, never leaving Razorpay less than ₹1 (pricing.redeemableCredit).
      redeemable: money(redeemableCredit(available, totals.total)),
    },
    lock: lock ? { orderNumber: lock.order_number, expiresAt: lock.expires_at } : null,
    needsAnswer,
    canCheckout: !lock && lines.length > 0 && needsAnswer === 0,
  }
}

/** GET /api/franchise/cart — the outlets that have something in their cart. */
export async function cartSummary(db, user) {
  const { rows } = await db.query(
      `SELECT o.id, o.code, o.name, ck.name AS kitchen_name, ck.code AS kitchen_code,
              COUNT(ci.id)::int AS lines, MAX(ci.updated_at) AS updated_at,
              EXISTS (SELECT 1 FROM fofo.orders p
                       WHERE p.outlet_id = o.id AND p.status = 'pending_payment'
                         AND (p.expires_at IS NULL OR p.expires_at > now())) AS locked
         FROM fofo.carts c
         JOIN fofo.cart_items ci ON ci.cart_id = c.id
         JOIN fofo.franchise_outlets fo ON fo.outlet_id = c.outlet_id AND fo.franchise_id = c.franchise_id
         JOIN public.outlets o ON o.id = c.outlet_id
         JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id
        WHERE c.franchise_id = $1
        GROUP BY o.id, o.code, o.name, ck.name, ck.code
        ORDER BY o.code, o.id`,
      [user.franchiseId]
  )
  const available = await storeCreditAvailable(db, user.franchiseId)
  const outlets = rows.map((r) => ({ ...publicOutlet(r), lines: r.lines, updatedAt: r.updated_at, locked: r.locked }))
  return {
    outlets,
    totalLines: outlets.reduce((sum, o) => sum + o.lines, 0),
    storeCreditAvailable: money(available),
  }
}

/** GET /api/franchise/cart?outlet_id= */
export async function getCart(db, user, outletId) {
  const outlet = await outletForFranchise(db, user.franchiseId, outletId)
  return cartView(db, user, outlet)
}

function requireMaterialId(value) {
  if (!isUuid(value)) throw new HttpError(400, 'Choose a supply')
  return value
}

/*
 * PUT /api/franchise/cart { outlet_id, material_id, quantity }
 * Sets a line's quantity; 0 removes it. Stamps the agreed price with the live one.
 */
export async function setQuantity(db, user, body) {
  const outlet = await outletForFranchise(db, user.franchiseId, body.outlet_id)
  const materialId = requireMaterialId(body.material_id)
  const quantity = Number(body.quantity)
  if (!Number.isFinite(quantity) || quantity < 0) throw new HttpError(400, 'Enter a quantity of 0 or more')

  await refuseIfLocked(db, outlet.id)

  if (quantity === 0) {
    await removeLine(db, user, outlet, materialId)
    return cartView(db, user, outlet)
  }

  const { items } = await pricedCatalog(db, outlet)
  const item = items.get(materialId)
  if (!item) throw new HttpError(422, 'That supply is not sold to this outlet. Remove it from the cart.')
  if (!item.available) throw new HttpError(422, 'That supply is not available for this outlet right now. Remove it from the cart.')
  if (!isWholeSteps(quantity, item.orderStep)) {
    throw new HttpError(400, `${item.material.name} is ordered in steps of ${item.orderStep} ${item.material.unit}`)
  }

  await lockAware(async () => {
    const { rows } = await db.query(
      `INSERT INTO fofo.carts (franchise_id, outlet_id) VALUES ($1, $2)
       ON CONFLICT (outlet_id) DO UPDATE SET updated_at = now()
       RETURNING id, franchise_id`,
      [user.franchiseId, outlet.id]
    )
    // outletForFranchise proved the outlet is this franchise's; a cart row left
    // by a previous owner would have been removed when the outlet was unlinked.
    if (rows[0].franchise_id !== user.franchiseId) throw new HttpError(409, 'This cart belongs to another franchise')
    await db.query(
      `INSERT INTO fofo.cart_items (cart_id, raw_material_id, quantity, agreed_unit_price_inc_gst, agreed_at, agreed_by)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (cart_id, raw_material_id) DO UPDATE
         SET quantity = EXCLUDED.quantity,
             agreed_unit_price_inc_gst = EXCLUDED.agreed_unit_price_inc_gst,
             agreed_at = now(),
             agreed_by = EXCLUDED.agreed_by`,
      [rows[0].id, materialId, String(quantity), toFixed(item.incGst, 4), user.franchiseUserId]
    )
  })
  return cartView(db, user, outlet)
}

async function removeLine(db, user, outlet, materialId) {
  await db.query(
    `DELETE FROM fofo.cart_items ci USING fofo.carts c
      WHERE ci.cart_id = c.id AND c.outlet_id = $1 AND c.franchise_id = $2 AND ci.raw_material_id = $3`,
    [outlet.id, user.franchiseId, materialId]
  )
  await db.query(
    `DELETE FROM fofo.carts c
      WHERE c.outlet_id = $1 AND c.franchise_id = $2
        AND NOT EXISTS (SELECT 1 FROM fofo.cart_items ci WHERE ci.cart_id = c.id)`,
    [outlet.id, user.franchiseId]
  )
}

/*
 * POST /api/franchise/cart/keep { outlet_id, material_id }
 * "Keep" on a changed price: the live price becomes the agreed one.
 */
export async function keepPrice(db, user, body) {
  const outlet = await outletForFranchise(db, user.franchiseId, body.outlet_id)
  const materialId = requireMaterialId(body.material_id)
  await refuseIfLocked(db, outlet.id)

  const { items } = await pricedCatalog(db, outlet)
  const item = items.get(materialId)
  if (!item || !item.available) throw new HttpError(422, 'That supply is no longer available for this outlet. Remove it from the cart.')

  const updated = await lockAware(() =>
    db.query(
      `UPDATE fofo.cart_items ci
          SET agreed_unit_price_inc_gst = $3, agreed_at = now(), agreed_by = $4
         FROM fofo.carts c
        WHERE ci.cart_id = c.id AND c.outlet_id = $1 AND c.franchise_id = $5 AND ci.raw_material_id = $2`,
      [outlet.id, materialId, toFixed(item.incGst, 4), user.franchiseUserId, user.franchiseId]
    )
  )
  if (!updated.rowCount) throw new HttpError(404, 'That supply is not in this cart')
  return cartView(db, user, outlet)
}

/** DELETE /api/franchise/cart?outlet_id= — clear one outlet's cart. */
export async function clearCart(db, user, outletId) {
  const outlet = await outletForFranchise(db, user.franchiseId, outletId)
  await refuseIfLocked(db, outlet.id)
  await db.query('DELETE FROM fofo.carts WHERE outlet_id = $1 AND franchise_id = $2', [outlet.id, user.franchiseId])
  return cartView(db, user, outlet)
}

/*
 * POST /api/franchise/checkout { outlet_id, redeem_store_credit }
 *
 * Every check checkout will make, and the exact amounts it would freeze, then a
 * clear stop: payments are not live. When they are, this is where the order is
 * frozen (prices onto order_items, credit onto store_credit_to_apply) and the
 * Razorpay order created, in this same transaction.
 */
export async function checkout(db, user, body) {
  const outlet = await outletForFranchise(db, user.franchiseId, body.outlet_id)
  const view = await cartView(db, user, outlet)

  if (view.lock) throw new HttpError(409, LOCKED)
  if (!view.lines.length) throw new HttpError(422, 'This cart is empty')
  if (view.needsAnswer) {
    const unavailable = view.lines.filter((l) => l.status === 'unavailable').length
    const changed = view.lines.filter((l) => l.status === 'price_changed').length
    const parts = []
    if (unavailable) parts.push(`remove ${unavailable} unavailable ${unavailable === 1 ? 'supply' : 'supplies'}`)
    if (changed) parts.push(`keep or remove ${changed} ${changed === 1 ? 'supply whose price has' : 'supplies whose prices have'} changed`)
    return { ok: false, reason: `Before checking out, ${parts.join(' and ')}.`, cart: view }
  }

  const total = dec(String(view.totals.total))
  // A Razorpay order cannot be for less than ₹1, and neither can what is left
  // after credit (orders_razorpay_amount_collectable).
  const credit = body.redeem_store_credit ? dec(String(view.storeCredit.redeemable)) : 0n
  const payable = sub(total, credit)
  if (payable > 0n && payable < dec('1')) {
    return { ok: false, reason: 'The amount to pay must be at least ₹1.', cart: view }
  }

  return {
    ok: true,
    paymentsLive: false,
    message: 'Your cart is ready to check out. Online payment is not switched on yet, so no order has been placed and nothing has been charged.',
    quote: {
      subtotal: view.totals.subtotal,
      gst: view.totals.gst,
      total: view.totals.total,
      storeCredit: money(credit),
      payable: money(payable),
    },
    cart: view,
  }
}
