-- =====================================================================
-- Supervisors can raise tomorrow's requisition from 21:00 IST
--
-- APPLIED to production on 2026-10-15 (all four function bodies checked by
-- md5 of prosrc against this file). The frontend that ships with it must be
-- deployed too: until it is, a supervisor between 21:00 and 05:30 sees the
-- old "closed" banner, nothing worse.
--
-- WHY. Under add-requisition-cutoff-per-cloud-kitchen.sql a supervisor at a
-- Nippu Kodi or El Chaapo outlet could raise a requisition only between
-- 05:30 IST and the kitchen's cutoff (10:30-11:30). Supervisors who start
-- late would rather send tomorrow's order the night before, sometimes after
-- midnight, than wake up for it. So the window for business day D now runs
--
--   [ 21:00 IST on D-1 , cutoff IST on D )
--   [ 15:30 UTC on D-1 , cutoff - 05:30 UTC on D )   the same, in UTC
--
-- and a requisition raised in the night part of it is DATED D — the day it
-- is for — not the business day it was raised in. Decision 0025.
--
-- THE RULE IN UTC. The business day is the UTC date (decision 0002) and
-- that does not change here. "From 15:30 UTC, a supervisor's requisition is
-- for the next UTC date" covers both sides of midnight IST with one test:
-- 22:00 IST is 16:30 UTC and 02:00 IST is 20:30 UTC, both on the same UTC
-- day and both >= 15:30. The window then closes at the cutoff as before.
--
-- WHO. Only supervisors raising for NK and EC outlets — the people the
-- cutoff already holds. Boom Pizza operators already raise ~200
-- requisitions a month between 21:00 and 01:00, dated the day they raise
-- them and packed around 07:00 the next morning. Shifting their dates was
-- simulated against the last 60 days and produced a collision with the
-- one-requisition-per-outlet-per-day rule; supervisors-only produced none.
-- The purchase manager stays on today, so a late phone request at 22:00
-- still lands on today, as decision 0005 intends.
--
-- WHAT IS NOT SHIFTED. business_today() and getBusinessDate(). Checkout,
-- closing, dispatch and every report keep the UTC business day. Moving the
-- whole day was tried and reverted (0002); this moves one column, for one
-- role, at one time of day.
--
-- WHAT THIS MIGRATION DOES
--   1. public.requisition_cutoff_applies() — the NK/EC supervisor test, so
--      the brand list lives in one place in the database.
--   2. public.requisition_date_for() — the date a requisition raised now is
--      for. The one statement of the 15:30 UTC rule in the database.
--   3. save_allocation_request() — dates a new requisition with (2) instead
--      of business_today(). Restated in full because CREATE OR REPLACE
--      needs the whole body; the body is the live one (md5 of prosrc
--      checked against revert-business-day-to-utc.sql on 2026-10-15) with
--      two lines changed, both marked "0025".
--   4. enforce_requisition_cutoff() — opens the window at 21:00, and now
--      also refuses a supervisor's row whose request_date is not the one
--      (2) gives. That closes a hole that predates this change: RLS lets a
--      supervisor insert into allocation_requests directly, and the trigger
--      used to check only the clock, so any date could be written.
--   5. A CHECK that the cutoff is before 21:00 IST, so the two windows can
--      never overlap.
--
-- Mirrored in frontend/src/lib/requisitionCutoff.js (NEXT_DAY_OPENS_IST,
-- getRequisitionDate). Change both together.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Is this requisition held to the cutoff?
-- ---------------------------------------------------------------------
-- Not SECURITY DEFINER: it is only called from the two SECURITY DEFINER
-- functions below, which already run as the owner.
CREATE OR REPLACE FUNCTION public.requisition_cutoff_applies(
  p_user_id   uuid,
  p_outlet_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  -- Hard-coded on purpose (decision 0005). Mirrors CUTOFF_BRANDS in
  -- frontend/src/lib/requisitionCutoff.js. Brand is the outlet code prefix.
  SELECT EXISTS (
    SELECT 1
    FROM public.users u, public.outlets o
    WHERE u.id = p_user_id
      AND o.id = p_outlet_id
      AND u.role = 'supervisor'
      AND upper(left(o.code, 2)) = ANY (ARRAY['NK', 'EC'])
  );
$function$;

COMMENT ON FUNCTION public.requisition_cutoff_applies IS
'True when a requisition by this user for this outlet is held to the daily cutoff: a supervisor, at a Nippu Kodi or El Chaapo outlet. Decision 0005.';

-- ---------------------------------------------------------------------
-- 2. The date a requisition raised now is for
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.requisition_date_for(
  p_user_id   uuid,
  p_outlet_id uuid
)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  -- 15:30 UTC is 21:00 IST. From then until the UTC day ends (05:30 IST)
  -- a cutoff-bound supervisor is ordering for the next business day.
  SELECT CASE
    WHEN (now() AT TIME ZONE 'UTC')::time >= TIME '15:30'
         AND public.requisition_cutoff_applies(p_user_id, p_outlet_id)
      THEN public.business_today() + 1
    ELSE public.business_today()
  END;
$function$;

COMMENT ON FUNCTION public.requisition_date_for IS
'The request_date a requisition raised now by this user for this outlet carries. business_today(), except for an NK/EC supervisor from 21:00 IST (15:30 UTC) until 05:30 IST, who is ordering for the next business day. Decision 0025.';

-- ---------------------------------------------------------------------
-- 3. save_allocation_request — the live body, dated by requisition_date_for
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

  -- The date this requisition is for, decided here so all callers agree.
  -- 0025: business_today(), except an NK/EC supervisor from 21:00 IST is
  -- ordering for tomorrow. Only a create uses it; an edit keeps its date.
  v_today     := public.requisition_date_for(p_acting_user_id, p_outlet_id);
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
      -- 0025: name the date, since after 21:00 it is not today.
      RAISE EXCEPTION 'This outlet already has a requisition for %. Edit that one instead.',
        to_char(v_today, 'DD Mon YYYY');
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
-- 4. The cutoff trigger: the 21:00 window, and the date check
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_requisition_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role           text;
  v_expected_date  date;
  v_cutoff_ist     time;
  v_cutoff_utc     time;
BEGIN
  -- Only supervisors are held to any of this. The purchase manager raises
  -- requisitions from the same shared Outlets page and is the one packing
  -- them; bp_operator runs the exempt brand; admin is not restricted.
  SELECT role INTO v_role FROM public.users WHERE id = NEW.requested_by;
  IF v_role IS DISTINCT FROM 'supervisor' THEN
    RETURN NEW;
  END IF;

  -- The date is not the caller's to choose. save_allocation_request always
  -- writes this date; the check is for a direct insert through the API,
  -- which RLS permits and which could otherwise carry any date at all.
  v_expected_date := public.requisition_date_for(NEW.requested_by, NEW.outlet_id);
  IF NEW.request_date IS DISTINCT FROM v_expected_date THEN
    RAISE EXCEPTION
      'A requisition raised now is for %, not %.',
      to_char(v_expected_date, 'DD Mon YYYY'),
      coalesce(to_char(NEW.request_date, 'DD Mon YYYY'), 'no date')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.requisition_cutoff_applies(NEW.requested_by, NEW.outlet_id) THEN
    RETURN NEW;
  END IF;

  -- Dated tomorrow means it is between 21:00 and 05:30 IST: tomorrow's
  -- window is open and today's cutoff is not the one that applies.
  IF v_expected_date > public.business_today() THEN
    RETURN NEW;
  END IF;

  SELECT requisition_cutoff_ist INTO v_cutoff_ist
  FROM public.cloud_kitchens WHERE id = NEW.cloud_kitchen_id;

  -- No kitchen row, no cutoff to enforce. Refusing here would block a
  -- requisition over a lookup failure that has nothing to do with timing.
  IF v_cutoff_ist IS NULL THEN
    RETURN NEW;
  END IF;

  v_cutoff_utc := v_cutoff_ist - INTERVAL '5 hours 30 minutes';

  IF (now() AT TIME ZONE 'UTC')::time >= v_cutoff_utc THEN
    RAISE EXCEPTION
      'Requisitions for today closed at % IST. Tomorrow''s open at 9:00 PM IST tonight.',
      to_char(v_cutoff_ist, 'HH12:MI AM')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_requisition_cutoff IS
'BEFORE INSERT guard on allocation_requests. For a supervisor: refuses a request_date other than requisition_date_for(); for an NK or EC outlet, also refuses a requisition for today once the kitchen''s requisition_cutoff_ist has passed. From 21:00 IST the requisition is for tomorrow and is allowed. Editing an existing requisition is deliberately NOT blocked — see docs/REQUISITION_CUTOFF.md.';

-- ---------------------------------------------------------------------
-- 5. The cutoff must fall before tomorrow's window opens
-- ---------------------------------------------------------------------
-- A cutoff at or after 21:00 would let today's window run into tomorrow's,
-- and a requisition raised at 21:30 would be dated tomorrow while today's
-- was still nominally open.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cloud_kitchens_requisition_cutoff_before_next_window'
  ) THEN
    ALTER TABLE public.cloud_kitchens
    ADD CONSTRAINT cloud_kitchens_requisition_cutoff_before_next_window
    CHECK (requisition_cutoff_ist < TIME '21:00');
  END IF;
