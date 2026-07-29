-- =====================================================================
-- Close E1 / E2 / E3 / E4 — allocation requests (requisitions)
--
-- docs/AUDIT_TRAIL_REQUIREMENTS.md §3.E. The authorizing document for
-- essentially all outbound stock had no audit trail at all, across three
-- separate page entry points plus the PM's own after-the-fact additions.
--
--   E1  create requisition
--   E2  edit item quantities / header
--   E3  delete requisition lines
--   E4  PM adds an item to a supervisor's requisition, pre-pack
--
-- Two functions:
--   save_allocation_request()        E1 + E2 + E3 (one modal action)
--   add_items_to_allocation_request() E4          (different page/intent)
--
-- E1-E3 are one function because they are one user action: all three
-- confirmAllocation implementations create-or-edit in a single submit,
-- and an edit is a diff that can update, insert and delete lines at once.
-- Splitting them would mean three round trips that must not half-fail.
--
-- REPLACES THREE NEAR-IDENTICAL COPIES. confirmAllocation exists in
-- components/outlets/OutletsPageBase.jsx (supervisor + bp_operator),
-- pages/supervisor/OutletDetails.jsx and
-- pages/purchase-manager/OutletDetails.jsx. They had drifted; the only
-- intended difference is that the PM page does not set supervisor_name.
--
-- ---------------------------------------------------------------------
-- THE RLS TRAP THIS FUNCTION MUST HONOUR
--
-- allocation_request_items has INSERT, UPDATE and DELETE policies that
-- all require the parent request to have is_packed = false (see
-- restrict-allocation-request-items-insert-to-unpacked.sql and
-- add-allocation-request-items-update-delete-policies.sql). A SECURITY
-- DEFINER function owned by postgres BYPASSES those policies entirely.
--
-- So moving these writes server-side would have quietly REMOVED the
-- guard that stops anyone editing an already-packed requisition — stock
-- has already physically left against a fixed item list at that point.
-- Both functions below therefore re-assert is_packed = false in their own
-- logic. Do not remove those checks: nothing else is enforcing them on
-- this path any more.
-- ---------------------------------------------------------------------
--
-- ---------------------------------------------------------------------
-- TIMEZONE FIX (behaviour change, deliberate)
--
-- request_date was computed client-side, inconsistently:
--   OutletsPageBase        -> getLocalDateString()          (local = IST)
--   supervisor/OutletDetails -> toISOString().split('T')[0] (UTC)
--   purchase-manager/OutletDetails -> same                  (UTC)
--
-- IST is UTC+5:30, so between 00:00 and 05:30 IST the UTC date is still
-- YESTERDAY. Requisitions filed from the two OutletDetails pages in that
-- window landed on the wrong day, where "today's requests" queries could
-- not see them.
--
-- The live data settles which is correct: of 145 allocation_requests,
-- ZERO mismatch the IST date of their created_at and TWELVE mismatch the
-- UTC date. The business runs on IST. request_date is now derived
-- server-side as (now() AT TIME ZONE 'Asia/Kolkata')::date, so all three
-- entry points agree and none can drift again.
-- ---------------------------------------------------------------------
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- E1 / E2 / E3
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
  v_today     := (now() AT TIME ZONE 'Asia/Kolkata')::date;
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

COMMENT ON FUNCTION public.save_allocation_request IS
  'E1/E2/E3: creates or edits an allocation request and its items in one transaction, and logs it. Replaces the three near-identical client-side confirmAllocation implementations. Derives request_date server-side in IST. Re-asserts the is_packed guard that RLS can no longer enforce on this path, and enforces one requisition per outlet per day.';

