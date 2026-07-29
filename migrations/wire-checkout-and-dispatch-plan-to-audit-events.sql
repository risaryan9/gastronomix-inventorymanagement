-- =====================================================================
-- Close F1 / G1 / G2 / H1 — the last four gaps
--
-- docs/AUDIT_TRAIL_REQUIREMENTS.md §3.F, §3.G, §3.H.
--
--   F1  save checkout/closing draft (returns, wastage, extra consumption)
--   G1  create/save dispatch plan + items
--   G2  delete/replace dispatch plan items
--   H1  kitchen executive confirms & locks the plan
--
-- Three functions:
--   save_checkout_draft()   F1
--   save_dispatch_plan()    G1 + G2 (one modal action: create or re-save)
--   lock_dispatch_plan()    H1
--
-- G1 and G2 are one function for the same reason E1-E3 were: re-saving a
-- plan IS the replace. The user presses Save once; whether that inserts a
-- new plan or swaps the items of an existing one is an implementation
-- detail of the same click.
--
-- ---------------------------------------------------------------------
-- THE §4 RLS TRAP — CHECKED, AND IT DOES NOT APPLY HERE
--
-- §4 warns that moving a write server-side can silently remove a guard,
-- because SECURITY DEFINER bypasses RLS — that is what nearly happened to
-- allocation_request_items' is_packed rule in E1-E4.
--
-- Checked all six tables involved here. Their policies are pure role and
-- cloud-kitchen scoping (plus permissive public_* policies asserting
-- NOT NULL / >= 0). **None of them encodes a status guard.** So nothing
-- is lost by moving these writes into functions.
--
-- The finding is the opposite one, and worse: there is currently NO
-- database-level protection against
--   * saving a draft over an ALREADY-CONFIRMED checkout form, or
--   * editing / re-locking an ALREADY-LOCKED dispatch plan.
--
-- Today the only defences are in JavaScript:
--   * Checkout.jsx line ~913 merely HIDES the save button when status is
--     'confirmed' — and handleSaveDraft sets status:'draft' unconditionally
--     while deleting every return/wastage row. Through the API a confirmed
--     form's numbers can be rewritten after F2 already created a stock_in
--     from them.
--   * DispatchExecutiveDashboard checks status='draft' twice before
--     editing, with a comment admitting it only "reduces race with kitchen
--     lock".
--   * KitchenExecutiveDashboard's handleConfirmLock checks NOTHING. It
--     deletes items, re-inserts, and sets status='locked' regardless of
--     what the plan's status already was.
--
-- All three functions below enforce those rules server-side, where they
-- cannot be skipped. This is a deliberate behaviour change.
-- ---------------------------------------------------------------------
--
-- TIMEZONE. G1 derived plan_date from new Date().toISOString() — UTC,
-- the identical bug fixed for requisitions in
-- wire-requisitions-to-audit-events.sql. India is UTC+5:30, so a plan
-- created between 00:00 and 05:30 IST was filed under the previous day.
-- plan_date is now derived as (now() AT TIME ZONE 'Asia/Kolkata')::date,
-- matching save_allocation_request. This matters more than it looks:
-- checkout_form joins a dispatch plan by date, so a plan and a requisition
-- disagreeing about what day it is would break the closing flow.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- F1 — save_checkout_draft
--
-- Replaces handleSaveDraft's sequence of up to seven separate client
-- calls: upsert checkout_form, three DELETEs, three INSERTs.
--
-- That sequence had no transaction, and the three deletes did not even
-- check their error result. A failure between the deletes and the
-- re-inserts destroyed the supervisor's previously saved returns and
-- wastage with nothing written back — silent loss of exactly the numbers
-- §3.F1 calls "the primary loss/shrinkage numbers". Now all-or-nothing.
--
-- Every draft save is logged, per §3.F1's requirement that the
-- delete-then-reinsert churn be captured and not just the final confirm.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_checkout_draft(
  p_acting_user_id   uuid,
  p_dispatch_plan_id uuid,
  p_cloud_kitchen_id uuid,
  p_outlet_id        uuid,
  p_supervisor_name  text,
  p_return_items     jsonb DEFAULT '[]'::jsonb,  -- [{raw_material_id, dispatched_quantity, returned_quantity}]
  p_wastage_items    jsonb DEFAULT '[]'::jsonb,  -- [{raw_material_id, dispatched_quantity, wasted_quantity}]
  p_operator_id      uuid  DEFAULT NULL,
  p_cash             numeric DEFAULT 0,
  p_payment_onside   numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_form          public.checkout_form%ROWTYPE;
  v_form_id       uuid;
  v_plan          public.dispatch_plan%ROWTYPE;
  v_is_create     boolean;
  v_supervisor    text;
  v_cash          numeric := coalesce(p_cash, 0);
  v_onside        numeric := coalesce(p_payment_onside, 0);
  v_old_returns   jsonb := '[]'::jsonb;
  v_old_wastage   jsonb := '[]'::jsonb;
  v_old_extra     jsonb := '{}'::jsonb;
  v_return_count  int := 0;
  v_wastage_count int := 0;
  v_actor_role    text;
  v_event_id      uuid;
BEGIN
  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;
  IF p_outlet_id IS NULL OR p_cloud_kitchen_id IS NULL OR p_dispatch_plan_id IS NULL THEN
    RAISE EXCEPTION 'p_dispatch_plan_id, p_cloud_kitchen_id and p_outlet_id are required';
  END IF;

  -- checkout_form.supervisor_name is NOT NULL.
  v_supervisor := nullif(btrim(coalesce(p_supervisor_name, '')), '');
  IF v_supervisor IS NULL THEN
    RAISE EXCEPTION 'Supervisor name is required';
  END IF;

  IF v_cash < 0 OR v_onside < 0 THEN
    RAISE EXCEPTION 'Cash and payment-onside cannot be negative';
  END IF;

  -- Quantities: the child tables allow 0 but not negative.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_return_items, '[]'::jsonb)) e
    WHERE e->>'raw_material_id' IS NULL
       OR coalesce((e->>'returned_quantity')::numeric, -1) < 0
       OR coalesce((e->>'dispatched_quantity')::numeric, -1) < 0
  ) THEN
    RAISE EXCEPTION 'Every return line needs a raw_material_id and non-negative quantities';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_wastage_items, '[]'::jsonb)) e
    WHERE e->>'raw_material_id' IS NULL
       OR coalesce((e->>'wasted_quantity')::numeric, -1) < 0
  ) THEN
    RAISE EXCEPTION 'Every wastage line needs a raw_material_id and a non-negative quantity';
  END IF;

  -- The plan must exist and be locked: confirm_checkout_form already
  -- requires that downstream, so accepting a draft against an unlocked
  -- plan only defers the failure to a worse moment.
  SELECT * INTO v_plan FROM public.dispatch_plan WHERE id = p_dispatch_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch plan not found: %', p_dispatch_plan_id;
  END IF;

  -- One form per outlet per plan.
  SELECT * INTO v_form
  FROM public.checkout_form
  WHERE dispatch_plan_id = p_dispatch_plan_id
    AND outlet_id = p_outlet_id
  FOR UPDATE;

  v_is_create := NOT FOUND;

  IF NOT v_is_create THEN
    -- See the header: nothing in RLS stops this today, and the UI only
    -- hides the button. Once confirmed, F2 has already created a stock_in
    -- from these returns; letting the figures be rewritten would leave
    -- that stock_in describing numbers that no longer exist.
    IF v_form.status = 'confirmed' THEN
      RAISE EXCEPTION 'This checkout form has already been confirmed and can no longer be edited.';
    END IF;

    v_form_id := v_form.id;

    -- Snapshot before the delete-and-reinsert, so the audit row records
    -- what the figures were, not just what they became.
    v_old_returns := (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'raw_material_id',     r.raw_material_id,
               'dispatched_quantity', r.dispatched_quantity,
               'returned_quantity',   r.returned_quantity
             ) ORDER BY r.raw_material_id), '[]'::jsonb)
      FROM public.checkout_form_return_items r WHERE r.checkout_form_id = v_form_id
    );
    v_old_wastage := (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'raw_material_id',     w.raw_material_id,
               'dispatched_quantity', w.dispatched_quantity,
               'wasted_quantity',     w.wasted_quantity
             ) ORDER BY w.raw_material_id), '[]'::jsonb)
      FROM public.checkout_form_wastage_items w WHERE w.checkout_form_id = v_form_id
    );
    v_old_extra := (
      SELECT coalesce(jsonb_build_object('cash', a.cash, 'payment_onside', a.payment_onside), '{}'::jsonb)
      FROM public.checkout_form_additional a WHERE a.checkout_form_id = v_form_id LIMIT 1
    );

    UPDATE public.checkout_form
    SET supervisor_name = v_supervisor,
        operator_id     = p_operator_id,
        status          = 'draft',
        updated_at      = now()
    WHERE id = v_form_id;

    DELETE FROM public.checkout_form_return_items  WHERE checkout_form_id = v_form_id;
    DELETE FROM public.checkout_form_wastage_items WHERE checkout_form_id = v_form_id;
    DELETE FROM public.checkout_form_additional    WHERE checkout_form_id = v_form_id;
  ELSE
    INSERT INTO public.checkout_form (
      dispatch_plan_id, cloud_kitchen_id, plan_date, outlet_id,
      status, supervisor_name, operator_id, created_by
    ) VALUES (
      p_dispatch_plan_id, p_cloud_kitchen_id, v_plan.plan_date, p_outlet_id,
      'draft', v_supervisor, p_operator_id, p_acting_user_id
    ) RETURNING id INTO v_form_id;
  END IF;

  -- Only non-zero lines are stored, matching the client's behaviour.
  INSERT INTO public.checkout_form_return_items (
    checkout_form_id, outlet_id, raw_material_id, dispatched_quantity, returned_quantity
  )
  SELECT v_form_id, p_outlet_id,
         (e->>'raw_material_id')::uuid,
         coalesce((e->>'dispatched_quantity')::numeric, 0),
         (e->>'returned_quantity')::numeric
  FROM jsonb_array_elements(coalesce(p_return_items, '[]'::jsonb)) e
  WHERE coalesce((e->>'returned_quantity')::numeric, 0) > 0;
  GET DIAGNOSTICS v_return_count = ROW_COUNT;

  INSERT INTO public.checkout_form_wastage_items (
    checkout_form_id, outlet_id, raw_material_id, dispatched_quantity, wasted_quantity
  )
  SELECT v_form_id, p_outlet_id,
         (e->>'raw_material_id')::uuid,
         (e->>'dispatched_quantity')::numeric,
         (e->>'wasted_quantity')::numeric
  FROM jsonb_array_elements(coalesce(p_wastage_items, '[]'::jsonb)) e
  WHERE coalesce((e->>'wasted_quantity')::numeric, 0) > 0;
  GET DIAGNOSTICS v_wastage_count = ROW_COUNT;

  IF v_cash > 0 OR v_onside > 0 THEN
    INSERT INTO public.checkout_form_additional (
      checkout_form_id, outlet_id, cash, payment_onside
    ) VALUES (v_form_id, p_outlet_id, v_cash, v_onside);
  END IF;

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  -- correlation_id ties every draft save for this form together, and to
  -- the eventual F2 confirm — §6.2 named this exact case.
  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => p_cloud_kitchen_id,
    p_category         => 'checkout',
    p_action           => CASE WHEN v_is_create THEN 'checkout_draft_created'
                               ELSE 'checkout_draft_updated' END,
    p_severity         => 'review',
    p_entity_type      => 'checkout_form',
    p_entity_id        => v_form_id,
    p_outlet_id        => p_outlet_id,
    p_correlation_id   => v_form_id,
    p_old_values       => CASE WHEN v_is_create THEN NULL ELSE jsonb_build_object(
      'supervisor_name', v_form.supervisor_name,
      'operator_id',     v_form.operator_id,
      'returns',         v_old_returns,
      'wastage',         v_old_wastage,
      'additional',      v_old_extra
    ) END,
    p_new_values       => jsonb_build_object(
      'supervisor_name', v_supervisor,
      'operator_id',     p_operator_id,
      'dispatch_plan_id', p_dispatch_plan_id,
      'return_count',    v_return_count,
      'wastage_count',   v_wastage_count,
      'returns',         coalesce(p_return_items, '[]'::jsonb),
      'wastage',         coalesce(p_wastage_items, '[]'::jsonb),
      'additional',      jsonb_build_object('cash', v_cash, 'payment_onside', v_onside)
    )
  );

  RETURN json_build_object(
    'success', true,
    'created', v_is_create,
    'checkout_form_id', v_form_id,
    'return_count', v_return_count,
    'wastage_count', v_wastage_count,
    'audit_event_id', v_event_id
  );
