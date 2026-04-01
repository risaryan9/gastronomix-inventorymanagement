-- =====================================================================
-- Operators feature: table + checkout_form.operator_id + RLS
-- Operators are universal (not tied to an outlet).
-- Used on the closing (checkout) form: after supervisor name, select
-- an operator from a global dropdown (with search).
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. CREATE OPERATORS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.operators (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.operators IS 'Universal operators used in closing form dropdown across all outlets.';
COMMENT ON COLUMN public.operators.name IS 'Operator display name';
COMMENT ON COLUMN public.operators.phone IS 'Optional phone number for the operator';

CREATE INDEX IF NOT EXISTS idx_operators_name ON public.operators(name);

-- =====================================================================
-- 2. ADD operator_id TO checkout_form
-- =====================================================================

ALTER TABLE public.checkout_form
    ADD COLUMN IF NOT EXISTS operator_id UUID NULL REFERENCES public.operators(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.checkout_form.operator_id IS 'Operator selected for closing form (global dropdown after supervisor name)';

CREATE INDEX IF NOT EXISTS idx_checkout_form_operator_id ON public.checkout_form(operator_id);

-- =====================================================================
-- 3. TRIGGER FOR operators.updated_at
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_operators_updated_at ON public.operators;
CREATE TRIGGER set_operators_updated_at
    BEFORE UPDATE ON public.operators
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 4. ENABLE RLS ON operators
-- =====================================================================

ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 5. RLS POLICIES FOR operators
-- =====================================================================

-- Admin: full access
CREATE POLICY "Admin full access to operators" ON public.operators
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- Universal read access for key-based and authenticated users.
CREATE POLICY "All users can view operators" ON public.operators
    FOR SELECT
    TO anon, authenticated
    USING (true);

COMMIT;
