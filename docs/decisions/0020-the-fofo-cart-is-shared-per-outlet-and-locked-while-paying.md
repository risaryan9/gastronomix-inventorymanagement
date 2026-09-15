# 0020. The FOFO cart is shared per outlet, remembers the price it was agreed at, and is locked while it is being paid for

Date: 2026-09-15
Status: Accepted

## Context

A franchise can own several outlets, and several people can sign in for one
franchise. The partner app's cart was designed as one database row per outlet
that holds quantities only (migration 05). Settling how the cart actually
behaves raised four questions that schema could not answer:

1. **Can one checkout cover several outlets?** Each outlet can be served by a
   different kitchen at different prices, and the payment check, the goods
   invoice, the credit notes and the "one live pending order per outlet" rule
   all work on one order at a time.
2. **What does "the price changed" mean when the cart holds no prices?** Costs
   move with every stock-in, so a live price can differ from the one someone saw
   when they added the item.
3. **When does the cart empty?** It now empties when the payment succeeds and the
   order reaches the purchase manager. It no longer empties when the payment is
   started. But the cart is shared, so someone else can edit it while the
   payment is in progress.
4. **How is store credit redeemed "before checkout"** when decision 0013 applies
   credit to an invoice, and the goods invoice is only issued after the money
   lands?

## Decision

**One cart per outlet, shared by the whole franchise, stored in the database.**
It is there after closing the window or signing in elsewhere. Items for outlet 2
never share a cart with outlet 1.

**Checkout is one outlet at a time. There is no combined checkout.** One outlet's
cart becomes one order, which gets one Razorpay order (or none, when credit
covers it), one goods invoice and one payment.

**A cart line remembers the price it was agreed at** (`cart_items.agreed_unit_price_inc_gst`).
The server stamps the live price whenever someone chooses a quantity or presses
**keep**. It is only compared, never charged. Checkout still prices every line
fresh. Before checkout:

- A line that can no longer be sold (the material was deactivated or made
  unsellable, or it cannot be priced in the serving kitchen) **must be removed**.
- A line whose live price differs from its agreed price by at least a paisa
  needs **keep or remove**. Checkout stays blocked until every changed line has
  an answer.

The server enforces both at checkout, not only the screen. A price can move
between reviewing the cart and pressing pay, and then checkout returns the lines
that need an answer.

**The cart is locked while its payment is in progress.** While the outlet has a
live pending order, no line can be added or changed. A database trigger enforces
this, and the lock lifts by itself when the order expires. When the payment
lands, `clear_cart_after_payment` removes the lines the order bought, in the
same transaction that marks the order paid. It keeps any line changed after the
order was frozen.

**Store credit is chosen at checkout, recorded on the order, and held.**
`orders.store_credit_to_apply` is frozen with the prices, and `amount_paise`
becomes what Razorpay collects: `grand_total` less that credit. When the money
lands, the goods invoice is issued at full value and `apply_store_credit`
settles the credit against it. Decision 0013 is unchanged: the credit is still a
payment and never a discount. While the order is a live pending order its credit
is **held**, and a trigger refuses a checkout that would promise more credit
than the franchise has. Credit belongs to the franchise, so it can be redeemed
on any of its outlets.

## Alternatives

**Paying for several outlets in one go.** Rejected. One payment would have to be
split across several orders before the webhook could mark any of them paid.
Refunds and credit are recorded per invoice, so every trim would need splitting
back as well. A combined checkout also has to freeze and expire several orders
together, including the case where one expired and another did not.

**Keeping the cart priceless and flagging a change against the price at the
previous page load.** That price lives only in one browser tab. The cart is
shared, so Ravi's tab cannot know what Priya agreed to yesterday. It would also
let a stale tab "acknowledge" a price nobody saw.

**Emptying the cart when payment starts** (the original behaviour, which needs
no lock). Rejected by product decision: a payment abandoned in the Razorpay popup
should not cost the franchise its cart. Emptying on payment makes the lock
necessary. Without it, an edit made during payment is either silently lost or
paid for twice.

**Deleting the whole cart on payment.** Simpler, but paid beats expired (05). A
late payment can land after the lock has lifted and someone has changed the
cart, and those changes would vanish.

**Applying credit only after payment, to the invoice, as 0013 first
imagined.** The franchise could not see what they would pay before paying, and
Razorpay would already have collected the full amount.

**Holding credit until a late payment is ruled out** instead of until expiry.
This would lock a franchise's credit behind any abandoned payment page. The rare
opposite case is a late payment finding its held credit already spent. That case
is left as an unpaid remainder on the invoice, which the "unpaid dues block
checkout" rule already covers, and it is flagged for review.

## Consequences

- The cart API writes the agreed price itself. It never accepts one from the
  browser.
- The cart API must refuse removals and "clear cart" while the lock is on. The
  trigger checks additions and changes only, because it cannot tell a person's
  delete from the cascade in `unlink_franchise_outlet` or from the payment
  clearing the cart.
- The payment-confirmation transaction has four steps, in order: mark the order
  paid, issue the goods invoice, apply `store_credit_to_apply`, and record the
  Razorpay payment for `amount_paise`. It then calls `clear_cart_after_payment`.
  An order whose credit covers everything is confirmed at checkout, with no
  Razorpay order.
- Razorpay's minimum is ₹1. The CHECK `orders_razorpay_amount_collectable` means
  checkout redeems ₹1 less credit rather than leave a few paise to collect.
- "Store credit available" on the cart is `fofo.store_credit_available()`, which
  is the balance less holds, not `store_credit_balance()`.
- Direct staff redemptions through `apply_store_credit` do not see holds. If that
  becomes common, make it respect them rather than widening the late-payment
  case.
- If flagging every paisa of movement turns out to be too noisy, loosen the
  comparison in the partner app. The column stays as it is.

## Where it lives

- `migrations/fofo/17-add-cart-price-agreement-lock-and-checkout-credit.sql`:
  the columns, the lock trigger, the credit hold, `clear_cart_after_payment`
- `migrations/fofo/05-create-fofo-orders-and-carts.sql`: one cart per outlet,
  one live pending order per outlet
- `partner-frontend/api/_lib/razorpay.js`: the webhook compares against
  `amount_paise`, which now excludes redeemed credit
- `docs/fofo-dashboard-spec.md` §8.2: the cart and checkout flow
- Decision 0013: store credit is a payment