END $$;

COMMENT ON COLUMN public.cloud_kitchens.requisition_cutoff_ist IS
'Time of day, in IST, after which supervisors can no longer create a requisition for today for this kitchen''s Nippu Kodi and El Chaapo outlets. Stored as IST because that is the only timezone anyone here states it in; the trigger converts to UTC to compare. Tomorrow''s window opens at 21:00 IST (decision 0025), so this must be between 05:30 and 21:00.';

COMMIT;

-- =====================================================================
-- VERIFY (after applying)
-- =====================================================================
-- What a requisition raised right now would be dated, per role and brand:
--
--   SELECT u.role, upper(left(o.code, 2)) AS brand,
--          public.requisition_date_for(u.id, o.id) AS dated,
--          public.business_today() AS business_today
--   FROM public.users u CROSS JOIN public.outlets o
--   WHERE u.role IN ('supervisor', 'purchase_manager', 'bp_operator')
--   GROUP BY 1, 2, 3, 4 ORDER BY 1, 2;
--
-- Between 21:00 and 05:30 IST, supervisor NK/EC rows should show
-- business_today + 1 and every other row business_today.

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Re-run the trigger function from add-requisition-cutoff-per-cloud-kitchen.sql
-- and save_allocation_request from revert-business-day-to-utc.sql, then:
--
--   ALTER TABLE public.cloud_kitchens
--     DROP CONSTRAINT IF EXISTS cloud_kitchens_requisition_cutoff_before_next_window;
--   DROP FUNCTION IF EXISTS public.requisition_date_for(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.requisition_cutoff_applies(uuid, uuid);
--
-- Requisitions already dated tomorrow stay as they are; they are correct
-- under either rule once that day arrives.
