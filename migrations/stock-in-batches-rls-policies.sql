-- =====================================================
-- RLS Policies for Stock In Batches Table
-- This allows:
-- 1. Purchase managers to create and view stock_in_batches for their cloud kitchen
-- 2. Works with both Supabase auth and key-based login
-- 3. Supports FIFO inventory tracking
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE stock_in_batches ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Users view stock in batches for their cloud kitchen" ON stock_in_batches;
DROP POLICY IF EXISTS "Purchase managers manage stock in batches" ON stock_in_batches;
DROP POLICY IF EXISTS "Admin full access to stock_in_batches" ON stock_in_batches;
DROP POLICY IF EXISTS "Allow key-based users to view stock in batches" ON stock_in_batches;
DROP POLICY IF EXISTS "Allow key-based users to insert stock in batches" ON stock_in_batches;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Reuse helper function from stock_in policies
-- (Assuming it's already created, if not, it will be created by stock_in-rls-policies.sql)

-- =====================================================
-- SELECT POLICY (VIEW)
-- =====================================================

-- Allow purchase managers and admins to view stock_in_batches for their cloud kitchen
CREATE POLICY "Purchase managers view stock in batches for own kitchen" ON stock_in_batches
  FOR SELECT
  TO public
  USING (
    -- For authenticated users, check if they are PM/Admin and match cloud_kitchen_id
    (auth.uid() IS NOT NULL AND is_purchase_manager_or_admin() AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND cloud_kitchen_id = stock_in_batches.cloud_kitchen_id
    ))
    OR
    -- For key-based (anon) users, allow all (application-level filtering)
    (auth.uid() IS NULL)
  );

-- =====================================================
-- INSERT POLICY
-- =====================================================

-- Allow purchase managers and admins to create stock_in_batches for their cloud kitchen
CREATE POLICY "Purchase managers create stock in batches for own kitchen" ON stock_in_batches
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND stock_in_id IS NOT NULL
    AND raw_material_id IS NOT NULL
    AND cloud_kitchen_id IS NOT NULL
    AND quantity_purchased > 0
    AND quantity_remaining >= 0
    AND quantity_remaining <= quantity_purchased
    AND unit_cost > 0
    -- Verify the stock_in record belongs to the user's kitchen
    AND EXISTS (
      SELECT 1 FROM stock_in
      WHERE stock_in.id = stock_in_batches.stock_in_id
      AND (
        auth.uid() IS NULL
        OR EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() 
          AND cloud_kitchen_id = stock_in.cloud_kitchen_id
          AND stock_in.cloud_kitchen_id = stock_in_batches.cloud_kitchen_id
        )
      )
    )
  );

-- =====================================================
-- UPDATE POLICY
-- =====================================================

-- Allow purchase managers and admins to update stock_in_batches
-- This is needed for FIFO operations when quantity_remaining is decremented
CREATE POLICY "Purchase managers update stock in batches for own kitchen" ON stock_in_batches
  FOR UPDATE
  TO public
  USING (
    is_purchase_manager_or_admin()
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND cloud_kitchen_id = stock_in_batches.cloud_kitchen_id
      )
    )
  )
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND stock_in_id IS NOT NULL
    AND raw_material_id IS NOT NULL
    AND cloud_kitchen_id IS NOT NULL
    AND quantity_purchased > 0
    AND quantity_remaining >= 0
    AND quantity_remaining <= quantity_purchased
    AND unit_cost > 0
  );

-- =====================================================
-- DELETE POLICY
-- =====================================================

-- Only admins can delete stock_in_batches (to maintain audit trail)
-- Purchase managers should not delete records, only update quantity_remaining
CREATE POLICY "Admin can delete stock in batches" ON stock_in_batches
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. SELECT: Purchase managers can view stock_in_batches for their cloud kitchen
--    - Works with both Supabase auth and key-based login
--    - Application layer should filter by cloud_kitchen_id for key-based users
--
-- 2. INSERT: Purchase managers can create stock_in_batches
--    - Must match their cloud_kitchen_id (for authenticated users)
--    - Requires stock_in_id, raw_material_id, cloud_kitchen_id
--    - Validates quantity constraints (quantity_remaining <= quantity_purchased)
--    - Verifies the parent stock_in record belongs to the user's kitchen
--
-- 3. UPDATE: Purchase managers can update stock_in_batches
--    - Primarily used to decrement quantity_remaining during FIFO allocations
--    - Maintains data integrity with quantity constraints
--
-- 4. DELETE: Only admins can delete (to maintain audit trail)
--    - Purchase managers should not delete records
--    - Historical batches are preserved for cost calculation
--
-- 5. FIFO Support:
--    - quantity_remaining tracks available stock in each batch
--    - When stock is allocated, quantity_remaining is decremented
--    - Batches with quantity_remaining = 0 are considered depleted but remain for history
--
-- 6. Security:
--    - All operations are scoped to the user's cloud_kitchen_id
--    - Key-based users rely on application-level filtering
--    - Audit trail is maintained by preventing deletions
