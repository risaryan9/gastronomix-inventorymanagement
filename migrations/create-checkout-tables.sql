-- =====================================================================
-- Supervisor Checkout Feature - Database Schema
-- Creates tables for checkout forms, return items, wastage items, and additional info
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. CREATE CHECKOUT_FORM TABLE (Master table)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.checkout_form (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    dispatch_plan_id UUID NOT NULL REFERENCES public.dispatch_plan(id) ON DELETE CASCADE,
    cloud_kitchen_id UUID NOT NULL REFERENCES public.cloud_kitchens(id) ON DELETE CASCADE,
    plan_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'confirmed')) DEFAULT 'draft',
    supervisor_name TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ NULL,
    CONSTRAINT checkout_form_dispatch_plan_id_key UNIQUE (dispatch_plan_id)
);

COMMENT ON TABLE public.checkout_form IS 'Master table for supervisor checkout forms linked to dispatch plans';
COMMENT ON COLUMN public.checkout_form.dispatch_plan_id IS 'Links to the dispatch plan this checkout is for (one checkout per dispatch plan)';
COMMENT ON COLUMN public.checkout_form.plan_date IS 'Date of the dispatch plan (should match dispatch_plan.plan_date)';
COMMENT ON COLUMN public.checkout_form.status IS 'Status: draft (being filled), submitted (ready for review), confirmed (inventory updated)';
COMMENT ON COLUMN public.checkout_form.supervisor_name IS 'Name of the supervisor who filled out the form (typed in by user)';
COMMENT ON COLUMN public.checkout_form.confirmed_at IS 'Timestamp when the checkout was confirmed and inventory was updated';

-- Indexes for checkout_form
CREATE INDEX IF NOT EXISTS idx_checkout_form_dispatch_plan_id 
    ON public.checkout_form(dispatch_plan_id);
CREATE INDEX IF NOT EXISTS idx_checkout_form_cloud_kitchen_id 
    ON public.checkout_form(cloud_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_checkout_form_plan_date 
    ON public.checkout_form(plan_date);
CREATE INDEX IF NOT EXISTS idx_checkout_form_status 
    ON public.checkout_form(status);
CREATE INDEX IF NOT EXISTS idx_checkout_form_created_by 
    ON public.checkout_form(created_by);

-- =====================================================================
-- 2. CREATE CHECKOUT_FORM_RETURN_ITEMS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.checkout_form_return_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    checkout_form_id UUID NOT NULL REFERENCES public.checkout_form(id) ON DELETE CASCADE,
    outlet_id UUID NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
    raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    dispatched_quantity NUMERIC(10, 3) NOT NULL CHECK (dispatched_quantity >= 0),
    returned_quantity NUMERIC(10, 3) NOT NULL CHECK (returned_quantity >= 0),
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT checkout_form_return_items_unique_key UNIQUE (checkout_form_id, outlet_id, raw_material_id)
);

COMMENT ON TABLE public.checkout_form_return_items IS 'Stores returned quantities per outlet and material for each checkout form';
COMMENT ON COLUMN public.checkout_form_return_items.dispatched_quantity IS 'Snapshot of quantity dispatched (from dispatch_plan_items)';
COMMENT ON COLUMN public.checkout_form_return_items.returned_quantity IS 'Quantity returned by the outlet';

-- Indexes for checkout_form_return_items
CREATE INDEX IF NOT EXISTS idx_checkout_return_items_checkout_form_id 
    ON public.checkout_form_return_items(checkout_form_id);
CREATE INDEX IF NOT EXISTS idx_checkout_return_items_outlet_id 
    ON public.checkout_form_return_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_checkout_return_items_raw_material_id 
    ON public.checkout_form_return_items(raw_material_id);

-- =====================================================================
-- 3. CREATE CHECKOUT_FORM_WASTAGE_ITEMS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.checkout_form_wastage_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    checkout_form_id UUID NOT NULL REFERENCES public.checkout_form(id) ON DELETE CASCADE,
    outlet_id UUID NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
    raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    dispatched_quantity NUMERIC(10, 3) NULL,
    wasted_quantity NUMERIC(10, 3) NOT NULL CHECK (wasted_quantity >= 0),
    wastage_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT checkout_form_wastage_items_unique_key UNIQUE (checkout_form_id, outlet_id, raw_material_id)
);

COMMENT ON TABLE public.checkout_form_wastage_items IS 'Stores wastage quantities per outlet and material for tracking purposes (does not affect inventory)';
COMMENT ON COLUMN public.checkout_form_wastage_items.dispatched_quantity IS 'Optional snapshot of quantity dispatched';
COMMENT ON COLUMN public.checkout_form_wastage_items.wasted_quantity IS 'Quantity wasted by the outlet';
COMMENT ON COLUMN public.checkout_form_wastage_items.wastage_reason IS 'Optional reason for wastage';

