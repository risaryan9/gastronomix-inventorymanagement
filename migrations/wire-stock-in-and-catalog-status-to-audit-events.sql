-- =====================================================================
-- Close B1 / C3
--
-- docs/AUDIT_TRAIL_REQUIREMENTS.md:
--   B1 — stock-in finalize (receiving stock)      §3.B
--   C3 — deactivate / reactivate raw material     §3.C
--
-- Both are closed the way decision #2 asks for: the write path itself
-- moves into a SECURITY DEFINER Postgres function that logs as part of
-- the same transaction, rather than leaving the client to insert and then
-- politely ask for an audit row afterwards.
--
-- This is a stronger shape than the one used for B2/C1/C2/D2 in
-- wire-legacy-audit-writers-to-audit-events.sql, where the business logic
-- stayed client-side and only the audit write was an RPC. There the audit
-- can be skipped by a client that simply never calls it. Here it cannot:
-- there is no way to perform the action without producing the audit row.
-- It follows pack_allocation_request / confirm_checkout_form instead.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- B1: finalize_stock_in
--
-- Replaces the sequence StockIn.jsx -> handleFinalize used to run
-- client-side: insert stock_in, ensure an inventory row per material,
-- then insert stock_in_batches (whose trigger syncs inventory.quantity).
--
-- Two things this fixes beyond adding the audit trail:
--
--   1. ATOMICITY. Those were three separate client calls with no
--      transaction around them. A failure on the batches insert left an
--      orphaned stock_in header — a receipt with a cost and an invoice
--      number but no stock and no batches — and the code just threw. All
--      three now commit or roll back together.
--
--   2. GST CONSISTENCY. The client computed the header's total_cost from
--      the GST typed into the form, but wrote gst_percent = 0 onto the
--      batch whenever stock_in_type = 'kitchen'. The two could disagree.
--      GST is now normalized ONCE, server-side, and both the stored batch
--      and the total are derived from that same normalized value.
--
-- Deliberately restricted to the two types this UI flow produces.
-- 'inter_cloud' (D3) and 'manual_inventory' (B2) are also valid values of
-- stock_in.stock_in_type, but they are minted by their own flows with
-- their own audit entries; this function must not become a second way to
-- create them.
--
-- The invoice image is uploaded to storage by the client BEFORE this is
-- called, and its URL passed in. That ordering is unchanged: a failure
-- here can therefore leave an unreferenced file in the bucket, exactly as
-- it could before. Not a regression, but worth knowing.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_stock_in(
  p_acting_user_id    uuid,
  p_cloud_kitchen_id  uuid,
  p_receipt_date      date,
  p_stock_in_type     text,
  p_items             jsonb,   -- [{raw_material_id, quantity, unit_cost, gst_percent}, ...]
  p_supplier_name     text DEFAULT NULL,
  p_invoice_number    text DEFAULT NULL,
  p_notes             text DEFAULT NULL,
  p_invoice_image_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stock_in_id     uuid;
  v_item            jsonb;
  v_rm              uuid;
  v_qty             numeric;
  v_unit_cost       numeric;
  v_gst             numeric;
  v_line_total      numeric;
  v_total_cost      numeric := 0;
  v_item_count      int := 0;
  v_normalized      jsonb := '[]'::jsonb;
  v_supplier        text;
  v_invoice         text;
  v_actor_role      text;
BEGIN
  -- ---- validate -----------------------------------------------------
  IF p_stock_in_type IS NULL OR p_stock_in_type NOT IN ('purchase', 'kitchen') THEN
    RAISE EXCEPTION 'p_stock_in_type must be ''purchase'' or ''kitchen'', got: %', p_stock_in_type;
  END IF;

  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;

  IF p_cloud_kitchen_id IS NULL THEN
    RAISE EXCEPTION 'p_cloud_kitchen_id is required';
  END IF;

  IF p_receipt_date IS NULL THEN
    RAISE EXCEPTION 'p_receipt_date is required';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one stock-in item is required';
  END IF;

  -- Supplier/invoice are meaningful only for a purchase. Kitchen receipts
  -- force them to NULL, mirroring what the form already did.
  v_supplier := CASE WHEN p_stock_in_type = 'purchase'
                     THEN nullif(btrim(coalesce(p_supplier_name, '')), '') END;
  v_invoice  := CASE WHEN p_stock_in_type = 'purchase'
                     THEN nullif(btrim(coalesce(p_invoice_number, '')), '') END;

  IF p_stock_in_type = 'purchase' THEN
    IF v_supplier IS NULL THEN
      RAISE EXCEPTION 'Supplier name is required for a purchase stock-in';
    END IF;
    IF v_invoice IS NULL THEN
      RAISE EXCEPTION 'Invoice number is required for a purchase stock-in';
    END IF;
  END IF;

  -- ---- normalize + price the items ----------------------------------
  -- Done in its own pass so the header's total_cost is correct at INSERT
  -- time and every item is validated before anything is written.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_rm        := (v_item->>'raw_material_id')::uuid;
    v_qty       := (v_item->>'quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;

    -- Kitchen receipts carry no GST; a purchase uses what was entered.
    -- This single normalization feeds BOTH the batch row and the total.
    v_gst := CASE
               WHEN p_stock_in_type = 'kitchen' THEN 0
               ELSE coalesce((v_item->>'gst_percent')::numeric, 0)
             END;

    IF v_rm IS NULL THEN
      RAISE EXCEPTION 'Every stock-in item needs a raw_material_id';
    END IF;
    -- stock_in_batches has CHECK (quantity_purchased > 0); fail with a
    -- readable message instead of a constraint violation.
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than 0 (raw_material_id: %)', v_rm;
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Unit cost must be 0 or greater (raw_material_id: %)', v_rm;
    END IF;
    IF v_gst < 0 THEN
      RAISE EXCEPTION 'GST %% must be 0 or greater (raw_material_id: %)', v_rm;
    END IF;

    -- Same formula as the form: base + GST on base.
    v_line_total := (v_qty * v_unit_cost) * (1 + v_gst / 100);
    v_total_cost := v_total_cost + v_line_total;
    v_item_count := v_item_count + 1;

    v_normalized := v_normalized || jsonb_build_object(
      'raw_material_id', v_rm,
      'quantity',        v_qty,
      'unit_cost',       v_unit_cost,
      'gst_percent',     v_gst,
      'line_total',      v_line_total
    );
  END LOOP;

  -- ---- header -------------------------------------------------------
  INSERT INTO public.stock_in (
    cloud_kitchen_id, received_by, receipt_date,
    supplier_name, invoice_number, total_cost, notes,
    stock_in_type, invoice_image_url
  ) VALUES (
    p_cloud_kitchen_id, p_acting_user_id, p_receipt_date,
    v_supplier, v_invoice, v_total_cost,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_stock_in_type, nullif(btrim(coalesce(p_invoice_image_url, '')), '')
  ) RETURNING id INTO v_stock_in_id;

  -- ---- inventory rows, then batches ---------------------------------
  -- Order matters. trigger_sync_inventory_quantity upserts the inventory
  -- row itself when a batch lands, but with updated_by = NULL. Creating
  -- the row here first means the receiving user is recorded as
  -- updated_by, which is what the client code did; the trigger's ON
  -- CONFLICT branch then only touches quantity.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    INSERT INTO public.inventory (
      cloud_kitchen_id, raw_material_id, quantity, updated_by
    ) VALUES (
      p_cloud_kitchen_id, (v_item->>'raw_material_id')::uuid, 0, p_acting_user_id
    )
    ON CONFLICT (cloud_kitchen_id, raw_material_id) DO NOTHING;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    v_qty := (v_item->>'quantity')::numeric;

    INSERT INTO public.stock_in_batches (
      stock_in_id, raw_material_id, cloud_kitchen_id,
      quantity_purchased, quantity_remaining, unit_cost, gst_percent
    ) VALUES (
      v_stock_in_id,
      (v_item->>'raw_material_id')::uuid,
      p_cloud_kitchen_id,
      v_qty,
      v_qty,                      -- nothing consumed yet
      (v_item->>'unit_cost')::numeric,
      (v_item->>'gst_percent')::numeric
    );
  END LOOP;

  -- ---- audit --------------------------------------------------------
  -- The doc's stated reason for B1: "who received what, at what cost,
  -- against which invoice" — so supplier, invoice number, per-item unit
  -- cost and GST all belong in the payload, not just a total.
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  PERFORM public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => p_cloud_kitchen_id,
    p_category         => 'inventory_in',
    p_action           => 'stock_in_received',
    p_severity         => 'review',
    p_entity_type      => 'stock_in',
    p_entity_id        => v_stock_in_id,
    p_new_values       => jsonb_build_object(
      'stock_in_type',     p_stock_in_type,
      'receipt_date',      p_receipt_date,
      'supplier_name',     v_supplier,
      'invoice_number',    v_invoice,
      'invoice_image_url', nullif(btrim(coalesce(p_invoice_image_url, '')), ''),
      'total_cost',        v_total_cost,
      'item_count',        v_item_count,
      'items',             v_normalized
    )
  );

  RETURN json_build_object(
    'success',     true,
    'stock_in_id', v_stock_in_id,
    'total_cost',  v_total_cost,
    'item_count',  v_item_count
  );
END;
$function$;

COMMENT ON FUNCTION public.finalize_stock_in IS
  'B1: atomically creates a stock_in header + inventory rows + stock_in_batches and writes the audit_events row. Replaces the three separate client-side inserts in StockIn.jsx -> handleFinalize. Restricted to stock_in_type purchase|kitchen.';

-- ---------------------------------------------------------------------
-- C3: set_raw_material_active
--
-- Owns the is_active flip so it cannot happen without an audit row.
--
-- Worth recording why this matters more than the admin-only UI suggests:
-- raw_materials' UPDATE policy is is_purchase_manager_or_admin(), and
-- that function returns TRUE unconditionally for anon. Every key-based
-- login is anon. So the Materials screen hiding the button behind
-- isAdminMode stops nothing at the database — any key holder can flip
-- is_active with a direct API call. That is precisely the "app is the
-- only gate" exposure §1 gives as the reason to audit key-based roles at
-- all, and it is why C3 is worth a tripwire even though the button is
-- admin-only today.
--
-- Severity is 'critical', not 'review'. §1's criterion 3 names
-- "re-activations" outright as a reverse/override, and §6.3 maps
-- criterion 3 to critical. Deactivation is the doc's "make an item
-- disappear without deleting its history"; reactivation is the quiet undo
-- of that. Both are rare, so neither will crowd the review queue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_raw_material_active(
  p_acting_user_id  uuid,
  p_raw_material_id uuid,
  p_is_active       boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_material   public.raw_materials%ROWTYPE;
  v_actor_role text;
  v_event_id   uuid;
BEGIN
  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'p_is_active is required';
  END IF;

  SELECT * INTO v_material
  FROM public.raw_materials
  WHERE id = p_raw_material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material not found: %', p_raw_material_id;
  END IF;

  IF v_material.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Raw material is deleted and cannot be activated or deactivated: %', p_raw_material_id;
  END IF;

  -- Already in the requested state: report it and write nothing. Keeps a
  -- double-clicked confirm button from producing two identical "material
  -- deactivated" rows, which would read as two separate decisions.
  IF v_material.is_active IS NOT DISTINCT FROM p_is_active THEN
    RETURN json_build_object(
      'success',         true,
      'changed',         false,
      'raw_material_id', p_raw_material_id,
      'is_active',       p_is_active
    );
  END IF;

  UPDATE public.raw_materials
  SET is_active  = p_is_active,
      updated_at = now()
  WHERE id = p_raw_material_id;

  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  -- raw_materials is a global catalog with no cloud_kitchen_id, so these
  -- events carry a NULL cloud_kitchen_id — same as C1/C2.
  v_event_id := public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => NULL,
    p_category         => 'catalog',
    p_action           => CASE WHEN p_is_active THEN 'reactivate' ELSE 'deactivate' END,
    p_severity         => 'critical',
    p_entity_type      => 'raw_material',
    p_entity_id        => p_raw_material_id,
    p_old_values       => jsonb_build_object(
      'is_active', v_material.is_active,
      'name',      v_material.name,
      'code',      v_material.code,
      'unit',      v_material.unit
    ),
    p_new_values       => jsonb_build_object(
      'is_active', p_is_active,
      'name',      v_material.name,
      'code',      v_material.code,
      'unit',      v_material.unit
    )
  );

  RETURN json_build_object(
    'success',         true,
    'changed',         true,
    'raw_material_id', p_raw_material_id,
    'is_active',       p_is_active,
    'audit_event_id',  v_event_id
  );
END;
$function$;

COMMENT ON FUNCTION public.set_raw_material_active IS
  'C3: flips raw_materials.is_active and writes the audit_events row in one transaction. Called from Materials.jsx deactivate/activate confirmations. Returns changed=false (and logs nothing) when the material is already in the requested state.';

COMMIT;

-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. B1 — receive stock, then confirm header, batches, inventory and the
--    audit row all landed together:
--      SELECT public.finalize_stock_in(
--        p_acting_user_id   => '<pm-user-uuid>',
--        p_cloud_kitchen_id => '<ck-uuid>',
--        p_receipt_date     => CURRENT_DATE,
--        p_stock_in_type    => 'kitchen',
--        p_items            => '[{"raw_material_id":"<rm-uuid>","quantity":5,"unit_cost":100}]'::jsonb
--      );
--
-- 2. B1 — atomicity. A bad quantity must leave NOTHING behind:
--      SELECT public.finalize_stock_in(
--        p_acting_user_id   => '<pm-user-uuid>',
--        p_cloud_kitchen_id => '<ck-uuid>',
--        p_receipt_date     => CURRENT_DATE,
--        p_stock_in_type    => 'kitchen',
--        p_items            => '[{"raw_material_id":"<rm-uuid>","quantity":0,"unit_cost":100}]'::jsonb
--      );
--    -- expect an exception, and no new stock_in row for today.
--
-- 3. C3 — deactivate, then re-run to prove the no-op path is silent:
--      SELECT public.set_raw_material_active('<user-uuid>', '<rm-uuid>', false);
--      SELECT public.set_raw_material_active('<user-uuid>', '<rm-uuid>', false);
--    -- expect changed=true then changed=false, and exactly ONE audit row.
--
-- 4. Review what was written:
--      SELECT created_at, category, action, severity, actor_role,
--             entity_type, entity_id, old_values, new_values
--      FROM public.audit_events
--      WHERE action IN ('stock_in_received', 'deactivate', 'reactivate')
--      ORDER BY created_at DESC
--      LIMIT 20;
-- =====================================================================
