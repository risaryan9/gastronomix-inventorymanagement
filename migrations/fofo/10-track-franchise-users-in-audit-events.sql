-- =====================================================================
-- Let the audit trail say WHICH franchise user did something
--
-- A franchise can have several logins, and everything they do — place an
-- order, spend store credit, register — is done on behalf of the franchise.
-- The audit trail still has to name the person. Today it cannot:
-- audit_events.actor_user_id references public.users, which is staff only,
-- and franchise users deliberately live in fofo.franchise_users instead
-- (03-create-fofo-schema.sql). A franchise action would be logged with no
-- actor at all, indistinguishable from the system.
--
-- WHAT CHANGES.
--
--   public.audit_events
--     actor_franchise_user_id  uuid → fofo.franchise_users   the person
--     franchise_id             uuid → fofo.franchises        on whose behalf
--     actor_label              text                          who, readably
--   the category list gains 'fofo_account'
--
--   fofo.store_credit_applications
--     applied_by_franchise_user_id  uuid → fofo.franchise_users
--
--   fofo.log_fofo_audit_event(...)   the one writer of FOFO audit events
--   fofo.apply_store_credit(...)     replaced: now records the franchise user
--
-- A PERSON IS EITHER STAFF OR A FRANCHISE USER, NEVER BOTH. A CHECK keeps
-- actor_user_id and actor_franchise_user_id from both being set. Neither set
-- means the system did it — a Razorpay webhook has no person behind it.
--
-- WHY actor_label IS STORED, NOT LOOKED UP. The audit screens live in the
-- internal app, which reaches the database through the public API — and the
-- fofo schema is deliberately not exposed there. The internal app therefore
-- cannot join to fofo.franchise_users to show a name. So the name is copied
-- onto the event at write time, e.g. "priya@testfoods.in (Test Foods)". It
-- is also the right behaviour for an audit record anyway: it should say who
-- the actor was when they acted, and actor_role already works this way.
--
-- WHY A NEW FUNCTION, AND public.log_audit_event IS LEFT ALONE. That
-- function is called by every audited flow in the internal app. Changing
-- its signature means dropping and recreating it, which resets its grants
-- (decision 0004 — they would silently come back for anon) and risks every
-- screen that logs. fofo.log_fofo_audit_event is a separate door for FOFO
-- events only: it accepts either kind of actor, derives actor_role and
-- actor_label itself rather than trusting a caller, and refuses a franchise
-- user acting for a franchise they do not belong to. Like log_audit_event,
-- the caller supplies facts and never the verdict.
--
-- IP AND USER AGENT. log_audit_event reads them off the PostgREST request.
-- FOFO calls come from the partner app's server, not PostgREST, so those
-- headers are the server's, not the franchise user's browser's. The new
-- function takes them as parameters and falls back to the request headers
-- only when none are given.
--
-- apply_store_credit IS REPLACED, not edited in 08. 08 is applied and stays
-- as the record of what ran. Its signature gains p_acting_franchise_user_id,
-- which means a DROP and CREATE — so its grants are restated below.
--
-- NOTHING EXISTING CHANGES. The three columns are nullable with no default,
-- so adding them does not rewrite the 2,500-odd existing events, and every
-- existing row passes the new CHECKs because all three are NULL on it.
--
-- Requires: 03, 06, 07, 08.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. audit_events: who, for which franchise
-- ---------------------------------------------------------------------

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_category_check;

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_category_check CHECK (category = ANY (ARRAY[
    'auth', 'inventory_in', 'catalog', 'inventory_out',
    'reversal', 'requisition', 'checkout', 'dispatch_plan',
    'fofo_money',
    'fofo_account'   -- franchises, welcome emails, invitations, franchise users
  ]));

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS actor_franchise_user_id uuid REFERENCES fofo.franchise_users(id),
  ADD COLUMN IF NOT EXISTS franchise_id            uuid REFERENCES fofo.franchises(id),
  ADD COLUMN IF NOT EXISTS actor_label             text;

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_one_kind_of_actor;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_one_kind_of_actor
  CHECK (actor_user_id IS NULL OR actor_franchise_user_id IS NULL);

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_franchise_actor_has_franchise;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_franchise_actor_has_franchise
  CHECK (actor_franchise_user_id IS NULL OR franchise_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_audit_events_franchise
  ON public.audit_events (franchise_id, created_at DESC)
  WHERE franchise_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_franchise_user
  ON public.audit_events (actor_franchise_user_id)
  WHERE actor_franchise_user_id IS NOT NULL;

COMMENT ON COLUMN public.audit_events.actor_franchise_user_id IS
'The FOFO franchise login that acted, when the actor was a franchise user rather than staff. Never set together with actor_user_id. Written only by fofo.log_fofo_audit_event.';

COMMENT ON COLUMN public.audit_events.franchise_id IS
'The FOFO franchise the event concerns. Always set when actor_franchise_user_id is; also set on staff and system events about a franchise, so one filter finds everything that happened to it.';

COMMENT ON COLUMN public.audit_events.actor_label IS
'Who acted, as a person reads it, copied at write time — e.g. "priya@testfoods.in (Test Foods)". Stored because the internal app cannot read the fofo schema to look it up, and because an audit record should say who the actor was when they acted.';

-- ---------------------------------------------------------------------
-- 2. store credit applications: which franchise user spent it
-- ---------------------------------------------------------------------

ALTER TABLE fofo.store_credit_applications
  ADD COLUMN IF NOT EXISTS applied_by_franchise_user_id uuid REFERENCES fofo.franchise_users(id);

ALTER TABLE fofo.store_credit_applications
  DROP CONSTRAINT IF EXISTS store_credit_applications_one_kind_of_actor;
ALTER TABLE fofo.store_credit_applications
  ADD CONSTRAINT store_credit_applications_one_kind_of_actor
  CHECK (applied_by IS NULL OR applied_by_franchise_user_id IS NULL);

COMMENT ON COLUMN fofo.store_credit_applications.applied_by_franchise_user_id IS
'The franchise user who applied the credit from the dashboard. applied_by is for staff; at most one of the two is set.';

-- ---------------------------------------------------------------------
-- 3. The writer
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.log_fofo_audit_event(
  p_franchise_id            uuid,
  p_category                text,
  p_action                  text,
  p_actor_user_id           uuid  DEFAULT NULL,   -- staff: admin, purchase manager
  p_actor_franchise_user_id uuid  DEFAULT NULL,   -- a franchise login
  p_severity                text  DEFAULT 'review',
  p_entity_type             text  DEFAULT NULL,
  p_entity_id               uuid  DEFAULT NULL,
  p_outlet_id               uuid  DEFAULT NULL,
  p_cloud_kitchen_id        uuid  DEFAULT NULL,
  p_correlation_id          uuid  DEFAULT NULL,
  p_old_values              jsonb DEFAULT NULL,
  p_new_values              jsonb DEFAULT NULL,
  p_ip_address              inet  DEFAULT NULL,
  p_user_agent              text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_role        text;
  v_label       text;
  v_fu_email    text;
  v_fu_franchise uuid;
  v_franchise   text;
  v_event_id    uuid;
BEGIN
  -- This door is for FOFO events. Internal flows keep public.log_audit_event.
  IF p_category NOT IN ('fofo_money', 'fofo_account') THEN
    RAISE EXCEPTION 'log_fofo_audit_event only records FOFO categories, not %', p_category;
  END IF;

  IF p_actor_user_id IS NOT NULL AND p_actor_franchise_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'An audit event has one actor: staff user % or franchise user %, not both',
      p_actor_user_id, p_actor_franchise_user_id;
  END IF;

  -- Role and label are derived here, never taken from the caller.
  IF p_actor_franchise_user_id IS NOT NULL THEN
    SELECT fu.email, fu.franchise_id, f.name
      INTO v_fu_email, v_fu_franchise, v_franchise
      FROM fofo.franchise_users fu
      JOIN fofo.franchises f ON f.id = fu.franchise_id
     WHERE fu.id = p_actor_franchise_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Franchise user % not found', p_actor_franchise_user_id;
    END IF;

    -- A franchise user acts only for their own franchise.
    IF p_franchise_id IS DISTINCT FROM v_fu_franchise THEN
      RAISE EXCEPTION 'Franchise user % belongs to franchise %, not %',
        p_actor_franchise_user_id, v_fu_franchise, p_franchise_id;
    END IF;

    v_role  := 'franchise_user';
    v_label := v_fu_email || ' (' || v_franchise || ')';

  ELSIF p_actor_user_id IS NOT NULL THEN
    SELECT u.role, u.full_name INTO v_role, v_label
      FROM public.users u WHERE u.id = p_actor_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Staff user % not found', p_actor_user_id;
    END IF;

  ELSE
    v_role  := 'system';
    v_label := 'System';
  END IF;

  INSERT INTO public.audit_events (
    actor_user_id, actor_franchise_user_id, actor_role, actor_label,
    franchise_id, cloud_kitchen_id, outlet_id,
    category, action, entity_type, entity_id,
    correlation_id, severity,
    old_values, new_values,
    ip_address, user_agent
  ) VALUES (
    p_actor_user_id, p_actor_franchise_user_id, v_role, v_label,
    p_franchise_id, p_cloud_kitchen_id, p_outlet_id,
    p_category, p_action, p_entity_type, p_entity_id,
    p_correlation_id, p_severity,
    p_old_values, p_new_values,
    COALESCE(p_ip_address, public.current_request_ip()),
    COALESCE(p_user_agent, public.current_request_user_agent())
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION fofo.log_fofo_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, inet, text) IS
'Writes one FOFO audit event. Takes a staff actor, a franchise-user actor, or neither (system) — never both. Derives actor_role and actor_label itself and refuses a franchise user acting for another franchise. Internal to FOFO server code: service_role only.';

-- ---------------------------------------------------------------------
-- 4. apply_store_credit, now naming the franchise user
-- ---------------------------------------------------------------------
-- Same body as 08 apart from the new parameter, the new column on the
-- application row, and the audit call. The old three-argument version is
-- dropped: two overloads would let a caller keep using the one that cannot
-- say who acted.

DROP FUNCTION IF EXISTS fofo.apply_store_credit(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION fofo.apply_store_credit(
  p_franchise_id             uuid,
  p_invoice_id               uuid,
  p_acting_user_id           uuid DEFAULT NULL,   -- staff applying it
  p_acting_franchise_user_id uuid DEFAULT NULL    -- the franchise user applying it
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
  IF p_acting_user_id IS NOT NULL AND p_acting_franchise_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Store credit is applied by staff or by a franchise user, not both';
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
      (credit_id, invoice_id, amount, applied_by, applied_by_franchise_user_id)
    VALUES (v_credit.id, p_invoice_id, v_take, p_acting_user_id, p_acting_franchise_user_id);

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

COMMENT ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid) IS
'Spends as much of a franchise''s store credit as an invoice can absorb, oldest credit first, and returns how much was applied. Partial by design: a 1000 credit settles a 400 invoice and keeps 600. Applies nothing and returns 0 when the invoice is already settled, so a repeated call is harmless. Records who applied it — staff or franchise user, never both — on the application row and the audit event. Never alters the invoice: credit is a payment, not a discount (decision 0013).';

-- ---------------------------------------------------------------------
-- 5. Grants — decision 0004: revoke by name, then check proacl
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION fofo.log_fofo_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, inet, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fofo.log_fofo_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, inet, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.log_fofo_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, inet, text) TO service_role;

REVOKE ALL ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.apply_store_credit(uuid, uuid, uuid, uuid) TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The three columns exist, nothing existing was touched (all NULL):
--
-- SELECT count(*) AS events,
--        count(actor_franchise_user_id) AS by_franchise_users,
--        count(franchise_id) AS about_franchises
-- FROM public.audit_events;                          -- 0 and 0 today
--
-- Both functions are service_role only, and the old apply_store_credit is gone:
--
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.proacl
-- FROM pg_proc p WHERE p.pronamespace = 'fofo'::regnamespace
--   AND p.proname IN ('log_fofo_audit_event', 'apply_store_credit');
--
-- A franchise user's actions, newest first, for one franchise:
--
-- SELECT created_at, actor_label, category, action, new_values
-- FROM public.audit_events
-- WHERE franchise_id = '<franchise>' ORDER BY created_at DESC;

-- =====================================================================
-- Rollback
-- =====================================================================
-- Only safe while no event uses the new columns or category.
--
-- DROP FUNCTION IF EXISTS fofo.log_fofo_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, inet, text);
-- then re-run the apply_store_credit section of 08 after dropping the
-- four-argument version, and:
-- ALTER TABLE fofo.store_credit_applications DROP COLUMN applied_by_franchise_user_id;
-- ALTER TABLE public.audit_events
--   DROP CONSTRAINT audit_events_one_kind_of_actor,
--   DROP CONSTRAINT audit_events_franchise_actor_has_franchise,
--   DROP COLUMN actor_label, DROP COLUMN franchise_id, DROP COLUMN actor_franchise_user_id;
-- and restore the category CHECK from 06.