-- Indexes for checkout_form_wastage_items
CREATE INDEX IF NOT EXISTS idx_checkout_wastage_items_checkout_form_id 
    ON public.checkout_form_wastage_items(checkout_form_id);
CREATE INDEX IF NOT EXISTS idx_checkout_wastage_items_outlet_id 
    ON public.checkout_form_wastage_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_checkout_wastage_items_raw_material_id 
    ON public.checkout_form_wastage_items(raw_material_id);

-- =====================================================================
-- 4. CREATE CHECKOUT_FORM_ADDITIONAL TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.checkout_form_additional (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    checkout_form_id UUID NOT NULL REFERENCES public.checkout_form(id) ON DELETE CASCADE,
    outlet_id UUID NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
    cash NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cash >= 0),
    payment_onside NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (payment_onside >= 0),
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT checkout_form_additional_unique_key UNIQUE (checkout_form_id, outlet_id)
);

COMMENT ON TABLE public.checkout_form_additional IS 'Stores additional financial information per outlet for analytics (cash and payment_onside)';
COMMENT ON COLUMN public.checkout_form_additional.cash IS 'Cash amount collected from the outlet';
COMMENT ON COLUMN public.checkout_form_additional.payment_onside IS 'Payment onside amount from the outlet';

-- Indexes for checkout_form_additional
CREATE INDEX IF NOT EXISTS idx_checkout_additional_checkout_form_id 
    ON public.checkout_form_additional(checkout_form_id);
CREATE INDEX IF NOT EXISTS idx_checkout_additional_outlet_id 
    ON public.checkout_form_additional(outlet_id);

-- =====================================================================
-- 5. ENABLE ROW LEVEL SECURITY
-- =====================================================================

ALTER TABLE public.checkout_form ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_form_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_form_wastage_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_form_additional ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 6. CREATE RLS POLICIES
-- =====================================================================

-- CHECKOUT_FORM POLICIES

-- Admin: full access
CREATE POLICY "Admin full access to checkout_form" ON public.checkout_form
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Supervisor & Purchase Manager: access their own kitchen's checkouts
CREATE POLICY "Supervisor and PM read own kitchen checkout_form" ON public.checkout_form
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = checkout_form.cloud_kitchen_id
            AND users.role IN ('supervisor', 'purchase_manager')
        )
    );

CREATE POLICY "Supervisor and PM insert own kitchen checkout_form" ON public.checkout_form
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = checkout_form.cloud_kitchen_id
            AND users.role IN ('supervisor', 'purchase_manager')
        )
    );

CREATE POLICY "Supervisor and PM update own kitchen checkout_form" ON public.checkout_form
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = checkout_form.cloud_kitchen_id
            AND users.role IN ('supervisor', 'purchase_manager')
        )
    );

-- CHECKOUT_FORM_RETURN_ITEMS POLICIES

-- Admin: full access
CREATE POLICY "Admin full access to checkout_form_return_items" ON public.checkout_form_return_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Supervisor & Purchase Manager: access via checkout_form's cloud_kitchen_id
CREATE POLICY "Supervisor and PM access own kitchen return_items" ON public.checkout_form_return_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.checkout_form ON checkout_form.id = checkout_form_return_items.checkout_form_id
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = checkout_form.cloud_kitchen_id
            AND users.role IN ('supervisor', 'purchase_manager')
        )
    );

-- CHECKOUT_FORM_WASTAGE_ITEMS POLICIES

-- Admin: full access
CREATE POLICY "Admin full access to checkout_form_wastage_items" ON public.checkout_form_wastage_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Supervisor & Purchase Manager: access via checkout_form's cloud_kitchen_id
CREATE POLICY "Supervisor and PM access own kitchen wastage_items" ON public.checkout_form_wastage_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.checkout_form ON checkout_form.id = checkout_form_wastage_items.checkout_form_id
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = checkout_form.cloud_kitchen_id
            AND users.role IN ('supervisor', 'purchase_manager')
        )
    );

-- CHECKOUT_FORM_ADDITIONAL POLICIES

-- Admin: full access
CREATE POLICY "Admin full access to checkout_form_additional" ON public.checkout_form_additional
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Supervisor & Purchase Manager: access via checkout_form's cloud_kitchen_id
CREATE POLICY "Supervisor and PM access own kitchen additional" ON public.checkout_form_additional
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.checkout_form ON checkout_form.id = checkout_form_additional.checkout_form_id
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = checkout_form.cloud_kitchen_id
            AND users.role IN ('supervisor', 'purchase_manager')
        )
    );

-- =====================================================================
-- 7. CREATE TRIGGER FOR UPDATED_AT
-- =====================================================================

-- Create or replace the set_updated_at function if it doesn't exist
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to checkout_form
DROP TRIGGER IF EXISTS set_checkout_form_updated_at ON public.checkout_form;
CREATE TRIGGER set_checkout_form_updated_at
    BEFORE UPDATE ON public.checkout_form
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMIT;
