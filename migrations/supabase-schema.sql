-- =====================================================
-- Gastronomix Inventory Management System
-- Complete Database Schema for Supabase
-- =====================================================

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. CORE TABLES
-- =====================================================

-- Cloud Kitchens Table
CREATE TABLE IF NOT EXISTS cloud_kitchens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes for cloud_kitchens
CREATE INDEX IF NOT EXISTS idx_cloud_kitchens_code ON cloud_kitchens(code);

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE,
  login_key TEXT UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('supervisor', 'purchase_manager', 'admin')),
  cloud_kitchen_id UUID REFERENCES cloud_kitchens(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  -- Constraint: Admins must have email, non-admins must have login_key
  CONSTRAINT users_login_constraint CHECK (
    (role = 'admin' AND email IS NOT NULL AND login_key IS NULL) OR
    (role != 'admin' AND login_key IS NOT NULL AND email IS NULL)
  )
);

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_cloud_kitchen_id ON users(cloud_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_login_key ON users(login_key);

-- Outlets Table
CREATE TABLE IF NOT EXISTS outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  contact_person TEXT,
  contact_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(cloud_kitchen_id, code)
);

-- Indexes for outlets
CREATE INDEX IF NOT EXISTS idx_outlets_cloud_kitchen_id ON outlets(cloud_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_outlets_code ON outlets(code);

-- Raw Materials Table
CREATE TABLE IF NOT EXISTS raw_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  unit TEXT NOT NULL,
  description TEXT,
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes for raw_materials
CREATE INDEX IF NOT EXISTS idx_raw_materials_code ON raw_materials(code);
CREATE INDEX IF NOT EXISTS idx_raw_materials_category ON raw_materials(category);

-- Material Costs Table
CREATE TABLE IF NOT EXISTS material_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  cost_per_unit DECIMAL(10, 2) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for material_costs
CREATE INDEX IF NOT EXISTS idx_material_costs_raw_material_id ON material_costs(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_material_costs_effective_from ON material_costs(effective_from);

-- Inventory Table
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold DECIMAL(10, 3) DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(cloud_kitchen_id, raw_material_id)
);

-- Indexes for inventory
CREATE INDEX IF NOT EXISTS idx_inventory_cloud_kitchen_id ON inventory(cloud_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_inventory_raw_material_id ON inventory(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory(cloud_kitchen_id, quantity, low_stock_threshold);

-- Allocations Table
CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  allocated_by UUID NOT NULL REFERENCES users(id),
  allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for allocations
CREATE INDEX IF NOT EXISTS idx_allocations_outlet_id ON allocations(outlet_id);
CREATE INDEX IF NOT EXISTS idx_allocations_cloud_kitchen_id ON allocations(cloud_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_allocations_allocation_date ON allocations(allocation_date);

-- Allocation Items Table
CREATE TABLE IF NOT EXISTS allocation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
  UNIQUE(allocation_id, raw_material_id)
);

-- Indexes for allocation_items
CREATE INDEX IF NOT EXISTS idx_allocation_items_allocation_id ON allocation_items(allocation_id);
CREATE INDEX IF NOT EXISTS idx_allocation_items_raw_material_id ON allocation_items(raw_material_id);

-- Stock In Table
CREATE TABLE IF NOT EXISTS stock_in (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  received_by UUID NOT NULL REFERENCES users(id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_name TEXT,
  invoice_number TEXT,
  total_cost DECIMAL(10, 2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for stock_in
CREATE INDEX IF NOT EXISTS idx_stock_in_cloud_kitchen_id ON stock_in(cloud_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_stock_in_receipt_date ON stock_in(receipt_date);
CREATE INDEX IF NOT EXISTS idx_stock_in_received_by ON stock_in(received_by);

-- Stock In Items Table
CREATE TABLE IF NOT EXISTS stock_in_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_in_id UUID NOT NULL REFERENCES stock_in(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
  unit_cost DECIMAL(10, 2) NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  UNIQUE(stock_in_id, raw_material_id)
);

-- Indexes for stock_in_items
CREATE INDEX IF NOT EXISTS idx_stock_in_items_stock_in_id ON stock_in_items(stock_in_id);
CREATE INDEX IF NOT EXISTS idx_stock_in_items_raw_material_id ON stock_in_items(raw_material_id);

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- =====================================================
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_kitchens ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_in ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_in_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users Table Policies
DROP POLICY IF EXISTS "Users can view own record" ON users;
CREATE POLICY "Users can view own record" ON users
  FOR SELECT USING (auth.uid() = id);

-- Create helper function to check admin status (avoids RLS recursion)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
    AND is_active = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, anon;

DROP POLICY IF EXISTS "Admins can view all users" ON users;
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "Users can update own record" ON users;
CREATE POLICY "Users can update own record" ON users
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can manage all users" ON users;
CREATE POLICY "Admins can manage all users" ON users
  FOR ALL USING (is_admin());

-- Cloud Kitchens Table Policies
DROP POLICY IF EXISTS "Users view own cloud kitchen" ON cloud_kitchens;
CREATE POLICY "Users view own cloud kitchen" ON cloud_kitchens
  FOR SELECT USING (
    id IN (SELECT cloud_kitchen_id FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins manage cloud kitchens" ON cloud_kitchens;
CREATE POLICY "Admins manage cloud kitchens" ON cloud_kitchens
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Outlets Table Policies
DROP POLICY IF EXISTS "Users view outlets for own cloud kitchen" ON outlets;
CREATE POLICY "Users view outlets for own cloud kitchen" ON outlets
  FOR SELECT USING (
    cloud_kitchen_id IN (SELECT cloud_kitchen_id FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Supervisors manage outlets for own cloud kitchen" ON outlets;
CREATE POLICY "Supervisors manage outlets for own cloud kitchen" ON outlets
  FOR ALL USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users 
      WHERE id = auth.uid() AND role = 'supervisor'
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Raw Materials Table Policies
DROP POLICY IF EXISTS "All authenticated users can view raw materials" ON raw_materials;
CREATE POLICY "All authenticated users can view raw materials" ON raw_materials
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Purchase managers and admins manage raw materials" ON raw_materials;
CREATE POLICY "Purchase managers and admins manage raw materials" ON raw_materials
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin')
    )
  );

-- Material Costs Table Policies
DROP POLICY IF EXISTS "All authenticated users can view material costs" ON material_costs;
CREATE POLICY "All authenticated users can view material costs" ON material_costs
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Purchase managers and admins manage material costs" ON material_costs;
CREATE POLICY "Purchase managers and admins manage material costs" ON material_costs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin')
    )
  );

-- Inventory Table Policies
DROP POLICY IF EXISTS "Users view own cloud kitchen inventory" ON inventory;
CREATE POLICY "Users view own cloud kitchen inventory" ON inventory
  FOR SELECT USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Supervisors and purchase managers update inventory" ON inventory;
CREATE POLICY "Supervisors and purchase managers update inventory" ON inventory
  FOR UPDATE USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users 
      WHERE id = auth.uid() 
      AND role IN ('supervisor', 'purchase_manager')
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Allocations Table Policies
DROP POLICY IF EXISTS "Users view allocations for their cloud kitchen" ON allocations;
CREATE POLICY "Users view allocations for their cloud kitchen" ON allocations
  FOR SELECT USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Supervisors create allocations for own cloud kitchen" ON allocations;
CREATE POLICY "Supervisors create allocations for own cloud kitchen" ON allocations
  FOR INSERT WITH CHECK (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users 
      WHERE id = auth.uid() AND role = 'supervisor'
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Supervisors update own allocations" ON allocations;
CREATE POLICY "Supervisors update own allocations" ON allocations
  FOR UPDATE USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users 
      WHERE id = auth.uid() AND role = 'supervisor'
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Allocation Items Table Policies
DROP POLICY IF EXISTS "Users view allocation items for their cloud kitchen" ON allocation_items;
CREATE POLICY "Users view allocation items for their cloud kitchen" ON allocation_items
  FOR SELECT USING (
    allocation_id IN (
      SELECT a.id FROM allocations a
      WHERE a.cloud_kitchen_id IN (
        SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Supervisors manage allocation items" ON allocation_items;
CREATE POLICY "Supervisors manage allocation items" ON allocation_items
  FOR ALL USING (
    allocation_id IN (
      SELECT a.id FROM allocations a
      WHERE a.cloud_kitchen_id IN (
        SELECT cloud_kitchen_id FROM users 
        WHERE id = auth.uid() AND role = 'supervisor'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Stock In Table Policies
DROP POLICY IF EXISTS "Users view stock in for their cloud kitchen" ON stock_in;
CREATE POLICY "Users view stock in for their cloud kitchen" ON stock_in
  FOR SELECT USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Purchase managers create stock in for own cloud kitchen" ON stock_in;
CREATE POLICY "Purchase managers create stock in for own cloud kitchen" ON stock_in
  FOR INSERT WITH CHECK (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users 
      WHERE id = auth.uid() AND role = 'purchase_manager'
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Purchase managers update own stock in" ON stock_in;
CREATE POLICY "Purchase managers update own stock in" ON stock_in
  FOR UPDATE USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users 
      WHERE id = auth.uid() AND role = 'purchase_manager'
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Stock In Items Table Policies
DROP POLICY IF EXISTS "Users view stock in items for their cloud kitchen" ON stock_in_items;
CREATE POLICY "Users view stock in items for their cloud kitchen" ON stock_in_items
  FOR SELECT USING (
    stock_in_id IN (
      SELECT s.id FROM stock_in s
      WHERE s.cloud_kitchen_id IN (
        SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Purchase managers manage stock in items" ON stock_in_items;
CREATE POLICY "Purchase managers manage stock in items" ON stock_in_items
  FOR ALL USING (
    stock_in_id IN (
      SELECT s.id FROM stock_in s
      WHERE s.cloud_kitchen_id IN (
        SELECT cloud_kitchen_id FROM users 
        WHERE id = auth.uid() AND role = 'purchase_manager'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Audit Logs Table Policies
DROP POLICY IF EXISTS "Users view own audit logs" ON audit_logs;
CREATE POLICY "Users view own audit logs" ON audit_logs
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;
CREATE POLICY "System can insert audit logs" ON audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- =====================================================
-- 3. VIEWS
-- =====================================================

-- Consumption Summary View
DROP VIEW IF EXISTS consumption_summary;
CREATE VIEW consumption_summary AS
SELECT
  o.id AS outlet_id,
  o.name AS outlet_name,
  o.cloud_kitchen_id,
  ck.name AS cloud_kitchen_name,
  ai.raw_material_id,
  rm.name AS raw_material_name,
  SUM(ai.quantity) AS total_consumption,
  COUNT(DISTINCT a.allocation_date) AS allocation_days,
  MIN(a.allocation_date) AS first_allocation,
  MAX(a.allocation_date) AS last_allocation
FROM allocations a
JOIN allocation_items ai ON a.id = ai.allocation_id
JOIN outlets o ON a.outlet_id = o.id
JOIN cloud_kitchens ck ON o.cloud_kitchen_id = ck.id
JOIN raw_materials rm ON ai.raw_material_id = rm.id
WHERE a.allocation_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY o.id, o.name, o.cloud_kitchen_id, ck.name, ai.raw_material_id, rm.name;

-- =====================================================
-- END OF SCHEMA
-- =====================================================

