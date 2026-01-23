-- =====================================================
-- RLS Policies for Stock Out Table
-- This allows:
-- 1. Purchase managers to create and view stock_out records for their cloud kitchen
-- 2. Works with both Supabase auth and key-based login
-- 3. Tracks stock allocations from kitchen to outlets
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE stock_out ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Purchase managers view stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Purchase managers create stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Purchase managers update stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Admin can delete stock out" ON stock_out;
DROP POLICY IF EXISTS "Supervisors view stock out for own kitchen" ON stock_out;

-- =====================================================
-- HELPER FUNCTIONS (REUSE FROM OTHER POLICIES)
-- =====================================================

-- Assuming is_purchase_manager_or_admin() and is_admin() already exist
-- If not, they are defined in stock-in-rls-policies.sql

-- =====================================================
-- SELECT POLICY (VIEW)
-- =====================================================

-- Allow purchase managers and supervisors to view stock_out records for their cloud kitchen
CREATE POLICY "Purchase managers and supervisors view stock out for own kitchen" ON stock_out
  FOR SELECT
  TO public
  USING (
    -- For authenticated users, check if they are PM/Admin/Supervisor and match cloud_kitchen_id
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin', 'supervisor')
      AND is_active = true
      AND cloud_kitchen_id = stock_out.cloud_kitchen_id
    ))
    OR
    -- For key-based (anon) users, allow all (application-level filtering)
    (auth.uid() IS NULL)
  );

-- =====================================================
-- INSERT POLICY
-- =====================================================

-- Allow purchase managers and admins to create stock_out records for their cloud kitchen
CREATE POLICY "Purchase managers create stock out for own kitchen" ON stock_out
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND allocation_request_id IS NOT NULL
    AND outlet_id IS NOT NULL
    AND cloud_kitchen_id IS NOT NULL
    AND allocated_by IS NOT NULL
    AND allocation_date IS NOT NULL
    -- Verify the allocation_request belongs to the user's kitchen
    AND EXISTS (
      SELECT 1 FROM allocation_requests
      WHERE allocation_requests.id = stock_out.allocation_request_id
      AND (
        auth.uid() IS NULL
        OR EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() 
          AND cloud_kitchen_id = allocation_requests.cloud_kitchen_id
          AND allocation_requests.cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
      )
    )
    -- Verify the outlet belongs to the user's kitchen
    AND EXISTS (
      SELECT 1 FROM outlets
      WHERE outlets.id = stock_out.outlet_id
      AND outlets.cloud_kitchen_id = stock_out.cloud_kitchen_id
    )
  );

-- =====================================================
-- UPDATE POLICY
-- =====================================================

-- Allow purchase managers and admins to update stock_out records for their cloud kitchen
CREATE POLICY "Purchase managers update stock out for own kitchen" ON stock_out
  FOR UPDATE
  TO public
  USING (
    is_purchase_manager_or_admin()
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND cloud_kitchen_id = stock_out.cloud_kitchen_id
      )
    )
  )
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND allocation_request_id IS NOT NULL
    AND outlet_id IS NOT NULL
    AND cloud_kitchen_id IS NOT NULL
    AND allocated_by IS NOT NULL
    AND allocation_date IS NOT NULL
  );

-- =====================================================
-- DELETE POLICY
-- =====================================================

-- Only admins can delete stock_out records (to maintain audit trail)
CREATE POLICY "Admin can delete stock out" ON stock_out
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. SELECT: Purchase managers and supervisors can view stock_out records for their kitchen
--    - Supervisors need visibility to see what was allocated to their outlets
--    - Works with both Supabase auth and key-based login
--    - Application layer should filter by cloud_kitchen_id for key-based users
--
-- 2. INSERT: Purchase managers can create stock_out records
--    - Must match their cloud_kitchen_id (for authenticated users)
--    - Verifies the allocation_request and outlet belong to the same kitchen
--    - Requires all mandatory fields
--
-- 3. UPDATE: Purchase managers can update stock_out records for their kitchen
--    - Maintains data integrity by checking cloud_kitchen_id
--    - Limited updates (mainly for notes or corrections)
--
-- 4. DELETE: Only admins can delete (to maintain audit trail)
--    - Purchase managers should not delete allocation records
--    - Historical records are preserved for reporting
--
-- 5. FIFO Integration:
--    - stock_out creation triggers stock_in_batches decrement
--    - stock_out_items created in conjunction with stock_out
--    - Inventory decremented automatically
--
-- 6. Security:
--    - All operations are scoped to the user's cloud_kitchen_id
--    - Key-based users rely on application-level filtering
--    - Audit trail is maintained by preventing deletions
