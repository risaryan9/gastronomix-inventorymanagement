-- =====================================================================
-- The cart: price changes, the lock during payment, and store credit
-- redeemed at checkout
--
-- How the partner app's cart behaves (docs/fofo-dashboard-spec.md §8.2,
-- decision 0020):
--
--   - One cart per outlet, shared by everyone at the franchise, kept in
--     the database so it is there after closing the window or signing in
--     elsewhere. 05 already gives this: fofo.carts is UNIQUE (outlet_id).
--   - A line whose material can no longer be sold must be removed before
--     checkout.
--   - A line whose price has changed since it was put in the cart needs
--     an answer, keep or remove, before checkout.
--   - Checkout is one outlet at a time. Store credit can be redeemed on
--     that checkout.
--   - The cart empties when the payment succeeds and the order reaches the
--     purchase manager, not when the payment is started.
--
-- Three of those need the database.
--
-- WHAT CHANGES.
--
--   fofo.cart_items   + agreed_unit_price_inc_gst, agreed_at, agreed_by
--                     + a trigger: no additions or changes while the
--                       outlet has a live payment in progress
--   fofo.orders       + store_credit_to_apply
--                     ~ amount_paise now means what Razorpay collects:
--                       grand_total less store_credit_to_apply
--                     + a trigger: credit held by live checkouts can
--                       never exceed the franchise's balance
--   functions         + store_credit_held(), store_credit_available()
--                     + clear_cart_after_payment()
--
-- ---------------------------------------------------------------------
-- 1. "PRICE CHANGED" NEEDS SOMETHING TO COMPARE AGAINST
-- ---------------------------------------------------------------------
-- 05 says the cart holds no prices, and the reason still stands: a price
-- stored on the cart and then charged would be a stale number presented
-- as a promise. But "this has changed since you added it" means changed
-- from a price, so the cart has to remember one.
--
-- agreed_unit_price_inc_gst is that price, and it is only ever used for
-- comparison. Nothing charges it and checkout never reads it as a price.
-- Checkout prices every line fresh, exactly as before, and refuses to go
-- ahead while any line's fresh price differs from its agreed price.
--
-- THE SERVER STAMPS IT. It is set to the live price whenever a person
-- chooses a quantity (add, change) or presses "keep" on a changed price.
-- Each of those is a moment when they were looking at the live price.
-- It is never taken from the browser. A browser-supplied figure would let
-- a stale tab acknowledge a price nobody saw.
--
-- COMPARED TO THE PAISA. Unit prices are numeric(14,4) because a weighted
-- average cost is rarely a whole paisa (05). Every stock-in moves the
-- fourth decimal place. The partner app compares both prices rounded to
-- the paisa, and only a change of at least a paisa is flagged. If that
-- still flags too often, loosen it in the app. This column stays as it is.
--
-- agreed_by NAMES THE PERSON because the cart is shared. "Ravi kept this at
-- ₹412.50 on Tuesday" is the answer when Priya asks why it is still there.
--
-- ---------------------------------------------------------------------
-- 2. THE CART IS LOCKED WHILE ITS PAYMENT IS IN PROGRESS
-- ---------------------------------------------------------------------
-- The cart now empties when the payment lands, not when it is started. A
-- shared cart that stays editable during payment is broken. Priya pays for
-- 10 kg while Ravi adds 5 kg of paneer to the same cart. Emptying the cart
-- on payment then silently loses Ravi's paneer. Leaving the cart alone
-- instead makes someone pay twice for Priya's 10 kg.
--
-- So while the outlet has a LIVE pending order (status pending_payment,
-- not past expires_at) no line can be added or changed. When the order
-- expires the lock lifts by itself. Expiry is compared on read, so no job
-- has to unlock anything (05). Starting checkout again replaces the pending
-- order as before.
--
-- A TRIGGER, NOT ONLY THE API. Same reasoning as decision 0005: the
-- partner app shows the cart as locked, but the rule is that the cart
-- does not change, and that belongs where every write passes through.
--
-- DELETE IS NOT BLOCKED HERE, on purpose. Two legitimate deletes happen
-- during a live payment: unlink_franchise_outlet (12) discards the cart
-- by cascade, and clear_cart_after_payment empties it when the money
-- lands. A trigger cannot tell those apart from a person removing a line.
-- The partner app's cart API refuses removals and "clear cart" while the
-- lock is on. Removing a line cannot put a wrong item on an order either,
-- because the order was frozen before the lock began.
--
-- ---------------------------------------------------------------------
-- 3. EMPTYING THE CART WHEN THE PAYMENT LANDS
-- ---------------------------------------------------------------------
-- clear_cart_after_payment(order) runs in the same transaction that marks
-- the order paid. It removes a cart line only if the order contains that
-- material AND the line has not changed since the order was frozen.
--
-- Why not simply delete the cart: paid beats expired (05). A payment can
-- land after the order has expired, and by then the lock has lifted and
-- someone may have changed the cart. Lines touched after the freeze are a
-- new decision by a person and are kept. Lines untouched since the freeze
-- are exactly what was paid for, and they go. The cart row itself goes
-- when nothing is left in it.
--
-- updated_at on cart_items is kept current by the trigger below, because
-- this comparison depends on it and a forgotten `updated_at = now()` in
-- the API would silently delete someone's change.
--
-- ---------------------------------------------------------------------
-- 4. STORE CREDIT IS REDEEMED AT CHECKOUT, SO IT MUST BE HELD
-- ---------------------------------------------------------------------
-- Decision 0013 still holds exactly. Credit is a payment, never a
-- discount. The goods invoice is issued at full value with full GST, and
-- fofo.apply_store_credit() settles part of what is payable. What is new
-- is WHEN the franchise chooses to use it: before paying, while no invoice
-- exists yet. The invoice is only created once the money lands (spec §8.2,
-- rule 2).
--
-- So the order records the choice. store_credit_to_apply is fixed at
-- checkout alongside the prices. When the payment lands, the same
-- transaction issues the goods invoice, calls apply_store_credit for that
-- amount, and records the Razorpay payment for the rest. The invoice
-- totals are untouched either way.
--
-- amount_paise BECOMES WHAT RAZORPAY COLLECTS. It stays generated, so the
-- webhook check in partner-frontend/api/_lib/razorpay.js is still integer
-- against integer and its code does not change. Only its meaning moves
-- from grand_total to grand_total less the credit.
--
-- WHY THE CREDIT IS HELD. Credit belongs to the franchise, not the outlet,
-- and two outlets can check out at once. Without a hold, ₹1,000 of credit
-- could be promised to two ₹1,000 checkouts. Neither would send anything to
-- Razorpay, and when the second one's money was due there would be no credit
-- left to settle it with.
-- store_credit_held() is the credit named by the franchise's live pending
-- orders, and store_credit_available() is the balance less that.
--
-- THE HOLD IS A TRIGGER, for the reason 0013's caps are. The rule is "read
-- a total, then write based on it", and it is only safe with a lock. The
-- trigger locks the franchise row, so two checkouts for one franchise
-- queue and the second one sees the first one's hold.
--
-- WHAT THE HOLD DOES NOT COVER.
--   - A payment that lands after its order expired. The hold lapsed at
--     expiry, so the credit may since have been spent. The payment
--     transaction applies what is still there. Any shortfall is an unpaid
--     remainder on that invoice, which the existing "unpaid dues block
--     checkout" rule (spec §8.2) already handles, and it is flagged for
--     review. It needs the franchise to pay late AND spend the same credit
--     in between, so it should be rare. The alternative, holding credit
--     past expiry, would lock a franchise's credit behind an abandoned
--     payment page.
--   - apply_store_credit called directly by staff on some other invoice
--     does not check holds. The payment transaction's shortfall handling
--     above catches that too.
--
-- RAZORPAY CANNOT COLLECT LESS THAN ₹1. What is left for Razorpay is
-- either nothing (credit covers the order, which is then paid at checkout
-- with no Razorpay order at all) or at least 100 paise. A CHECK makes
-- anything between impossible. Checkout redeems ₹1 less credit rather
-- than leave a 40-paise payment.
--
-- APPLIED to the live database on 2026-09-15, and checked against the live
-- schema: columns, constraints, triggers and grants. Needs 05, 07, 08.
-- Independent of 16 (the accept function, not yet written), and was run
-- before 16 exists.
--
-- Requires: 05-create-fofo-orders-and-carts.sql,
--           07-create-fofo-money-tables.sql,
--           08-create-fofo-store-credit-rpcs.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The price a cart line was agreed at
-- ---------------------------------------------------------------------
-- NOT NULL with no default: there is no honest value for an existing line.
-- fofo.cart_items was empty in the live database when this was written. If
-- it is not empty where you run this, the ALTER fails, and deleting the
-- rows first is correct: a cart holds quantities only (05).