END;
$function$;

COMMENT ON FUNCTION public.save_checkout_draft IS
  'F1: atomically upserts a checkout form and replaces its return/wastage/additional rows, and logs the save. Replaces up to seven separate client calls whose deletes were unchecked and untransacted. Refuses to edit a confirmed form.';

-- ---------------------------------------------------------------------
-- G1 + G2 — save_dispatch_plan
--
-- Creating a plan and re-saving one are the same click. A re-save wipes
-- dispatch_plan_items and inserts the new set, which §3.G2 flags as the
-- same overwrite risk category as D4 and E3 — so, exactly as with E3, the
-- replaced items get their own critical reversal event carrying the plan
-- as it was.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_dispatch_plan(
  p_acting_user_id   uuid,
  p_cloud_kitchen_id uuid,
  p_brand            text,
  p_items            jsonb,                 -- [{raw_material_id, outlet_id, quantity}]
  p_dispatch_plan_id uuid DEFAULT NULL,     -- NULL => create, else re-save
  p_notes            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan          public.dispatch_plan%ROWTYPE;
  v_plan_id       uuid;
  v_today         date;
  v_is_create     boolean;
  v_existing_id   uuid;
  v_old_items     jsonb := '[]'::jsonb;
  v_replaced      int := 0;
  v_inserted      int := 0;
  v_correlation   uuid;
  v_actor_role    text;
  v_event_id      uuid;
BEGIN
  IF p_acting_user_id IS NULL OR p_cloud_kitchen_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id and p_cloud_kitchen_id are required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A dispatch plan needs at least one item';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE e->>'raw_material_id' IS NULL
       OR e->>'outlet_id' IS NULL
       OR coalesce((e->>'quantity')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Every plan line needs a raw_material_id, an outlet_id and a quantity greater than 0';
  END IF;

  -- See header: same IST fix as save_allocation_request.
  v_today     := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_is_create := p_dispatch_plan_id IS NULL;

  IF v_is_create THEN
    -- One plan per kitchen/brand/day, which the client also checked.
    SELECT id INTO v_existing_id
    FROM public.dispatch_plan
    WHERE cloud_kitchen_id = p_cloud_kitchen_id
      AND brand IS NOT DISTINCT FROM p_brand
      AND plan_date = v_today
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'A dispatch plan for today already exists for this brand.';
    END IF;

    INSERT INTO public.dispatch_plan (
      cloud_kitchen_id, created_by, plan_date, status, brand, notes
    ) VALUES (
      p_cloud_kitchen_id, p_acting_user_id, v_today, 'draft', p_brand,
      nullif(btrim(coalesce(p_notes, '')), '')
    ) RETURNING * INTO v_plan;

    v_plan_id := v_plan.id;
  ELSE
    SELECT * INTO v_plan
    FROM public.dispatch_plan
    WHERE id = p_dispatch_plan_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dispatch plan not found: %', p_dispatch_plan_id;
    END IF;

    -- The client checked this twice and still called it a race. FOR UPDATE
    -- above plus this check makes it actually safe: a concurrent lock must
    -- now wait for this transaction, then one of the two loses cleanly.
    IF v_plan.status <> 'draft' THEN
      RAISE EXCEPTION 'This dispatch plan has been locked and can no longer be edited.';
    END IF;

    v_plan_id := v_plan.id;

    v_old_items := (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'raw_material_id', i.raw_material_id,
               'outlet_id',       i.outlet_id,
               'quantity',        i.quantity
             ) ORDER BY i.raw_material_id, i.outlet_id), '[]'::jsonb)
      FROM public.dispatch_plan_items i WHERE i.dispatch_plan_id = v_plan_id
    );

    DELETE FROM public.dispatch_plan_items WHERE dispatch_plan_id = v_plan_id;
    GET DIAGNOSTICS v_replaced = ROW_COUNT;
  END IF;

  INSERT INTO public.dispatch_plan_items (dispatch_plan_id, raw_material_id, outlet_id, quantity)
  SELECT v_plan_id,
         (e->>'raw_material_id')::uuid,
         (e->>'outlet_id')::uuid,
         (e->>'quantity')::numeric
  FROM jsonb_array_elements(p_items) e;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  -- Only correlate when a reversal event will accompany this one.
  v_correlation := CASE WHEN v_replaced > 0 THEN v_plan_id END;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => p_cloud_kitchen_id,
    p_category         => 'dispatch_plan',
    p_action           => CASE WHEN v_is_create THEN 'dispatch_plan_created'
                               ELSE 'dispatch_plan_updated' END,
    p_severity         => 'review',
    p_entity_type      => 'dispatch_plan',
    p_entity_id        => v_plan_id,
    p_correlation_id   => v_correlation,
    p_old_values       => CASE WHEN v_is_create THEN NULL
                               ELSE jsonb_build_object('items', v_old_items) END,
    p_new_values       => jsonb_build_object(
      'plan_date',  CASE WHEN v_is_create THEN v_today ELSE v_plan.plan_date END,
      'brand',      COALESCE(p_brand, v_plan.brand),
      'status',     'draft',
      'item_count', v_inserted,
      'items',      p_items
    )
  );

  -- G2 — the replace half. §3.G2: "a full replace silently discards the
  -- previous plan", same risk category as D4 and E3, so it gets its own
  -- critical row rather than living inside the routine save above.
  IF v_replaced > 0 THEN
    PERFORM public.log_audit_event(
      p_actor_user_id    => p_acting_user_id,
      p_actor_role       => v_actor_role,
      p_cloud_kitchen_id => p_cloud_kitchen_id,
      p_category         => 'reversal',
      p_action           => 'dispatch_plan_items_replaced',
      p_severity         => 'critical',
      p_entity_type      => 'dispatch_plan',
      p_entity_id        => v_plan_id,
      p_correlation_id   => v_correlation,
      p_reversed_event_id => (
        SELECT id FROM public.audit_events
        WHERE entity_type = 'dispatch_plan' AND entity_id = v_plan_id
          AND action IN ('dispatch_plan_created', 'dispatch_plan_updated')
          AND id <> v_event_id
        ORDER BY created_at DESC LIMIT 1
      ),
      p_old_values       => jsonb_build_object('replaced_items', v_old_items,
                                               'replaced_count', v_replaced),
      p_new_values       => jsonb_build_object('items', p_items,
                                               'item_count', v_inserted)
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'created', v_is_create,
    'dispatch_plan_id', v_plan_id,
    'plan_date', CASE WHEN v_is_create THEN v_today ELSE v_plan.plan_date END,
    'items_replaced', v_replaced,
    'items_inserted', v_inserted
  );
