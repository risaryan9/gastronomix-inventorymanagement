-- =====================================================
-- RLS Policies for Stock Out Items Table
-- This allows:
-- 1. Purchase managers to create and view stock_out_items for their cloud kitchen
-- 2. Works with both Supabase auth and key-based login
-- 3. Tracks individual materials allocated in each stock-out operation
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE stock_out_items ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP EXISTING POLICIES
-- =====================================================

DROP POLICY IF EXISTS "Purchase managers view stock out items for own kitchen" ON stock_out_items;
DROP POLICY IF EXISTS "Purchase managers create stock out items for own kitchen" ON stock_out_items;
DROP POLICY IF EXISTS "Purchase managers update stock out items for own kitchen" ON stock_out_items;
DROP POLICY IF EXISTS "Admin can delete stock out items" ON stock_out_items;
DROP POLICY IF EXISTS "Supervisors view stock out items for own kitchen" ON stock_out_items;

-- =====================================================
-- HELPER FUNCTIONS (REUSE FROM OTHER POLICIES)
-- =====================================================

-- Assuming is_purchase_manager_or_admin() and is_admin() already exist
-- If not, they are defined in stock-in-rls-policies.sql

-- =====================================================
-- SELECT POLICY (VIEW)
-- =====================================================

-- Allow purchase managers and supervisors to view stock_out_items for their cloud kitchen
CREATE POLICY "Purchase managers and supervisors view stock out items for own kitchen" ON stock_out_items
  FOR SELECT
  TO public
  USING (
    -- Check if the stock_out belongs to the user's kitchen
    stock_out_id IN (
      SELECT s.id FROM stock_out s
      WHERE (
        -- For authenticated users
        (auth.uid() IS NOT NULL AND EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() 
          AND role IN ('purchase_manager', 'admin', 'supervisor')
          AND is_active = true
          AND cloud_kitchen_id = s.cloud_kitchen_id
        ))
        OR
        -- For key-based (anon) users, allow all
        (auth.uid() IS NULL)
      )
    )
  );

-- =====================================================
-- INSERT POLICY
-- =====================================================

-- Allow purchase managers and admins to create stock_out_items for their cloud kitchen
CREATE POLICY "Purchase managers create stock out items for own kitchen" ON stock_out_items
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND stock_out_id IS NOT NULL
    AND raw_material_id IS NOT NULL
    AND quantity > 0
    -- Verify the stock_out belongs to the user's kitchen
    AND EXISTS (
      SELECT 1 FROM stock_out
      WHERE stock_out.id = stock_out_items.stock_out_id
      AND (
        auth.uid() IS NULL
        OR EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() 
          AND cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
      )
    )
  );

-- =====================================================
-- UPDATE POLICY
-- =====================================================

-- Allow purchase managers and admins to update stock_out_items
-- This is rarely needed but allowed for corrections
CREATE POLICY "Purchase managers update stock out items for own kitchen" ON stock_out_items
  FOR UPDATE
  TO public
  USING (
    is_purchase_manager_or_admin()
    -- Check if the stock_out belongs to the user's kitchen
    AND stock_out_id IN (
      SELECT s.id FROM stock_out s
      WHERE (
        auth.uid() IS NULL
        OR EXISTS (
          SELECT 1 FROM users 
          WHERE id = auth.uid() 
          AND cloud_kitchen_id = s.cloud_kitchen_id
        )
      )
    )
  )
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND stock_out_id IS NOT NULL
    AND raw_material_id IS NOT NULL
    AND quantity > 0
  );

-- =====================================================
-- DELETE POLICY
-- =====================================================

-- Only admins can delete stock_out_items (to maintain audit trail)
CREATE POLICY "Admin can delete stock out items" ON stock_out_items
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. SELECT: Purchase managers and supervisors can view stock_out_items for their kitchen
--    - Access is controlled through the parent stock_out record
--    - Supervisors need visibility to see what materials were allocated
--    - Works with both Supabase auth and key-based login
--
-- 2. INSERT: Purchase managers can create stock_out_items
--    - Must be associated with a stock_out that belongs to their kitchen
--    - Requires quantity > 0
--    - Created as part of stock-out operation
--
-- 3. UPDATE: Purchase managers can update stock_out_items (rare)
--    - Primarily for corrections or adjustments
--    - Maintains data integrity with quantity constraints
--
-- 4. DELETE: Only admins can delete (to maintain audit trail)
--    - Purchase managers should not delete allocation item records
--    - Historical records are preserved for reporting and costing
--
-- 5. FIFO Integration:
--    - Each stock_out_item corresponds to a quantity allocated
--    - FIFO logic decrements stock_in_batches
--    - Inventory is automatically decremented
--
-- 6. Security:
--    - All operations are scoped to the user's cloud_kitchen_id via parent stock_out
--    - Key-based users rely on application-level filtering
--    - Audit trail is maintained by preventing deletions
--
-- 7. Relationship:
--    - stock_out_items -> stock_out -> cloud_kitchen
--    - Access control follows the chain of ownership
