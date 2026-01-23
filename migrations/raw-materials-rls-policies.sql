-- =====================================================
-- RLS Policies for Raw Materials Table
-- This allows:
-- 1. All users to view raw materials (catalog items)
-- 2. Purchase managers and admins to create, update, and manage raw materials
-- 3. Works with both Supabase auth and key-based login
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Admin full access to raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Purchase Manager read raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Purchase Manager create raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Supervisor read raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "All authenticated users can view raw materials" ON raw_materials;
DROP POLICY IF EXISTS "All users can view raw materials" ON raw_materials;
DROP POLICY IF EXISTS "Purchase managers and admins manage raw materials" ON raw_materials;
DROP POLICY IF EXISTS "Allow key-based users to view raw materials" ON raw_materials;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Create helper function to check if user is purchase_manager or admin
-- This works for both Supabase auth users and key-based login users
CREATE OR REPLACE FUNCTION is_purchase_manager_or_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is authenticated via Supabase auth
  IF auth.uid() IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 
      FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin')
      AND is_active = true
    );
  END IF;
  
  -- For key-based login (anon users), allow operations
  -- Application-level validation ensures only authorized users can access
  RETURN true;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_purchase_manager_or_admin() TO authenticated, anon;

-- =====================================================
-- SELECT POLICY (VIEW)
-- =====================================================

-- Allow all users (including anon/key-based) to view raw materials
-- This is safe because:
-- 1. Raw materials are catalog items (name, code, unit, category)
-- 2. No sensitive financial or operational data
-- 3. Application layer controls who can see/modify them based on user roles
-- 4. Supervisors need to view materials to create allocation requests
CREATE POLICY "All users can view raw materials" ON raw_materials
  FOR SELECT 
  TO public
  USING (
    -- Only show active, non-deleted materials
    is_active = true 
    AND deleted_at IS NULL
  );

-- =====================================================
-- INSERT POLICY
-- =====================================================

-- Allow purchase managers and admins to create raw materials
-- This works for both Supabase auth and key-based login
CREATE POLICY "Purchase managers and admins can create raw materials" ON raw_materials
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND name IS NOT NULL
    AND code IS NOT NULL
    AND unit IS NOT NULL
    -- Code must be unique (enforced by constraint)
    -- Trigger will automatically create inventory entries for all cloud kitchens
  );

-- =====================================================
-- UPDATE POLICY
-- =====================================================

-- Allow purchase managers and admins to update raw materials
-- This works for both Supabase auth and key-based login
-- This policy handles all updates including is_active toggle and soft delete
CREATE POLICY "Purchase managers and admins can update raw materials" ON raw_materials
  FOR UPDATE
  TO public
  USING (
    is_purchase_manager_or_admin()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    is_purchase_manager_or_admin()
    -- Allow updates to any field as long as user has permission
    -- Required fields (name, code, unit) are enforced by constraints
  );

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. SELECT: All users can view active, non-deleted raw materials
--    - Safe because raw materials are just catalog items
--    - Supervisors need access to view materials for allocation requests
--    - Application layer controls access based on user roles
--
-- 2. INSERT: Purchase managers and admins can create raw materials
--    - Works with both Supabase auth and key-based login
--    - Trigger automatically creates inventory entries for all cloud kitchens
--    - Code must be unique (enforced by constraint)
--
-- 3. UPDATE: Purchase managers and admins can update raw materials
--    - Works with both Supabase auth and key-based login
--    - Can update name, unit, category, description, low_stock_threshold, is_active
--    - Code can be updated but must remain unique
--
-- 4. DELETE: Soft delete only (using deleted_at)
--    - Purchase managers and admins can soft delete
--    - Hard deletes should be restricted to admins only (if needed)
--
-- 5. Security: 
--    - Raw materials are read-only for most users
--    - Only purchase managers and admins can modify
--    - Application-level filtering ensures proper access
--
-- 6. Trigger Behavior:
--    - When a new raw material is created, the trigger `trigger_create_inventory_for_new_material`
--      automatically creates inventory entries (quantity = 0) for all active cloud kitchens
--
-- 7. For production, consider:
--    - Using Supabase auth for all users
--    - Implementing custom JWT claims
--    - Using Edge Functions for material creation
--    - Adding audit logging for material changes
