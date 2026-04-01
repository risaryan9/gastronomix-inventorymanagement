-- =====================================================
-- Add Material Type Column to Raw Materials Table
-- =====================================================
-- This migration adds support for four material types:
-- 1. raw_material - Materials purchased from vendors
-- 2. semi_finished - Materials prepared in-house (intermediate products)
-- 3. finished - Final products ready for sale
-- 4. non_food - Non-food items (packaging, sanitary, etc.)
-- =====================================================

-- Step 1: Add material_type column with CHECK constraint
ALTER TABLE public.raw_materials
ADD COLUMN IF NOT EXISTS material_type TEXT NOT NULL DEFAULT 'raw_material'
CHECK (material_type IN ('raw_material', 'semi_finished', 'finished', 'non_food'));

-- Step 2: Initialize all existing rows to 'raw_material'
UPDATE public.raw_materials
SET material_type = 'raw_material'
WHERE material_type IS NULL OR material_type = '';

-- Step 3: Create index on material_type for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_material_type 
ON public.raw_materials USING btree (material_type) TABLESPACE pg_default;

-- Step 4: Make vendor_id and brand nullable only for non-raw materials
-- (They are already nullable in the schema, but we'll add a comment for clarity)
COMMENT ON COLUMN public.raw_materials.vendor_id IS 'Required for raw_material type, optional for semi_finished and finished types';
COMMENT ON COLUMN public.raw_materials.brand IS 'Optional for all material types';

-- Step 5: Update the category column comment to reflect new usage
COMMENT ON COLUMN public.raw_materials.category IS 'For raw_material: Baking Essentials, Condiments & Toppings, Dairy & Dairy Product, Dry Fruits & Nuts, Edible Oils & Fats, Food Grains & Grain Products, Fruits & Vegetables, Herbs & Spices, Indian Breads & Breads, Meat & Poultry & Cold Cuts, Packaged Deserts & Sweets, Packaged Water & Bevereges, Pulses & Lentils, Sauces & Seasoning, Inedible & Packaging. For semi_finished: SemiFinished (fixed). For finished: Finished (fixed). For non_food: Inedible & Packaging (fixed)';

-- Step 6: Update the code column comment to reflect new patterns
COMMENT ON COLUMN public.raw_materials.code IS 'Format: RM-{CATEGORY_SHORT}-{NUMBER} for raw materials (e.g., RM-HBSP-001), SF-{NUMBER} for semi-finished (e.g., SF-001), FF-{NUMBER} for finished (e.g., FF-001), NF-{NUMBER} for non-food (e.g., NF-001)';

-- =====================================================
-- Verification Query (Optional - Run to verify)
-- =====================================================
-- SELECT material_type, COUNT(*) as count
-- FROM public.raw_materials
-- WHERE deleted_at IS NULL
-- GROUP BY material_type;

-- =====================================================
-- Rollback Instructions (If needed)
-- =====================================================
-- To rollback this migration:
-- DROP INDEX IF EXISTS idx_raw_materials_material_type;
-- ALTER TABLE public.raw_materials DROP COLUMN IF EXISTS material_type;
