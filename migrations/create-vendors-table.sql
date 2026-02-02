-- ============================================================================
-- Create Vendors Table
-- Vendors are predefined - purchase managers must select from this list
-- ============================================================================

-- Create vendors table
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT vendors_pkey PRIMARY KEY (id),
  CONSTRAINT vendors_name_key UNIQUE (name)
)
TABLESPACE pg_default;

-- Index for active vendors lookup
CREATE INDEX IF NOT EXISTS idx_vendors_is_active 
  ON public.vendors USING btree (is_active) 
  TABLESPACE pg_default;

-- ============================================================================
-- Seed Vendors
-- ============================================================================

INSERT INTO public.vendors (name) VALUES
  ('Hyperpure'),
  ('Fresko Choice'),
  ('Punjab Store'),
  ('SB Interprice'),
  ('Rai Poltry'),
  ('Local'),
  ('Priya Foods'),
  ('English Oven')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Alter raw_materials: Add vendor_id, migrate from vendor text if exists, drop vendor
-- ============================================================================

-- Step 1: Add vendor_id column (nullable initially)
ALTER TABLE public.raw_materials 
  ADD COLUMN IF NOT EXISTS vendor_id uuid NULL REFERENCES public.vendors(id);

-- Step 2: Migrate existing vendor text to vendor_id (if vendor column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'raw_materials' 
    AND column_name = 'vendor'
  ) THEN
    UPDATE public.raw_materials rm
    SET vendor_id = v.id
    FROM public.vendors v
    WHERE rm.vendor = v.name
    AND rm.vendor_id IS NULL;
  END IF;
END $$;

-- Step 3: Drop vendor text column if it exists
ALTER TABLE public.raw_materials 
  DROP COLUMN IF EXISTS vendor;

-- Step 4: Make vendor_id required for new records (optional - keeps nullable for backward compat)
-- ALTER TABLE public.raw_materials ALTER COLUMN vendor_id SET NOT NULL;

-- Index for vendor lookups
CREATE INDEX IF NOT EXISTS idx_raw_materials_vendor_id 
  ON public.raw_materials USING btree (vendor_id) 
  TABLESPACE pg_default;

-- ============================================================================
-- RLS for Vendors Table (lookup table - all users can read active vendors)
-- ============================================================================

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- All users (including key-based login) can read active vendors for dropdown
DROP POLICY IF EXISTS "Allow read active vendors" ON public.vendors;
CREATE POLICY "Allow read active vendors"
  ON public.vendors
  FOR SELECT
  TO public
  USING (is_active = true);

-- Only admins can manage vendors (create, update, delete)
DROP POLICY IF EXISTS "Admins can manage vendors" ON public.vendors;
CREATE POLICY "Admins can manage vendors"
  ON public.vendors
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin' 
      AND is_active = true
    )
  );