-- ---------------------------------------------------------------------
-- E4 — PM adds an item to a supervisor's requisition, before packing.
--
-- Separate from save_allocation_request because the semantics differ:
-- that function REPLACES the item set from the outlet's own screen, this
-- one APPENDS from the PM's packing modal. Logged under its own action so
-- "the PM widened someone else's request after they submitted it" stays
-- distinguishable from the supervisor editing their own.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_items_to_allocation_request(
  p_acting_user_id        uuid,
  p_allocation_request_id uuid,
  p_items                 jsonb   -- [{raw_material_id, quantity}, ...]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request      public.allocation_requests%ROWTYPE;
  v_clash        text;
  v_added_items  jsonb;
  v_added_count  int := 0;
  v_actor_role   text;
  v_event_id     uuid;
BEGIN
  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', true, 'added', 0, 'changed', false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE e->>'raw_material_id' IS NULL
       OR coalesce((e->>'quantity')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Every added line needs a raw_material_id and a quantity greater than 0';
  END IF;

  SELECT * INTO v_request
  FROM public.allocation_requests
  WHERE id = p_allocation_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation request not found: %', p_allocation_request_id;
  END IF;

  -- Re-assert what RLS can no longer enforce here. Once packed, stock has
  -- left against a fixed list and the requisition must not grow.
  IF v_request.is_packed THEN
    RAISE EXCEPTION 'This requisition has already been packed; items cannot be added.';
  END IF;

  -- UNIQUE (allocation_request_id, raw_material_id) would catch this, but
  -- name the offender instead of surfacing a constraint violation.
  SELECT string_agg(DISTINCT rm.name, ', ') INTO v_clash
  FROM jsonb_array_elements(p_items) e
  JOIN public.allocation_request_items i
    ON i.allocation_request_id = p_allocation_request_id
   AND i.raw_material_id = (e->>'raw_material_id')::uuid
  JOIN public.raw_materials rm ON rm.id = i.raw_material_id;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Already on this requisition: %', v_clash;
  END IF;

  INSERT INTO public.allocation_request_items (allocation_request_id, raw_material_id, quantity)
  SELECT p_allocation_request_id, (e->>'raw_material_id')::uuid, (e->>'quantity')::numeric
  FROM jsonb_array_elements(p_items) e;

  GET DIAGNOSTICS v_added_count = ROW_COUNT;

  v_added_items := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'raw_material_id', (e->>'raw_material_id')::uuid,
             'quantity',        (e->>'quantity')::numeric
           ) ORDER BY e->>'raw_material_id'), '[]'::jsonb)
    FROM jsonb_array_elements(p_items) e
  );

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => v_request.cloud_kitchen_id,
    p_category         => 'requisition',
    p_action           => 'requisition_items_added_by_pm',
    p_severity         => 'review',
    p_entity_type      => 'allocation_request',
    p_entity_id        => p_allocation_request_id,
    p_outlet_id        => v_request.outlet_id,
    p_new_values       => jsonb_build_object(
      'added_by_purchase_manager', true,
      'requested_by',              v_request.requested_by,
      'supervisor_name',           v_request.supervisor_name,
      'added_count',               v_added_count,
      'added_items',               v_added_items
    )
  );

  RETURN json_build_object(
    'success', true, 'changed', true,
    'allocation_request_id', p_allocation_request_id,
    'added', v_added_count,
    'audit_event_id', v_event_id
  );
END;
$function$;

COMMENT ON FUNCTION public.add_items_to_allocation_request IS
  'E4: appends PM-added lines to an unpacked requisition and logs them under their own action, distinct from the outlet editing its own request. Re-asserts the is_packed guard that RLS can no longer enforce on this path.';

COMMIT;

-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. E1 — create, and confirm the date is IST not UTC. Run this between
--    00:00 and 05:30 IST to actually exercise the fix:
--      SELECT public.save_allocation_request(
--        p_acting_user_id   => '<user>',
--        p_outlet_id        => '<outlet>',
--        p_cloud_kitchen_id => '<ck>',
--        p_items            => '[{"raw_material_id":"<rm>","quantity":3}]'::jsonb);
--      -- returned request_date must equal (now() AT TIME ZONE 'Asia/Kolkata')::date
--
-- 2. One-per-day — repeat call 1 for the same outlet:
--      -- expect 'This outlet already has a requisition for today.'
--
-- 3. E2 + E3 — edit the request, dropping one line and changing another:
--      SELECT public.save_allocation_request(
--        p_acting_user_id        => '<user>',
--        p_outlet_id             => '<outlet>',
--        p_cloud_kitchen_id      => '<ck>',
--        p_allocation_request_id => '<request>',
--        p_items                 => '[{"raw_material_id":"<rm-kept>","quantity":9}]'::jsonb);
--    then:
--      SELECT action, category, severity, correlation_id
--      FROM public.audit_events WHERE entity_id = '<request>'
--      ORDER BY created_at;
--    -- expect requisition_updated (requisition/review) AND
--    --        requisition_items_deleted (reversal/critical),
--    --        both sharing one correlation_id.
--
-- 4. No-op edit writes nothing — re-run call 3 unchanged:
--      -- expect changed=false and NO new audit_events row.
--
-- 5. The is_packed guard still bites (this is the RLS bypass check):
--      UPDATE public.allocation_requests SET is_packed = true WHERE id = '<request>';
--      SELECT public.save_allocation_request(... same as call 3 ...);
--      -- expect 'already been packed and cannot be edited'
--      SELECT public.add_items_to_allocation_request('<user>','<request>',
--               '[{"raw_material_id":"<rm>","quantity":1}]'::jsonb);
--      -- expect 'already been packed; items cannot be added'
--      UPDATE public.allocation_requests SET is_packed = false WHERE id = '<request>';
--
-- 6. E4 — add an item, then add the same one again:
--      -- first call: added=1; second: 'Already on this requisition: <name>'
-- =====================================================================
