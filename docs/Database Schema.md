# Database Schema Documentation
## Gastronomix Inventory Management System

This document outlines the complete database schema for the inventory management system using Supabase (PostgreSQL).

---

## Database Design Principles

1. **Normalization:** Proper 3NF to reduce redundancy
2. **Audit Trail:** Track all changes with timestamps and user IDs
3. **Soft Deletes:** Use `deleted_at` instead of hard deletes
4. **Row Level Security (RLS):** Implement at database level for security
5. **Indexing:** Optimize queries with appropriate indexes

---

## Core Tables

### 1. `users`
Stores user accounts with role-based access.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('supervisor', 'purchase_manager', 'admin')),
  cloud_kitchen_id UUID REFERENCES cloud_kitchens(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_users_cloud_kitchen_id ON users(cloud_kitchen_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
```

**Notes:**
- `cloud_kitchen_id` is NULL for admins (they see all)
- Use Supabase Auth for authentication, link to this table via `auth.users.id`

---

### 2. `cloud_kitchens`
Stores cloud kitchen information.

```sql
CREATE TABLE cloud_kitchens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, -- e.g., 'CK001'
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_cloud_kitchens_code ON cloud_kitchens(code);
```

---

### 3. `outlets`
Stores outlet information mapped to cloud kitchens.

```sql
CREATE TABLE outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL, -- e.g., 'OUT001'
  address TEXT,
  contact_person TEXT,
  contact_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(cloud_kitchen_id, code)
);

-- Indexes
CREATE INDEX idx_outlets_cloud_kitchen_id ON outlets(cloud_kitchen_id);
CREATE INDEX idx_outlets_code ON outlets(code);
```

---

### 4. `raw_materials`
Catalog of all raw materials/ingredients.

```sql
CREATE TABLE raw_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, -- e.g., 'RM001'
  unit TEXT NOT NULL, -- 'kg', 'liter', 'piece', 'gram', etc.
  description TEXT,
  category TEXT, -- Optional: 'vegetables', 'spices', 'packaging', etc.
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_raw_materials_code ON raw_materials(code);
CREATE INDEX idx_raw_materials_category ON raw_materials(category);
```

---

### 5. `material_costs`
Tracks cost history for raw materials (for price tracking).

```sql
CREATE TABLE material_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  cost_per_unit DECIMAL(10, 2) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ, -- NULL if current
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_material_costs_raw_material_id ON material_costs(raw_material_id);
CREATE INDEX idx_material_costs_effective_from ON material_costs(effective_from);
```

**Notes:**
- Only one cost should be active (effective_to IS NULL) per material
- Purchase Manager can update costs, creating new records

---

### 6. `inventory`
Main inventory stock per cloud kitchen per raw material.

```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold DECIMAL(10, 3) DEFAULT 0, -- Alert threshold
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(cloud_kitchen_id, raw_material_id)
);

-- Indexes
CREATE INDEX idx_inventory_cloud_kitchen_id ON inventory(cloud_kitchen_id);
CREATE INDEX idx_inventory_raw_material_id ON inventory(raw_material_id);
CREATE INDEX idx_inventory_low_stock ON inventory(cloud_kitchen_id, quantity, low_stock_threshold);
```

**Notes:**
- This table represents CURRENT stock levels
- Updates happen via stock-in and allocations
- Low stock check: `quantity <= low_stock_threshold`

---

### 7. `allocations`
Records of inventory allocations from cloud kitchen to outlets.

```sql
CREATE TABLE allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id) ON DELETE CASCADE,
  allocated_by UUID NOT NULL REFERENCES users(id),
  allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_allocations_outlet_id ON allocations(outlet_id);
CREATE INDEX idx_allocations_cloud_kitchen_id ON allocations(cloud_kitchen_id);
CREATE INDEX idx_allocations_allocation_date ON allocations(allocation_date);
```

**Notes:**
- Supervisor creates allocations directly (after reviewing paper requests)
- No digital request tracking - allocations are the primary record
- Each allocation represents a single allocation transaction to an outlet

---

### 8. `allocation_items`
Items allocated in each allocation.

```sql
CREATE TABLE allocation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
  UNIQUE(allocation_id, raw_material_id)
);

