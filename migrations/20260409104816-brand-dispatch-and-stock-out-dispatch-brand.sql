-- =====================================================
-- Migration: Brand Dispatch and Stock Out Dispatch Brand
-- This migration adds support for dispatch brand stock-outs where
-- the purchase manager can select a brand (Nippu Kodi, El Chaapo)
-- and auto-populate materials specific to that brand.
-- =====================================================

-- =====================================================
-- STEP 1: Create brand_dispatch table
-- =====================================================

CREATE TABLE public.brand_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brand_dispatch IS
  'Brands for dispatch stock-outs (e.g., Nippu Kodi, El Chaapo).';

COMMENT ON COLUMN public.brand_dispatch.code IS
  'Short code stored in stock_out.dispatch_brand (e.g., NK, EC).';

-- =====================================================
-- STEP 2: Create brand_dispatch_items table
-- =====================================================

CREATE TABLE public.brand_dispatch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_dispatch_id uuid NOT NULL REFERENCES public.brand_dispatch (id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials (id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_dispatch_id, raw_material_id)
);

COMMENT ON TABLE public.brand_dispatch_items IS
  'Materials associated with each dispatch brand for auto-population in stock-out UI.';

CREATE INDEX idx_brand_dispatch_items_brand 
ON public.brand_dispatch_items (brand_dispatch_id);

CREATE INDEX idx_brand_dispatch_items_material 
ON public.brand_dispatch_items (raw_material_id);

-- =====================================================
-- STEP 3: Seed default brands (items table starts empty)
-- =====================================================

INSERT INTO public.brand_dispatch (name, code, sort_order) VALUES
  ('Nippu Kodi', 'NK', 1),
  ('El Chaapo', 'EC', 2);

-- =====================================================
-- STEP 4: Add dispatch_brand column to stock_out
-- =====================================================

ALTER TABLE public.stock_out
ADD COLUMN IF NOT EXISTS dispatch_brand text NULL;

COMMENT ON COLUMN public.stock_out.dispatch_brand IS
  'Brand code (e.g., NK, EC) when reason is dispatch. NULL for all other reasons.';

CREATE INDEX IF NOT EXISTS idx_stock_out_dispatch_brand
ON public.stock_out USING btree (dispatch_brand) 
TABLESPACE pg_default
WHERE dispatch_brand IS NOT NULL;

-- =====================================================
-- STEP 5: Add CHECK constraint for dispatch_brand
-- =====================================================

-- Drop existing inter-cloud transfer check to rebuild it alongside dispatch check
ALTER TABLE public.stock_out
DROP CONSTRAINT IF EXISTS stock_out_inter_cloud_transfer_check;

-- Add combined constraint for both inter-cloud and dispatch rules
ALTER TABLE public.stock_out
ADD CONSTRAINT stock_out_dispatch_and_transfer_check CHECK (
  -- Rule 1: dispatch_brand must be NULL unless reason is 'dispatch'
  (
    (reason IS DISTINCT FROM 'dispatch' AND dispatch_brand IS NULL)
    OR
    (reason = 'dispatch' AND dispatch_brand IS NOT NULL)
  )
  AND
  -- Rule 2: transfer_to_cloud_kitchen_id must be NULL unless reason is 'inter-cloud-kitchen'
  (
    (reason IS DISTINCT FROM 'inter-cloud-kitchen')
    OR (transfer_to_cloud_kitchen_id IS NOT NULL AND transfer_to_cloud_kitchen_id != cloud_kitchen_id)
  )
);

-- =====================================================
-- STEP 6: Enable RLS on new tables
-- =====================================================

ALTER TABLE public.brand_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_dispatch_items ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 7: RLS Policies for brand_dispatch
-- =====================================================

-- SELECT: Purchase managers, admins, and supervisors can view brands
CREATE POLICY "Purchase managers and supervisors view brands" ON brand_dispatch
  FOR SELECT
  TO public
  USING (
    -- For authenticated users
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin', 'supervisor')
      AND is_active = true
    ))
    OR
    -- For key-based (anon) users, allow all (application-level filtering)
    (auth.uid() IS NULL)
  );

-- INSERT/UPDATE/DELETE: Admin only
CREATE POLICY "Admin manages brands" ON brand_dispatch
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin());

-- =====================================================
-- STEP 8: RLS Policies for brand_dispatch_items
-- =====================================================

-- SELECT: Purchase managers, admins, and supervisors can view brand items
CREATE POLICY "Purchase managers and supervisors view brand items" ON brand_dispatch_items
  FOR SELECT
  TO public
  USING (
    -- For authenticated users
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin', 'supervisor')
      AND is_active = true
    ))
    OR
    -- For key-based (anon) users, allow all (application-level filtering)
    (auth.uid() IS NULL)
  );

-- INSERT/UPDATE/DELETE: Admin only
CREATE POLICY "Admin manages brand items" ON brand_dispatch_items
  FOR ALL
  TO public
  USING (is_admin())
  WITH CHECK (is_admin());

-- =====================================================
-- STEP 9: Grant permissions
-- =====================================================

GRANT SELECT ON public.brand_dispatch TO authenticated, anon;
GRANT SELECT ON public.brand_dispatch_items TO authenticated, anon;

-- Admin gets full access (handled by RLS policies)
GRANT ALL ON public.brand_dispatch TO authenticated;
GRANT ALL ON public.brand_dispatch_items TO authenticated;

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. brand_dispatch contains the two default brands (NK, EC)
-- 2. brand_dispatch_items starts empty; admin configures via Settings UI
-- 3. stock_out.dispatch_brand is NULL for all non-dispatch reasons
-- 4. When reason = 'dispatch', dispatch_brand must be set to a brand code
-- 5. The CHECK constraint enforces this rule at the database level
-- 6. RLS allows PM/supervisor to read, admin to write
-- 7. Key-based (anon) users can read for PM dashboard functionality
