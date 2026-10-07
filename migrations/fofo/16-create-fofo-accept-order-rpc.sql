-- =====================================================================
-- The purchase manager accepts a FOFO order, in full
--
-- A paid order waits for the purchase manager of the kitchen that serves its
-- outlet (spec §8.3). Accepting it is the moment the goods are promised: the
-- stock leaves the kitchen's books in the same transaction, and the order goes
-- on to be packed. This file adds that one step.
--
-- WHAT CHANGES.
--
--   fofo.accept_order(order, acting user, ip, user agent)
--
-- Nothing else. The columns it fills have been there since 05
-- (orders.accepted_at, accepted_by; order_items.quantity_accepted) and 09
-- (stock_out.fofo_order_id).
--
-- IN FULL ONLY, FOR NOW. Every line is accepted at the quantity ordered. If
-- the kitchen does not hold enough of even one line, the whole accept is
-- refused and the order stays `paid`; the purchase manager stocks in the
-- shortfall and accepts again. Accepting LESS than was ordered (a trim) needs a
-- credit note and store credit written in the same transaction, and comes as a
-- later file that replaces this function. Until then there is no way to accept
-- part of an order, on purpose: a trim with no credit note would keep money for
-- goods that were never sent.
--
-- ALL OR NOTHING. One transaction: accepted quantities, the stock-out, the FIFO
-- consumption of every line, the status change and the audit event. If
-- anything fails, none of it happened. Two people pressing Accept at once are
-- serialised by a row lock on the order; the second finds it already accepted.
--
-- STOCK IS CHECKED TWICE, AND THE SECOND CHECK IS THE REAL ONE.
--   1. Before anything is written, every line is compared with what the
--      kitchen's batches hold, and ALL the shortfalls are reported together, by
--      name: "Marinade short by 2.5 kg; Paneer short by 1 kg". This exists for
--      the message.
--   2. public.fifo_consume then takes each line from the oldest batches first,
--      locking them, and raises if it comes up short. This is the guarantee:
--      it is what stops a requisition packed a moment earlier from being
--      promised twice. Its message names the material by id, so it is caught
--      and raised again in words; the accept is undone either way.
--
-- HOW THE STOCK-OUT IS WRITTEN (decision 0024). As a kitchen stock-out:
-- self_stock_out = true, reason = 'franchise-order', fofo_order_id set, and NO
-- outlet_id. public.stock_out only allows two shapes
-- (stock_out_self_stock_out_check): a requisition, which must have an
-- allocation request and an outlet, or a kitchen stock-out, which must have a
-- reason and neither. A sale to a franchise has no allocation request, so it
-- is the second. That also keeps it out of every report that reads
-- "self_stock_out = false" as "one of our own outlets consumed this". The
-- outlet is on the order, one join away through fofo_order_id.
--
-- WHAT LEAVES THE SHELF IS THE MATERIAL ORDERED, as it is: a finished good
-- leaves as a finished good, never as the ingredients of its recipe (spec §8.3).
--
-- WHO MAY CALL IT. Only the partner server (service_role), which has already
-- resolved a staff pass (decision 0023). The function still checks for itself
-- that the acting user is an active purchase manager of the order's kitchen:
-- the pass says who is calling, and this is where "which orders may they
-- touch" is finally enforced.
--
-- THE GOODS INVOICE IS NOT TOUCHED. It was issued when the order was paid (18)
-- and is never edited (decision 0016). An accept in full changes no money.
--
-- AUDIT. One event, fofo_money / order_accepted on the order, as 06 planned,
-- carrying the stock-out, every line and what the stock cost us.
--
-- Requires: 03, 05, 09, 10 (log_fofo_audit_event).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fofo.accept_order(
  p_order_id       uuid,
  p_acting_user_id uuid,
  p_ip_address     inet DEFAULT NULL,
  p_user_agent     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_order        fofo.orders%ROWTYPE;
  v_actor        public.users%ROWTYPE;
  v_outlet       text;
  v_franchise    text;
  v_shortfalls   text;
  v_stock_out_id uuid;
  v_line         record;
  v_consumed     jsonb;
  v_total_cost   numeric := 0;
  v_lines        jsonb := '[]'::jsonb;
  v_now          timestamptz := now();
BEGIN
  -- Lock the order: a second accept waits here, then finds it accepted.
  SELECT * INTO v_order FROM fofo.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT * INTO v_actor FROM public.users u WHERE u.id = p_acting_user_id;
  IF v_actor.id IS NULL
     OR v_actor.role <> 'purchase_manager'
     OR v_actor.is_active IS NOT TRUE
     OR v_actor.deleted_at IS NOT NULL
     OR v_actor.cloud_kitchen_id IS DISTINCT FROM v_order.cloud_kitchen_id THEN
    RAISE EXCEPTION 'Only a purchase manager of the kitchen that serves order % can accept it', v_order.order_number;
  END IF;

  IF v_order.status IN ('accepted', 'packed', 'ready_to_ship', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'Order % has already been accepted', v_order.order_number;
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Order % cannot be accepted: it is %', v_order.order_number, replace(v_order.status, '_', ' ');
  END IF;
  -- Cannot happen while the status check above holds; here so that stock can
  -- never leave twice for one order even if a status is ever set by hand.
  IF EXISTS (SELECT 1 FROM public.stock_out so WHERE so.fofo_order_id = v_order.id) THEN
    RAISE EXCEPTION 'Stock has already left for order %', v_order.order_number;
  END IF;

  -- 1. Every shortfall, by name, before anything is written.
  SELECT string_agg(
           format('%s short by %s %s', rm.name,
                  rtrim(rtrim(round(oi.quantity_ordered - held.quantity, 3)::text, '0'), '.'), rm.unit),
           '; ' ORDER BY rm.name)
    INTO v_shortfalls
    FROM fofo.order_items oi
    JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(b.quantity_remaining), 0) AS quantity
        FROM public.stock_in_batches b
       WHERE b.raw_material_id = oi.raw_material_id
         AND b.cloud_kitchen_id = v_order.cloud_kitchen_id
         AND b.quantity_remaining > 0
    ) held
   WHERE oi.order_id = v_order.id
     AND held.quantity < oi.quantity_ordered;

  IF v_shortfalls IS NOT NULL THEN
    RAISE EXCEPTION 'Not enough stock to accept order %: %. Stock in the shortfall, then accept again.',
      v_order.order_number, v_shortfalls;
  END IF;

  SELECT ou.name || ' (' || ou.code || ')' INTO v_outlet FROM public.outlets ou WHERE ou.id = v_order.outlet_id;
  SELECT f.name INTO v_franchise FROM fofo.franchises f WHERE f.id = v_order.franchise_id;

  -- 2. The stock-out, as a kitchen stock-out (see the header).
  INSERT INTO public.stock_out (
    cloud_kitchen_id, allocated_by, allocation_date,
    self_stock_out, reason, fofo_order_id, notes
  ) VALUES (
    v_order.cloud_kitchen_id, p_acting_user_id, CURRENT_DATE,
    true, 'franchise-order', v_order.id,
    format('Franchise order %s · %s · %s', v_order.order_number, v_franchise, v_outlet)
  ) RETURNING id INTO v_stock_out_id;

  -- 3. Each line: accepted as ordered, written to the stock-out, taken FIFO.
  --    In material order, so two accepts always lock batches the same way round.
  FOR v_line IN
    SELECT oi.id, oi.raw_material_id, oi.quantity_ordered, rm.name, rm.unit
      FROM fofo.order_items oi
      JOIN public.raw_materials rm ON rm.id = oi.raw_material_id
     WHERE oi.order_id = v_order.id
     ORDER BY oi.raw_material_id
  LOOP
    UPDATE fofo.order_items SET quantity_accepted = v_line.quantity_ordered, updated_at = v_now
     WHERE id = v_line.id;

    INSERT INTO public.stock_out_items (stock_out_id, raw_material_id, quantity)
    VALUES (v_stock_out_id, v_line.raw_material_id, v_line.quantity_ordered);

    -- Raises, and so undoes everything above, if the stock is not there after
    -- all: something else took it between the check and here. fifo_consume
    -- names the material by id, so its refusal is said again in words.
    BEGIN
      v_consumed := public.fifo_consume(
        v_stock_out_id, v_line.raw_material_id, v_line.quantity_ordered, v_order.cloud_kitchen_id
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'Insufficient stock%' THEN
        RAISE EXCEPTION 'Not enough stock to accept order %: % was taken by another stock-out while this was being accepted. Nothing was changed. Open the order again to see what is left.',
          v_order.order_number, v_line.name;
      END IF;
      RAISE;
    END;
    v_total_cost := v_total_cost + COALESCE((v_consumed->>'total_cost')::numeric, 0);

    v_lines := v_lines || jsonb_build_object(
      'raw_material_id', v_line.raw_material_id,
      'name', v_line.name,
      'unit', v_line.unit,
      'quantity_ordered', v_line.quantity_ordered,
      'quantity_accepted', v_line.quantity_ordered,
      'cost', COALESCE((v_consumed->>'total_cost')::numeric, 0)
    );
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Order % has no lines to accept', v_order.order_number;
  END IF;

  -- 4. The order moves on.
  UPDATE fofo.orders
     SET status = 'accepted', accepted_at = v_now, accepted_by = p_acting_user_id, updated_at = v_now
   WHERE id = v_order.id;

  -- 5. Audit.
  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => v_order.franchise_id,
    p_category         => 'fofo_money',
    p_action           => 'order_accepted',
    p_actor_user_id    => p_acting_user_id,
    p_severity         => 'review',
    p_entity_type      => 'fofo_order',
    p_entity_id        => v_order.id,
    p_outlet_id        => v_order.outlet_id,
    p_cloud_kitchen_id => v_order.cloud_kitchen_id,
    p_old_values       => jsonb_build_object('status', v_order.status),
    p_new_values       => jsonb_build_object(
      'status', 'accepted',
      'order_number', v_order.order_number,
      'stock_out_id', v_stock_out_id,
      'accepted_in_full', true,
      'stock_cost', v_total_cost,
      'items', v_lines
    ),
    p_ip_address       => p_ip_address,
    p_user_agent       => p_user_agent
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'stock_out_id', v_stock_out_id,
    'accepted_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION fofo.accept_order(uuid, uuid, inet, text) IS
'A purchase manager accepts a paid FOFO order in full: every line at the quantity ordered. One transaction writes the accepted quantities, a kitchen stock-out linked to the order (reason franchise-order), the FIFO consumption of each line, status accepted and an audit event. Refused, with every shortfall named, if the kitchen does not hold the stock; refused for anyone but an active purchase manager of the order''s kitchen. Accepting less than was ordered is not possible yet.';

-- Deny by default, then the partner server only (decision 0004).
REVOKE ALL ON FUNCTION fofo.accept_order(uuid, uuid, inet, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.accept_order(uuid, uuid, inet, text) TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Callable by the server only (proacl must not mention anon, authenticated or
-- a bare "=X"):
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace AND p.proname = 'accept_order';
--
-- After an order has been accepted from the Franchise Orders screen, what it
-- left behind. One stock-out per order, its quantities equal to the order's,
-- and the consumption adding up to the same:
--
-- SELECT o.order_number, o.status, o.accepted_at, u.full_name AS accepted_by,
--        so.id AS stock_out_id, so.reason, so.self_stock_out, so.outlet_id,
--        (SELECT SUM(oi.quantity_ordered)  FROM fofo.order_items oi WHERE oi.order_id = o.id) AS ordered,
--        (SELECT SUM(oi.quantity_accepted) FROM fofo.order_items oi WHERE oi.order_id = o.id) AS accepted,
--        (SELECT SUM(soi.quantity) FROM public.stock_out_items soi WHERE soi.stock_out_id = so.id) AS stocked_out,
--        (SELECT SUM(c.quantity_consumed) FROM public.stock_out_batch_consumption c WHERE c.stock_out_id = so.id) AS consumed
-- FROM fofo.orders o
-- JOIN public.stock_out so ON so.fofo_order_id = o.id
-- LEFT JOIN public.users u ON u.id = o.accepted_by
-- ORDER BY o.accepted_at DESC;
--
-- No order has had stock leave for it twice — this must return no rows:
--
-- SELECT fofo_order_id, COUNT(*) FROM public.stock_out
-- WHERE fofo_order_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;

-- =====================================================================
-- Rollback
-- =====================================================================
-- Removes the ability to accept. Orders already accepted, and the stock that
-- left for them, are not undone by this.
--
-- DROP FUNCTION IF EXISTS fofo.accept_order(uuid, uuid, inet, text);
