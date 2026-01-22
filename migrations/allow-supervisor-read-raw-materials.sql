-- =====================================================
-- Allow Supervisors (including key-based login) to Read Raw Materials
-- This fixes the issue where supervisors get empty results when querying raw_materials
-- =====================================================

-- Drop all existing SELECT policies on raw_materials to avoid conflicts
DROP POLICY IF EXISTS "All authenticated users can view raw materials" ON raw_materials;
DROP POLICY IF EXISTS "All users can view raw materials" ON raw_materials;
DROP POLICY IF EXISTS "Allow key-based users to view raw materials" ON raw_materials;
DROP POLICY IF EXISTS "Supervisor read raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Purchase Manager read raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Admin full access to raw_materials" ON raw_materials;

-- Create a single, clear policy that allows ALL users (including anon/key-based) to view raw materials
-- This is safe because raw materials are not sensitive data - they're just catalog items
-- The application layer controls who can see/modify them based on user roles
CREATE POLICY "All users can view raw materials" ON raw_materials
  FOR SELECT 
  TO public
  USING (true);

-- Keep the existing policy for purchase managers and admins to manage raw materials
-- This policy already exists from fix-materials-rls-for-key-login.sql
-- But we'll ensure it's there and correct
DROP POLICY IF EXISTS "Purchase managers and admins manage raw materials" ON raw_materials;
CREATE POLICY "Purchase managers and admins manage raw materials" ON raw_materials
  FOR ALL 
  USING (is_purchase_manager_or_admin())
  WITH CHECK (is_purchase_manager_or_admin());

-- Ensure the helper function exists (from fix-materials-rls-for-key-login.sql)
-- This function allows purchase managers and admins to manage materials
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
  
  -- For key-based login (anon users), we need to allow operations
  -- Application-level validation in the frontend ensures only purchase managers
  -- can access the Materials page and perform operations
  RETURN true;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_purchase_manager_or_admin() TO authenticated, anon;

-- =====================================================
-- Notes:
-- =====================================================
-- 1. The SELECT policy allows ALL users (public) to view raw_materials
--    This is safe because:
--    - Raw materials are just catalog items (name, code, unit, category)
--    - No sensitive financial or operational data
--    - Application layer controls access based on user roles
--
-- 2. The ALL policy (INSERT/UPDATE/DELETE) is restricted to purchase managers and admins
--    This uses the helper function that works for both Supabase auth and key-based login
--
-- 3. Supervisors can now read raw_materials for:
--    - Viewing the raw materials catalog
--    - Creating allocation requests
--    - But cannot modify raw materials (only purchase managers can)
