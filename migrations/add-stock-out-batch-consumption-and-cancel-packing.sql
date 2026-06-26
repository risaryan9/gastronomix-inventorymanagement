-- Migration: stock-out batch consumption tracking + atomic packing / cancel-packing
--
-- Adds a per-batch consumption ledger so every FIFO stock-out is reversible, and
-- replaces the client-side FIFO loop with atomic RPCs:
--   * fifo_consume               - decrement stock_in_batches oldest-first, log each batch touched
--   * pack_allocation_request    - create stock_out + items + FIFO consume + mark request packed
--   * cancel_allocation_packing  - restore consumed batches, delete the stock_out, reopen the request
--
-- Inventory.quantity is fully derived from SUM(stock_in_batches.quantity_remaining) via the existing
-- trigger_sync_inventory_quantity trigger, so restoring batch quantities is sufficient to correct
-- inventory on cancel (no separate stock_out -> inventory trigger exists).

-- ---------------------------------------------------------------------------
-- 1. Consumption ledger: one row per (stock_out, batch) FIFO decrement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_out_batch_consumption (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  stock_out_id      uuid NOT NULL REFERENCES public.stock_out(id) ON DELETE CASCADE,
  raw_material_id   uuid NOT NULL REFERENCES public.raw_materials(id),
  batch_id          uuid NOT NULL REFERENCES public.stock_in_batches(id),
  cloud_kitchen_id  uuid NOT NULL REFERENCES public.cloud_kitchens(id) ON DELETE CASCADE,
  quantity_consumed numeric(10,3) NOT NULL CHECK (quantity_consumed > 0),
  unit_cost         numeric(10,2) NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sobc_stock_out ON public.stock_out_batch_consumption (stock_out_id);
CREATE INDEX IF NOT EXISTS idx_sobc_batch     ON public.stock_out_batch_consumption (batch_id);

-- ---------------------------------------------------------------------------
-- 2. fifo_consume: decrement oldest batches first, logging each row consumed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fifo_consume(
  p_stock_out_id uuid,
  p_raw_material_id uuid,
  p_quantity numeric,
  p_cloud_kitchen_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_remaining numeric := p_quantity;
  v_total_cost numeric := 0;
  v_to_take numeric;
  v_batch RECORD;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('total_cost', 0, 'total_consumed', 0);
  END IF;

  -- Oldest batches first; lock so concurrent consumers can't double-spend.
  FOR v_batch IN
    SELECT id, quantity_remaining, unit_cost
    FROM public.stock_in_batches
    WHERE raw_material_id = p_raw_material_id
      AND cloud_kitchen_id = p_cloud_kitchen_id
      AND quantity_remaining > 0
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_to_take := LEAST(v_batch.quantity_remaining, v_remaining);

    UPDATE public.stock_in_batches
    SET quantity_remaining = quantity_remaining - v_to_take
    WHERE id = v_batch.id;

    INSERT INTO public.stock_out_batch_consumption (
      stock_out_id, raw_material_id, batch_id, cloud_kitchen_id,
      quantity_consumed, unit_cost
    ) VALUES (
      p_stock_out_id, p_raw_material_id, v_batch.id, p_cloud_kitchen_id,
      v_to_take, COALESCE(v_batch.unit_cost, 0)
    );

    v_total_cost := v_total_cost + v_to_take * COALESCE(v_batch.unit_cost, 0);
    v_remaining := v_remaining - v_to_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient stock for material %. Short by % units',
      p_raw_material_id, round(v_remaining, 3);
  END IF;

  RETURN jsonb_build_object(
    'total_cost', v_total_cost,
    'total_consumed', p_quantity
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. pack_allocation_request: atomic requisition packing.
-- ---------------------------------------------------------------------------
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
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_values)
  VALUES (
    p_acting_user_id, 'requisition_packed', 'stock_out', v_stock_out_id,
    jsonb_build_object(
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

-- ---------------------------------------------------------------------------
-- 4. cancel_allocation_packing: reverse a same-day packing.
-- ---------------------------------------------------------------------------
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
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (
    p_acting_user_id, 'requisition_packing_cancelled', 'stock_out', v_stock_out.id,
    v_snapshot,
    jsonb_build_object(
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
