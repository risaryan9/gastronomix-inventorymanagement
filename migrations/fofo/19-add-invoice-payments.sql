-- =====================================================================
-- Paying an invoice that has money due
--
-- Until now the only payment was the one at checkout, which creates the
-- goods invoice as it lands (18). An invoice that already exists and is
-- owed on could not be paid at all: a logistics invoice raised after
-- packing (spec §8.4), or the remainder of a goods invoice whose chosen
-- credit had been spent by the time the money arrived (17). Checkout is
-- refused while anything is owed (fofo.franchise_dues, 18), so an unpaid
-- invoice also stopped the franchise ordering again.
--
-- WHAT CHANGES.
--
--   functions  + invoice_outstanding     what one invoice is still owed
--              + begin_invoice_payment   apply credit, say what is left
--              + open_invoice_payment    record the Razorpay order for it
--              + mark_invoice_paid       a confirmed payment
--              ~ apply_store_credit      replaced: takes an optional limit
--   index      + payments by Razorpay order id
--
-- No new table. fofo.payments has had status 'created' since 07, for
-- exactly this: a row that says "a Razorpay order was opened for this
-- invoice, and nobody has paid it yet".
--
-- ---------------------------------------------------------------------
-- 1. HOW AN INVOICE IS PAID
-- ---------------------------------------------------------------------
-- The partner server, in one transaction:
--
--   begin_invoice_payment   locks the invoice, applies store credit if the
--                           franchise asked for it, and returns what is
--                           still owed. Nothing owed: done, no Razorpay.
--   (Razorpay)              the server creates a Razorpay order for exactly
--                           what is owed
--   open_invoice_payment    records that order as a payment attempt,
--                           status 'created'
--
-- and later, once it has the payment FROM RAZORPAY (a signed webhook, or
-- by asking Razorpay's API; never from the browser):
--
--   mark_invoice_paid       turns the attempt into a captured payment
--
-- An attempt is found by its Razorpay order id. That is also how the
-- webhook tells an invoice payment from a checkout: a checkout's Razorpay
-- order id is on fofo.orders, an invoice payment's is only here.
--
-- ---------------------------------------------------------------------
-- 2. STORE CREDIT IS SPENT AT ONCE, NOT HELD
-- ---------------------------------------------------------------------
-- At checkout the credit chosen is HELD until the money lands, because
-- the invoice it will settle does not exist yet (17, decision 0020). Here
-- the invoice exists, so the credit is applied in begin_invoice_payment,
-- before Razorpay is opened. If the franchise then closes the payment
-- window, the credit stays spent and the invoice is owed that much less.
-- Nothing is lost: credit cannot be cashed out and the invoice was owed
-- anyway (decision 0013). The alternative, holding it, needs a second
-- kind of hold and a way to release it, to protect nothing.
--
-- What may be spent is the AVAILABLE credit: the balance less what live
-- checkouts are holding (store_credit_available, 17). Credit a checkout
-- is waiting on is not this invoice's to take.
--
-- Razorpay cannot collect less than Rs 1 (17). So credit is never applied
-- in a way that leaves between 1 and 99 paise owing: it stops Rs 1 short
-- instead. An invoice owed less than Rs 1 that credit cannot finish is
-- refused with a message, for a person to settle.
--
-- apply_store_credit is REPLACED to take that limit (p_limit). 10 is
-- applied and stays as it was; the four-argument function is dropped here
-- and the five-argument one, whose last argument is optional, takes every
-- existing call. mark_order_paid (18) calls it with four and is unchanged.
--
-- ---------------------------------------------------------------------
-- 3. A PAYMENT MUST FIT WHAT IS OWED (mark_invoice_paid)
-- ---------------------------------------------------------------------
-- IT IS SAFE TO CALL TWICE, like mark_order_paid: a payment already
-- recorded returns 'already_recorded'. The invoice row is locked first,
-- so two callers queue.
--
-- IT REFUSES rather than guesses:
--   - a payment whose amount is not the attempt's amount
--   - a payment for more than the invoice is still owed. This is what a
--     second payment looks like: two people at the franchise each opened a
--     payment window, or credit was applied in between. The first to land
--     settles the invoice and the second no longer fits.
--   - a second payment on a Razorpay order that already paid
-- The money has moved in every one of these, so the server records the
-- refusal in fofo.payment_exceptions (18) for someone to refund or apply.
--
-- A payment for LESS than is owed is accepted. It cannot arise from this
-- flow, which always asks for the whole remainder, but it is money
-- correctly paid against a bill, and the rest stays due.
--
-- An invoice is never changed by any of this (decision 0016). What it is
-- owed is worked out from payments and credit on every read (0013).
--
-- Requires: 07, 08, 10, 17, 18.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. What one invoice is still owed
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.invoice_outstanding(p_invoice_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = fofo, public
AS $$
  -- Captured payments only: a 'created' row is a payment window someone may
  -- yet close. The same sum as fofo.franchise_dues (18), for one invoice.
  SELECT i.total
         - COALESCE((SELECT SUM(a.amount) FROM fofo.store_credit_applications a
                      WHERE a.invoice_id = i.id), 0)
         - COALESCE((SELECT SUM(p.amount) FROM fofo.payments p
                      WHERE p.invoice_id = i.id AND p.status = 'captured'), 0)
    FROM fofo.invoices i
   WHERE i.id = p_invoice_id;
$$;

COMMENT ON FUNCTION fofo.invoice_outstanding(uuid) IS
'What an invoice is still owed: its total less the credit applied and the captured payments against it. Worked out on every read, never stored (decision 0013). Lock the invoice row first when acting on the answer.';

-- ---------------------------------------------------------------------
-- 2. apply_store_credit, now with an optional limit
-- ---------------------------------------------------------------------
-- The body is 10's, with p_limit added. Nothing else is changed.

DROP FUNCTION IF EXISTS fofo.apply_store_credit(uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION fofo.apply_store_credit(
  p_franchise_id             uuid,
  p_invoice_id               uuid,
  p_acting_user_id           uuid DEFAULT NULL,
  p_acting_franchise_user_id uuid DEFAULT NULL,
  p_limit                    numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_invoice     fofo.invoices%ROWTYPE;
  v_outstanding numeric(14,2);
  v_to_apply    numeric(14,2);
  v_applied     numeric(14,2) := 0;
  v_take        numeric(14,2);
  v_credit      record;
BEGIN
  IF p_acting_user_id IS NOT NULL AND p_acting_franchise_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Store credit is applied by staff or by a franchise user, not both';
  END IF;

  IF p_limit IS NOT NULL AND p_limit < 0 THEN
    RAISE EXCEPTION 'A store credit limit cannot be negative (got %)', p_limit;
  END IF;

  -- LOCK ORDER: invoice first, then credits. The trigger on
  -- store_credit_applications takes them in the same order; two paths
  -- locking the same rows in opposite orders deadlock instead of queueing.
  SELECT * INTO v_invoice
    FROM fofo.invoices WHERE id = p_invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  -- Belt and braces against a caller that got its franchise from the
  -- request instead of the session. The trigger checks this too.
  IF v_invoice.franchise_id <> p_franchise_id THEN
    RAISE EXCEPTION 'Invoice % does not belong to franchise %',
      p_invoice_id, p_franchise_id;
  END IF;

  -- What is actually still owed: the bill, less credit already applied,
  -- less money already taken for it.
  v_outstanding := fofo.invoice_outstanding(p_invoice_id);

  -- Nothing owed. This is also where a double-clicked redeem button lands:
  -- the second click finds the invoice settled and applies nothing, so it
  -- is a no-op rather than an error or a second spend.
  IF v_outstanding <= 0 THEN
    RETURN 0;
  END IF;

  -- No limit: as much as the invoice can absorb. With one: no more than it.
  v_to_apply := LEAST(v_outstanding, COALESCE(p_limit, v_outstanding));

  FOR v_credit IN
    SELECT c.id,
           c.amount - COALESCE((SELECT SUM(a.amount)
                                  FROM fofo.store_credit_applications a
                                 WHERE a.credit_id = c.id), 0) AS remaining
      FROM fofo.store_credits c
     WHERE c.franchise_id = p_franchise_id
     ORDER BY c.created_at, c.id
       FOR UPDATE OF c
  LOOP
    EXIT     WHEN v_to_apply <= 0;
    CONTINUE WHEN v_credit.remaining <= 0;   -- fully spent already

    v_take := LEAST(v_credit.remaining, v_to_apply);

    -- The trigger re-reads both totals under lock. If a concurrent
    -- transaction spent this credit between the row being read here and
    -- being locked, it raises and the whole redemption rolls back — the
    -- caller retries and gets a correct answer. An error is the right
    -- outcome there; a silently smaller application would not be.
    INSERT INTO fofo.store_credit_applications
      (credit_id, invoice_id, amount, applied_by, applied_by_franchise_user_id)
    VALUES (v_credit.id, p_invoice_id, v_take, p_acting_user_id, p_acting_franchise_user_id);

    v_to_apply    := v_to_apply - v_take;
    v_outstanding := v_outstanding - v_take;
    v_applied     := v_applied + v_take;
  END LOOP;

  IF v_applied > 0 THEN
    PERFORM fofo.log_fofo_audit_event(
      p_franchise_id            => p_franchise_id,
      p_category                => 'fofo_money',
      p_action                  => 'store_credit_applied',
      p_actor_user_id           => p_acting_user_id,
      p_actor_franchise_user_id => p_acting_franchise_user_id,
      p_severity                => 'review',
      p_entity_type             => 'fofo_invoice',
      p_entity_id               => p_invoice_id,
      p_new_values              => jsonb_build_object(
        'invoice_number', v_invoice.invoice_number,
        'amount_applied', v_applied,
        'still_owed',     v_outstanding,
        'balance_after',  fofo.store_credit_balance(p_franchise_id)
      )
    );
  END IF;

  RETURN v_applied;
END;
$$;

COMMENT ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid, numeric) IS
'Spends store credit against an invoice, oldest credit first, and returns how much was applied. With no p_limit, as much as the invoice can absorb; with one, no more than that. Never touches the invoice: credit is a payment, not a discount (decision 0013). Locks the invoice then the credits, the same order as the trigger on store_credit_applications.';

-- ---------------------------------------------------------------------
-- 3. Start paying an invoice
-- ---------------------------------------------------------------------

-- An attempt is looked up by its Razorpay order id on every confirm and
-- every webhook.
CREATE INDEX IF NOT EXISTS idx_fofo_payments_razorpay_order
  ON fofo.payments (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fofo.begin_invoice_payment(
  p_franchise_id      uuid,
  p_invoice_id        uuid,
  p_franchise_user_id uuid,
  p_redeem_credit     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_invoice     fofo.invoices%ROWTYPE;
  v_outstanding numeric(14,2);
  v_credit      numeric(14,2) := 0;
  v_applied     numeric(14,2) := 0;
  v_attempt     text;
BEGIN
  -- Held to the end of the caller's transaction, which also covers creating
  -- the Razorpay order: a second person paying the same invoice waits here,
  -- then finds the attempt this one recorded.
  SELECT * INTO v_invoice
    FROM fofo.invoices
   WHERE id = p_invoice_id AND franchise_id = p_franchise_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  v_outstanding := fofo.invoice_outstanding(v_invoice.id);

  IF v_outstanding > 0 AND p_redeem_credit THEN
    v_credit := LEAST(GREATEST(fofo.store_credit_available(p_franchise_id), 0), v_outstanding);
    -- Never leave Razorpay between 1 and 99 paise to collect: stop Rs 1 short.
    IF v_outstanding - v_credit > 0 AND v_outstanding - v_credit < 1 THEN
      v_credit := GREATEST(v_outstanding - 1, 0);
    END IF;
    IF v_credit > 0 THEN
      v_applied := fofo.apply_store_credit(p_franchise_id, v_invoice.id, NULL, p_franchise_user_id, v_credit);
      v_outstanding := fofo.invoice_outstanding(v_invoice.id);
    END IF;
  END IF;

  IF v_outstanding <= 0 THEN
    RETURN jsonb_build_object(
      'result',         'settled',
      'invoice_number', v_invoice.invoice_number,
      'credit_applied', v_applied
    );
  END IF;

  IF v_outstanding < 1 THEN
    RAISE EXCEPTION 'Invoice % has % left to pay, which is less than can be collected online. Please contact Gastronomix to settle it.',
      v_invoice.invoice_number, v_outstanding;
  END IF;

  -- A Razorpay order already opened for exactly this amount is paid again
  -- rather than opening another: a double click, a reopened window. Older
  -- than a day, or for a different amount, and a new one is opened.
  SELECT p.razorpay_order_id INTO v_attempt
    FROM fofo.payments p
   WHERE p.invoice_id = v_invoice.id
     AND p.status = 'created'
     AND p.razorpay_order_id IS NOT NULL
     AND p.amount = v_outstanding
     AND p.created_at > now() - interval '1 day'
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'result',            'due',
    'invoice_number',    v_invoice.invoice_number,
    'credit_applied',    v_applied,
    'outstanding',       v_outstanding,
    'amount_paise',      (v_outstanding * 100)::bigint,
    'razorpay_order_id', v_attempt
  );
END;
$$;

COMMENT ON FUNCTION fofo.begin_invoice_payment(uuid, uuid, uuid, boolean) IS
'Starts paying an invoice. Locks it, applies the franchise''s available store credit if asked (at once, not held), and returns {result: settled} when nothing is left or {result: due, amount_paise, razorpay_order_id} when Razorpay must collect the rest. razorpay_order_id is an attempt already open for that amount, or NULL when the caller must open one. See 19-add-invoice-payments.sql.';

CREATE OR REPLACE FUNCTION fofo.open_invoice_payment(
  p_franchise_id      uuid,
  p_invoice_id        uuid,
  p_franchise_user_id uuid,
  p_razorpay_order_id text,
  p_amount_paise      bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_invoice     fofo.invoices%ROWTYPE;
  v_outstanding numeric(14,2);
  v_id          uuid;
BEGIN
  IF p_razorpay_order_id IS NULL OR btrim(p_razorpay_order_id) = '' THEN
    RAISE EXCEPTION 'A payment attempt needs its Razorpay order id';
  END IF;

  SELECT * INTO v_invoice
    FROM fofo.invoices
   WHERE id = p_invoice_id AND franchise_id = p_franchise_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  -- The Razorpay order must be for exactly what is owed now. The caller got
  -- that figure from begin_invoice_payment in this same transaction, so a
  -- difference is a bug, and charging the wrong amount is worse than failing.
  v_outstanding := fofo.invoice_outstanding(v_invoice.id);
  IF p_amount_paise IS DISTINCT FROM (v_outstanding * 100)::bigint THEN
    RAISE EXCEPTION 'Invoice % has % left to pay, but the Razorpay order is for % paise',
      v_invoice.invoice_number, v_outstanding, p_amount_paise;
  END IF;

  INSERT INTO fofo.payments (invoice_id, razorpay_order_id, amount, status)
  VALUES (v_invoice.id, p_razorpay_order_id, v_outstanding, 'created')
  RETURNING id INTO v_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => p_franchise_id,
    p_category                => 'fofo_money',
    p_action                  => 'invoice_payment_started',
    p_actor_franchise_user_id => p_franchise_user_id,
    p_severity                => 'info',
    p_entity_type             => 'fofo_invoice',
    p_entity_id               => v_invoice.id,
    p_new_values              => jsonb_build_object(
      'invoice_number',    v_invoice.invoice_number,
      'amount',            v_outstanding,
      'razorpay_order_id', p_razorpay_order_id
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fofo.open_invoice_payment(uuid, uuid, uuid, text, bigint) IS
'Records the Razorpay order opened to pay an invoice, as a payment with status created. The amount must be exactly what the invoice is still owed. Call it in the transaction that called begin_invoice_payment.';

-- ---------------------------------------------------------------------
-- 4. A confirmed payment for an invoice
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.mark_invoice_paid(
  p_razorpay_order_id   text,
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
  v_invoice_id  uuid;
  v_invoice     fofo.invoices%ROWTYPE;
  v_attempt     fofo.payments%ROWTYPE;
  v_order       fofo.orders%ROWTYPE;
  v_outstanding numeric(14,2);
  v_now         timestamptz := now();
BEGIN
  IF p_source NOT IN ('webhook', 'api') THEN
    RAISE EXCEPTION 'Unknown payment source %', p_source;
  END IF;
  IF p_razorpay_payment_id IS NULL OR p_razorpay_order_id IS NULL THEN
    RAISE EXCEPTION 'An invoice payment needs its Razorpay order and payment ids';
  END IF;

  -- Which invoice, read without a lock, so the invoice can be locked FIRST:
  -- the same order as every other path that locks an invoice.
  SELECT p.invoice_id INTO v_invoice_id
    FROM fofo.payments p
   WHERE p.razorpay_order_id = p_razorpay_order_id
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No invoice payment was started for Razorpay order %', p_razorpay_order_id;
  END IF;

  SELECT * INTO v_invoice FROM fofo.invoices WHERE id = v_invoice_id FOR UPDATE;

  -- The idempotency key. A retried webhook, or the payment window and the
  -- webhook reporting the same payment, lands here and changes nothing.
  IF EXISTS (SELECT 1 FROM fofo.payments WHERE razorpay_payment_id = p_razorpay_payment_id) THEN
    RETURN jsonb_build_object('result', 'already_recorded', 'invoice_number', v_invoice.invoice_number);
  END IF;

  SELECT * INTO v_attempt
    FROM fofo.payments p
   WHERE p.razorpay_order_id = p_razorpay_order_id
     AND p.invoice_id = v_invoice.id
     AND p.status <> 'captured'
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT 1
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Razorpay order % has already paid invoice %, so payment % cannot be applied to it',
      p_razorpay_order_id, v_invoice.invoice_number, p_razorpay_payment_id;
  END IF;

  IF p_amount_paise IS DISTINCT FROM (v_attempt.amount * 100)::bigint THEN
    RAISE EXCEPTION 'Payment % is for % paise, but invoice % was to be paid % paise',
      p_razorpay_payment_id, p_amount_paise, v_invoice.invoice_number, (v_attempt.amount * 100)::bigint;
  END IF;

  v_outstanding := fofo.invoice_outstanding(v_invoice.id);
  IF v_attempt.amount > v_outstanding THEN
    RAISE EXCEPTION 'Invoice % has % left to pay, but payment % is for %',
      v_invoice.invoice_number, GREATEST(v_outstanding, 0), p_razorpay_payment_id, v_attempt.amount;
  END IF;

  UPDATE fofo.payments
     SET status = 'captured',
         razorpay_payment_id = p_razorpay_payment_id,
         signature_verified_at = v_now,
         raw_webhook = jsonb_build_object('source', p_source, 'payment', p_payment)
   WHERE id = v_attempt.id;

  SELECT * INTO v_order FROM fofo.orders WHERE id = v_invoice.order_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => v_invoice.franchise_id,
    p_category         => 'fofo_money',
    p_action           => 'invoice_paid',
    p_severity         => 'review',
    p_entity_type      => 'fofo_invoice',
    p_entity_id        => v_invoice.id,
    p_outlet_id        => v_order.outlet_id,
    p_cloud_kitchen_id => v_order.cloud_kitchen_id,
    p_new_values       => jsonb_build_object(
      'invoice_number',      v_invoice.invoice_number,
      'invoice_type',        v_invoice.invoice_type,
      'order_number',        v_order.order_number,
      'paid_online',         v_attempt.amount,
      'razorpay_payment_id', p_razorpay_payment_id,
      'source',              p_source,
      'still_owed',          v_outstanding - v_attempt.amount
    )
  );

  RETURN jsonb_build_object(
    'result',         'paid',
    'invoice_id',     v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'still_owed',     v_outstanding - v_attempt.amount
  );
END;
$$;

COMMENT ON FUNCTION fofo.mark_invoice_paid(text, text, bigint, jsonb, text) IS
'A confirmed payment for an existing invoice: turns the attempt opened for that Razorpay order into a captured payment. A payment already recorded returns already_recorded and changes nothing. Refuses a wrong amount, a payment for more than the invoice is still owed, and a second payment on the same Razorpay order; the caller records those in payment_exceptions. The caller must have the payment from Razorpay, never from the browser.';

-- ---------------------------------------------------------------------
-- 5. Grants (decision 0004): revoke by name, then check proacl
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION fofo.invoice_outstanding(uuid)                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid, numeric)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.begin_invoice_payment(uuid, uuid, uuid, boolean)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.open_invoice_payment(uuid, uuid, uuid, text, bigint)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.mark_invoice_paid(text, text, bigint, jsonb, text)       FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fofo.invoice_outstanding(uuid)                             TO service_role;
GRANT EXECUTE ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid, numeric)   TO service_role;
GRANT EXECUTE ON FUNCTION fofo.begin_invoice_payment(uuid, uuid, uuid, boolean)      TO service_role;
GRANT EXECUTE ON FUNCTION fofo.open_invoice_payment(uuid, uuid, uuid, text, bigint)  TO service_role;
GRANT EXECUTE ON FUNCTION fofo.mark_invoice_paid(text, text, bigint, jsonb, text)    TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The old apply_store_credit is gone and the new one is the only one:
--
-- SELECT p.oid::regprocedure FROM pg_proc p
--  WHERE p.pronamespace = 'fofo'::regnamespace AND p.proname = 'apply_store_credit';
--   -- one row: fofo.apply_store_credit(uuid,uuid,uuid,uuid,numeric)
--
-- Grants. service_role (and the owner) only; no anon or authenticated:
--
-- SELECT proname, proacl FROM pg_proc
--  WHERE pronamespace = 'fofo'::regnamespace
--    AND proname IN ('invoice_outstanding', 'apply_store_credit', 'begin_invoice_payment',
--                    'open_invoice_payment', 'mark_invoice_paid')
--  ORDER BY proname;
--
-- What each invoice is owed agrees with what the franchise is owed in total:
--
-- SELECT i.franchise_id, SUM(GREATEST(fofo.invoice_outstanding(i.id), 0)) AS by_invoice,
--        fofo.franchise_dues(i.franchise_id) AS dues
--   FROM fofo.invoices i GROUP BY i.franchise_id;                -- equal on every row
--
-- The full flow needs an invoice with money due, which today means a
-- logistics invoice. After paying one through the partner app in Razorpay
-- test mode:
--
-- SELECT i.invoice_number, i.total, p.status, p.amount, p.razorpay_order_id, p.razorpay_payment_id,
--        fofo.invoice_outstanding(i.id) AS still_owed
--   FROM fofo.invoices i JOIN fofo.payments p ON p.invoice_id = i.id
--  ORDER BY p.created_at DESC LIMIT 5;

-- =====================================================================
-- Rollback
-- =====================================================================
-- Only while no invoice has been paid through it. Restores 10's
-- apply_store_credit by re-running that section of 10 afterwards.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS fofo.mark_invoice_paid(text, text, bigint, jsonb, text);
-- DROP FUNCTION IF EXISTS fofo.open_invoice_payment(uuid, uuid, uuid, text, bigint);
-- DROP FUNCTION IF EXISTS fofo.begin_invoice_payment(uuid, uuid, uuid, boolean);
-- DROP FUNCTION IF EXISTS fofo.apply_store_credit(uuid, uuid, uuid, uuid, numeric);
-- DROP FUNCTION IF EXISTS fofo.invoice_outstanding(uuid);
-- DROP INDEX IF EXISTS fofo.idx_fofo_payments_razorpay_order;
-- COMMIT;
