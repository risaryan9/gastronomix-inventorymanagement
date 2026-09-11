-- Test suite for service_kits and service_kit_items constraints
-- Run this after applying rename-recipes-to-service-kits.sql
-- =====================================================================

-- Cleanup any existing test data first
DELETE FROM public.service_kit_items WHERE service_kit_id IN (
  SELECT id FROM public.service_kits WHERE kit_name LIKE 'TEST_%'
);
DELETE FROM public.service_kits WHERE kit_name LIKE 'TEST_%';
DELETE FROM public.raw_materials WHERE name LIKE 'TEST_%';

-- Create test materials
INSERT INTO public.raw_materials (id, name, code, unit, material_type, category, brand_codes)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'TEST_Finished_Product', 'FF-TEST-001', 'nos', 'finished', 'Boom Pizza', ARRAY['bp']),
  ('00000000-0000-0000-0000-000000000002', 'TEST_Raw_Material', 'RM-TEST-001', 'gm', 'raw_material', 'Meat', ARRAY['bp']),
  ('00000000-0000-0000-0000-000000000003', 'TEST_Semi_Finished', 'SF-TEST-001', 'gm', 'semi_finished', 'Boom Pizza', ARRAY['bp']);

-- TEST 1: Valid kit creation with finished product (should succeed)
INSERT INTO public.service_kits (id, finished_product_id, kit_name, is_active)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'TEST_Valid_Kit', true);

-- TEST 4: Valid item with raw_material (should succeed)
INSERT INTO public.service_kit_items (service_kit_id, material_id, quantity_per_unit)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', 50.0);

-- TEST 5: Valid item with semi_finished (should succeed)
INSERT INTO public.service_kit_items (service_kit_id, material_id, quantity_per_unit)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 20.0);

-- TEST 12: Inactive kit should be allowed alongside active one (should succeed)
INSERT INTO public.service_kits (finished_product_id, kit_name, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'TEST_Inactive_Kit', false);

-- Verify all tests passed by counting rows
SELECT
  CASE
    WHEN (SELECT COUNT(*) FROM public.service_kits WHERE kit_name LIKE 'TEST_%') = 2
      AND (SELECT COUNT(*) FROM public.service_kit_items WHERE service_kit_id = '00000000-0000-0000-0000-000000000010') = 2
    THEN 'ALL BASIC TESTS PASSED'
    ELSE 'SOME TESTS FAILED'
  END as test_result;

-- Cleanup test data
DELETE FROM public.service_kit_items WHERE service_kit_id IN (
  SELECT id FROM public.service_kits WHERE kit_name LIKE 'TEST_%'
);
DELETE FROM public.service_kits WHERE kit_name LIKE 'TEST_%';
DELETE FROM public.raw_materials WHERE name LIKE 'TEST_%';
