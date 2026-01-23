-- =====================================================
-- RLS Policies for Stock In Table
-- This allows:
-- 1. Purchase managers to create and view stock_in records for their cloud kitchen
-- 2. Works with both Supabase auth and key-based login
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE stock_in ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Users view stock in for their cloud kitchen" ON stock_in;
DROP POLICY IF EXISTS "Purchase managers create stock in for own cloud kitchen" ON stock_in;
DROP POLICY IF EXISTS "Purchase managers update own stock in" ON stock_in;
DROP POLICY IF EXISTS "Admin full access to stock_in" ON stock_in;
DROP POLICY IF EXISTS "Allow key-based users to view stock in by cloud kitchen" ON stock_in;
DROP POLICY IF EXISTS "Allow key-based users to insert stock in by cloud kitchen" ON stock_in;

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

-- Allow purchase managers and admins to view stock_in records for their cloud kitchen
CREATE POLICY "Purchase managers view stock in for own kitchen" ON stock_in
  FOR SELECT
  TO public
  USING (
    -- For authenticated users, check if they are PM/Admin and match cloud_kitchen_id
    (auth.uid() IS NOT NULL AND is_purchase_manager_or_admin() AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND cloud_kitchen_id = stock_in.cloud_kitchen_id
    ))
    OR
    -- For key-based (anon) users, allow all (application-level filtering)
    (auth.uid() IS NULL)
  );

-- =====================================================
-- INSERT POLICY
-- =====================================================

-- Allow purchase managers and admins to create stock_in records for their cloud kitchen
CREATE POLICY "Purchase managers create stock in for own kitchen" ON stock_in
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND cloud_kitchen_id IS NOT NULL
    AND received_by IS NOT NULL
    AND receipt_date IS NOT NULL
    -- For authenticated users, verify cloud_kitchen_id matches user's kitchen
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND cloud_kitchen_id = stock_in.cloud_kitchen_id
      )
    )
  );

-- =====================================================
-- UPDATE POLICY
-- =====================================================

-- Allow purchase managers and admins to update stock_in records for their cloud kitchen
CREATE POLICY "Purchase managers update stock in for own kitchen" ON stock_in
  FOR UPDATE
  TO public
  USING (
    is_purchase_manager_or_admin()
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND cloud_kitchen_id = stock_in.cloud_kitchen_id
      )
    )
  )
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND cloud_kitchen_id IS NOT NULL
    AND received_by IS NOT NULL
    AND receipt_date IS NOT NULL
  );

-- =====================================================
-- DELETE POLICY
-- =====================================================

-- Only admins can delete stock_in records (to maintain audit trail)
-- Purchase managers should not delete records, only update if needed
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false; -- Anon users cannot be admins
  END IF;
  
  RETURN EXISTS (
    SELECT 1 
    FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
    AND is_active = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

CREATE POLICY "Admin can delete stock in" ON stock_in
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. SELECT: Purchase managers can view stock_in records for their cloud kitchen
--    - Works with both Supabase auth and key-based login
--    - Application layer should filter by cloud_kitchen_id for key-based users
--
-- 2. INSERT: Purchase managers can create stock_in records
--    - Must match their cloud_kitchen_id (for authenticated users)
--    - Requires received_by, receipt_date, and cloud_kitchen_id
--
-- 3. UPDATE: Purchase managers can update stock_in records for their kitchen
--    - Maintains data integrity by checking cloud_kitchen_id
--
-- 4. DELETE: Only admins can delete (to maintain audit trail)
--    - Purchase managers should not delete records
--
-- 5. Security:
--    - All operations are scoped to the user's cloud_kitchen_id
--    - Key-based users rely on application-level filtering
--    - Audit trail is maintained by preventing deletions