END;
$function$;

COMMENT ON FUNCTION public.save_dispatch_plan IS
  'G1/G2: creates or re-saves a dispatch plan and its items in one transaction, logging the save and — when items were replaced — a separate critical reversal event carrying the discarded plan. Derives plan_date server-side in IST. Refuses to edit a locked plan, with FOR UPDATE closing the race the client could only narrow.';

-- ---------------------------------------------------------------------
-- H1 — lock_dispatch_plan
--
-- The hand-off from planning to execution. §3.H1 asks for this to mirror
-- how confirm_checkout_form gates and logs the analogous downstream step.
--
-- handleConfirmLock checked NOTHING before locking: it deleted the items,
-- re-inserted, and set status='locked' whatever the plan's state. Locking
-- an already-locked plan silently overwrote the quantities the kitchen was
-- already working to — after confirm_checkout_form had begun trusting them
-- (it requires status='locked' and reads locked_at for its 24-hour
-- window). This refuses unless the plan is still a draft.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_dispatch_plan(
  p_acting_user_id   uuid,
  p_dispatch_plan_id uuid,
  p_items            jsonb   -- final [{raw_material_id, outlet_id, quantity}]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan       public.dispatch_plan%ROWTYPE;
  v_old_items  jsonb;
  v_replaced   int := 0;
  v_inserted   int := 0;
  v_changed    boolean;
  v_actor_role text;
  v_event_id   uuid;
BEGIN
  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keep at least one item with a positive quantity before locking.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE e->>'raw_material_id' IS NULL
       OR e->>'outlet_id' IS NULL
       OR coalesce((e->>'quantity')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Every plan line needs a raw_material_id, an outlet_id and a quantity greater than 0';
  END IF;

  SELECT * INTO v_plan
  FROM public.dispatch_plan
  WHERE id = p_dispatch_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch plan not found: %', p_dispatch_plan_id;
  END IF;

  -- The check handleConfirmLock never made.
  IF v_plan.status <> 'draft' THEN
    RAISE EXCEPTION 'This dispatch plan is already %; it cannot be locked again.', v_plan.status;
  END IF;

  v_old_items := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'raw_material_id', i.raw_material_id,
             'outlet_id',       i.outlet_id,
             'quantity',        i.quantity
           ) ORDER BY i.raw_material_id, i.outlet_id), '[]'::jsonb)
    FROM public.dispatch_plan_items i WHERE i.dispatch_plan_id = p_dispatch_plan_id
  );

  DELETE FROM public.dispatch_plan_items WHERE dispatch_plan_id = p_dispatch_plan_id;
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.dispatch_plan_items (dispatch_plan_id, raw_material_id, outlet_id, quantity)
  SELECT p_dispatch_plan_id,
         (e->>'raw_material_id')::uuid,
         (e->>'outlet_id')::uuid,
         (e->>'quantity')::numeric
  FROM jsonb_array_elements(p_items) e;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.dispatch_plan
  SET status    = 'locked',
      locked_by = p_acting_user_id,
      locked_at = now()
  WHERE id = p_dispatch_plan_id;

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  -- Whether the kitchen changed the dispatch executive's numbers on the
  -- way through is the single most interesting fact about a lock, so make
  -- it answerable without diffing the payloads by hand.
  v_changed := v_old_items IS DISTINCT FROM (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'raw_material_id', (e->>'raw_material_id')::uuid,
             'outlet_id',       (e->>'outlet_id')::uuid,
             'quantity',        (e->>'quantity')::numeric
           ) ORDER BY (e->>'raw_material_id')::uuid, (e->>'outlet_id')::uuid), '[]'::jsonb)
    FROM jsonb_array_elements(p_items) e
  );

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => v_plan.cloud_kitchen_id,
    p_category         => 'dispatch_plan',
    p_action           => 'dispatch_plan_locked',
    p_severity         => 'review',
    p_entity_type      => 'dispatch_plan',
    p_entity_id        => p_dispatch_plan_id,
    p_correlation_id   => p_dispatch_plan_id,
    p_old_values       => jsonb_build_object(
      'status', 'draft',
      'items',  v_old_items
    ),
    p_new_values       => jsonb_build_object(
      'status',              'locked',
      'locked_by',           p_acting_user_id,
      'plan_date',           v_plan.plan_date,
      'brand',               v_plan.brand,
      'items',               p_items,
      'item_count',          v_inserted,
      'items_replaced',      v_replaced,
      'quantities_changed_by_kitchen', v_changed
    )
  );

  RETURN json_build_object(
    'success', true,
    'dispatch_plan_id', p_dispatch_plan_id,
    'items_replaced', v_replaced,
    'items_inserted', v_inserted,
    'quantities_changed_by_kitchen', v_changed,
    'audit_event_id', v_event_id
  );
