-- =====================================================================
-- Revert the business day to UTC — restore the 05:30 IST rollover
--
-- wire-requisitions-to-audit-events.sql and
-- wire-checkout-and-dispatch-plan-to-audit-events.sql changed request_date
-- and plan_date to (now() AT TIME ZONE 'Asia/Kolkata')::date, on the
-- reasoning that the business runs on IST and UTC was "wrong".
--
-- That reasoning was incomplete, and this migration undoes it.
--
-- WHY THE UTC BEHAVIOUR WAS ACTUALLY CORRECT FOR THIS BUSINESS
--
-- UTC runs 5.5 hours behind IST, so deriving the day from UTC has the
-- effect of saying: **the business day does not roll over until 05:30
-- IST**. That is not a bug here — it matches how the kitchen actually
-- operates. A late shift routinely finishes after midnight, and the crew
-- still consider that work to belong to the previous day.
--
-- Concretely, the case that broke: a dispatch plan is locked at 10:00 IST
-- and the supervisor files the closing form at 00:30 IST the next
-- morning. Under UTC both sides resolve to the same day and the closing
-- works. Under IST the plan is dated the 29th while the closing screen
-- asks for the 30th, so Checkout.jsx shows "No locked dispatch plan found
-- for today" and the supervisor is completely blocked.
--
-- The same rollover blocked the kitchen executive from locking a draft
-- plan carried past midnight.
--
-- This is real traffic, not a hypothetical: 20 records were created in the
-- midnight hour alone (6 stock-outs, 4 stock-ins, 10 requisitions), plus
-- more at 01:00 and 04:00 IST.
--
-- WHAT THIS DOES
--
-- Introduces business_today() as the single definition of "what day is
-- it", and points both RPCs at it. The two function bodies are otherwise
-- byte-for-byte what they already were — only the date derivation moved.
--
-- If the business day should later start at some other hour (06:00 IST is
-- the honest version of what UTC is approximating here), change
-- business_today() alone and both callers follow. The frontend's
-- getBusinessDate() in lib/businessDate.js is the matching mirror and must
-- be changed with it.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- The one definition of the business day.
--
-- CURRENT_DATE is the UTC date: this database's TimeZone is UTC, which is
-- exactly the behaviour being restored. Written explicitly rather than
-- relying on the session default, so a future timezone change to the
-- database cannot silently move every business day by 5.5 hours.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_today()
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT (now() AT TIME ZONE 'UTC')::date;
$function$;

COMMENT ON FUNCTION public.business_today IS
  'The current business day. Deliberately UTC, which puts the rollover at 05:30 IST and lets a late shift finishing after midnight still file against the day it started. Mirrored by getBusinessDate() in frontend/src/lib/businessDate.js — change both together.';

