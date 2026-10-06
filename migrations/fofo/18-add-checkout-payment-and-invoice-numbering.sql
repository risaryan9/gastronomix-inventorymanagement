-- =====================================================================
-- Checkout, payment and invoice numbering
--
-- Until now checkout checked a cart and stopped. This is what happens after:
-- the order is frozen, Razorpay collects the money, and the payment turns
-- into a paid order with a goods invoice (docs/fofo-dashboard-spec.md §8.2).
--
-- WHAT CHANGES.
--
--   fofo.orders              + checked_out_by (the franchise user)
--   fofo.order_number_seq    order numbers, FO-000001
--   fofo.document_counters   invoice and credit-note numbers, gapless per
--                            financial year: INV/26-27/0001, CN/26-27/0001
--   fofo.payment_exceptions  money Razorpay took that did not pay an order
--   functions                + freeze_order          checkout: the order
--                            + mark_order_paid       payment: invoice, credit,
--                                                    cart
--                            + cancel_checkout       unlock a cart
--                            + record_payment_exception
--                            + franchise_dues        what is owed
--                            + next_document_number, next_order_number,
--                              financial_year_label
--   triggers                 + invoices and invoice lines refuse UPDATE and
--                              DELETE (decision 0016)
--
-- ---------------------------------------------------------------------
-- 1. NUMBERS
-- ---------------------------------------------------------------------
-- ORDER NUMBERS may have gaps (decision 0016): one is taken at checkout, and
-- an abandoned checkout keeps it. A sequence is right for that.
--
-- INVOICE AND CREDIT-NOTE NUMBERS may not. GST wants them sequential with no
-- holes, per financial year. A sequence skips a number whenever the
-- transaction that took it rolls back, so these come from a counter row
-- instead. The row is updated inside the transaction that issues the
-- document: if that transaction rolls back, so does the number, and a second
-- issuer waits on the row lock rather than taking the same number.
--
-- THE FINANCIAL YEAR follows the business day, which is the UTC date
-- (decision 0002). An invoice issued between 00:00 and 05:30 IST on 1 April
-- is dated 31 March and numbered in the old year. Its date and its number
-- agree, which is what matters, but the accountant should know.
--
-- The format is INV/<yy-yy>/<at least 4 digits>, 14 characters, under
-- GST's 16. It grows a digit past 9999 rather than wrapping.
--
-- ---------------------------------------------------------------------
-- 2. FREEZING AN ORDER (freeze_order)
-- ---------------------------------------------------------------------
-- The partner server prices the cart (api/_lib/pricing.js) and passes the
-- lines in. This function copies them onto order_items and then works the
-- order's totals out FROM THOSE ROWS, with the one rounding rule (05). The
-- invoice is later built from the same rows with the same expressions, so the
-- order, the invoice and the amount Razorpay is asked for cannot disagree. The
-- server compares its own totals with these and refuses on any difference.
--
-- One checkout per outlet at a time. The outlet's franchise_outlets row is
-- locked first, so a double-clicked Checkout queues behind the first one and
-- is handed the order it created rather than a second order. An earlier
-- pending order that has expired is marked expired here, because the partial
-- unique index in 05 still counts it as pending.
--
-- Checkout is refused while the franchise owes money on an invoice (spec
-- §8.2), and while it has no address on file, because no invoice can be
-- issued without one (07) and finding that out after the money is taken is
-- too late.
--
-- A checkout waits 15 minutes for its payment. The partner server passes the
-- time left to the Razorpay popup as its timeout.
--
-- ---------------------------------------------------------------------
-- 3. MARKING AN ORDER PAID (mark_order_paid)
-- ---------------------------------------------------------------------
-- The partner server calls this once it has the payment FROM RAZORPAY: from
-- a signed webhook, or by asking Razorpay's API. Never from the browser.
-- In one transaction it:
--
--   - marks the order paid (paid beats expired: an expired order still
--     takes its payment, spec §8.2 rule 1)
--   - takes the next invoice number and issues the goods invoice at full
--     value, lines copied from order_items (decision 0016)
--   - records the Razorpay payment
--   - applies the store credit chosen at checkout (decision 0013). If some
--     of it was spent after the order expired, what is left is an unpaid
--     remainder on the invoice, flagged for review (migration 17).
--   - empties the cart of what was bought (clear_cart_after_payment, 17)
--
-- IT IS SAFE TO CALL TWICE. Razorpay retries webhooks, and the popup and the
-- webhook both report the same payment. A payment already recorded returns
-- 'already_recorded' and changes nothing. razorpay_payment_id is unique
-- (07), and the order row is locked first, so two callers queue.
--
-- IT REFUSES rather than guesses: a payment of the wrong amount, a second
-- payment for an order already paid, an order that was cancelled. The money
-- has still moved, so the server records each refusal in
-- payment_exceptions for someone to resolve by hand.
--
-- An order that store credit covers completely has no Razorpay payment. It
-- is marked paid by the checkout itself, with a NULL payment id.
--
-- ---------------------------------------------------------------------
-- 4. CANCELLING A CHECKOUT (cancel_checkout)
-- ---------------------------------------------------------------------
-- Closing the popup leaves the cart locked until the order expires.
-- Cancelling ends the wait at once by expiring the order now. It is expiry,
-- not a new state, so a payment that was already on its way still lands
-- (paid beats expired).
--
-- ---------------------------------------------------------------------
-- 5. INVOICES CANNOT BE CHANGED
-- ---------------------------------------------------------------------
-- Decision 0016 said this was a rule and not yet a guard. Now it is a guard:
-- UPDATE and DELETE on fofo.invoices and fofo.invoice_items raise. A
-- correction is a credit note.
--
-- Requires: 05, 07, 08, 10, 17.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Who checked out
-- ---------------------------------------------------------------------

