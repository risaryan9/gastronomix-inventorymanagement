-- =====================================================================
-- Close D3 — inter-cloud-kitchen transfer, destination leg
--
-- docs/AUDIT_TRAIL_REQUIREMENTS.md §3.D3 (the document's one ⚠️ partial).
--
-- A transfer has two legs. The SOURCE leg — stock leaving kitchen A — is
-- already audited as part of D2 via log_self_stock_out(). The DESTINATION
-- leg — a stock_in + stock_in_batches + inventory rows minted at kitchen
-- B, carrying FIFO cost across — had no audit entry of its own. Value
-- crossed an organizational boundary with only the depleting half on the
-- record.
--
-- This migration:
--   1. Adds receive_inter_cloud_transfer(), which owns the destination
--      writes and logs them (same "the function owns its write path"
--      shape as finalize_stock_in / set_raw_material_active).
--   2. Re-points log_self_stock_out() so the source leg stamps a
--      correlation_id. SAME SIGNATURE — no frontend change, no overload.
--
-- CORRELATION. §6.2 wants the two legs "reviewable as a matched pair".
-- Both legs derive the correlation_id deterministically as **the source
-- stock_out's id**. That needs no client-generated UUID and no ordering
-- between the two calls: each side already knows the source stock_out id,
-- so each can arrive at the same answer independently. Only inter-cloud
-- self-stock-outs get one — wastage/R&D/dispatch have no second leg to
-- pair with, and stamping them would pollute the partial index on
-- correlation_id for no benefit.
--
-- SCOPE. This makes the destination leg atomic *within itself* and
-- audited. It does NOT put the two legs in one transaction — see the
-- "known gap" note at the bottom.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Source leg: stamp the correlation_id.
--
--    Identical signature to the version in
--    wire-legacy-audit-writers-to-audit-events.sql, so this is a true
--    replace — no overload, and StockOut.jsx's existing call is untouched.
--    The only change is the p_correlation_id argument.
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
    -- Only an inter-cloud transfer has a second leg to be paired with.
    -- The source stock_out's id is the natural shared key: the
    -- destination leg knows it too (stock_in.source_stock_out_id).
    p_correlation_id   => CASE
                            WHEN p_reason = 'inter-cloud-kitchen'
                            THEN p_stock_out_id
                          END,
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
  'Audit write for D2 (self stock-out: wastage / R&D / dispatch / inter-cloud source leg). Called from StockOut.jsx after the stock_out + items + FIFO consume have already succeeded. Inter-cloud stock-outs also carry correlation_id = the stock_out id, pairing them with the destination leg logged by receive_inter_cloud_transfer().';

-- ---------------------------------------------------------------------
-- 2. Destination leg.
--
--    Everything is derived from the source stock_out row rather than
--    accepted from the caller: which kitchen sent the stock, which
--    kitchen receives it, and whether this is an inter-cloud transfer at
--    all. The client therefore cannot use this function to mint inventory
--    into an arbitrary kitchen — it can only complete a transfer that a
--    real stock_out already authorized.
--
--    The caller still supplies the per-item FIFO cost, because that is
--    the one fact only the source-side consume knows (fifo_consume
--    returns it and the rows it consumed are already spent by this
--    point).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_inter_cloud_transfer(
  p_acting_user_id      uuid,
  p_source_stock_out_id uuid,
  p_items               jsonb   -- [{raw_material_id, quantity, total_cost, total_qty}, ...]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stock_out       public.stock_out%ROWTYPE;
  v_existing        uuid;
  v_source_name     text;
  v_destination_id  uuid;
  v_stock_in_id     uuid;
  v_item            jsonb;
  v_rm              uuid;
  v_qty             numeric;
  v_total_cost      numeric;
  v_total_qty       numeric;
  v_unit_cost       numeric;
  v_transfer_cost   numeric := 0;
  v_item_count      int := 0;
  v_normalized      jsonb := '[]'::jsonb;
  v_actor_role      text;
BEGIN
  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'p_acting_user_id is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one transfer item is required';
  END IF;

  -- ---- authorize against the source stock_out ------------------------
  SELECT * INTO v_stock_out
  FROM public.stock_out
  WHERE id = p_source_stock_out_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source stock-out not found: %', p_source_stock_out_id;
  END IF;
  IF NOT v_stock_out.self_stock_out OR v_stock_out.reason IS DISTINCT FROM 'inter-cloud-kitchen' THEN
    RAISE EXCEPTION 'Stock-out % is not an inter-cloud-kitchen transfer', p_source_stock_out_id;
  END IF;

  v_destination_id := v_stock_out.transfer_to_cloud_kitchen_id;

  IF v_destination_id IS NULL THEN
    RAISE EXCEPTION 'Stock-out % has no destination cloud kitchen', p_source_stock_out_id;
  END IF;
  IF v_destination_id = v_stock_out.cloud_kitchen_id THEN
    RAISE EXCEPTION 'A transfer cannot have the same source and destination kitchen';
  END IF;

  -- ---- idempotency ---------------------------------------------------
  -- Minting the destination stock twice would invent inventory out of
  -- nothing, so a retry after a partial failure must not double up.
  SELECT id INTO v_existing
  FROM public.stock_in
  WHERE source_stock_out_id = p_source_stock_out_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object(
      'success',     true,
      'created',     false,
      'stock_in_id', v_existing,
      'message',     'Destination stock-in already exists for this transfer'
    );
  END IF;

  -- ---- normalize + cost the items ------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_rm         := (v_item->>'raw_material_id')::uuid;
    v_qty        := (v_item->>'quantity')::numeric;
    v_total_cost := coalesce((v_item->>'total_cost')::numeric, 0);
    v_total_qty  := coalesce((v_item->>'total_qty')::numeric, 0);

    IF v_rm IS NULL THEN
      RAISE EXCEPTION 'Every transfer item needs a raw_material_id';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Transfer quantity must be greater than 0 (raw_material_id: %)', v_rm;
    END IF;

    -- Carry the source's FIFO cost across as the destination's unit cost.
    -- Floored at 0.01 the same way the client did: a zero unit cost would
    -- make the transferred stock look free at the destination and corrupt
    -- every downstream cost report.
    v_unit_cost := CASE WHEN v_total_qty > 0 THEN v_total_cost / v_total_qty ELSE 0.01 END;
    v_unit_cost := greatest(0.01, v_unit_cost);

    v_transfer_cost := v_transfer_cost + v_total_cost;
    v_item_count    := v_item_count + 1;

    v_normalized := v_normalized || jsonb_build_object(
      'raw_material_id', v_rm,
      'quantity',        v_qty,
      'unit_cost',       v_unit_cost,
      'source_cost',     v_total_cost
    );
  END LOOP;

  -- ---- destination header --------------------------------------------
  -- Source kitchen name is looked up here rather than passed in; the
  -- client was falling back to a raw UUID in the notes whenever the
  -- session had no cloud_kitchen_name cached.
  SELECT name INTO v_source_name
  FROM public.cloud_kitchens
  WHERE id = v_stock_out.cloud_kitchen_id;

  INSERT INTO public.stock_in (
    cloud_kitchen_id, received_by, receipt_date,
    supplier_name, invoice_number, total_cost, notes,
    stock_in_type, invoice_image_url, source_stock_out_id
  ) VALUES (
    v_destination_id, p_acting_user_id, CURRENT_DATE,
    NULL, NULL, v_transfer_cost,
    'Transfer from ' || coalesce(v_source_name, v_stock_out.cloud_kitchen_id::text),
    'inter_cloud', NULL, p_source_stock_out_id
  ) RETURNING id INTO v_stock_in_id;

  -- ---- inventory rows, then batches -----------------------------------
  -- Same ordering rationale as finalize_stock_in: create the inventory
  -- row first so updated_by records a real user, then let
  -- trigger_sync_inventory_quantity fill in quantity when batches land.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    INSERT INTO public.inventory (
      cloud_kitchen_id, raw_material_id, quantity, updated_by
    ) VALUES (
      v_destination_id, (v_item->>'raw_material_id')::uuid, 0, p_acting_user_id
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
      v_destination_id,
      v_qty,
      v_qty,
      (v_item->>'unit_cost')::numeric,
      0                              -- GST does not re-apply on an internal move
    );
  END LOOP;

  -- ---- audit ----------------------------------------------------------
  -- cloud_kitchen_id is the DESTINATION: this event describes stock
  -- arriving at kitchen B, and that is the kitchen whose RLS scope should
  -- surface it. The source half stays on kitchen A via D2. correlation_id
  -- is what lets an admin pull the pair back together.
  SELECT role INTO v_actor_role FROM public.users WHERE id = p_acting_user_id;

  PERFORM public.log_audit_event(
    p_actor_user_id    => p_acting_user_id,
    p_actor_role       => v_actor_role,
    p_cloud_kitchen_id => v_destination_id,
    p_category         => 'inventory_in',
    p_action           => 'inter_cloud_transfer_received',
    p_severity         => 'review',
    p_entity_type      => 'stock_in',
    p_entity_id        => v_stock_in_id,
    p_correlation_id   => p_source_stock_out_id,
    p_new_values       => jsonb_build_object(
      'source_cloud_kitchen_id',      v_stock_out.cloud_kitchen_id,
      'source_cloud_kitchen_name',    v_source_name,
      'source_stock_out_id',          p_source_stock_out_id,
      'destination_cloud_kitchen_id', v_destination_id,
      'total_cost',                   v_transfer_cost,
      'item_count',                   v_item_count,
      'items',                        v_normalized
    )
  );

  RETURN json_build_object(
    'success',     true,
    'created',     true,
    'stock_in_id', v_stock_in_id,
    'total_cost',  v_transfer_cost,
    'item_count',  v_item_count
  );
END;
$function$;

COMMENT ON FUNCTION public.receive_inter_cloud_transfer IS
  'D3: creates the destination-side stock_in + batches + inventory rows for an inter-cloud transfer and logs the arrival, sharing correlation_id with the source leg. Derives both kitchens from the source stock_out, so it can only complete a transfer that stock_out already authorized. Idempotent on source_stock_out_id.';

COMMIT;

-- =====================================================================
-- Known gap this does NOT close
-- =====================================================================
-- The source leg (FIFO consume at kitchen A) and the destination leg
-- (mint at kitchen B) are still two separate client calls with no
-- transaction spanning them. If the destination call fails outright, the
-- source stock is already consumed and the stock simply vanishes.
--
-- That predates this change and is not made worse by it — the
-- idempotency guard above at least makes the natural fix (retry the
-- destination call) safe to perform. Closing it properly means folding
-- both legs into one RPC, which rewrites D2's already-audited path and
-- was deliberately left out of scope here.
--
-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. Perform a transfer through the UI, then confirm BOTH legs are
--    present and paired:
--      SELECT e.created_at, e.category, e.action, e.cloud_kitchen_id,
--             e.entity_type, e.entity_id, e.correlation_id
--      FROM public.audit_events e
--      WHERE e.correlation_id IS NOT NULL
--      ORDER BY e.created_at DESC
--      LIMIT 10;
--    -- expect two rows per transfer sharing one correlation_id:
--    --   inventory_out / stock_out                     (source kitchen)
--    --   inventory_in  / inter_cloud_transfer_received (destination kitchen)
--
-- 2. Confirm non-transfer self stock-outs are NOT correlated:
--      SELECT action, reason, correlation_id
--      FROM public.audit_events e
--      JOIN public.stock_out s ON s.id = e.entity_id
--      WHERE e.action = 'stock_out' AND s.reason <> 'inter-cloud-kitchen'
--      LIMIT 5;
--    -- expect correlation_id IS NULL on every row.
--
-- 3. Idempotency — calling twice must not mint the stock twice:
--      SELECT public.receive_inter_cloud_transfer(
--        '<user-uuid>', '<source-stock-out-uuid>',
--        '[{"raw_material_id":"<rm>","quantity":2,"total_cost":50,"total_qty":2}]'::jsonb);
--    -- second call returns created=false and creates no new stock_in.
--
-- 4. Authorization — a non-transfer stock_out must be rejected:
--      SELECT public.receive_inter_cloud_transfer(
--        '<user-uuid>', '<a-wastage-stock-out-uuid>',
--        '[{"raw_material_id":"<rm>","quantity":1,"total_cost":1,"total_qty":1}]'::jsonb);
--    -- expect "is not an inter-cloud-kitchen transfer".
--
-- NOTE: the 20 inter-cloud transfers that predate this migration have no
-- destination audit row and were deliberately not backfilled. Their
-- source legs also predate the correlation_id stamp, so pre-cutover
-- transfers show one uncorrelated source event only.
-- =====================================================================
