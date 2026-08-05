-- =====================================================================
-- F2 — stamp the checkout confirmation with its outlet and correlation id
--
-- docs/AUDIT_TRAIL_REQUIREMENTS.md §3.F1 says every draft save shares a
-- correlation_id (the checkout form's id) "so the chain of drafts and the
-- final F2 confirm are reviewable as one sequence — the exact case §6.2
-- named when the column was designed."
--
-- Half of that was never true. save_checkout_draft() does stamp
-- p_correlation_id => v_form_id on every draft, but confirm_checkout_form()
-- passes neither p_correlation_id nor p_outlet_id, so the confirmation —
-- the row that matters most, the one that made the figures official — sits
-- outside the chain it completes. Found while building the admin Dispatch &
-- Checkout audit screen: the drafts link to each other, the confirm links
-- to nothing, and it does not answer an outlet filter either, because
-- audit_events.outlet_id is null on it while every other checkout event
-- carries one.
--
-- WHAT CHANGES. Two arguments on the existing log_audit_event() call:
--
--   p_outlet_id      => v_checkout_record.outlet_id
--   p_correlation_id => p_checkout_form_id
--
-- The correlation value is the checkout form's id — deliberately the same
-- value save_checkout_draft() uses, since that is what the drafts are keyed
-- on and both sides already know it without coordinating.
--
-- Nothing else in the function is touched: same signature, same validation,
-- same stock_in creation, same return shape. No frontend change.
--
-- CREATE OR REPLACE, NOT DROP + CREATE. §6.5 records how the internal audit
-- helpers were silently re-opened to anon: DROP + CREATE re-applies this
-- database's default privileges (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE
-- ON FUNCTIONS TO anon, authenticated, service_role), while CREATE OR
-- REPLACE preserves the existing ACL. This function is meant to be callable
-- by the app, so its grants are not the problem — but the habit is what
-- stops the next one being a problem.
--
-- NOT BACKFILLED. Confirmations written before this migration keep a null
-- correlation_id and outlet_id. Their correlation could be reconstructed
-- exactly (entity_id *is* the checkout form id), but an audit trail is a
-- contemporaneous record; rewriting past rows to look as though they always
-- carried this would misrepresent when it became true. Same reasoning as
-- §3.D3's untouched transfers. As of this migration there are no
-- checkout_confirmed rows at all, so nothing is lost either way.
--
-- NOT CHANGED, but worth knowing. Unlike the functions added by the later
-- audit migrations, this one has no `SET search_path`. Every table and
-- function reference in its body is already schema-qualified, so it is not
-- exploitable as written, but it is the only SECURITY DEFINER function in
-- the checkout path without that guard. Adding it is a one-line change and
-- belongs in its own migration rather than riding along with an audit fix.
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
      -- Added: every other checkout event carries the outlet, and the
      -- correlation is what puts this row at the end of the chain of draft
      -- saves that led to it. save_checkout_draft() stamps the same value.
      p_outlet_id        => v_checkout_record.outlet_id,
      p_correlation_id   => p_checkout_form_id,
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
$function$;

COMMENT ON FUNCTION public.confirm_checkout_form IS
  'F2: confirms an outlet checkout, creating a stock_in from the returned quantities and marking the form confirmed. Logs against the outlet and shares the checkout form id as correlation_id with the F1 draft saves, so the chain of drafts and the confirmation that closed them read as one sequence.';

COMMIT;
