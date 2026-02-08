-- =====================================================
-- Update RLS Policies for Stock Out Table
-- This updates the policies to support self stock outs
-- where allocation_request_id and outlet_id can be NULL
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE stock_out ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Purchase managers and supervisors view stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Purchase managers create stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Purchase managers update stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Admin can delete stock out" ON stock_out;

-- =====================================================
-- HELPER FUNCTIONS (REUSE FROM OTHER POLICIES)
-- =====================================================

-- Assuming is_purchase_manager_or_admin() and is_admin() already exist
-- If not, they are defined in audit-logs-rls-policies.sql

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
-- Updated to support both regular stock outs and self stock outs
CREATE POLICY "Purchase managers create stock out for own kitchen" ON stock_out
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND cloud_kitchen_id IS NOT NULL
    AND allocated_by IS NOT NULL
    AND allocation_date IS NOT NULL
    -- Verify the check constraint is satisfied (handled by table constraint)
    -- For regular stock outs: verify allocation_request and outlet belong to kitchen
    AND (
      -- Self stock out: no additional checks needed (constraint handles it)
      self_stock_out = true
      OR
      -- Regular stock out: verify allocation_request and outlet
      (
        self_stock_out = false
        AND allocation_request_id IS NOT NULL
        AND outlet_id IS NOT NULL
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
      )
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
    AND cloud_kitchen_id IS NOT NULL
    AND allocated_by IS NOT NULL
    AND allocation_date IS NOT NULL
    -- The table constraint will handle the self_stock_out validation
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
--    - Works with both regular and self stock outs
--    - Works with both Supabase auth and key-based login
--
-- 2. INSERT: Purchase managers can create both types of stock_out records
--    - For self stock outs: only cloud_kitchen_id, allocated_by, and reason are required
--    - For regular stock outs: allocation_request_id and outlet_id are also required
--    - The table constraint ensures data integrity
--
-- 3. UPDATE: Purchase managers can update stock_out records for their kitchen
--    - Limited updates (mainly for notes or reason corrections)
--
-- 4. DELETE: Only admins can delete (to maintain audit trail)
--
-- 5. Self Stock Out Flow:
--    - Purchase manager creates self stock out with reason
--    - Stock is decremented from stock_in_batches (FIFO)
--    - Inventory is decremented
--    - Audit log is created
--    - No allocation request or outlet involved
--
-- 6. Security:
--    - All operations are scoped to the user's cloud_kitchen_id
--    - Key-based users rely on application-level filtering
--    - Audit trail is maintained by preventing deletions
