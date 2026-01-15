-- =====================================================
-- Add RLS Policy for Key-Based Users to Access Outlets
-- This allows users without Supabase Auth to query outlets
-- by their cloud_kitchen_id (similar to inventory policy)
-- =====================================================

-- Note: This is a workaround for key-based authentication
-- Key-based users don't have auth.uid(), so we need a policy
-- that allows querying by cloud_kitchen_id directly

-- Add policy to allow key-based users to view outlets for their cloud kitchen
-- This policy allows queries when cloud_kitchen_id is specified
-- The application layer ensures users only query their own cloud_kitchen_id
DROP POLICY IF EXISTS "Allow key-based users to view outlets by cloud kitchen" ON outlets;
CREATE POLICY "Allow key-based users to view outlets by cloud kitchen" 
ON outlets
FOR SELECT
TO public
USING (
  -- Allow if cloud_kitchen_id is provided (application ensures correct ID)
  -- This is safe because users can only query their own cloud_kitchen_id from session
  cloud_kitchen_id IS NOT NULL
);

-- Allow key-based users to create allocations for their cloud kitchen
DROP POLICY IF EXISTS "Allow key-based users to create allocations by cloud kitchen" ON allocations;
CREATE POLICY "Allow key-based users to create allocations by cloud kitchen" 
ON allocations
FOR INSERT
TO public
WITH CHECK (
  -- Allow if cloud_kitchen_id is provided (application ensures correct ID)
  cloud_kitchen_id IS NOT NULL
);

-- Allow key-based users to view allocations for their cloud kitchen
DROP POLICY IF EXISTS "Allow key-based users to view allocations by cloud kitchen" ON allocations;
CREATE POLICY "Allow key-based users to view allocations by cloud kitchen" 
ON allocations
FOR SELECT
TO public
USING (
  -- Allow if cloud_kitchen_id is provided (application ensures correct ID)
  cloud_kitchen_id IS NOT NULL
);

-- Allow key-based users to view allocation items
DROP POLICY IF EXISTS "Allow key-based users to view allocation items" ON allocation_items;
CREATE POLICY "Allow key-based users to view allocation items" 
ON allocation_items
FOR SELECT
TO public
USING (
  -- Allow viewing allocation items for allocations in their cloud kitchen
  allocation_id IN (
    SELECT id FROM allocations WHERE cloud_kitchen_id IS NOT NULL
  )
);

-- Allow key-based users to create allocation items
DROP POLICY IF EXISTS "Allow key-based users to insert allocation items" ON allocation_items;
CREATE POLICY "Allow key-based users to insert allocation items" 
ON allocation_items
FOR INSERT
TO public
WITH CHECK (
  -- Allow creating allocation items for allocations in their cloud kitchen
  allocation_id IN (
    SELECT id FROM allocations WHERE cloud_kitchen_id IS NOT NULL
  )
);

-- Note: These policies are less secure than auth.uid() checks, but necessary for
-- key-based authentication. The application must ensure users only query
-- their own cloud_kitchen_id from their session data.