ALTER TABLE fofo.cart_items
  ADD COLUMN IF NOT EXISTS agreed_unit_price_inc_gst numeric(14,4) NOT NULL,
  ADD COLUMN IF NOT EXISTS agreed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS agreed_by uuid NOT NULL REFERENCES fofo.franchise_users(id);

ALTER TABLE fofo.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_agreed_price_non_negative;
ALTER TABLE fofo.cart_items
  ADD CONSTRAINT cart_items_agreed_price_non_negative
  CHECK (agreed_unit_price_inc_gst >= 0);

COMMENT ON COLUMN fofo.cart_items.agreed_unit_price_inc_gst IS
'The live GST-inclusive unit price when someone last chose this quantity or pressed keep on a changed price. Stamped by the server, never sent by the browser. Only used to detect a price change: checkout re-prices every line and refuses while any line, rounded to the paisa, differs from this. Never charged. See 17-add-cart-price-agreement-lock-and-checkout-credit.sql.';

COMMENT ON COLUMN fofo.cart_items.agreed_by IS
'The franchise user who last set the quantity or kept the changed price. The cart is shared across the franchise, so this answers "who kept this".';

-- ---------------------------------------------------------------------
-- 2. The lock while a payment is in progress
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.assert_cart_not_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fofo, public
AS $$
DECLARE
  v_order_number text;
