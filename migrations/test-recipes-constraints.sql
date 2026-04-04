-- Test suite for recipes and recipe_ingredients constraints
-- Run this after applying the add-recipes-and-recipe-ingredients migration
-- =====================================================================

-- Cleanup any existing test data first
DELETE FROM public.recipe_ingredients WHERE recipe_id IN (
  SELECT id FROM public.recipes WHERE recipe_name LIKE 'TEST_%'
);
DELETE FROM public.recipes WHERE recipe_name LIKE 'TEST_%';
DELETE FROM public.raw_materials WHERE name LIKE 'TEST_%';

-- Create test materials
INSERT INTO public.raw_materials (id, name, code, unit, material_type, category, brand_codes)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'TEST_Finished_Product', 'FF-TEST-001', 'nos', 'finished', 'Boom Pizza', ARRAY['bp']),
  ('00000000-0000-0000-0000-000000000002', 'TEST_Raw_Material', 'RM-TEST-001', 'gm', 'raw_material', 'Meat', ARRAY['bp']),
  ('00000000-0000-0000-0000-000000000003', 'TEST_Semi_Finished', 'SF-TEST-001', 'gm', 'semi_finished', 'Boom Pizza', ARRAY['bp']);

-- TEST 1: Valid recipe creation with finished product (should succeed)
INSERT INTO public.recipes (id, finished_product_id, recipe_name, is_active)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'TEST_Valid_Recipe', true);

-- TEST 4: Valid ingredient with raw_material (should succeed)
INSERT INTO public.recipe_ingredients (recipe_id, ingredient_material_id, quantity_per_unit)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', 50.0);

-- TEST 5: Valid ingredient with semi_finished (should succeed)
INSERT INTO public.recipe_ingredients (recipe_id, ingredient_material_id, quantity_per_unit)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 20.0);

-- TEST 12: Inactive recipe should be allowed alongside active one (should succeed)
INSERT INTO public.recipes (finished_product_id, recipe_name, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'TEST_Inactive_Recipe', false);

-- Verify all tests passed by counting rows
SELECT 
  CASE 
    WHEN (SELECT COUNT(*) FROM public.recipes WHERE recipe_name LIKE 'TEST_%') = 2 
      AND (SELECT COUNT(*) FROM public.recipe_ingredients WHERE recipe_id = '00000000-0000-0000-0000-000000000010') = 2
    THEN 'ALL BASIC TESTS PASSED'
    ELSE 'SOME TESTS FAILED'
  END as test_result;

-- Cleanup test data
DELETE FROM public.recipe_ingredients WHERE recipe_id IN (
  SELECT id FROM public.recipes WHERE recipe_name LIKE 'TEST_%'
);
DELETE FROM public.recipes WHERE recipe_name LIKE 'TEST_%';
DELETE FROM public.raw_materials WHERE name LIKE 'TEST_%';