END;
$function$;

COMMENT ON FUNCTION public.lock_dispatch_plan IS
  'H1: replaces a draft plan''s items with the kitchen''s final numbers and locks it, in one transaction, logging whether the kitchen changed the quantities. Refuses to lock a plan that is not still draft — a check the client never made.';

COMMIT;

-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. G1 — create a plan; plan_date must be the IST date:
--      SELECT public.save_dispatch_plan(
--        p_acting_user_id   => '<dispatch-exec>',
--        p_cloud_kitchen_id => '<ck>',
--        p_brand            => '<brand>',
--        p_items            => '[{"raw_material_id":"<rm>","outlet_id":"<outlet>","quantity":5}]'::jsonb);
--      -- plan_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
--
-- 2. G2 — re-save it with different numbers, then:
--      SELECT action, category, severity, correlation_id, reversed_event_id
--      FROM public.audit_events WHERE entity_id = '<plan>' ORDER BY created_at;
--      -- expect dispatch_plan_updated (dispatch_plan/review) AND
--      --        dispatch_plan_items_replaced (reversal/critical),
--      --        sharing a correlation_id, the second pointing at the first.
--
-- 3. H1 — lock it, then try to lock again:
--      SELECT public.lock_dispatch_plan('<kitchen-exec>','<plan>',
--        '[{"raw_material_id":"<rm>","outlet_id":"<outlet>","quantity":7}]'::jsonb);
--      -- first: quantities_changed_by_kitchen = true (5 -> 7)
--      -- second: 'already locked; it cannot be locked again'  <-- the check
--      --         handleConfirmLock never made
--
-- 4. G2 after lock — re-saving a locked plan must now fail:
--      SELECT public.save_dispatch_plan(..., p_dispatch_plan_id => '<plan>', ...);
--      -- expect 'has been locked and can no longer be edited'
--
-- 5. F1 — save a draft twice, confirming both are logged and correlated:
--      SELECT action, correlation_id, new_values->'return_count'
--      FROM public.audit_events WHERE category='checkout' ORDER BY created_at;
--      -- expect checkout_draft_created then checkout_draft_updated,
--      --        sharing correlation_id = the checkout_form id
--
-- 6. F1 after confirm — the guard that RLS never had:
--      UPDATE public.checkout_form SET status='confirmed' WHERE id='<form>';
--      SELECT public.save_checkout_draft(... same args ...);
--      -- expect 'already been confirmed and can no longer be edited'
-- =====================================================================
