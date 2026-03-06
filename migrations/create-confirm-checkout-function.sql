-- =====================================================================
-- Supervisor Checkout Feature - Confirm Checkout Function
-- Creates a Postgres function to confirm checkout and update inventory
-- =====================================================================

BEGIN;

-- =====================================================================
-- CREATE CONFIRM_CHECKOUT_FORM FUNCTION
-- =====================================================================

CREATE OR REPLACE FUNCTION public.confirm_checkout_form(p_checkout_form_id UUID)
RETURNS JSON AS $$
DECLARE
    v_checkout_record RECORD;
    v_dispatch_plan_record RECORD;
    v_stock_in_id UUID;
    v_return_item RECORD;
    v_aggregated_returns RECORD;
    v_last_batch_cost NUMERIC;
    v_total_returned NUMERIC := 0;
    v_result JSON;
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
    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        created_at
    ) VALUES (
        v_checkout_record.created_by,
        'checkout_confirmed',
        'checkout_form',
        p_checkout_form_id,
        jsonb_build_object(
            'status', 'submitted',
            'checkout_form_id', p_checkout_form_id
        ),
        jsonb_build_object(
            'status', 'confirmed',
            'stock_in_id', v_stock_in_id,
            'total_returned_qty', v_total_returned,
            'confirmed_at', NOW()
        ),
        NOW()
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.confirm_checkout_form IS 'Confirms a checkout form, creates stock_in batches for returned materials, and updates inventory';

COMMIT;