-- ---------------------------------------------------------------------
-- E1/E2/E3 — unchanged except for the date derivation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_allocation_request(
  p_acting_user_id        uuid,
  p_outlet_id             uuid,
  p_cloud_kitchen_id      uuid,
  p_items                 jsonb,                    -- [{raw_material_id, quantity}, ...]
  p_allocation_request_id uuid    DEFAULT NULL,     -- NULL => create, else edit
  p_supervisor_name       text    DEFAULT NULL,
  p_set_supervisor_name   boolean DEFAULT false     -- PM page leaves it untouched
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request         public.allocation_requests%ROWTYPE;
  v_request_id      uuid;
  v_today           date;
  v_is_create       boolean;
  v_existing_id     uuid;
  v_supervisor      text;
  v_old_supervisor  text;
  v_old_items       jsonb;
  v_new_items       jsonb;
  v_deleted_items   jsonb;
  v_deleted_count   int := 0;
  v_updated_count   int := 0;
  v_inserted_count  int := 0;
  v_correlation     uuid;
  v_actor_role      text;
  v_event_id        uuid;
BEGIN
  -- ---- validate ------------------------------------------------------
  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;
  IF p_outlet_id IS NULL OR p_cloud_kitchen_id IS NULL THEN
    RAISE EXCEPTION 'p_outlet_id and p_cloud_kitchen_id are required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A requisition needs at least one item';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE e->>'raw_material_id' IS NULL
  ) THEN
    RAISE EXCEPTION 'Every requisition line needs a raw_material_id';
  END IF;

  -- allocation_request_items has CHECK (quantity > 0); fail readably.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE coalesce((e->>'quantity')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Every requisition line needs a quantity greater than 0';
  END IF;

  -- Also guarded by UNIQUE (allocation_request_id, raw_material_id), but
  -- catching it here gives the user a sentence instead of a constraint name.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    GROUP BY e->>'raw_material_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate materials detected. Please remove duplicates.';
  END IF;

  -- The business day, decided here so all callers agree. See header.
  v_today     := public.business_today();
  v_is_create := p_allocation_request_id IS NULL;
  v_supervisor := nullif(btrim(coalesce(p_supervisor_name, '')), '');

  v_new_items := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'raw_material_id', (e->>'raw_material_id')::uuid,
             'quantity',        (e->>'quantity')::numeric
           ) ORDER BY e->>'raw_material_id'), '[]'::jsonb)
    FROM jsonb_array_elements(p_items) e
  );

  -- =====================================================================
  -- CREATE (E1)
  -- =====================================================================
  IF v_is_create THEN
    -- One requisition per outlet per day. The three pages each checked a
    -- weaker version of this in JS (packed requests only) and there is no
    -- unique constraint backing it, so enforce the real rule here.
    SELECT id INTO v_existing_id
    FROM public.allocation_requests
    WHERE outlet_id = p_outlet_id AND request_date = v_today
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'This outlet already has a requisition for today. Edit that one instead.';
    END IF;

    INSERT INTO public.allocation_requests (
      outlet_id, cloud_kitchen_id, requested_by, request_date, is_packed, supervisor_name
    ) VALUES (
      p_outlet_id, p_cloud_kitchen_id, p_acting_user_id, v_today, false,
      CASE WHEN p_set_supervisor_name THEN v_supervisor END
    ) RETURNING * INTO v_request;

    v_request_id := v_request.id;

    INSERT INTO public.allocation_request_items (allocation_request_id, raw_material_id, quantity)
    SELECT v_request_id, (e->>'raw_material_id')::uuid, (e->>'quantity')::numeric
    FROM jsonb_array_elements(p_items) e;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

    v_event_id := public.log_audit_event(
      p_actor_user_id    => p_acting_user_id,
      p_actor_role       => v_actor_role,
      p_cloud_kitchen_id => p_cloud_kitchen_id,
      p_category         => 'requisition',
      p_action           => 'requisition_created',
      p_severity         => 'review',
      p_entity_type      => 'allocation_request',
      p_entity_id        => v_request_id,
      p_outlet_id        => p_outlet_id,
      p_new_values       => jsonb_build_object(
        'request_date',    v_today,
        'supervisor_name', v_request.supervisor_name,
        'item_count',      v_inserted_count,
        'items',           v_new_items
      )
    );

    RETURN json_build_object(
      'success', true, 'created', true, 'changed', true,
      'allocation_request_id', v_request_id,
      'request_date', v_today,
      'items_inserted', v_inserted_count
    );
  END IF;

  -- =====================================================================
  -- EDIT (E2 + E3)
  -- =====================================================================
  SELECT * INTO v_request
  FROM public.allocation_requests
  WHERE id = p_allocation_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation request not found: %', p_allocation_request_id;
  END IF;

  -- Re-assert what RLS can no longer enforce on this path. See header.
  IF v_request.is_packed THEN
    RAISE EXCEPTION 'This requisition has already been packed and cannot be edited.';
  END IF;

  IF v_request.outlet_id <> p_outlet_id THEN
    RAISE EXCEPTION 'Allocation request % does not belong to outlet %',
      p_allocation_request_id, p_outlet_id;
  END IF;

  v_request_id     := v_request.id;
  v_old_supervisor := v_request.supervisor_name;

  v_old_items := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'raw_material_id', i.raw_material_id,
             'quantity',        i.quantity
           ) ORDER BY i.raw_material_id), '[]'::jsonb)
    FROM public.allocation_request_items i
    WHERE i.allocation_request_id = v_request_id
  );

  -- Capture the lines about to disappear BEFORE deleting them — same
  -- reasoning as cancel_allocation_packing: the audit row has to outlive
  -- the rows it describes.
  v_deleted_items := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'raw_material_id', i.raw_material_id,
             'quantity',        i.quantity
           ) ORDER BY i.raw_material_id), '[]'::jsonb)
    FROM public.allocation_request_items i
    WHERE i.allocation_request_id = v_request_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) e
        WHERE (e->>'raw_material_id')::uuid = i.raw_material_id
      )
  );

  -- Header. notes is deliberately untouched: it is display-only in all
  -- three pages, and their update({ notes: editingRequest.notes }) was
  -- writing the same value back to itself.
  IF p_set_supervisor_name THEN
    UPDATE public.allocation_requests
    SET supervisor_name = v_supervisor
    WHERE id = v_request_id;
  END IF;

  -- Items: delete, then update, then insert. Set-based rather than the
  -- client's row-at-a-time loops.
  DELETE FROM public.allocation_request_items i
  WHERE i.allocation_request_id = v_request_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) e
      WHERE (e->>'raw_material_id')::uuid = i.raw_material_id
    );
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- IS DISTINCT FROM on numeric is an exact comparison. The client used a
  -- 0.0001 tolerance, which was working around JS float error that does
  -- not exist here; numeric equality also ignores trailing zeros, so
  -- 5.0 vs 5.00 correctly counts as unchanged.
  UPDATE public.allocation_request_items i
  SET quantity = e.qty
  FROM (
    SELECT (el->>'raw_material_id')::uuid AS rm, (el->>'quantity')::numeric AS qty
    FROM jsonb_array_elements(p_items) el
  ) e
  WHERE i.allocation_request_id = v_request_id
    AND i.raw_material_id = e.rm
    AND i.quantity IS DISTINCT FROM e.qty;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  INSERT INTO public.allocation_request_items (allocation_request_id, raw_material_id, quantity)
  SELECT v_request_id, e.rm, e.qty
  FROM (
    SELECT (el->>'raw_material_id')::uuid AS rm, (el->>'quantity')::numeric AS qty
    FROM jsonb_array_elements(p_items) el
  ) e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.allocation_request_items i
    WHERE i.allocation_request_id = v_request_id AND i.raw_material_id = e.rm
  );
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- Nothing actually moved: don't manufacture an audit row. Re-opening a
  -- requisition and pressing Confirm without changing anything is not a
  -- decision anyone needs to review.
  IF v_deleted_count = 0 AND v_updated_count = 0 AND v_inserted_count = 0
     AND (NOT p_set_supervisor_name OR v_old_supervisor IS NOT DISTINCT FROM v_supervisor)
  THEN
    RETURN json_build_object(
      'success', true, 'created', false, 'changed', false,
      'allocation_request_id', v_request_id,
      'request_date', v_request.request_date
    );
  END IF;

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  -- Only correlate when there IS a second event to pair with, so the
  -- partial index on correlation_id stays meaningful (same rule as D3).
  v_correlation := CASE WHEN v_deleted_count > 0 THEN v_request_id END;

  -- E2 — the edit itself, record-level before/after per decision #4.
  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => v_request.cloud_kitchen_id,
    p_category         => 'requisition',
    p_action           => 'requisition_updated',
    p_severity         => 'review',
    p_entity_type      => 'allocation_request',
    p_entity_id        => v_request_id,
    p_outlet_id        => v_request.outlet_id,
    p_correlation_id   => v_correlation,
    p_old_values       => jsonb_build_object(
      'supervisor_name', v_old_supervisor,
      'items',           v_old_items
    ),
    p_new_values       => jsonb_build_object(
      'supervisor_name', CASE WHEN p_set_supervisor_name THEN v_supervisor ELSE v_old_supervisor END,
      'items',           v_new_items,
      'items_deleted',   v_deleted_count,
      'items_updated',   v_updated_count,
      'items_inserted',  v_inserted_count
    )
  );

  -- E3 — deletions get their own row. §6.3 files E3 under the reversal
  -- category at critical severity: removing a line erases evidence of what
  -- was originally asked for, and that belongs in the critical queue rather
  -- than buried inside a routine edit.
  IF v_deleted_count > 0 THEN
    PERFORM public.log_audit_event(
      p_actor_user_id    => p_acting_user_id,
      p_actor_role       => v_actor_role,
      p_cloud_kitchen_id => v_request.cloud_kitchen_id,
      p_category         => 'reversal',
      p_action           => 'requisition_items_deleted',
      p_severity         => 'critical',
      p_entity_type      => 'allocation_request',
      p_entity_id        => v_request_id,
      p_outlet_id        => v_request.outlet_id,
      p_correlation_id   => v_correlation,
      p_old_values       => jsonb_build_object(
        'deleted_items', v_deleted_items,
        'items_before',  v_old_items
      ),
      p_new_values       => jsonb_build_object(
        'deleted_count', v_deleted_count,
        'items_after',   v_new_items
      )
    );
  END IF;

  RETURN json_build_object(
    'success', true, 'created', false, 'changed', true,
    'allocation_request_id', v_request_id,
    'request_date', v_request.request_date,
    'items_deleted',  v_deleted_count,
    'items_updated',  v_updated_count,
    'items_inserted', v_inserted_count
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- G1/G2 — unchanged except for the date derivation.
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
  v_today     := public.business_today();
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
COMMIT;

-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. The rollover is back at 05:30 IST:
--      SELECT public.business_today() AS business_day,
--             (now() AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
--             to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist_now;
--    -- between 00:00 and 05:30 IST these two dates should DIFFER, and
--    -- business_day should be the earlier one. Otherwise they match.
--
-- 2. Both RPCs use it:
--      SELECT proname,
--             pg_get_functiondef(oid) ILIKE '%business_today%'  AS uses_helper,
--             pg_get_functiondef(oid) ILIKE '%Asia/Kolkata%'    AS still_ist
--      FROM pg_proc
--      WHERE proname IN ('save_allocation_request','save_dispatch_plan')
--        AND pronamespace = 'public'::regnamespace;
--    -- expect uses_helper = true, still_ist = false for both.
--
-- 3. The scenario that was broken — plan locked in the morning, closing
--    filed at 00:30 IST the next morning — should find the plan again.
--    Confirm plan_date and the frontend's "today" agree in that window.
-- =====================================================================
