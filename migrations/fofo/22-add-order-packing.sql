-- =====================================================================
-- The kitchen executive packs an accepted FOFO order
--
-- Once a purchase manager has accepted an order (16) its stock has already
-- left the kitchen's books. What is left is physical: the kitchen executive
-- gathers the goods, boxes them, sticks on the shipping label and says so
-- (spec §8.4, step 1). This file adds that one step.
--
-- WHAT CHANGES.
--
--   fofo.orders.packed_by                  who packed it, beside packed_at (05)
--   fofo.mark_order_packed(order, acting user, ip, user agent)
--
-- PACKING MOVES NOTHING BUT THE STATUS. No stock, no money, no document. The
-- stock left at accept and the goods invoice was issued at payment. So unlike
-- accept there is nothing here that can come up short: the only refusals are
-- the wrong person or the wrong moment.
--
-- WHO MAY CALL IT. Only the partner server (service_role), which has resolved a
-- staff pass (decision 0023). The function checks again that the acting user is
-- an active KITCHEN EXECUTIVE of the order's kitchen. A purchase manager cannot
-- mark an order packed: the spec keeps "this was accepted" and "this is boxed"
-- as two people's statements, and the purchase manager raises the logistics
-- invoice only after hearing the second from the first.
--
-- THE LABEL IS NOT PART OF THIS. Printing the shipping label is a read
-- (GET /api/staff/orders/label) and can be done before or after, any number of
-- times. Nothing records that a label was printed, and packing does not
-- require one.
--
-- THERE IS NO UNPACK. An order marked packed by mistake stays packed; the
-- status only ever moves forward (spec §9).
--
-- AUDIT. One event, fofo_money / order_packed on the order, severity info: the
-- same category as the order's other steps (06), though no money moves.
--
-- Requires: 03, 05, 10 (log_fofo_audit_event), 16 (something to pack).
-- =====================================================================

BEGIN;

ALTER TABLE fofo.orders
  ADD COLUMN IF NOT EXISTS packed_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN fofo.orders.packed_by IS
'The kitchen executive who marked the order packed. NULL until then. Beside packed_at, as accepted_by sits beside accepted_at.';

CREATE OR REPLACE FUNCTION fofo.mark_order_packed(
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
  v_order fofo.orders%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_now   timestamptz := now();
BEGIN
  -- Lock the order: a second press waits here, then finds it packed.
  SELECT * INTO v_order FROM fofo.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT * INTO v_actor FROM public.users u WHERE u.id = p_acting_user_id;
  IF v_actor.id IS NULL
     OR v_actor.role <> 'kitchen_executive'
     OR v_actor.is_active IS NOT TRUE
     OR v_actor.deleted_at IS NOT NULL
     OR v_actor.cloud_kitchen_id IS DISTINCT FROM v_order.cloud_kitchen_id THEN
    RAISE EXCEPTION 'Only a kitchen executive of the kitchen that serves order % can mark it packed', v_order.order_number;
  END IF;

  IF v_order.status IN ('packed', 'ready_to_ship', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'Order % has already been packed', v_order.order_number;
  END IF;
  IF v_order.status = 'paid' THEN
    RAISE EXCEPTION 'Order % has not been accepted by the purchase manager yet', v_order.order_number;
  END IF;
  IF v_order.status <> 'accepted' THEN
    RAISE EXCEPTION 'Order % cannot be packed: it is %', v_order.order_number, replace(v_order.status, '_', ' ');
  END IF;

  UPDATE fofo.orders
     SET status = 'packed', packed_at = v_now, packed_by = p_acting_user_id, updated_at = v_now
   WHERE id = v_order.id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => v_order.franchise_id,
    p_category         => 'fofo_money',
    p_action           => 'order_packed',
    p_actor_user_id    => p_acting_user_id,
    p_severity         => 'info',
    p_entity_type      => 'fofo_order',
    p_entity_id        => v_order.id,
    p_outlet_id        => v_order.outlet_id,
    p_cloud_kitchen_id => v_order.cloud_kitchen_id,
    p_old_values       => jsonb_build_object('status', v_order.status),
    p_new_values       => jsonb_build_object('status', 'packed', 'order_number', v_order.order_number),
    p_ip_address       => p_ip_address,
    p_user_agent       => p_user_agent
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'packed_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION fofo.mark_order_packed(uuid, uuid, inet, text) IS
'A kitchen executive marks an accepted FOFO order packed: status packed, packed_at and packed_by, and an audit event. Moves no stock and no money. Refused for anyone but an active kitchen executive of the order''s kitchen, and for an order that is not at accepted. There is no way back.';

-- Deny by default, then the partner server only (decision 0004).
REVOKE ALL ON FUNCTION fofo.mark_order_packed(uuid, uuid, inet, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.mark_order_packed(uuid, uuid, inet, text) TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The column exists, and the function is callable by the server only (proacl
-- must not mention anon, authenticated or a bare "=X"):
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'fofo' AND table_name = 'orders' AND column_name = 'packed_by';
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace AND p.proname = 'mark_order_packed';
--
-- Who packed what, once an order has been packed from the kitchen dashboard:
--
-- SELECT o.order_number, o.status, o.accepted_at, o.packed_at, u.full_name AS packed_by
-- FROM fofo.orders o LEFT JOIN public.users u ON u.id = o.packed_by
-- WHERE o.packed_at IS NOT NULL ORDER BY o.packed_at DESC;

-- =====================================================================
-- Rollback
-- =====================================================================
-- Orders already packed keep their status and packed_at; only who packed them
-- is lost with the column.
--
-- DROP FUNCTION IF EXISTS fofo.mark_order_packed(uuid, uuid, inet, text);
-- ALTER TABLE fofo.orders DROP COLUMN IF EXISTS packed_by;