BEGIN
  -- A NULL expires_at counts as live: checkout sets it when it freezes the
  -- order, so a NULL is a checkout that is still being created.
  SELECT o.order_number INTO v_order_number
    FROM fofo.carts c
    JOIN fofo.orders o ON o.outlet_id = c.outlet_id
   WHERE c.id = NEW.cart_id
     AND o.status = 'pending_payment'
     AND (o.expires_at IS NULL OR o.expires_at > now())
   LIMIT 1;

  IF v_order_number IS NOT NULL THEN
    RAISE EXCEPTION 'This cart is locked while payment for order % is in progress', v_order_number
      USING ERRCODE = 'check_violation',
            HINT = 'Wait for the payment to finish or expire, or start checkout again.';
  END IF;

  -- clear_cart_after_payment keeps lines changed after an order was frozen
  -- by comparing this timestamp, so it cannot be left to the caller.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fofo.assert_cart_not_locked() IS
'Refuses to add or change a cart line while the outlet has a live pending order, and keeps updated_at current. Deletes are not checked here: see 17-add-cart-price-agreement-lock-and-checkout-credit.sql for why.';

DROP TRIGGER IF EXISTS trg_cart_items_not_locked ON fofo.cart_items;

CREATE TRIGGER trg_cart_items_not_locked
  BEFORE INSERT OR UPDATE ON fofo.cart_items
  FOR EACH ROW EXECUTE FUNCTION fofo.assert_cart_not_locked();

-- ---------------------------------------------------------------------
-- 3. Store credit chosen at checkout
-- ---------------------------------------------------------------------

ALTER TABLE fofo.orders
  ADD COLUMN IF NOT EXISTS store_credit_to_apply numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE fofo.orders DROP CONSTRAINT IF EXISTS orders_store_credit_within_total;
ALTER TABLE fofo.orders
  ADD CONSTRAINT orders_store_credit_within_total
  CHECK (store_credit_to_apply >= 0 AND store_credit_to_apply <= grand_total);