-- Indexes
CREATE INDEX idx_allocation_items_allocation_id ON allocation_items(allocation_id);
CREATE INDEX idx_allocation_items_raw_material_id ON allocation_items(raw_material_id);
```

---

### 9. `stock_in`
Records of incoming stock (purchases/receipts).

```sql
CREATE TABLE stock_in (
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

-- Indexes
CREATE INDEX idx_stock_in_cloud_kitchen_id ON stock_in(cloud_kitchen_id);
CREATE INDEX idx_stock_in_receipt_date ON stock_in(receipt_date);
CREATE INDEX idx_stock_in_received_by ON stock_in(received_by);
```

---

### 10. `stock_in_items`
Items received in each stock-in transaction.

```sql
CREATE TABLE stock_in_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_in_id UUID NOT NULL REFERENCES stock_in(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
  unit_cost DECIMAL(10, 2) NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  UNIQUE(stock_in_id, raw_material_id)
);

-- Indexes
CREATE INDEX idx_stock_in_items_stock_in_id ON stock_in_items(stock_in_id);
CREATE INDEX idx_stock_in_items_raw_material_id ON stock_in_items(raw_material_id);
```

---

### 11. `audit_logs`
Audit trail for critical operations (optional but recommended).

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- 'create', 'update', 'delete', 'allocate', 'stock_in'
  entity_type TEXT NOT NULL, -- 'allocation', 'inventory', 'stock_in', etc.
  entity_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

---

## Database Functions & Triggers

### 1. Update Inventory on Stock-In
```sql
CREATE OR REPLACE FUNCTION update_inventory_on_stock_in()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory (cloud_kitchen_id, raw_material_id, quantity, last_updated_at, updated_by)
  VALUES (
    (SELECT cloud_kitchen_id FROM stock_in WHERE id = NEW.stock_in_id),
    NEW.raw_material_id,
    NEW.quantity,
    NOW(),
    (SELECT received_by FROM stock_in WHERE id = NEW.stock_in_id)
  )
  ON CONFLICT (cloud_kitchen_id, raw_material_id)
  DO UPDATE SET
    quantity = inventory.quantity + NEW.quantity,
    last_updated_at = NOW(),
    updated_by = (SELECT received_by FROM stock_in WHERE id = NEW.stock_in_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_inventory_on_stock_in
  AFTER INSERT ON stock_in_items
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_on_stock_in();
```

### 2. Update Inventory on Allocation
```sql
CREATE OR REPLACE FUNCTION update_inventory_on_allocation()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory
  SET
    quantity = quantity - NEW.quantity,
    last_updated_at = NOW(),
    updated_by = (SELECT allocated_by FROM allocations WHERE id = NEW.allocation_id)
  WHERE
    cloud_kitchen_id = (SELECT cloud_kitchen_id FROM allocations WHERE id = NEW.allocation_id)
    AND raw_material_id = NEW.raw_material_id
    AND quantity >= NEW.quantity;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient stock for allocation';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_inventory_on_allocation
  AFTER INSERT ON allocation_items
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_on_allocation();
```

### 3. Auto-update timestamps
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cloud_kitchens_updated_at BEFORE UPDATE ON cloud_kitchens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ... (apply to other tables as needed)
```

---

## Row Level Security (RLS) Policies

### Users Table
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can view their own record
CREATE POLICY "Users can view own record" ON users
  FOR SELECT USING (auth.uid() = id);

-- Admins can view all users
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );
```

### Inventory Table
```sql
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- Users can view inventory for their cloud kitchen
CREATE POLICY "Users view own cloud kitchen inventory" ON inventory
  FOR SELECT USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );
```

### Allocations Table
```sql
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view allocations for their cloud kitchen" ON allocations
  FOR SELECT USING (
    cloud_kitchen_id IN (
      SELECT cloud_kitchen_id FROM users WHERE id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );
```

*Note: Implement comprehensive RLS policies for all tables based on role and cloud_kitchen_id mapping.*

---

## Views for Analytics

### Consumption Summary View
```sql
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
``` 

---

## Database Migrations Strategy

1. **Initial Setup:** Create all tables, indexes, constraints
2. **Functions & Triggers:** Add database functions and triggers
3. **RLS Policies:** Implement Row Level Security
4. **Seed Data:** Insert initial data (cloud kitchens, users, raw materials)
5. **Views:** Create analytical views

---

## Notes

- Use UUID for all primary keys (better for distributed systems)
- Use DECIMAL for quantities and costs (precision important for financial data)
- Implement soft deletes with `deleted_at` for data retention
- Consider partitioning for large tables (audit_logs, transactions) if needed
- Regular backups recommended
- Index optimization based on query patterns


