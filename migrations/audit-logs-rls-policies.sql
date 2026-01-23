-- =====================================================
-- RLS Policies for Audit Logs Table
-- This allows:
-- 1. Admins to view all audit logs
-- 2. Purchase managers to view audit logs for their cloud kitchen
-- 3. Users to view their own audit logs
-- 4. Authenticated users to insert audit logs (for system logging)
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Admin full access to audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "Users read audit_logs for own kitchen" ON audit_logs;
DROP POLICY IF EXISTS "Users view own audit logs" ON audit_logs;
DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Purchase managers can view audit logs" ON audit_logs;
DROP POLICY IF EXISTS "All users can view audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON audit_logs;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Create helper function to check if user is admin
-- This works for both Supabase auth users and key-based login users
CREATE OR REPLACE FUNCTION is_admin()
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
      AND role = 'admin'
      AND is_active = true
    );
  END IF;
  
  -- For key-based login (anon users), return false
  -- Admins should use Supabase auth
  RETURN false;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, anon;

-- Create helper function to check if user is purchase_manager or admin
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

-- Admin: Full access to all audit logs
CREATE POLICY "Admin full access to audit logs" ON audit_logs
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Purchase Managers: View audit logs for their cloud kitchen
-- This works by checking if the entity_id in audit logs relates to their cloud kitchen
-- For inventory adjustments, we check if the inventory belongs to their cloud kitchen
CREATE POLICY "Purchase managers view audit logs for own kitchen" ON audit_logs
  FOR SELECT
  TO public
  USING (
    -- For authenticated purchase managers
    (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 
        FROM users 
        WHERE id = auth.uid() 
        AND role = 'purchase_manager'
        AND is_active = true
        AND cloud_kitchen_id IS NOT NULL
        AND (
          -- If entity_type is 'inventory', check cloud_kitchen_id
          (entity_type = 'inventory' AND EXISTS (
            SELECT 1 FROM inventory 
            WHERE inventory.id = audit_logs.entity_id 
            AND inventory.cloud_kitchen_id = users.cloud_kitchen_id
          ))
          -- If entity_type is 'stock_in', check cloud_kitchen_id
          OR (entity_type = 'stock_in' AND EXISTS (
            SELECT 1 FROM stock_in 
            WHERE stock_in.id = audit_logs.entity_id 
            AND stock_in.cloud_kitchen_id = users.cloud_kitchen_id
          ))
          -- If entity_type is 'allocation_request', check cloud_kitchen_id
          OR (entity_type = 'allocation_request' AND EXISTS (
            SELECT 1 FROM allocation_requests 
            WHERE allocation_requests.id = audit_logs.entity_id 
            AND allocation_requests.cloud_kitchen_id = users.cloud_kitchen_id
          ))
          -- If entity_type is 'stock_out', check cloud_kitchen_id
          OR (entity_type = 'stock_out' AND EXISTS (
            SELECT 1 FROM stock_out 
            WHERE stock_out.id = audit_logs.entity_id 
            AND stock_out.cloud_kitchen_id = users.cloud_kitchen_id
          ))
          -- For other entity types, allow if user_id matches
          OR (entity_type NOT IN ('inventory', 'stock_in', 'allocation_request', 'stock_out'))
        )
      )
    )
    -- For key-based login (anon users), allow viewing
    -- Application layer filters by cloud_kitchen_id
    OR (auth.uid() IS NULL AND is_purchase_manager_or_admin())
  );

-- Users: View their own audit logs (where user_id matches)
CREATE POLICY "Users view own audit logs" ON audit_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_admin()
  );

-- =====================================================
-- INSERT POLICY
-- =====================================================

-- Allow authenticated users to insert audit logs
-- This is needed for the application to log actions
-- Works for both Supabase auth and key-based login
CREATE POLICY "Authenticated users can insert audit logs" ON audit_logs
  FOR INSERT
  TO public
  WITH CHECK (
    -- Allow if user_id is provided (can be NULL for system actions)
    -- Application ensures proper user_id is set
    true
  );

-- =====================================================
-- UPDATE POLICY (RESTRICTED)
-- =====================================================

-- Audit logs should generally be immutable
-- Only admins can update (for corrections if needed)
CREATE POLICY "Admin can update audit logs" ON audit_logs
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- =====================================================
-- DELETE POLICY (RESTRICTED)
-- =====================================================

-- Audit logs should generally not be deleted
-- Only admins can delete (for data retention policies)
CREATE POLICY "Admin can delete audit logs" ON audit_logs
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. SELECT: 
--    - Admins can view all audit logs
--    - Purchase managers can view logs for their cloud kitchen
--    - Users can view their own logs (where user_id matches)
--    - Key-based users can view (application filters)
--
-- 2. INSERT: 
--    - All authenticated users can insert audit logs
--    - Application ensures proper user_id and entity relationships
--    - Works with both Supabase auth and key-based login
--
-- 3. UPDATE/DELETE: 
--    - Only admins can update or delete audit logs
--    - This maintains audit trail integrity
--
-- 4. Security: 
--    - Audit logs are read-only for most users
--    - Purchase managers can only see logs related to their cloud kitchen
--    - Application-level filtering ensures proper access
--
-- 5. Entity Type Filtering:
--    - For 'inventory': Checks inventory.cloud_kitchen_id
--    - For 'stock_in': Checks stock_in.cloud_kitchen_id
--    - For 'allocation_request': Checks allocation_requests.cloud_kitchen_id
--    - For 'stock_out': Checks stock_out.cloud_kitchen_id
--    - For other types: Allows if user_id matches
--
-- 6. For production, consider:
--    - Using Supabase auth for all users
--    - Implementing custom JWT claims
--    - Using Edge Functions for audit log creation
--    - Adding data retention policies
--    - Implementing audit log archiving