-- Nothing for Razorpay, or at least its ₹1 minimum.
ALTER TABLE fofo.orders DROP CONSTRAINT IF EXISTS orders_razorpay_amount_collectable;
ALTER TABLE fofo.orders
  ADD CONSTRAINT orders_razorpay_amount_collectable
  CHECK (grand_total - store_credit_to_apply = 0
         OR grand_total - store_credit_to_apply >= 1.00);

-- Redefine amount_paise. Dropping and re-adding a generated column works on
-- every supported Postgres. ALTER ... SET EXPRESSION is 17+ only. Nothing
-- depends on the column except its own default expression.
ALTER TABLE fofo.orders DROP COLUMN amount_paise;
ALTER TABLE fofo.orders
  ADD COLUMN amount_paise bigint
  GENERATED ALWAYS AS (((grand_total - store_credit_to_apply) * 100)::bigint) STORED;

COMMENT ON COLUMN fofo.orders.store_credit_to_apply IS
'Store credit the franchise chose to redeem at checkout, frozen with the prices. Not a discount: the goods invoice is still issued at grand_total with full GST, and this amount is settled against it through fofo.apply_store_credit() in the transaction that marks the order paid (decision 0013). Held against the franchise balance while the order is a live pending order.';

COMMENT ON COLUMN fofo.orders.amount_paise IS
'What Razorpay collects: grand_total less store_credit_to_apply, in whole paise, generated. What checkout sends to Razorpay as the amount, and what the webhook compares the captured payment against, integer to integer. 0 means credit covered the order and there is no Razorpay order. Never set directly.';

