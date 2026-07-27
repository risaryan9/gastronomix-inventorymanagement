-- =====================================================================
-- Wire the remaining client-side ✅-audited flows to audit_events
--
-- pack_allocation_request (D1), cancel_allocation_packing (D4), and
-- confirm_checkout_form (F2) were already re-pointed at audit_events in
-- replace-audit-logs-with-audit-events.sql. The other four items marked
-- ✅ Audited in docs/AUDIT_TRAIL_REQUIREMENTS.md were still writing
-- straight to the client with a direct `.from('audit_logs').insert(...)`
-- call — which now targets a dropped table:
--   * B2 - manual inventory adjustment  (frontend/src/lib/manualInventoryAdjust.js)
--   * C1 - create raw material          (frontend/src/pages/purchase-manager/Materials.jsx)
--   * C2 - edit raw material            (frontend/src/pages/purchase-manager/Materials.jsx)
--   * D2 - self stock-out               (frontend/src/pages/purchase-manager/StockOut.jsx)
--
-- Each gets a narrow, purpose-built RPC (client-callable, unlike the
-- internal-only log_audit_event) that hardcodes its own category/action/
-- severity and entity_type server-side — the client only supplies the
-- business facts (quantities, old/new catalog fields, items), never the
-- audit action itself, so a compromised client can't spoof what kind of
-- event gets logged. This mirrors the existing pack_allocation_request
-- shape: client passes p_acting_user_id, the function derives the rest.
--
-- Business logic in the three frontend files is unchanged — only the
-- `audit_logs` insert at the end of each flow is replaced with one of
-- these RPC calls.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- B2: manual inventory adjustment (increment via synthetic stock-in, or
-- decrement via self stock-out + FIFO consume).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_manual_inventory_adjustment(
  p_acting_user_id      uuid,
  p_raw_material_id     uuid,
  p_cloud_kitchen_id    uuid,
  p_inventory_id        uuid,
  p_adjustment_type     text,   -- 'increment' | 'decrement'
  p_old_quantity        numeric,
  p_new_quantity        numeric,
  p_actual_new_quantity numeric,
  p_reason              text,
  p_details             text DEFAULT NULL,
  p_stock_in_id         uuid DEFAULT NULL,
  p_stock_out_id        uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_role text;
  v_event_id uuid;
BEGIN
  IF p_adjustment_type NOT IN ('increment', 'decrement') THEN
    RAISE EXCEPTION 'p_adjustment_type must be ''increment'' or ''decrement'', got: %', p_adjustment_type;
  END IF;

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => p_cloud_kitchen_id,
    p_category         => CASE WHEN p_adjustment_type = 'increment' THEN 'inventory_in' ELSE 'inventory_out' END,
    p_action           => 'inventory_' || p_adjustment_type,
    p_severity         => 'review',
    p_entity_type      => 'inventory',
    p_entity_id        => p_inventory_id,
    p_old_values       => jsonb_build_object(
      'quantity', p_old_quantity,
      'raw_material_id', p_raw_material_id,
      'cloud_kitchen_id', p_cloud_kitchen_id,
      'reason', p_reason,
      'details', p_details,
      'adjustment_type', p_adjustment_type,
      'adjustment_amount', abs(p_new_quantity - p_old_quantity),
      'stock_in_id', p_stock_in_id,
      'stock_out_id', p_stock_out_id
    ),
    p_new_values       => jsonb_build_object(
      'quantity', p_new_quantity,
      'raw_material_id', p_raw_material_id,
      'cloud_kitchen_id', p_cloud_kitchen_id,
      'actual_new_quantity', p_actual_new_quantity,
      'stock_in_id', p_stock_in_id,
      'stock_out_id', p_stock_out_id
    )
  );

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_manual_inventory_adjustment IS
  'Audit write for B2 (manual inventory adjustment). Called from frontend/src/lib/manualInventoryAdjust.js after the increment/decrement itself has already succeeded.';

-- ---------------------------------------------------------------------
-- C1 / C2: raw material create / update.
-- Two functions (not one parameterized by a flag) to mirror the existing
-- one-function-per-action convention (pack_allocation_request,
-- cancel_allocation_packing, confirm_checkout_form). raw_materials is a
-- global catalog (no cloud_kitchen_id column), so cloud_kitchen_id is
-- left NULL on these events.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_raw_material_created(
  p_acting_user_id  uuid,
  p_raw_material_id uuid,
  p_new_values      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_role text;
  v_event_id uuid;
BEGIN
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => NULL,
    p_category         => 'catalog',
    p_action           => 'create',
    p_severity         => 'review',
    p_entity_type      => 'raw_material',
    p_entity_id        => p_raw_material_id,
    p_new_values       => p_new_values
  );

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_raw_material_created IS
  'Audit write for C1 (create raw material). Called from frontend/src/pages/purchase-manager/Materials.jsx after the insert succeeds.';

CREATE OR REPLACE FUNCTION public.log_raw_material_updated(
  p_acting_user_id  uuid,
  p_raw_material_id uuid,
  p_old_values      jsonb,
  p_new_values      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_role text;
  v_event_id uuid;
BEGIN
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => NULL,
    p_category         => 'catalog',
    p_action           => 'update',
    p_severity         => 'review',
    p_entity_type      => 'raw_material',
    p_entity_id        => p_raw_material_id,
    p_old_values       => p_old_values,
    p_new_values       => p_new_values
  );

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_raw_material_updated IS
  'Audit write for C2 (edit raw material, incl. cost). Called from frontend/src/pages/purchase-manager/Materials.jsx after the update succeeds.';

-- ---------------------------------------------------------------------
-- D2: self stock-out (wastage / culinary R&D / dispatch / inter-cloud
-- source leg). Covers every self_stock_out reason uniformly, same as the
-- original client-side insert did.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_self_stock_out(
  p_acting_user_id   uuid,
  p_stock_out_id     uuid,
  p_cloud_kitchen_id uuid,
  p_reason           text,
  p_notes            text,
  p_items            jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_role text;
  v_event_id uuid;
BEGIN
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => p_cloud_kitchen_id,
    p_category         => 'inventory_out',
    p_action           => 'stock_out',
    p_severity         => 'review',
    p_entity_type      => 'stock_out',
    p_entity_id        => p_stock_out_id,
    p_new_values       => jsonb_build_object(
      'self_stock_out', true,
      'reason', p_reason,
      'notes', p_notes,
      'allocation_request_id', NULL,
      'outlet_id', NULL,
      'items', p_items
    )
  );

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_self_stock_out IS
  'Audit write for D2 (self stock-out: wastage / R&D / dispatch / inter-cloud source leg). Called from frontend/src/pages/purchase-manager/StockOut.jsx after the stock_out + items + FIFO consume have already succeeded.';

COMMIT;
