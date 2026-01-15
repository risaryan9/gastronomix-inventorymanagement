-- =====================================================
-- Seed Data: Users, Cloud Kitchens, and Outlets
-- =====================================================

-- =====================================================
-- 1. CLOUD KITCHENS
-- =====================================================

INSERT INTO cloud_kitchens (id, name, code, address, is_active) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'North Kitchen', 'CK001', '123 North Street, City', true),
  ('550e8400-e29b-41d4-a716-446655440002', 'South Kitchen', 'CK002', '456 South Avenue, City', true),
  ('550e8400-e29b-41d4-a716-446655440003', 'East Kitchen', 'CK003', '789 East Road, City', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 2. USERS
-- =====================================================

-- Admin user (email-based login)
INSERT INTO users (id, email, login_key, full_name, role, cloud_kitchen_id, is_active) VALUES
  ('660e8400-e29b-41d4-a716-446655440001', 'admin@gastronomix.com', NULL, 'Admin User', 'admin', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Purchase Manager user (key-based login)
INSERT INTO users (id, email, login_key, full_name, role, cloud_kitchen_id, is_active) VALUES
  ('660e8400-e29b-41d4-a716-446655440002', NULL, 'PM-KEY-2024-ABC123XYZ', 'Purchase Manager', 'purchase_manager', '550e8400-e29b-41d4-a716-446655440001', true)
ON CONFLICT (id) DO NOTHING;

-- Supervisor user (key-based login)
INSERT INTO users (id, email, login_key, full_name, role, cloud_kitchen_id, is_active) VALUES
  ('660e8400-e29b-41d4-a716-446655440003', NULL, 'SUP-KEY-2024-DEF456UVW', 'Supervisor User', 'supervisor', '550e8400-e29b-41d4-a716-446655440001', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 3. OUTLETS (3 per cloud kitchen = 9 total)
-- =====================================================

-- Outlets for North Kitchen (CK001)
INSERT INTO outlets (id, cloud_kitchen_id, name, code, address, contact_person, contact_phone, is_active) VALUES
  ('770e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', 'North Outlet 1', 'OUT001', '100 Main Street, North District', 'John Doe', '+1234567890', true),
  ('770e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', 'North Outlet 2', 'OUT002', '200 Park Avenue, North District', 'Jane Smith', '+1234567891', true),
  ('770e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440001', 'North Outlet 3', 'OUT003', '300 Market Road, North District', 'Bob Johnson', '+1234567892', true)
ON CONFLICT (id) DO NOTHING;

-- Outlets for South Kitchen (CK002)
INSERT INTO outlets (id, cloud_kitchen_id, name, code, address, contact_person, contact_phone, is_active) VALUES
  ('770e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440002', 'South Outlet 1', 'OUT004', '400 Ocean Drive, South District', 'Alice Brown', '+1234567893', true),
  ('770e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440002', 'South Outlet 2', 'OUT005', '500 Beach Boulevard, South District', 'Charlie Wilson', '+1234567894', true),
  ('770e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440002', 'South Outlet 3', 'OUT006', '600 Harbor Street, South District', 'Diana Martinez', '+1234567895', true)
ON CONFLICT (id) DO NOTHING;

-- Outlets for East Kitchen (CK003)
INSERT INTO outlets (id, cloud_kitchen_id, name, code, address, contact_person, contact_phone, is_active) VALUES
  ('770e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440003', 'East Outlet 1', 'OUT007', '700 Mountain View, East District', 'Ethan Davis', '+1234567896', true),
  ('770e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440003', 'East Outlet 2', 'OUT008', '800 Valley Road, East District', 'Fiona Taylor', '+1234567897', true),
  ('770e8400-e29b-41d4-a716-446655440009', '550e8400-e29b-41d4-a716-446655440003', 'East Outlet 3', 'OUT009', '900 Hilltop Avenue, East District', 'George Anderson', '+1234567898', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- VERIFICATION QUERIES (Optional - run to verify data)
-- =====================================================

-- View all cloud kitchens
-- SELECT * FROM cloud_kitchens;

-- View all users
-- SELECT id, email, login_key, full_name, role, cloud_kitchen_id FROM users;

-- View all outlets grouped by cloud kitchen
-- SELECT 
--   ck.name AS cloud_kitchen_name,
--   ck.code AS cloud_kitchen_code,
--   o.name AS outlet_name,
--   o.code AS outlet_code,
--   o.address AS outlet_address
-- FROM outlets o
-- JOIN cloud_kitchens ck ON o.cloud_kitchen_id = ck.id
-- ORDER BY ck.code, o.code;
