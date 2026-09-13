-- =====================================================================
-- Store credit: the balance, and applying it to an invoice
--
-- Two functions over fofo.store_credits and
-- fofo.store_credit_applications (07-create-fofo-money-tables.sql):
--
--   store_credit_balance(franchise)            what is left, in total
--   apply_store_credit(franchise, invoice, by) spend as much of it as the
--                                              invoice can absorb
--
-- WHY FIFO. Credit never expires, so oldest-first changes nothing about
-- the money — every rupee is worth a rupee whichever credit it came from.
-- It is chosen because it is deterministic and explainable: a franchise
-- asking "what happened to CN-0007" gets the same answer today and next
-- year, and two concurrent redemptions walk the credits in the same order
-- and therefore queue instead of deadlocking. ORDER BY created_at, id —
-- created_at alone is not unique, and an unstable sort would make which
-- credit got spent depend on the query plan (decision 0009).
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT API CODE. The rule it enforces
-- is "read a total, then write based on it", which is only safe with the
-- rows locked. Every attempt to do that from the application layer has the
-- same hole: two requests read the same total before either writes. The
-- trigger in 07-create-fofo-money-tables.sql is the backstop that makes
-- overdrawing impossible; this function is the part that does the right
-- thing in the first place, so the backstop stays quiet.
--
-- A NOTE ON WHAT THIS DOES NOT DO. It never touches the invoice. Store
-- credit is a payment, not a discount: the invoice keeps its full taxable
-- value and its full GST, and the credit settles part of what is payable.
-- The tax was adjusted once already, by the credit note. See decision 0013
-- — this is the single rule that, if broken, undercharges GST.
--
-- Requires: 07-create-fofo-money-tables.sql, 06-add-fofo-money-audit-category.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The balance
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.store_credit_balance(p_franchise_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = fofo, public
AS $$
  SELECT COALESCE(SUM(amount_remaining), 0)
    FROM fofo.store_credit_statement
   WHERE franchise_id = p_franchise_id;
$$;

COMMENT ON FUNCTION fofo.store_credit_balance(uuid) IS
'What a franchise has left to spend: earned less applied, computed on every call. Never cached, never stored on the franchise row — a balance nobody can derive is a balance nobody can defend when it is disputed.';

-- ---------------------------------------------------------------------
-- 2. Applying it
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.apply_store_credit(
  p_franchise_id   uuid,
  p_invoice_id     uuid,
  p_acting_user_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_invoice     fofo.invoices%ROWTYPE;
  v_outstanding numeric(14,2);
  v_applied     numeric(14,2) := 0;
  v_take        numeric(14,2);
  v_credit      record;
BEGIN
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
  -- less money already taken for it. Captured payments only — a payment
  -- that is merely 'created' is a popup someone may yet abandon.
  v_outstanding :=
      v_invoice.total
    - COALESCE((SELECT SUM(amount) FROM fofo.store_credit_applications
                 WHERE invoice_id = p_invoice_id), 0)
    - COALESCE((SELECT SUM(amount) FROM fofo.payments
                 WHERE invoice_id = p_invoice_id AND status = 'captured'), 0);

  -- Nothing owed. This is also where a double-clicked redeem button lands:
  -- the second click finds the invoice settled and applies nothing, so it
  -- is a no-op rather than an error or a second spend.
  IF v_outstanding <= 0 THEN
    RETURN 0;
  END IF;

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
    EXIT     WHEN v_outstanding <= 0;
    CONTINUE WHEN v_credit.remaining <= 0;   -- fully spent already

    v_take := LEAST(v_credit.remaining, v_outstanding);

    -- The trigger re-reads both totals under lock. If a concurrent
    -- transaction spent this credit between the row being read here and
    -- being locked, it raises and the whole redemption rolls back — the
    -- caller retries and gets a correct answer. An error is the right
    -- outcome there; a silently smaller application would not be.
    INSERT INTO fofo.store_credit_applications
      (credit_id, invoice_id, amount, applied_by)
    VALUES (v_credit.id, p_invoice_id, v_take, p_acting_user_id);

    v_outstanding := v_outstanding - v_take;
    v_applied     := v_applied + v_take;
  END LOOP;

  IF v_applied > 0 THEN
    PERFORM public.log_audit_event(
      p_actor_user_id    => p_acting_user_id,
      p_actor_role       => NULL,
      p_cloud_kitchen_id => NULL,
      p_category         => 'fofo_money',
      p_action           => 'store_credit_applied',
      p_severity         => 'review',
      p_entity_type      => 'fofo_invoice',
      p_entity_id        => p_invoice_id,
      p_new_values       => jsonb_build_object(
        'franchise_id',    p_franchise_id,
        'invoice_number',  v_invoice.invoice_number,
        'amount_applied',  v_applied,
        'still_owed',      v_outstanding,
        'balance_after',   fofo.store_credit_balance(p_franchise_id)
      )
    );
  END IF;

  RETURN v_applied;
END;
$$;

COMMENT ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid) IS
'Spends as much of a franchise''s store credit as an invoice can absorb, oldest credit first, and returns how much was applied. Partial by design: a 1000 credit settles a 400 invoice and keeps 600. Applies nothing and returns 0 when the invoice is already settled, so a repeated call is harmless. Never alters the invoice — credit is a payment, not a discount (decision 0013).';

-- ---------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------
-- Decision 0004: REVOKE ... FROM PUBLIC does NOT make a function internal
-- in this database, because functions get direct by-name grants at CREATE
-- time from ALTER DEFAULT PRIVILEGES. Revoke the roles by name.
--
-- These live in schema fofo, which anon and authenticated have no USAGE
-- on, so they are unreachable twice over. That is the point: the schema
-- omission is the safety net, and this is the actual lock. Neither is
-- trusted to be the only one.

REVOKE ALL ON FUNCTION fofo.store_credit_balance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fofo.store_credit_balance(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.store_credit_balance(uuid) TO service_role;

REVOKE ALL ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid) TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- GRANTS FIRST, and read proacl rather than trusting the REVOKE above —
-- that is the exact shape of the bug decision 0004 documents. Neither
-- function may list anon or authenticated:
--
-- SELECT p.proname, p.proacl
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'fofo'
--   AND p.proname IN ('apply_store_credit', 'store_credit_balance');
--
-- PARTIAL SPENDING, end to end. Given a franchise with a 1000 credit and
-- an unpaid invoice of 400:
--
-- SELECT fofo.apply_store_credit('<franchise>', '<invoice 400>');  -- 400
-- SELECT fofo.store_credit_balance('<franchise>');                 -- 600
-- SELECT fofo.apply_store_credit('<franchise>', '<invoice 400>');  -- 0, no-op
-- SELECT fofo.store_credit_balance('<franchise>');                 -- 600
--
-- SPILLING ACROSS CREDITS. Two credits of 300 and 500, one invoice of 700:
-- the older is emptied first and the newer part-used.
--
-- SELECT fofo.apply_store_credit('<franchise>', '<invoice 700>');  -- 700
-- SELECT credit_note_number, amount_earned, amount_remaining
-- FROM fofo.store_credit_statement WHERE franchise_id = '<franchise>'
-- ORDER BY earned_at;                    -- 300 -> 0 left, 500 -> 100 left
--
-- CREDIT SMALLER THAN THE BILL. A 100 credit against a 5000 invoice must
-- apply all 100 and leave 4900 for Razorpay — the case the old full-only
-- rule refused outright.
--
-- AN AUDIT EVENT EXISTS FOR EVERY APPLICATION:
--
-- SELECT action, entity_id, new_values FROM public.audit_events
-- WHERE category = 'fofo_money' ORDER BY created_at DESC LIMIT 5;
--
-- THE LEDGER RECONCILES BY HAND. For any franchise, these must be equal:
--
-- SELECT (SELECT COALESCE(SUM(amount),0) FROM fofo.store_credits
--          WHERE franchise_id = '<franchise>')
--      - (SELECT COALESCE(SUM(a.amount),0)
--           FROM fofo.store_credit_applications a
--           JOIN fofo.store_credits c ON c.id = a.credit_id
--          WHERE c.franchise_id = '<franchise>')
--      AS by_subtraction,
--        fofo.store_credit_balance('<franchise>') AS by_function;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP FUNCTION IF EXISTS fofo.apply_store_credit(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.store_credit_balance(uuid);
