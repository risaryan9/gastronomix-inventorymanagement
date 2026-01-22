-- ============================================================================
-- SEED DATA SCRIPT
-- Inserts sample data for testing and development
-- Run this AFTER database_migration.sql
-- ============================================================================

-- ============================================================================
-- STEP 1: INSERT CLOUD KITCHENS
-- ============================================================================

INSERT INTO public.cloud_kitchens (id, name, code, address, is_active, created_at, updated_at) VALUES
('11111111-1111-1111-1111-111111111111', 'Gastronomix Central Kitchen', 'CK001', '123 Brigade Road, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('22222222-2222-2222-2222-222222222222', 'Gastronomix North Kitchen', 'CK002', '456 Indiranagar Main Road, Bangalore - 560038, Karnataka, India', TRUE, NOW(), NOW()),
('33333333-3333-3333-3333-333333333333', 'Gastronomix South Kitchen', 'CK003', '789 Koramangala 5th Block, Bangalore - 560095, Karnataka, India', TRUE, NOW(), NOW());

-- ============================================================================
-- STEP 2: INSERT USERS (1 Admin, 3 Supervisors, 3 Purchase Managers)
-- ============================================================================

-- Admin (no cloud_kitchen_id)
INSERT INTO public.users (id, email, full_name, role, cloud_kitchen_id, is_active, created_at, updated_at) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@gastronomix.com', 'Admin User', 'admin', NULL, TRUE, NOW(), NOW());

-- Supervisors (one for each kitchen)
INSERT INTO public.users (id, email, full_name, role, cloud_kitchen_id, is_active, login_key, created_at, updated_at) VALUES
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'Supervisor CK001', 'supervisor', '11111111-1111-1111-1111-111111111111', TRUE, 'SUP001', NOW(), NOW()),
('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'Supervisor CK002', 'supervisor', '22222222-2222-2222-2222-222222222222', TRUE, 'SUP002', NOW(), NOW()),
('dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, 'Supervisor CK003', 'supervisor', '33333333-3333-3333-3333-333333333333', TRUE, 'SUP003', NOW(), NOW());

-- Purchase Managers (one for each kitchen)
INSERT INTO public.users (id, email, full_name, role, cloud_kitchen_id, is_active, login_key, created_at, updated_at) VALUES
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL, 'Purchase Manager CK001', 'purchase_manager', '11111111-1111-1111-1111-111111111111', TRUE, 'PM001', NOW(), NOW()),
('ffffffff-ffff-ffff-ffff-ffffffffffff', NULL, 'Purchase Manager CK002', 'purchase_manager', '22222222-2222-2222-2222-222222222222', TRUE, 'PM002', NOW(), NOW()),
('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', NULL, 'Purchase Manager CK003', 'purchase_manager', '33333333-3333-3333-3333-333333333333', TRUE, 'PM003', NOW(), NOW());

-- ============================================================================
-- STEP 3: INSERT RAW MATERIALS (~20 materials across categories)
-- ============================================================================

INSERT INTO public.raw_materials (id, name, code, unit, description, category, low_stock_threshold, is_active, created_at, updated_at) VALUES
-- Meat Category
('a1111111-1111-1111-1111-111111111111', 'Chicken Breast', 'RM-MEAT-001', 'kg', 'Fresh chicken breast', 'Meat', 10.000, TRUE, NOW(), NOW()),
('a2222222-2222-2222-2222-222222222222', 'Mutton Mince', 'RM-MEAT-002', 'kg', 'Fresh mutton mince', 'Meat', 5.000, TRUE, NOW(), NOW()),
('a3333333-3333-3333-3333-333333333333', 'Prawns', 'RM-MEAT-003', 'kg', 'Fresh prawns', 'Meat', 8.000, TRUE, NOW(), NOW()),

-- Grains Category
('b1111111-1111-1111-1111-111111111111', 'Basmati Rice', 'RM-GRNS-001', 'kg', 'Premium basmati rice', 'Grains', 50.000, TRUE, NOW(), NOW()),
('b2222222-2222-2222-2222-222222222222', 'Wheat Flour', 'RM-GRNS-002', 'kg', 'Fine wheat flour', 'Grains', 40.000, TRUE, NOW(), NOW()),
('b3333333-3333-3333-3333-333333333333', 'Maida', 'RM-GRNS-003', 'kg', 'Refined wheat flour', 'Grains', 30.000, TRUE, NOW(), NOW()),

-- Vegetables Category
('c1111111-1111-1111-1111-111111111111', 'Onions', 'RM-VEGT-001', 'kg', 'Fresh onions', 'Vegetables', 20.000, TRUE, NOW(), NOW()),
('c2222222-2222-2222-2222-222222222222', 'Tomatoes', 'RM-VEGT-002', 'kg', 'Fresh tomatoes', 'Vegetables', 25.000, TRUE, NOW(), NOW()),
('c3333333-3333-3333-3333-333333333333', 'Bell Peppers', 'RM-VEGT-003', 'kg', 'Mixed bell peppers', 'Vegetables', 15.000, TRUE, NOW(), NOW()),
('c4444444-4444-4444-4444-444444444444', 'Potatoes', 'RM-VEGT-004', 'kg', 'Fresh potatoes', 'Vegetables', 30.000, TRUE, NOW(), NOW()),

-- Oils Category
('d1111111-1111-1111-1111-111111111111', 'Sunflower Oil', 'RM-OIL-001', 'liter', 'Refined sunflower oil', 'Oils', 20.000, TRUE, NOW(), NOW()),
('d2222222-2222-2222-2222-222222222222', 'Olive Oil', 'RM-OIL-002', 'liter', 'Extra virgin olive oil', 'Oils', 10.000, TRUE, NOW(), NOW()),

-- Spices Category
('e1111111-1111-1111-1111-111111111111', 'Red Chilli Powder', 'RM-SPCE-001', 'kg', 'Kashmiri red chilli powder', 'Spices', 5.000, TRUE, NOW(), NOW()),
('e2222222-2222-2222-2222-222222222222', 'Garam Masala', 'RM-SPCE-002', 'kg', 'Traditional garam masala', 'Spices', 3.000, TRUE, NOW(), NOW()),
('e3333333-3333-3333-3333-333333333333', 'Turmeric Powder', 'RM-SPCE-003', 'kg', 'Pure turmeric powder', 'Spices', 5.000, TRUE, NOW(), NOW()),

-- Dairy Category
('f1111111-1111-1111-1111-111111111111', 'Fresh Milk', 'RM-DARY-001', 'liter', 'Fresh whole milk', 'Dairy', 30.000, TRUE, NOW(), NOW()),
('f2222222-2222-2222-2222-222222222222', 'Butter', 'RM-DARY-002', 'kg', 'Unsalted butter', 'Dairy', 10.000, TRUE, NOW(), NOW()),

-- Packaging Category
('a1111111-1111-1111-1111-111111111118', 'Food Containers', 'RM-PKG-001', 'nos', 'Disposable food containers (pack of 100)', 'Packaging', 200.000, TRUE, NOW(), NOW()),
('a2222222-2222-2222-2222-222222222229', 'Aluminum Foil', 'RM-PKG-002', 'packets', 'Heavy-duty aluminum foil', 'Packaging', 50.000, TRUE, NOW(), NOW()),

-- Sanitary Category
('c5555555-5555-5555-5555-555555555550', 'Hand Sanitizer', 'RM-SAN-001', 'liter', 'Alcohol-based hand sanitizer', 'Sanitary', 10.000, TRUE, NOW(), NOW()),

-- Misc Category
('c6666666-6666-6666-6666-666666666661', 'Salt', 'RM-MISC-001', 'kg', 'Iodized table salt', 'Misc', 20.000, TRUE, NOW(), NOW());

-- ============================================================================
-- STEP 4: INSERT OUTLETS (32 outlets: 12 NK, 12 EC, 8 BP randomly distributed)
-- ============================================================================

-- Nippu Kodi Outlets (12 outlets)
INSERT INTO public.outlets (id, cloud_kitchen_id, name, code, address, is_active, created_at, updated_at) VALUES
-- CK001 - 4 NK outlets
('o1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Nippu Kodi MG Road', 'NK1001', '101 MG Road, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o1111112-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Nippu Kodi Brigade', 'NK1002', '102 Brigade Road, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o1111113-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Nippu Kodi Commercial Street', 'NK1003', '103 Commercial Street, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o1111114-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Nippu Kodi Koramangala', 'NK1004', '104 Koramangala 6th Block, Bangalore - 560095, Karnataka, India', TRUE, NOW(), NOW()),

-- CK002 - 4 NK outlets
('o2222221-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Nippu Kodi Indiranagar', 'NK1005', '205 Indiranagar 100ft Road, Bangalore - 560038, Karnataka, India', TRUE, NOW(), NOW()),
('o2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Nippu Kodi Whitefield', 'NK1006', '206 Whitefield Main Road, Bangalore - 560066, Karnataka, India', TRUE, NOW(), NOW()),
('o2222223-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Nippu Kodi HSR Layout', 'NK1007', '207 HSR Layout Sector 7, Bangalore - 560102, Karnataka, India', TRUE, NOW(), NOW()),
('o2222224-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Nippu Kodi Marathahalli', 'NK1008', '208 Marathahalli Outer Ring Road, Bangalore - 560037, Karnataka, India', TRUE, NOW(), NOW()),

-- CK003 - 4 NK outlets
('o3333331-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Nippu Kodi BTM Layout', 'NK1009', '309 BTM Layout 2nd Stage, Bangalore - 560076, Karnataka, India', TRUE, NOW(), NOW()),
('o3333332-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Nippu Kodi JP Nagar', 'NK1010', '310 JP Nagar 7th Phase, Bangalore - 560078, Karnataka, India', TRUE, NOW(), NOW()),
('o3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Nippu Kodi Banashankari', 'NK1011', '311 Banashankari 3rd Stage, Bangalore - 560085, Karnataka, India', TRUE, NOW(), NOW()),
('o3333334-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Nippu Kodi Jayanagar', 'NK1012', '312 Jayanagar 4th Block, Bangalore - 560011, Karnataka, India', TRUE, NOW(), NOW());

-- El Chaapo Outlets (12 outlets)
INSERT INTO public.outlets (id, cloud_kitchen_id, name, code, address, is_active, created_at, updated_at) VALUES
-- CK001 - 4 EC outlets
('o4444441-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'El Chaapo Church Street', 'EC1001', '401 Church Street, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o4444442-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'El Chaapo Lavelle Road', 'EC1002', '402 Lavelle Road, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o4444443-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'El Chaapo UB City', 'EC1003', '403 UB City Tower 2, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'El Chaapo Vittal Mallya Road', 'EC1004', '404 Vittal Mallya Road, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),

-- CK002 - 4 EC outlets
('o5555551-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'El Chaapo HAL Road', 'EC1005', '505 HAL 2nd Stage, Bangalore - 560038, Karnataka, India', TRUE, NOW(), NOW()),
('o5555552-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'El Chaapo Sarjapur Road', 'EC1006', '506 Sarjapur Road, Bangalore - 560035, Karnataka, India', TRUE, NOW(), NOW()),
('o5555553-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'El Chaapo Domlur', 'EC1007', '507 Domlur Layout, Bangalore - 560071, Karnataka, India', TRUE, NOW(), NOW()),
('o5555554-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'El Chaapo CV Raman Nagar', 'EC1008', '508 CV Raman Nagar, Bangalore - 560093, Karnataka, India', TRUE, NOW(), NOW()),

-- CK003 - 4 EC outlets
('o6666661-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 'El Chaapo Bannerghatta Road', 'EC1009', '609 Bannerghatta Road, Bangalore - 560076, Karnataka, India', TRUE, NOW(), NOW()),
('o6666662-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 'El Chaapo Electronic City', 'EC1010', '610 Electronic City Phase 1, Bangalore - 560100, Karnataka, India', TRUE, NOW(), NOW()),
('o6666663-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 'El Chaapo Silk Board', 'EC1011', '611 Silk Board Junction, Bangalore - 560068, Karnataka, India', TRUE, NOW(), NOW()),
('o6666664-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 'El Chaapo Hosur Road', 'EC1012', '612 Hosur Road, Bangalore - 560068, Karnataka, India', TRUE, NOW(), NOW());

-- Boom Pizza Outlets (8 outlets)
INSERT INTO public.outlets (id, cloud_kitchen_id, name, code, address, is_active, created_at, updated_at) VALUES
-- CK001 - 3 BP outlets
('o7777771-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'Boom Pizza Residency Road', 'BP1001', '701 Residency Road, Bangalore - 560001, Karnataka, India', TRUE, NOW(), NOW()),
('o7777772-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'Boom Pizza Cunningham Road', 'BP1002', '702 Cunningham Road, Bangalore - 560052, Karnataka, India', TRUE, NOW(), NOW()),
('o7777773-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'Boom Pizza Richmond Road', 'BP1003', '703 Richmond Road, Bangalore - 560025, Karnataka, India', TRUE, NOW(), NOW()),

-- CK002 - 3 BP outlets
('o8888881-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'Boom Pizza Old Airport Road', 'BP1004', '804 Old Airport Road, Bangalore - 560017, Karnataka, India', TRUE, NOW(), NOW()),
('o8888882-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'Boom Pizza Kodihalli', 'BP1005', '805 Kodihalli, Bangalore - 560008, Karnataka, India', TRUE, NOW(), NOW()),
('o8888883-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222', 'Boom Pizza Bellandur', 'BP1006', '806 Bellandur Outer Ring Road, Bangalore - 560103, Karnataka, India', TRUE, NOW(), NOW()),

-- CK003 - 2 BP outlets
('o9999991-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', 'Boom Pizza Bommanahalli', 'BP1007', '907 Bommanahalli Industrial Area, Bangalore - 560068, Karnataka, India', TRUE, NOW(), NOW()),
('o9999992-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', 'Boom Pizza Begur Road', 'BP1008', '908 Begur Road, Bangalore - 560068, Karnataka, India', TRUE, NOW(), NOW());

-- ============================================================================
-- STEP 5: INSERT INVENTORY ENTRIES (auto-created by triggers, but ensuring all combinations exist)
-- Note: Triggers should auto-create these, but we'll ensure they exist with quantity 0
-- ============================================================================

-- Insert inventory entries for all material-kitchen combinations (quantity = 0)
-- These will be created automatically by triggers, but we ensure they exist

INSERT INTO public.inventory (cloud_kitchen_id, raw_material_id, quantity, updated_by, last_updated_at)
SELECT 
    ck.id as cloud_kitchen_id,
    rm.id as raw_material_id,
    0 as quantity,
    NULL as updated_by,
    NOW() as last_updated_at
FROM public.cloud_kitchens ck
CROSS JOIN public.raw_materials rm
WHERE ck.is_active = TRUE AND rm.is_active = TRUE
ON CONFLICT (cloud_kitchen_id, raw_material_id) DO NOTHING;

-- ============================================================================
-- SEED DATA COMPLETE
-- ============================================================================

-- Summary:
-- - 3 Cloud Kitchens
-- - 7 Users (1 Admin, 3 Supervisors, 3 Purchase Managers)
-- - 21 Raw Materials across 9 categories
-- - 32 Outlets (12 Nippu Kodi, 12 El Chaapo, 8 Boom Pizza)
-- - 63 Inventory entries (21 materials × 3 kitchens, quantity = 0)
