-- =====================================================================
-- Refactor checkout_form to be outlet-wise (one form per outlet per plan)
-- Previously: one form per dispatch_plan_id
-- After: one form per (dispatch_plan_id, outlet_id)
-- =====================================================================

BEGIN;

-- =====================================================================
-- STEP 1: Add outlet_id column (nullable initially for migration)
-- =====================================================================

ALTER TABLE public.checkout_form 
  ADD COLUMN IF NOT EXISTS outlet_id UUID NULL;

-- Add FK constraint
ALTER TABLE public.checkout_form 
  ADD CONSTRAINT checkout_form_outlet_id_fkey 
  FOREIGN KEY (outlet_id) REFERENCES public.outlets(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.checkout_form.outlet_id IS 'The specific outlet this closing form is for (one form per outlet per plan)';

-- =====================================================================
-- STEP 2: Migrate existing data (create outlet-wise forms from master forms)
-- =====================================================================

-- For each existing checkout_form (master form), create one new form per outlet
-- that has return_items, wastage_items, or additional data

DO $$
DECLARE
    v_old_form RECORD;
    v_outlet_id UUID;
    v_new_form_id UUID;
BEGIN
    -- Loop through all existing checkout_forms that don't have outlet_id set
    FOR v_old_form IN 
        SELECT * FROM public.checkout_form WHERE outlet_id IS NULL
    LOOP
        -- Get distinct outlet_ids from child tables for this form
        FOR v_outlet_id IN
            SELECT DISTINCT outlet_id
            FROM (
                SELECT outlet_id FROM public.checkout_form_return_items 
                WHERE checkout_form_id = v_old_form.id
                UNION
                SELECT outlet_id FROM public.checkout_form_wastage_items 
                WHERE checkout_form_id = v_old_form.id
                UNION
                SELECT outlet_id FROM public.checkout_form_additional 
                WHERE checkout_form_id = v_old_form.id
            ) AS outlet_ids
        LOOP
            -- Create new outlet-wise form
            INSERT INTO public.checkout_form (
                dispatch_plan_id,
                cloud_kitchen_id,
                plan_date,
                status,
                supervisor_name,
                created_by,
                created_at,
                updated_at,
                confirmed_at,
                outlet_id
            ) VALUES (
                v_old_form.dispatch_plan_id,
                v_old_form.cloud_kitchen_id,
                v_old_form.plan_date,
                v_old_form.status,
                v_old_form.supervisor_name,
                v_old_form.created_by,
                v_old_form.created_at,
                v_old_form.updated_at,
                v_old_form.confirmed_at,
                v_outlet_id
            ) RETURNING id INTO v_new_form_id;

            -- Update return_items for this outlet to point to new form
            UPDATE public.checkout_form_return_items
            SET checkout_form_id = v_new_form_id
            WHERE checkout_form_id = v_old_form.id
            AND outlet_id = v_outlet_id;

            -- Update wastage_items for this outlet to point to new form
            UPDATE public.checkout_form_wastage_items
            SET checkout_form_id = v_new_form_id
            WHERE checkout_form_id = v_old_form.id
            AND outlet_id = v_outlet_id;

            -- Update additional for this outlet to point to new form
            UPDATE public.checkout_form_additional
            SET checkout_form_id = v_new_form_id
            WHERE checkout_form_id = v_old_form.id
            AND outlet_id = v_outlet_id;

            RAISE NOTICE 'Migrated outlet % for old form % to new form %', v_outlet_id, v_old_form.id, v_new_form_id;
        END LOOP;

        -- Delete the old master form (all child rows have been reassigned)
        DELETE FROM public.checkout_form WHERE id = v_old_form.id;
        RAISE NOTICE 'Deleted old master form %', v_old_form.id;
    END LOOP;
END $$;

-- =====================================================================
-- STEP 3: Make outlet_id NOT NULL and add unique constraint
-- =====================================================================

-- Set outlet_id to NOT NULL (all rows should have it now)
ALTER TABLE public.checkout_form 
  ALTER COLUMN outlet_id SET NOT NULL;

-- Drop old unique constraint (one form per dispatch_plan_id)
ALTER TABLE public.checkout_form 
  DROP CONSTRAINT IF EXISTS checkout_form_dispatch_plan_id_key;

-- Add new unique constraint (one form per dispatch_plan_id + outlet_id)
ALTER TABLE public.checkout_form 
  ADD CONSTRAINT checkout_form_dispatch_plan_outlet_key 
  UNIQUE (dispatch_plan_id, outlet_id);

-- Add index on outlet_id for lookups
CREATE INDEX IF NOT EXISTS idx_checkout_form_outlet_id 
  ON public.checkout_form(outlet_id);

-- =====================================================================
-- STEP 4: Update comments to reflect new structure
-- =====================================================================

COMMENT ON TABLE public.checkout_form IS 'Outlet-wise closing forms linked to dispatch plans (one form per outlet per plan)';
COMMENT ON COLUMN public.checkout_form.dispatch_plan_id IS 'Links to the dispatch plan this closing form is for';
COMMENT ON COLUMN public.checkout_form.outlet_id IS 'The specific outlet this closing form is for (one form per outlet per plan)';

COMMIT;