ALTER TABLE fofo.orders
  ADD COLUMN IF NOT EXISTS checked_out_by uuid REFERENCES fofo.franchise_users(id);

COMMENT ON COLUMN fofo.orders.checked_out_by IS
'The franchise user who pressed Checkout. Store credit applied when the order is paid is recorded as theirs.';

-- ---------------------------------------------------------------------
-- 2. Numbers
-- ---------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS fofo.order_number_seq;

CREATE TABLE IF NOT EXISTS fofo.document_counters (
  series         text NOT NULL,
  financial_year text NOT NULL,
  last_number    integer NOT NULL,
  PRIMARY KEY (series, financial_year),
  CONSTRAINT document_counters_series_check CHECK (series IN ('INV', 'CN')),
  CONSTRAINT document_counters_year_format CHECK (financial_year ~ '^\d{2}-\d{2}$'),
  CONSTRAINT document_counters_positive CHECK (last_number > 0)
);

ALTER TABLE fofo.document_counters ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fofo.document_counters IS
'The last invoice (INV) and credit-note (CN) number issued in each financial year. A counter row rather than a sequence, because a sequence skips a number when a transaction rolls back and GST numbers must be gapless. Only fofo.next_document_number writes here.';

CREATE OR REPLACE FUNCTION fofo.financial_year_label(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  -- The business day is the UTC date (decision 0002). April starts the year.
  SELECT to_char(fy, 'FM00') || '-' || to_char((fy + 1) % 100, 'FM00')
    FROM (SELECT (CASE WHEN extract(month FROM d) >= 4
                       THEN extract(year FROM d)
                       ELSE extract(year FROM d) - 1 END)::int % 100 AS fy
            FROM (SELECT (p_at AT TIME ZONE 'UTC')::date AS d) day) year;
$$;

COMMENT ON FUNCTION fofo.financial_year_label(timestamptz) IS
'The Indian financial year a moment falls in, as ''26-27''. Uses the UTC date, like every business day in this system (decision 0002).';

CREATE OR REPLACE FUNCTION fofo.next_document_number(p_series text, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_year   text := fofo.financial_year_label(p_at);
  v_number integer;
BEGIN
  -- Insert-or-increment takes the row lock: a second issuer waits here until
  -- the first commits or rolls back, and a rollback returns the number.
  INSERT INTO fofo.document_counters AS c (series, financial_year, last_number)
  VALUES (p_series, v_year, 1)
  ON CONFLICT (series, financial_year)
    DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO v_number;

  RETURN p_series || '/' || v_year || '/' || lpad(v_number::text, greatest(4, length(v_number::text)), '0');
END;
$$;

COMMENT ON FUNCTION fofo.next_document_number(text, timestamptz) IS
'The next gapless invoice or credit-note number for the financial year of p_at: INV/26-27/0001. Call it in the transaction that issues the document, so a rollback returns the number.';

CREATE OR REPLACE FUNCTION fofo.next_order_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
  SELECT 'FO-' || lpad(n::text, greatest(6, length(n::text)), '0')
    FROM (SELECT nextval('fofo.order_number_seq') AS n) s;
$$;

COMMENT ON FUNCTION fofo.next_order_number() IS
'The next order number, FO-000001. Taken at checkout; an abandoned checkout leaves a gap, which is harmless for orders (decision 0016).';

-- ---------------------------------------------------------------------
-- 3. What a franchise owes
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.franchise_dues(p_franchise_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fofo, public
AS $$
  SELECT COALESCE(SUM(GREATEST(owed, 0)), 0)
    FROM (SELECT i.total
                 - COALESCE((SELECT SUM(a.amount) FROM fofo.store_credit_applications a
                              WHERE a.invoice_id = i.id), 0)
                 - COALESCE((SELECT SUM(p.amount) FROM fofo.payments p
                              WHERE p.invoice_id = i.id AND p.status = 'captured'), 0) AS owed
            FROM fofo.invoices i
           WHERE i.franchise_id = p_franchise_id) invoice;
$$;

COMMENT ON FUNCTION fofo.franchise_dues(uuid) IS
'What the franchise still owes across its invoices: each invoice less the credit applied and the captured payments against it. Checkout is refused while this is above zero (spec §8.2).';

-- ---------------------------------------------------------------------
-- 4. Checkout: freeze the order
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.freeze_order(
  p_franchise_id      uuid,
  p_outlet_id         uuid,
  p_franchise_user_id uuid,
  p_lines             jsonb,
  p_store_credit      numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_kitchen   uuid;
  v_franchise fofo.franchises%ROWTYPE;
  v_existing  fofo.orders%ROWTYPE;
  v_order     fofo.orders%ROWTYPE;
  v_dues      numeric(14,2);
  v_subtotal  numeric(14,2);
  v_gst       numeric(14,2);
BEGIN
  -- Serialise checkouts for this outlet: a double-clicked Checkout waits
  -- here and then finds the order the first click made.
  PERFORM 1 FROM fofo.franchise_outlets
    WHERE franchise_id = p_franchise_id AND outlet_id = p_outlet_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outlet % is not one of this franchise''s outlets', p_outlet_id;
  END IF;

  PERFORM 1 FROM fofo.franchise_users
    WHERE id = p_franchise_user_id AND franchise_id = p_franchise_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Franchise user % cannot check out for this franchise', p_franchise_user_id;
  END IF;

  SELECT * INTO v_existing FROM fofo.orders
   WHERE outlet_id = p_outlet_id AND status = 'pending_payment'
     AND (expires_at IS NULL OR expires_at > now());
  IF FOUND THEN
    RETURN jsonb_build_object('order_id', v_existing.id, 'resumed', true);
  END IF;

  SELECT * INTO v_franchise FROM fofo.franchises WHERE id = p_franchise_id;
  IF NOT v_franchise.is_active OR v_franchise.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This franchise is not active';
  END IF;
  IF btrim(COALESCE(v_franchise.address, '')) = '' THEN
    RAISE EXCEPTION 'Your business address is missing, and an invoice cannot be issued without it. Ask Gastronomix to add it.';
  END IF;

  v_dues := fofo.franchise_dues(p_franchise_id);
  IF v_dues > 0 THEN
    RAISE EXCEPTION 'You have ₹% unpaid on earlier invoices. Pay it under Pending payments, then check out.', v_dues;
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'This cart is empty';
  END IF;

  SELECT cloud_kitchen_id INTO v_kitchen FROM public.outlets WHERE id = p_outlet_id;

  -- The unique index in 05 still counts an expired pending order as pending.
  UPDATE fofo.orders SET status = 'expired', updated_at = now()
   WHERE outlet_id = p_outlet_id AND status = 'pending_payment' AND expires_at <= now();

  INSERT INTO fofo.orders
    (order_number, franchise_id, outlet_id, cloud_kitchen_id, status, expires_at, checked_out_by)
  VALUES
    (fofo.next_order_number(), p_franchise_id, p_outlet_id, v_kitchen, 'pending_payment',
     now() + interval '15 minutes', p_franchise_user_id)
  RETURNING * INTO v_order;

  INSERT INTO fofo.order_items
    (order_id, raw_material_id, quantity_ordered, unit_base_cost, margin_percent,
     gst_percent, hsn_code, unit_price_ex_gst, unit_price_inc_gst)
  SELECT v_order.id, l.raw_material_id, l.quantity, l.unit_base_cost, l.margin_percent,
         l.gst_percent, NULLIF(btrim(l.hsn_code), ''), l.unit_price_ex_gst, l.unit_price_inc_gst
    FROM jsonb_to_recordset(p_lines) AS l(
           raw_material_id uuid, quantity numeric, unit_base_cost numeric,
           margin_percent numeric, gst_percent numeric, hsn_code text,
           unit_price_ex_gst numeric, unit_price_inc_gst numeric);

  -- The rounding rule (05), from the stored rows. mark_order_paid builds the
  -- invoice lines with these same expressions.
  SELECT COALESCE(SUM(round(quantity_ordered * unit_price_ex_gst, 2)), 0),
         COALESCE(SUM(round(round(quantity_ordered * unit_price_ex_gst, 2) * gst_percent / 100, 2)), 0)
    INTO v_subtotal, v_gst
    FROM fofo.order_items WHERE order_id = v_order.id;

  -- Totals and credit together: the credit CHECKs compare them, and the hold
  -- trigger (17) checks the credit against the franchise's balance.
  UPDATE fofo.orders
     SET subtotal = v_subtotal, gst_total = v_gst, grand_total = v_subtotal + v_gst,
         store_credit_to_apply = COALESCE(p_store_credit, 0), updated_at = now()
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => p_franchise_id,
    p_category                => 'fofo_money',
    p_action                  => 'checkout_started',
    p_actor_franchise_user_id => p_franchise_user_id,
    p_severity                => 'info',
    p_entity_type             => 'fofo_order',
    p_entity_id               => v_order.id,
    p_outlet_id               => p_outlet_id,
    p_cloud_kitchen_id        => v_kitchen,
    p_new_values              => jsonb_build_object(
      'order_number', v_order.order_number,
      'grand_total',  v_order.grand_total,
      'store_credit', v_order.store_credit_to_apply,
      'amount_paise', v_order.amount_paise,
      'lines',        jsonb_array_length(p_lines),
      'expires_at',   v_order.expires_at
    )
  );

  RETURN jsonb_build_object('order_id', v_order.id, 'resumed', false);
END;
$$;

COMMENT ON FUNCTION fofo.freeze_order(uuid, uuid, uuid, jsonb, numeric) IS
'Checkout. Freezes a priced cart into a pending order for one outlet, with totals worked out from the frozen lines, and holds the store credit chosen. Returns {order_id, resumed}; resumed is true when the outlet already had a live pending order, which is returned instead of a second one. Refuses while the franchise owes money or has no address. See 18-add-checkout-payment-and-invoice-numbering.sql.';

-- ---------------------------------------------------------------------
-- 5. Payment: mark the order paid and issue the invoice
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.mark_order_paid(
  p_order_id            uuid,
  p_razorpay_payment_id text,
  p_amount_paise        bigint,
  p_payment             jsonb,
  p_source              text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_order      fofo.orders%ROWTYPE;
  v_franchise  fofo.franchises%ROWTYPE;
  v_invoice_id uuid;
  v_number     text;
  v_taxable    numeric(14,2);
  v_gst        numeric(14,2);
  v_applied    numeric(14,2) := 0;
  v_now        timestamptz := now();
BEGIN
  IF p_source NOT IN ('webhook', 'api', 'store_credit') THEN
    RAISE EXCEPTION 'Unknown payment source %', p_source;
  END IF;

  SELECT * INTO v_order FROM fofo.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- The idempotency key. A retried webhook, or the popup and the webhook
  -- reporting the same payment, lands here and changes nothing.
  IF p_razorpay_payment_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM fofo.payments WHERE razorpay_payment_id = p_razorpay_payment_id) THEN
    RETURN jsonb_build_object('result', 'already_recorded', 'order_number', v_order.order_number);
  END IF;

  IF v_order.status NOT IN ('pending_payment', 'expired') THEN
    RAISE EXCEPTION 'Order % is %, so this payment cannot be applied to it', v_order.order_number, v_order.status;
  END IF;

  IF p_razorpay_payment_id IS NULL THEN
    IF v_order.amount_paise <> 0 THEN
      RAISE EXCEPTION 'Order % needs a payment of % paise', v_order.order_number, v_order.amount_paise;
    END IF;
  ELSIF p_amount_paise IS DISTINCT FROM v_order.amount_paise THEN
    RAISE EXCEPTION 'Payment % is for % paise, order % is % paise',
      p_razorpay_payment_id, p_amount_paise, v_order.order_number, v_order.amount_paise;
  END IF;

  UPDATE fofo.orders
     SET status = 'paid', placed_at = v_now, updated_at = v_now
   WHERE id = v_order.id;

  -- The goods invoice: at full value, whatever part credit pays (0013), and
  -- a copy of the order lines rather than a view onto them (0016).
  SELECT * INTO v_franchise FROM fofo.franchises WHERE id = v_order.franchise_id;

  SELECT COALESCE(SUM(round(quantity_ordered * unit_price_ex_gst, 2)), 0),
         COALESCE(SUM(round(round(quantity_ordered * unit_price_ex_gst, 2) * gst_percent / 100, 2)), 0)
    INTO v_taxable, v_gst
    FROM fofo.order_items WHERE order_id = v_order.id;

  -- Cannot differ, since freeze_order derived the totals from these rows the
  -- same way. If it ever does, stop: an invoice that disagrees with what was
  -- charged is worse than a payment waiting for a person.
  IF v_taxable + v_gst <> v_order.grand_total THEN
    RAISE EXCEPTION 'Order % lines add up to %, but its total is %',
      v_order.order_number, v_taxable + v_gst, v_order.grand_total;
  END IF;

  v_number := fofo.next_document_number('INV', v_now);

  INSERT INTO fofo.invoices
    (invoice_number, order_id, franchise_id, invoice_type, issued_at,
     buyer_name, buyer_gstin, buyer_address, buyer_city,
     taxable_value, gst_amount, total)
  VALUES
    (v_number, v_order.id, v_order.franchise_id, 'goods', v_now,
     v_franchise.name, NULLIF(btrim(v_franchise.gst_number), ''), v_franchise.address, v_franchise.city,
     v_taxable, v_gst, v_taxable + v_gst)
  RETURNING id INTO v_invoice_id;

  INSERT INTO fofo.invoice_items
    (invoice_id, description, hsn_code, quantity, unit_price_ex_gst, gst_percent,
     line_taxable_value, line_gst, line_total, sort_order)
  SELECT v_invoice_id, rm.name, oi.hsn_code, oi.quantity_ordered, oi.unit_price_ex_gst, oi.gst_percent,
         round(oi.quantity_ordered * oi.unit_price_ex_gst, 2),
         round(round(oi.quantity_ordered * oi.unit_price_ex_gst, 2) * oi.gst_percent / 100, 2),
         round(oi.quantity_ordered * oi.unit_price_ex_gst, 2)
           + round(round(oi.quantity_ordered * oi.unit_price_ex_gst, 2) * oi.gst_percent / 100, 2),
         row_number() OVER (ORDER BY rm.name, oi.id)
    FROM fofo.order_items oi
    JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
   WHERE oi.order_id = v_order.id;

  IF p_razorpay_payment_id IS NOT NULL THEN
    INSERT INTO fofo.payments
      (invoice_id, razorpay_order_id, razorpay_payment_id, amount, status,
       signature_verified_at, raw_webhook)
    VALUES
      (v_invoice_id, v_order.razorpay_order_id, p_razorpay_payment_id,
       p_amount_paise / 100.0, 'captured', v_now,
       jsonb_build_object('source', p_source, 'payment', p_payment));
  END IF;

  -- What is left owing after the payment is exactly the credit chosen at
  -- checkout, so apply_store_credit takes that much, or all that is left.
  IF v_order.store_credit_to_apply > 0 THEN
    v_applied := fofo.apply_store_credit(v_order.franchise_id, v_invoice_id, NULL, v_order.checked_out_by);
  END IF;

  PERFORM fofo.clear_cart_after_payment(v_order.id);

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => v_order.franchise_id,
    p_category         => 'fofo_money',
    p_action           => 'order_paid',
    p_severity         => CASE WHEN v_applied < v_order.store_credit_to_apply THEN 'critical' ELSE 'review' END,
    p_entity_type      => 'fofo_order',
    p_entity_id        => v_order.id,
    p_outlet_id        => v_order.outlet_id,
    p_cloud_kitchen_id => v_order.cloud_kitchen_id,
    p_new_values       => jsonb_build_object(
      'order_number',        v_order.order_number,
      'invoice_number',      v_number,
      'total',               v_taxable + v_gst,
      'paid_online',         COALESCE(p_amount_paise, 0) / 100.0,
      'razorpay_payment_id', p_razorpay_payment_id,
      'source',              p_source,
      'credit_chosen',       v_order.store_credit_to_apply,
      'credit_applied',      v_applied,
      -- Credit spent elsewhere after this order expired: now an unpaid
      -- remainder on the invoice (17).
      'credit_shortfall',    v_order.store_credit_to_apply - v_applied,
      'paid_after_expiry',   v_order.status = 'expired' OR v_order.expires_at <= v_now
    )
  );

  RETURN jsonb_build_object(
    'result',           'paid',
    'order_number',     v_order.order_number,
    'invoice_id',       v_invoice_id,
    'invoice_number',   v_number,
    'credit_applied',   v_applied,
    'credit_shortfall', v_order.store_credit_to_apply - v_applied
  );
END;
$$;

COMMENT ON FUNCTION fofo.mark_order_paid(uuid, text, bigint, jsonb, text) IS
'A confirmed payment: marks the order paid (even if it expired), issues the goods invoice with the next gapless number, records the Razorpay payment, applies the store credit chosen at checkout, and empties the cart. A payment already recorded returns already_recorded and changes nothing. p_razorpay_payment_id NULL means store credit covered the order. The caller must have the payment from Razorpay, never from the browser.';

-- ---------------------------------------------------------------------
-- 6. Cancelling a checkout
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.cancel_checkout(
  p_franchise_id      uuid,
  p_outlet_id         uuid,
  p_franchise_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_order fofo.orders%ROWTYPE;
BEGIN
  UPDATE fofo.orders
     SET status = 'expired', expires_at = LEAST(expires_at, now()), updated_at = now()
   WHERE franchise_id = p_franchise_id AND outlet_id = p_outlet_id
     AND status = 'pending_payment' AND (expires_at IS NULL OR expires_at > now())
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => p_franchise_id,
    p_category                => 'fofo_money',
    p_action                  => 'checkout_cancelled',
    p_actor_franchise_user_id => p_franchise_user_id,
    p_severity                => 'info',
    p_entity_type             => 'fofo_order',
    p_entity_id               => v_order.id,
    p_outlet_id               => p_outlet_id,
    p_new_values              => jsonb_build_object('order_number', v_order.order_number)
  );

  RETURN v_order.order_number;
END;
$$;

COMMENT ON FUNCTION fofo.cancel_checkout(uuid, uuid, uuid) IS
'Ends an outlet''s live checkout now, unlocking its cart and releasing its credit hold. It expires the order rather than cancelling it, so a payment already on its way still marks it paid. Returns the order number, or NULL when there was nothing to cancel.';

-- ---------------------------------------------------------------------
-- 7. Payments that did not pay an order
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.payment_exceptions (
  id                  uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  order_id            uuid REFERENCES fofo.orders(id),
  razorpay_order_id   text,
  razorpay_payment_id text,
  reasons             text[] NOT NULL,
  payment             jsonb,
  source              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES public.users(id),
  resolution          text,
  CONSTRAINT payment_exceptions_source_check CHECK (source IN ('webhook', 'api')),
  CONSTRAINT payment_exceptions_has_reason CHECK (cardinality(reasons) > 0)
);

-- One row per payment: a retried webhook must not pile up copies.
CREATE UNIQUE INDEX IF NOT EXISTS payment_exceptions_one_per_payment
  ON fofo.payment_exceptions (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fofo_payment_exceptions_open
  ON fofo.payment_exceptions (created_at)
  WHERE resolved_at IS NULL;

ALTER TABLE fofo.payment_exceptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fofo.payment_exceptions IS
'Money Razorpay took that did not pay an order: the wrong amount, a second payment for an order already paid, or an order that cannot take it. The money has moved, so the payment is kept here for a person to refund or apply by hand, never dropped and never guessed at.';

CREATE OR REPLACE FUNCTION fofo.record_payment_exception(
  p_order_id            uuid,
  p_razorpay_order_id   text,
  p_razorpay_payment_id text,
  p_reasons             text[],
  p_payment             jsonb,
  p_source              text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_order fofo.orders%ROWTYPE;
  v_id    uuid;
BEGIN
  INSERT INTO fofo.payment_exceptions
    (order_id, razorpay_order_id, razorpay_payment_id, reasons, payment, source)
  VALUES
    (p_order_id, p_razorpay_order_id, p_razorpay_payment_id, p_reasons, p_payment, p_source)
  ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  -- Already recorded: a retry, not news.
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM fofo.orders WHERE id = p_order_id;
  IF FOUND THEN
    PERFORM fofo.log_fofo_audit_event(
      p_franchise_id => v_order.franchise_id,
      p_category     => 'fofo_money',
      p_action       => 'payment_exception',
      p_severity     => 'critical',
      p_entity_type  => 'fofo_order',
      p_entity_id    => v_order.id,
      p_outlet_id    => v_order.outlet_id,
      p_new_values   => jsonb_build_object(
        'order_number',        v_order.order_number,
        'razorpay_payment_id', p_razorpay_payment_id,
        'reasons',             to_jsonb(p_reasons)
      )
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION fofo.record_payment_exception(uuid, text, text, text[], jsonb, text) IS
'Keeps a Razorpay payment that did not pay its order, for someone to resolve by hand, and raises a critical audit event. Once per payment: a repeat is ignored.';

-- ---------------------------------------------------------------------
-- 8. An invoice is never edited (decision 0016)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.refuse_invoice_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fofo, public
AS $$
BEGIN
  RAISE EXCEPTION 'Invoices are never changed or deleted. Issue a credit note instead (decision 0016).'
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION fofo.refuse_invoice_change() IS
'Refuses UPDATE and DELETE on invoices and their lines. A wrong invoice is corrected by a credit note (decision 0016).';

DROP TRIGGER IF EXISTS trg_invoices_never_change ON fofo.invoices;
CREATE TRIGGER trg_invoices_never_change
  BEFORE UPDATE OR DELETE ON fofo.invoices
  FOR EACH ROW EXECUTE FUNCTION fofo.refuse_invoice_change();

DROP TRIGGER IF EXISTS trg_invoice_items_never_change ON fofo.invoice_items;
CREATE TRIGGER trg_invoice_items_never_change
  BEFORE UPDATE OR DELETE ON fofo.invoice_items
  FOR EACH ROW EXECUTE FUNCTION fofo.refuse_invoice_change();

-- ---------------------------------------------------------------------
-- 9. Grants (decision 0004): revoke by name, then check proacl
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION fofo.financial_year_label(timestamptz)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.next_document_number(text, timestamptz)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.next_order_number()                            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.franchise_dues(uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.freeze_order(uuid, uuid, uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.mark_order_paid(uuid, text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.cancel_checkout(uuid, uuid, uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.record_payment_exception(uuid, text, text, text[], jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.refuse_invoice_change()                        FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION fofo.financial_year_label(timestamptz)              TO service_role;
GRANT EXECUTE ON FUNCTION fofo.franchise_dues(uuid)                           TO service_role;
GRANT EXECUTE ON FUNCTION fofo.freeze_order(uuid, uuid, uuid, jsonb, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION fofo.mark_order_paid(uuid, text, bigint, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION fofo.cancel_checkout(uuid, uuid, uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION fofo.record_payment_exception(uuid, text, text, text[], jsonb, text) TO service_role;

-- Numbers are only ever taken by the functions above, never directly: a
-- number taken outside an issuing transaction is a gap.
REVOKE ALL ON TABLE fofo.document_counters     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE fofo.order_number_seq   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE fofo.payment_exceptions    FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- New objects:
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'fofo' AND table_name = 'orders' AND column_name = 'checked_out_by';
-- SELECT tablename FROM pg_tables WHERE schemaname = 'fofo'
--    AND tablename IN ('document_counters', 'payment_exceptions');          -- 2 rows
-- SELECT tgname FROM pg_trigger
--  WHERE tgname IN ('trg_invoices_never_change', 'trg_invoice_items_never_change');  -- 2 rows
--
-- Grants. service_role (and the owner) only on the six callable functions;
-- no anon or authenticated anywhere; nobody but the owner on
-- next_document_number, next_order_number and refuse_invoice_change:
--
-- SELECT proname, proacl FROM pg_proc
--  WHERE pronamespace = 'fofo'::regnamespace
--    AND proname IN ('financial_year_label', 'next_document_number', 'next_order_number',
--                    'franchise_dues', 'freeze_order', 'mark_order_paid', 'cancel_checkout',
--                    'record_payment_exception', 'refuse_invoice_change')
--  ORDER BY proname;
--
-- Financial years, UTC dates (decision 0002):
--
-- SELECT fofo.financial_year_label('2026-03-31 23:59+00'),   -- 25-26
--        fofo.financial_year_label('2026-04-01 00:00+00'),   -- 26-27
--        fofo.financial_year_label('2026-03-31 20:00+00'),   -- 25-26 (01:30 IST on 1 April)
--        fofo.financial_year_label('2099-12-31 00:00+00');   -- 99-00
--
-- Nothing is numbered yet, and the counters are empty:
--
-- SELECT * FROM fofo.document_counters;                       -- 0 rows
--
-- The full flow (freeze, pay, invoice, idempotent repeat, the invoice
-- guard) needs a priced cart and is exercised through the partner app in
-- Razorpay test mode. After a test payment:
--
-- SELECT o.order_number, o.status, o.grand_total, o.store_credit_to_apply, o.amount_paise,
--        i.invoice_number, i.total, p.razorpay_payment_id, p.amount
--   FROM fofo.orders o
--   LEFT JOIN fofo.invoices i ON i.order_id = o.id
--   LEFT JOIN fofo.payments p ON p.invoice_id = i.id
--  ORDER BY o.created_at DESC LIMIT 5;
--
-- The guard, in a transaction you roll back — both must FAIL:
--
-- BEGIN;
-- UPDATE fofo.invoices SET total = total WHERE true;
-- ROLLBACK;
-- BEGIN;
-- DELETE FROM fofo.invoice_items WHERE true;
-- ROLLBACK;

-- =====================================================================
-- Rollback
-- =====================================================================
-- Only while no order has been paid through it: invoices numbered by it
-- must keep their numbers.
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_invoice_items_never_change ON fofo.invoice_items;
-- DROP TRIGGER IF EXISTS trg_invoices_never_change ON fofo.invoices;
-- DROP FUNCTION IF EXISTS fofo.refuse_invoice_change();
-- DROP FUNCTION IF EXISTS fofo.record_payment_exception(uuid, text, text, text[], jsonb, text);
-- DROP TABLE IF EXISTS fofo.payment_exceptions;
-- DROP FUNCTION IF EXISTS fofo.cancel_checkout(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.mark_order_paid(uuid, text, bigint, jsonb, text);
-- DROP FUNCTION IF EXISTS fofo.freeze_order(uuid, uuid, uuid, jsonb, numeric);
-- DROP FUNCTION IF EXISTS fofo.franchise_dues(uuid);
-- DROP FUNCTION IF EXISTS fofo.next_order_number();
-- DROP FUNCTION IF EXISTS fofo.next_document_number(text, timestamptz);
-- DROP FUNCTION IF EXISTS fofo.financial_year_label(timestamptz);
-- DROP TABLE IF EXISTS fofo.document_counters;
-- DROP SEQUENCE IF EXISTS fofo.order_number_seq;
-- ALTER TABLE fofo.orders DROP COLUMN IF EXISTS checked_out_by;
-- COMMIT;
