-- =====================================================================
-- Confirming a checkout no longer moves stock
--
-- The dispatch and closing flow is being made a record-keeping flow. A
-- dispatch plan is a plan; a closing sheet is a sheet. Neither changes what
-- the system believes is on the shelf. The purchase manager performs the
-- matching stock-in and stock-out by hand, as they already do for
-- everything else that physically moves.
--
-- WHAT ACTUALLY MOVED STOCK. Only this function. save_dispatch_plan()
-- writes dispatch_plan and dispatch_plan_items and nothing else, so the
-- planning half of the flow already satisfied this and is untouched. On the
-- closing sheet, only the *returns* moved stock: wastage, cash,
-- payment-onside and the additional details have always been stored as data
-- only.
--
-- WHAT THIS REMOVES. Steps 5 and 6 — the stock_in header and the
-- stock_in_batches rows built from checkout_form_return_items. Those
-- batches were what fed inventory.quantity, via
-- trigger_sync_inventory_quantity on stock_in_batches
-- (sync-inventory-from-batches-trigger.sql). With no batch inserted, that
-- trigger never fires and no inventory row is touched.
--
-- WHAT STAYS, deliberately:
--
--   * Every guard. The plan must exist and be locked, within 24 hours, and
--     the form must not already be confirmed. These read as stock guards
--     but they are data-quality guards — they keep a closing sheet attached
--     to the dispatch it closes — and they are the reason a sheet cannot be
--     filed against a plan from last week.
--
--   * The confirmed status and its edit lock. save_checkout_draft() refuses
--     to rewrite a confirmed form. Its inline comment gives the reason as
--     "F2 has already created a stock_in from these returns"; that reason is
--     now gone, but the lock is still right for a better one — a purchase
--     manager will have keyed stock against these figures by hand, and
--     numbers that move after someone has acted on them are worse than
--     numbers that cannot be corrected. That comment is stale and the
--     function is otherwise untouched; correcting a comment is not worth a
--     CREATE OR REPLACE of a 200-line function.
--
--   * total_returned_qty in the audit payload and the return value. It is
--     what was returned, which is still true and still worth recording. The
--     admin audit screen reads it.
--
-- WHAT CHANGES SHAPE. stock_in_id disappears from both the audit payload
-- and the returned json. Nothing consumed it: the only caller
-- (supervisor/Checkout.jsx) discards the result, and the audit renderer
-- reads total_returned_qty alone.
--
-- NOT BACKFILLED. Stock-in rows created by past confirmations are left
-- exactly as they are, and inventory keeps whatever they added. Reversing
-- them would subtract a second time anywhere a purchase manager has already
-- corrected a count by hand, and it would rewrite history to look as though
-- this had always been the rule.
--
-- CREATE OR REPLACE, NOT DROP + CREATE. DROP + CREATE re-applies this
-- database's ALTER DEFAULT PRIVILEGES (GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role); CREATE OR REPLACE preserves the existing
-- ACL. See fix-internal-audit-helper-grants.sql for the time that mattered.
--
-- STILL NO `SET search_path`. correlate-checkout-confirm-with-its-drafts.sql
-- notes this function is the only SECURITY DEFINER function in the checkout
-- path without that guard, and that adding it "belongs in its own migration
-- rather than riding along". That is still true, and this is not that
-- migration. Every reference in the body remains schema-qualified.
--
-- See docs/decisions/0010-dispatch-and-closing-do-not-move-stock.md
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_checkout_form(p_checkout_form_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_checkout_record RECORD;
    v_dispatch_plan_record RECORD;
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

    -- 5. Total what was returned.
    --
    -- Recorded, not applied. This figure goes into the audit trail and the
    -- return value so the confirmation says how much came back, but nothing
    -- downstream of here writes stock_in, stock_in_batches or inventory.
    -- The purchase manager records the physical movement.
    SELECT COALESCE(SUM(returned_quantity), 0)
    INTO v_total_returned
    FROM public.checkout_form_return_items
    WHERE checkout_form_id = p_checkout_form_id;

    -- 6. Update checkout_form status to confirmed
    UPDATE public.checkout_form
    SET
        status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_checkout_form_id;

    -- 7. Create audit log entry
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
      p_outlet_id        => v_checkout_record.outlet_id,
      p_correlation_id   => p_checkout_form_id,
      p_old_values       => jsonb_build_object(
        'status', 'submitted',
        'checkout_form_id', p_checkout_form_id
      ),
      p_new_values       => jsonb_build_object(
        'status', 'confirmed',
        'total_returned_qty', v_total_returned,
        'confirmed_at', NOW()
      )
    );

    -- 8. Return success response
    v_result := json_build_object(
        'success', true,
        'checkout_form_id', p_checkout_form_id,
        'total_returned_qty', v_total_returned,
        'message', 'Checkout confirmed. Stock is unchanged — the purchase manager records the movement.'
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error confirming checkout: %', SQLERRM;
END;
$function$;

COMMENT ON FUNCTION public.confirm_checkout_form IS
  'F2: confirms an outlet closing sheet and marks it no longer editable. Records what was returned but does NOT move stock — no stock_in, no batches, no inventory change; the purchase manager performs the physical stock-in. Logs against the outlet and shares the checkout form id as correlation_id with the F1 draft saves, so the chain of drafts and the confirmation that closed them read as one sequence.';

COMMIT;
