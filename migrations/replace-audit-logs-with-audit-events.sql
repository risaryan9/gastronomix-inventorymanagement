-- =====================================================================
-- Replace audit_logs with audit_events (+ audit_auth_events)
--
-- Drops the old single-table audit_logs (never used in production, per
-- decision — not migrated/backfilled) and replaces it with:
--   * audit_events       - spine table for every audited action
--   * audit_auth_events  - satellite table for login attempts (A1/A2),
--                          the one case with no real actor and no entity
--
-- Design/rationale lives in docs/AUDIT_TRAIL_REQUIREMENTS.md §6.
--
-- IMPORTANT: pack_allocation_request, cancel_allocation_packing, and
-- confirm_checkout_form currently INSERT INTO audit_logs directly. Dropping
-- that table without updating them would break packing/cancel/checkout in
-- production (insert into a table that no longer exists). This migration
-- re-creates all three (CREATE OR REPLACE, same signatures) so their audit
-- write goes through log_audit_event() against audit_events instead — no
-- other logic in those functions changes.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Drop the old table (and everything hanging directly off it).
--    is_admin() / is_purchase_manager_or_admin() are used by many OTHER
--    RLS policies across the app (inventory, stock_in, raw_materials, ...)
--    and are intentionally left in place.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- ---------------------------------------------------------------------
-- 1. Spine table: audit_events
-- ---------------------------------------------------------------------
CREATE TABLE public.audit_events (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),

  -- WHO
  actor_user_id      uuid REFERENCES public.users(id),
  actor_role         text,        -- role AT THE TIME of the action, not a
                                   -- live join to users.role

  -- WHERE (copied at write time so RLS/reporting never need per-entity joins)
  cloud_kitchen_id   uuid REFERENCES public.cloud_kitchens(id),
  outlet_id          uuid REFERENCES public.outlets(id),

  -- WHAT
  category           text NOT NULL,
  action             text NOT NULL,
  entity_type        text,
  entity_id          uuid,

  -- LINKING RELATED EVENTS
  correlation_id     uuid,
  reversed_event_id  uuid REFERENCES public.audit_events(id),

  -- PRIORITY
  severity           text NOT NULL DEFAULT 'info',

  -- PAYLOAD
  old_values         jsonb,
  new_values         jsonb,

  -- CONTEXT
  ip_address         inet,
  user_agent         text,
  session_id         uuid,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_events_category_check CHECK (category = ANY (ARRAY[
    'auth', 'inventory_in', 'catalog', 'inventory_out',
    'reversal', 'requisition', 'checkout', 'dispatch_plan'
  ])),
  CONSTRAINT audit_events_severity_check CHECK (severity = ANY (ARRAY[
    'info', 'review', 'critical'
  ]))
);

COMMENT ON TABLE public.audit_events IS
  'Spine table for every audited non-admin action. See docs/AUDIT_TRAIL_REQUIREMENTS.md for the business-logic catalogue this backs.';
COMMENT ON COLUMN public.audit_events.actor_role IS
  'Role at the time of the action — do not derive from a live join to users.role, which can change later.';
COMMENT ON COLUMN public.audit_events.correlation_id IS
  'Ties multiple rows from one logical action together, e.g. an inter-cloud-kitchen transfer''s source + destination legs.';
COMMENT ON COLUMN public.audit_events.reversed_event_id IS
  'Points at the audit_events row this one undoes, e.g. a cancel-packing row -> the pack row it reverses.';
COMMENT ON COLUMN public.audit_events.severity IS
  'info | review | critical — derived from the business-logic test in docs/AUDIT_TRAIL_REQUIREMENTS.md §1, not a free judgment call.';