-- ---------------------------------------------------------------------
-- 4. Credit held by live checkouts
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.store_credit_held(
  p_franchise_id     uuid,
  p_except_order_id  uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = fofo, public
AS $$
  SELECT COALESCE(SUM(store_credit_to_apply), 0)
    FROM fofo.orders
   WHERE franchise_id = p_franchise_id
     AND status = 'pending_payment'
     AND (expires_at IS NULL OR expires_at > now())
     AND id IS DISTINCT FROM p_except_order_id;
$$;

COMMENT ON FUNCTION fofo.store_credit_held(uuid, uuid) IS
'Store credit promised to the franchise''s live pending orders and not yet applied to an invoice. Lapses when an order expires. Pass an order id to leave that order out.';

CREATE OR REPLACE FUNCTION fofo.store_credit_available(p_franchise_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = fofo, public
AS $$
  SELECT fofo.store_credit_balance(p_franchise_id)
       - fofo.store_credit_held(p_franchise_id);
$$;

COMMENT ON FUNCTION fofo.store_credit_available(uuid) IS
'What checkout may offer to redeem: the balance less what live checkouts already hold. The figure the cart shows as "store credit available". The balance itself stays fofo.store_credit_balance(), unchanged.';

CREATE OR REPLACE FUNCTION fofo.assert_order_credit_is_available()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fofo, public
AS $$
DECLARE
  v_balance numeric(14,2);
  v_held    numeric(14,2);
BEGIN
  -- Only a live pending order holds credit, and only a positive amount.
  -- Anything else (a zero, a paid order, an expiry) cannot overdraw.
  IF NEW.store_credit_to_apply = 0
     OR NEW.status <> 'pending_payment'
     OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= now()) THEN
    RETURN NEW;
  END IF;

  -- Serialise checkouts for one franchise, so the second one sees the
  -- first one's hold instead of the same free balance.
  PERFORM 1 FROM fofo.franchises WHERE id = NEW.franchise_id FOR UPDATE;

  v_balance := fofo.store_credit_balance(NEW.franchise_id);
  v_held    := fofo.store_credit_held(NEW.franchise_id, NEW.id);

  IF v_held + NEW.store_credit_to_apply > v_balance THEN
    RAISE EXCEPTION
      'Not enough store credit. Balance is %, held by other checkouts %, this checkout asks for %',
      v_balance, v_held, NEW.store_credit_to_apply
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fofo.assert_order_credit_is_available() IS
'Refuses a live pending order whose store credit, together with what the franchise''s other live checkouts hold, exceeds the franchise''s balance. Locks the franchise row so concurrent checkouts queue.';

DROP TRIGGER IF EXISTS trg_orders_credit_is_available ON fofo.orders;

CREATE TRIGGER trg_orders_credit_is_available
  BEFORE INSERT OR UPDATE OF store_credit_to_apply, status, expires_at ON fofo.orders
  FOR EACH ROW EXECUTE FUNCTION fofo.assert_order_credit_is_available();

-- ---------------------------------------------------------------------
-- 5. Emptying the cart once the order is paid
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.clear_cart_after_payment(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = fofo, public
AS $$
DECLARE
  v_order   fofo.orders%ROWTYPE;
  v_removed integer;
BEGIN
  SELECT * INTO v_order FROM fofo.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Only once the money is in. Called on a pending order, this would empty
  -- a cart for a payment that may never come.
  IF v_order.status IN ('pending_payment', 'expired', 'payment_failed', 'cancelled') THEN
    RAISE EXCEPTION 'Order % is %, not paid; its cart is left alone', v_order.order_number, v_order.status;
  END IF;

  -- Lines untouched since the freeze are what was paid for. A line changed
  -- afterwards (possible only once the order had expired) is kept.
  WITH removed AS (
    DELETE FROM fofo.cart_items ci
     USING fofo.carts c
     WHERE ci.cart_id = c.id
       AND c.outlet_id = v_order.outlet_id
       AND ci.updated_at <= v_order.created_at
       AND EXISTS (SELECT 1 FROM fofo.order_items oi
                    WHERE oi.order_id = v_order.id
                      AND oi.raw_material_id = ci.raw_material_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM removed;

  DELETE FROM fofo.carts c
   WHERE c.outlet_id = v_order.outlet_id
     AND NOT EXISTS (SELECT 1 FROM fofo.cart_items ci WHERE ci.cart_id = c.id);

  RETURN v_removed;
END;
$$;

COMMENT ON FUNCTION fofo.clear_cart_after_payment(uuid) IS
'Empties an outlet''s cart of what a paid order bought. Call it in the transaction that marks the order paid. Keeps any line changed after the order was frozen, and drops the cart row once it is empty. Returns the number of lines removed.';

-- ---------------------------------------------------------------------
-- 6. Grants (decision 0004): revoke by name, then check proacl
-- ---------------------------------------------------------------------
-- Trigger functions are revoked from service_role too. A trigger runs its
-- function whatever the caller's EXECUTE privilege, so nobody needs to call
-- these directly.

REVOKE ALL ON FUNCTION fofo.assert_cart_not_locked()              FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.assert_order_credit_is_available()    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.store_credit_held(uuid, uuid)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.store_credit_available(uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.clear_cart_after_payment(uuid)        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fofo.store_credit_held(uuid, uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION fofo.store_credit_available(uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION fofo.clear_cart_after_payment(uuid)     TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- New columns, and amount_paise's new expression:
--
-- SELECT table_name, column_name, data_type, generation_expression
--   FROM information_schema.columns
--  WHERE table_schema = 'fofo'
--    AND ((table_name = 'cart_items' AND column_name LIKE 'agreed%')
--      OR (table_name = 'orders' AND column_name IN ('store_credit_to_apply', 'amount_paise')));
--
-- Grants. Only service_role (and the owner) on the three callable functions;
-- no anon, no authenticated on any of the five:
--
-- SELECT proname, proacl FROM pg_proc
--  WHERE pronamespace = 'fofo'::regnamespace
--    AND proname IN ('assert_cart_not_locked', 'assert_order_credit_is_available',
--                    'store_credit_held', 'store_credit_available',
--                    'clear_cart_after_payment');
--
-- Behaviour, in a transaction you roll back. Needs a franchise, one of its
-- outlets, that outlet's kitchen, a franchise user and a raw material:
--
-- BEGIN;
-- INSERT INTO fofo.carts (id, franchise_id, outlet_id)
--   VALUES ('00000000-0000-0000-0000-00000000c001', '<franchise>', '<outlet>');
-- INSERT INTO fofo.cart_items (cart_id, raw_material_id, quantity, agreed_unit_price_inc_gst, agreed_by)
--   VALUES ('00000000-0000-0000-0000-00000000c001', '<material>', 2, 100, '<franchise user>');
-- INSERT INTO fofo.orders (id, order_number, franchise_id, outlet_id, cloud_kitchen_id,
--                          subtotal, gst_total, grand_total, expires_at)
--   VALUES ('00000000-0000-0000-0000-00000000d001', 'TEST-17', '<franchise>', '<outlet>', '<kitchen>',
--           200, 10, 210, now() + interval '15 minutes');
-- INSERT INTO fofo.order_items (order_id, raw_material_id, quantity_ordered, unit_base_cost,
--                               margin_percent, gst_percent, unit_price_ex_gst, unit_price_inc_gst)
--   VALUES ('00000000-0000-0000-0000-00000000d001', '<material>', 2, 90, 10, 5, 100, 105);
--
-- -- MUST FAIL: the cart is locked while TEST-17 is pending
-- UPDATE fofo.cart_items SET quantity = 3 WHERE cart_id = '00000000-0000-0000-0000-00000000c001';
--
-- -- MUST FAIL: credit this franchise does not have (balance 0)
-- UPDATE fofo.orders SET store_credit_to_apply = 50 WHERE order_number = 'TEST-17';
--
-- -- MUST FAIL on orders_razorpay_amount_collectable: leaves 40 paise for
-- -- Razorpay. Marked paid in the same statement only so the credit trigger
-- -- stands aside and the CHECK is what answers.
-- SAVEPOINT s;
-- UPDATE fofo.orders SET status = 'paid', store_credit_to_apply = 209.60 WHERE order_number = 'TEST-17';
-- ROLLBACK TO s;
--
-- -- amount_paise is 21000 with no credit
-- SELECT amount_paise FROM fofo.orders WHERE order_number = 'TEST-17';
--
-- -- MUST FAIL: the order is not paid yet
-- SELECT fofo.clear_cart_after_payment('00000000-0000-0000-0000-00000000d001');
--
-- UPDATE fofo.orders SET status = 'paid' WHERE order_number = 'TEST-17';
-- SELECT fofo.clear_cart_after_payment('00000000-0000-0000-0000-00000000d001');  -- 1
-- SELECT count(*) FROM fofo.carts WHERE id = '00000000-0000-0000-0000-00000000c001';  -- 0
-- ROLLBACK;

-- =====================================================================
-- Rollback
-- =====================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_orders_credit_is_available ON fofo.orders;
-- DROP TRIGGER IF EXISTS trg_cart_items_not_locked ON fofo.cart_items;
-- DROP FUNCTION IF EXISTS fofo.clear_cart_after_payment(uuid);
-- DROP FUNCTION IF EXISTS fofo.assert_order_credit_is_available();
-- DROP FUNCTION IF EXISTS fofo.store_credit_available(uuid);
-- DROP FUNCTION IF EXISTS fofo.store_credit_held(uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.assert_cart_not_locked();
-- ALTER TABLE fofo.orders DROP COLUMN amount_paise;
-- ALTER TABLE fofo.orders DROP CONSTRAINT IF EXISTS orders_razorpay_amount_collectable;
-- ALTER TABLE fofo.orders DROP CONSTRAINT IF EXISTS orders_store_credit_within_total;
-- ALTER TABLE fofo.orders DROP COLUMN IF EXISTS store_credit_to_apply;
-- ALTER TABLE fofo.orders
--   ADD COLUMN amount_paise bigint GENERATED ALWAYS AS ((grand_total * 100)::bigint) STORED;
-- ALTER TABLE fofo.cart_items DROP CONSTRAINT IF EXISTS cart_items_agreed_price_non_negative;
-- ALTER TABLE fofo.cart_items
--   DROP COLUMN IF EXISTS agreed_by,
--   DROP COLUMN IF EXISTS agreed_at,
--   DROP COLUMN IF EXISTS agreed_unit_price_inc_gst;
-- COMMIT;