CREATE INDEX idx_audit_events_cloud_kitchen ON public.audit_events(cloud_kitchen_id);
CREATE INDEX idx_audit_events_outlet        ON public.audit_events(outlet_id) WHERE outlet_id IS NOT NULL;
CREATE INDEX idx_audit_events_actor         ON public.audit_events(actor_user_id);
CREATE INDEX idx_audit_events_entity        ON public.audit_events(entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_audit_events_correlation   ON public.audit_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_events_category      ON public.audit_events(category);
CREATE INDEX idx_audit_events_severity      ON public.audit_events(severity) WHERE severity <> 'info';
CREATE INDEX idx_audit_events_created_at    ON public.audit_events(created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Satellite table: audit_auth_events (A1/A2 — the one shape that
--    doesn't fit the spine: no valid actor on failure, no entity at all).
-- ---------------------------------------------------------------------
CREATE TABLE public.audit_auth_events (
  id                          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id                    uuid NOT NULL REFERENCES public.audit_events(id) ON DELETE CASCADE,

  attempted_login_key_hash    text NOT NULL,  -- hash only, never the raw key
  attempted_role              text,
  attempted_cloud_kitchen_id  uuid REFERENCES public.cloud_kitchens(id),

  success                     boolean NOT NULL,
  resolved_user_id            uuid REFERENCES public.users(id),  -- null on failure
  failure_reason              text
);

COMMENT ON TABLE public.audit_auth_events IS
  'One row per key-based login attempt (success or failure), linked 1:1 to an audit_events row with category = ''auth''.';
COMMENT ON COLUMN public.audit_auth_events.attempted_login_key_hash IS
  'sha256 hex digest of the normalized login key — see hash_login_key(). Never store the raw key.';

CREATE INDEX idx_audit_auth_events_event           ON public.audit_auth_events(event_id);
CREATE INDEX idx_audit_auth_events_resolved_user   ON public.audit_auth_events(resolved_user_id) WHERE resolved_user_id IS NOT NULL;
CREATE INDEX idx_audit_auth_events_success         ON public.audit_auth_events(success);

-- ---------------------------------------------------------------------
-- 3. RLS
--    SELECT: admins see everything; everyone else sees rows where they
--    are the actor, or (for key-based/anon sessions) rows scoped to their
--    own cloud kitchen — application layer still filters by kitchen for
--    anon sessions, same caveat the old audit_logs policy had.
--    INSERT: deliberately NO policy for anon/authenticated. Writes only
--    happen through log_audit_event()/log_auth_event(), which are
--    SECURITY DEFINER and therefore bypass RLS — this is what makes
--    "no client-side inserts" (decision #2) actually enforceable rather
--    than just a convention.
--    UPDATE/DELETE: admin only, audit rows are otherwise immutable.
-- ---------------------------------------------------------------------
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_auth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to audit_events" ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Users view audit_events for own kitchen or own actions" ON public.audit_events
  FOR SELECT
  TO public
  USING (
    (
      auth.uid() IS NOT NULL
      AND (
        actor_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid()
            AND is_active = true
            AND cloud_kitchen_id = audit_events.cloud_kitchen_id
        )
      )
    )
    -- Key-based login (anon) sessions: same caveat as the old audit_logs
    -- policy — the app filters by cloud_kitchen_id client-side.
    OR (auth.uid() IS NULL AND is_purchase_manager_or_admin())
  );

CREATE POLICY "Admin can update audit_events" ON public.audit_events
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admin can delete audit_events" ON public.audit_events
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- audit_auth_events carries a key hash + failure reasons — admin-only, no
-- self-view (a user doesn't need to see their own hashed login attempts).
CREATE POLICY "Admin full access to audit_auth_events" ON public.audit_auth_events
  FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admin can update audit_auth_events" ON public.audit_auth_events
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admin can delete audit_auth_events" ON public.audit_auth_events
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------
-- 4. Helper functions
-- ---------------------------------------------------------------------

-- General-purpose write helper for every category except auth. Meant to be
-- called from inside other SECURITY DEFINER RPCs (pack_allocation_request,
-- future create_allocation_request, etc.) — not from the client.
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_actor_user_id     uuid,
  p_actor_role        text,
  p_cloud_kitchen_id  uuid,
  p_category          text,
  p_action            text,
  p_severity          text DEFAULT 'review',
  p_entity_type       text DEFAULT NULL,
  p_entity_id         uuid DEFAULT NULL,
  p_outlet_id         uuid DEFAULT NULL,
  p_correlation_id    uuid DEFAULT NULL,
  p_reversed_event_id uuid DEFAULT NULL,
  p_old_values        jsonb DEFAULT NULL,
  p_new_values        jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.audit_events (
    actor_user_id, actor_role, cloud_kitchen_id, outlet_id,
    category, action, entity_type, entity_id,
    correlation_id, reversed_event_id, severity,
    old_values, new_values
  ) VALUES (
    p_actor_user_id, p_actor_role, p_cloud_kitchen_id, p_outlet_id,
    p_category, p_action, p_entity_type, p_entity_id,
    p_correlation_id, p_reversed_event_id, p_severity,
    p_old_values, p_new_values
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_audit_event IS
  'Internal write helper for audit_events. Not directly callable by anon/authenticated (see REVOKE below) — call it from inside another SECURITY DEFINER function, matching the existing pack_allocation_request pattern.';

REVOKE EXECUTE ON FUNCTION public.log_audit_event(
  uuid, text, uuid, text, text, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb
) FROM PUBLIC;

-- Normalizes a login key the same way authenticate_user_by_key does
-- (trim, strip dashes, uppercase) and returns a sha256 hex digest — so a
-- failed/successful login attempt can be logged without ever storing the
-- raw key.
CREATE OR REPLACE FUNCTION public.hash_login_key(p_login_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT encode(
    extensions.digest(upper(replace(trim(p_login_key), '-', '')), 'sha256'),
    'hex'
  );
$function$;

-- Write helper for auth events (A1/A2): writes the audit_events row
-- (category = 'auth') and its audit_auth_events satellite row together.
-- Not wired into authenticate_user_by_key yet — that rewiring is a
-- separate, deliberate change to a live login path, not bundled here.
CREATE OR REPLACE FUNCTION public.log_auth_event(
  p_success                    boolean,
  p_attempted_login_key_hash   text,
  p_attempted_role             text,
  p_attempted_cloud_kitchen_id uuid,
  p_resolved_user_id           uuid DEFAULT NULL,
  p_failure_reason             text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.audit_events (
    actor_user_id, actor_role, cloud_kitchen_id,
    category, action, severity, new_values
  ) VALUES (
    p_resolved_user_id,
    p_attempted_role,
    p_attempted_cloud_kitchen_id,
    'auth',
    CASE WHEN p_success THEN 'login_success' ELSE 'login_failed' END,
    CASE WHEN p_success THEN 'info' ELSE 'critical' END,
    jsonb_build_object('success', p_success)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_auth_events (
    event_id, attempted_login_key_hash, attempted_role,
    attempted_cloud_kitchen_id, success, resolved_user_id, failure_reason
  ) VALUES (
    v_event_id, p_attempted_login_key_hash, p_attempted_role,
    p_attempted_cloud_kitchen_id, p_success, p_resolved_user_id, p_failure_reason
  );

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_auth_event IS
  'Internal write helper for A1/A2. Not directly callable by anon/authenticated (see REVOKE below).';

REVOKE EXECUTE ON FUNCTION public.log_auth_event(
  boolean, text, text, uuid, uuid, text
) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 5. Re-point the three existing RPCs at audit_events instead of the
--    now-dropped audit_logs. Only the audit block changes in each.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pack_allocation_request(
  p_allocation_request_id uuid,
  p_items jsonb,
  p_notes text,
  p_acting_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_request RECORD;
  v_stock_out_id uuid;
  v_item jsonb;
  v_rm uuid;
  v_qty numeric;
  v_total_cost numeric := 0;
  v_consume jsonb;
  v_actor_role text;
BEGIN
  -- Lock the request; guard against double-packing.
  SELECT * INTO v_request
  FROM public.allocation_requests
  WHERE id = p_allocation_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation request not found: %', p_allocation_request_id;
  END IF;
  IF v_request.is_packed THEN
    RAISE EXCEPTION 'Allocation request is already packed';
  END IF;

  -- Header (self_stock_out = false -> requires allocation_request_id + outlet_id)
  INSERT INTO public.stock_out (
    allocation_request_id, outlet_id, cloud_kitchen_id,
    allocated_by, allocation_date, notes, self_stock_out
  ) VALUES (
    p_allocation_request_id, v_request.outlet_id, v_request.cloud_kitchen_id,
    p_acting_user_id, CURRENT_DATE, NULLIF(btrim(COALESCE(p_notes, '')), ''), false
  ) RETURNING id INTO v_stock_out_id;

  -- Line items + FIFO consumption
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_rm  := (v_item->>'raw_material_id')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);

    INSERT INTO public.stock_out_items (stock_out_id, raw_material_id, quantity)
    VALUES (v_stock_out_id, v_rm, v_qty);

    IF v_qty > 0 THEN
      v_consume := public.fifo_consume(v_stock_out_id, v_rm, v_qty, v_request.cloud_kitchen_id);
      v_total_cost := v_total_cost + COALESCE((v_consume->>'total_cost')::numeric, 0);
    END IF;
  END LOOP;

  -- Mark packed
  UPDATE public.allocation_requests
  SET is_packed = true
  WHERE id = p_allocation_request_id;

  -- Audit
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  PERFORM public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => v_request.cloud_kitchen_id,
    p_category         => 'inventory_out',
    p_action           => 'requisition_packed',
    p_severity         => 'review',
    p_entity_type      => 'stock_out',
    p_entity_id        => v_stock_out_id,
    p_outlet_id        => v_request.outlet_id,
    p_new_values       => jsonb_build_object(
      'allocation_request_id', p_allocation_request_id,
      'outlet_id', v_request.outlet_id,
      'total_cost', v_total_cost,
      'items', p_items
    )
  );

  RETURN json_build_object(
    'success', true,
    'stock_out_id', v_stock_out_id,
    'total_cost', v_total_cost
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_allocation_packing(
  p_allocation_request_id uuid,
  p_acting_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_request RECORD;
  v_stock_out RECORD;
  v_consumption_count int;
  v_positive_items int;
  v_snapshot jsonb;
  v_cons RECORD;
  v_restored_qty numeric := 0;
  v_restored_items int := 0;
  v_actor_role text;
  v_reversed_event_id uuid;
BEGIN
  -- Lock request; must currently be packed.
  SELECT * INTO v_request
  FROM public.allocation_requests
  WHERE id = p_allocation_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation request not found: %', p_allocation_request_id;
  END IF;
  IF NOT v_request.is_packed THEN
    RAISE EXCEPTION 'Allocation request is not packed; nothing to cancel';
  END IF;

  -- The requisition's stock_out (self_stock_out = false).
  SELECT * INTO v_stock_out
  FROM public.stock_out
  WHERE allocation_request_id = p_allocation_request_id
    AND self_stock_out = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No stock-out found for this packed requisition';
  END IF;

  -- Same-day guard.
  IF v_stock_out.allocation_date <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Packing can only be cancelled on the same day it was packed';
  END IF;

  -- Legacy guard: positive line items but no consumption log -> cannot safely restore.
  SELECT count(*) INTO v_consumption_count
  FROM public.stock_out_batch_consumption
  WHERE stock_out_id = v_stock_out.id;

  SELECT count(*) INTO v_positive_items
  FROM public.stock_out_items
  WHERE stock_out_id = v_stock_out.id AND quantity > 0;

  IF v_positive_items > 0 AND v_consumption_count = 0 THEN
    RAISE EXCEPTION 'This packing predates batch tracking and cannot be auto-cancelled';
  END IF;

  -- Snapshot full state before deletion.
  v_snapshot := jsonb_build_object(
    'stock_out', to_jsonb(v_stock_out),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(si)) FROM public.stock_out_items si
      WHERE si.stock_out_id = v_stock_out.id
    ), '[]'::jsonb),
    'consumption', COALESCE((
      SELECT jsonb_agg(to_jsonb(c)) FROM public.stock_out_batch_consumption c
      WHERE c.stock_out_id = v_stock_out.id
    ), '[]'::jsonb)
  );

  -- Find the original pack event, if any, to link as reversed_event_id.
  SELECT id INTO v_reversed_event_id
  FROM public.audit_events
  WHERE entity_type = 'stock_out'
    AND entity_id = v_stock_out.id
    AND action = 'requisition_packed'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Restore each consumed batch by exactly the amount taken.
  FOR v_cons IN
    SELECT batch_id, quantity_consumed
    FROM public.stock_out_batch_consumption
    WHERE stock_out_id = v_stock_out.id
    FOR UPDATE
  LOOP
    UPDATE public.stock_in_batches
    SET quantity_remaining = quantity_remaining + v_cons.quantity_consumed
    WHERE id = v_cons.batch_id;

    v_restored_qty := v_restored_qty + v_cons.quantity_consumed;
    v_restored_items := v_restored_items + 1;
  END LOOP;

  -- Hard-delete the stock_out (cascades items + consumption log).
  DELETE FROM public.stock_out WHERE id = v_stock_out.id;

  -- Reopen the requisition.
  UPDATE public.allocation_requests
  SET is_packed = false
  WHERE id = p_allocation_request_id;

  -- Audit (snapshot preserved here since the rows are now gone).
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  PERFORM public.log_audit_event(
    p_actor_user_id     => p_acting_user_id,
    p_actor_role        => v_actor_role,
    p_cloud_kitchen_id  => v_request.cloud_kitchen_id,
    p_category          => 'reversal',
    p_action            => 'requisition_packing_cancelled',
    p_severity          => 'critical',
    p_entity_type       => 'stock_out',
    p_entity_id         => v_stock_out.id,
    p_outlet_id         => v_request.outlet_id,
    p_reversed_event_id => v_reversed_event_id,
    p_old_values        => v_snapshot,
    p_new_values        => jsonb_build_object(
      'allocation_request_id', p_allocation_request_id,
      'restored_batch_rows', v_restored_items,
      'restored_qty', v_restored_qty
    )
  );

  RETURN json_build_object(
    'success', true,
    'allocation_request_id', p_allocation_request_id,
    'restored_batch_rows', v_restored_items,
    'restored_qty', v_restored_qty
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_checkout_form(p_checkout_form_id UUID)
RETURNS JSON AS $function$
DECLARE
    v_checkout_record RECORD;
    v_dispatch_plan_record RECORD;
    v_stock_in_id UUID;
    v_aggregated_returns RECORD;
    v_last_batch_cost NUMERIC;
    v_total_returned NUMERIC := 0;
    v_result JSON;
    v_actor_role text;
BEGIN
    -- 1. Fetch the checkout form
    SELECT * INTO v_checkout_record
    FROM public.checkout_form
    WHERE id = p_checkout_form_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Checkout form not found with id: %', p_checkout_form_id;
    END IF;

    -- 2. Check if already confirmed
    IF v_checkout_record.status = 'confirmed' THEN
        RAISE EXCEPTION 'Checkout form has already been confirmed';
    END IF;

    -- 3. Fetch and validate the dispatch plan
    SELECT * INTO v_dispatch_plan_record
    FROM public.dispatch_plan
    WHERE id = v_checkout_record.dispatch_plan_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch plan not found';
    END IF;

    IF v_dispatch_plan_record.status != 'locked' THEN
        RAISE EXCEPTION 'Dispatch plan must be in locked status. Current status: %', v_dispatch_plan_record.status;
    END IF;

    -- 4. Validate 24-hour window (dispatch plan locked_at should be within last 24 hours)
    IF v_dispatch_plan_record.locked_at IS NOT NULL THEN
        IF v_dispatch_plan_record.locked_at < (NOW() - INTERVAL '24 hours') THEN
            RAISE EXCEPTION 'Dispatch plan was locked more than 24 hours ago. Cannot confirm checkout.';
        END IF;
    END IF;

    -- 5. Create stock_in header for the return
    INSERT INTO public.stock_in (
        cloud_kitchen_id,
        received_by,
        receipt_date,
        supplier_name,
        invoice_number,
        total_cost,
        notes,
        stock_in_type,
        invoice_image_url
    ) VALUES (
        v_checkout_record.cloud_kitchen_id,
        v_checkout_record.created_by,
        v_checkout_record.plan_date,
        NULL,
        NULL,
        NULL,
        'Supervisor checkout return for dispatch_plan ' || v_checkout_record.dispatch_plan_id,
        'kitchen',
        NULL
    ) RETURNING id INTO v_stock_in_id;

    -- 6. Aggregate returned quantities by raw_material_id and create stock_in_batches
    FOR v_aggregated_returns IN
        SELECT
            raw_material_id,
            SUM(returned_quantity) as total_returned
        FROM public.checkout_form_return_items
        WHERE checkout_form_id = p_checkout_form_id
        AND returned_quantity > 0
        GROUP BY raw_material_id
    LOOP
        -- Find the last batch for this material to get unit_cost
        SELECT unit_cost INTO v_last_batch_cost
        FROM public.stock_in_batches
        WHERE raw_material_id = v_aggregated_returns.raw_material_id
        AND cloud_kitchen_id = v_checkout_record.cloud_kitchen_id
        ORDER BY created_at DESC
        LIMIT 1;

        -- If no batch found, default to 0
        IF v_last_batch_cost IS NULL THEN
            v_last_batch_cost := 0;
        END IF;

        -- Insert stock_in_batch for the returned material
        INSERT INTO public.stock_in_batches (
            stock_in_id,
            raw_material_id,
            cloud_kitchen_id,
            quantity_purchased,
            quantity_remaining,
            unit_cost,
            gst_percent
        ) VALUES (
            v_stock_in_id,
            v_aggregated_returns.raw_material_id,
            v_checkout_record.cloud_kitchen_id,
            v_aggregated_returns.total_returned,
            v_aggregated_returns.total_returned,
            v_last_batch_cost,
            0
        );

        v_total_returned := v_total_returned + v_aggregated_returns.total_returned;
    END LOOP;

    -- 7. Update checkout_form status to confirmed
    UPDATE public.checkout_form
    SET
        status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_checkout_form_id;

    -- 8. Create audit log entry
    SELECT role INTO v_actor_role FROM public.users WHERE id = v_checkout_record.created_by;

    PERFORM public.log_audit_event(
      p_actor_user_id    => v_checkout_record.created_by,
      p_actor_role       => v_actor_role,
      p_cloud_kitchen_id => v_checkout_record.cloud_kitchen_id,
      p_category         => 'checkout',
      p_action           => 'checkout_confirmed',
      p_severity         => 'review',
      p_entity_type      => 'checkout_form',
      p_entity_id        => p_checkout_form_id,
      p_old_values       => jsonb_build_object(
        'status', 'submitted',
        'checkout_form_id', p_checkout_form_id
      ),
      p_new_values       => jsonb_build_object(
        'status', 'confirmed',
        'stock_in_id', v_stock_in_id,
        'total_returned_qty', v_total_returned,
        'confirmed_at', NOW()
      )
    );

    -- 9. Return success response
    v_result := json_build_object(
        'success', true,
        'checkout_form_id', p_checkout_form_id,
        'stock_in_id', v_stock_in_id,
        'total_returned_qty', v_total_returned,
        'message', 'Checkout confirmed successfully and inventory updated'
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error confirming checkout: %', SQLERRM;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.confirm_checkout_form IS 'Confirms a checkout form, creates stock_in batches for returned materials, and updates inventory. Audit write goes through log_audit_event() -> audit_events.';

COMMIT;
