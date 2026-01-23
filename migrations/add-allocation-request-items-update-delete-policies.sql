-- =====================================================
-- Add UPDATE and DELETE policies for allocation_request_items
-- This allows supervisors and purchase managers to update/delete
-- items when editing allocation requests
-- =====================================================

-- Enable RLS if not already enabled
ALTER TABLE allocation_request_items ENABLE ROW LEVEL SECURITY;

-- Drop existing UPDATE/DELETE policies if they exist
DROP POLICY IF EXISTS "Supervisors and purchase managers can update allocation request items" ON allocation_request_items;
DROP POLICY IF EXISTS "Supervisors and purchase managers can delete allocation request items" ON allocation_request_items;
DROP POLICY IF EXISTS "Supervisor manage allocation_request_items" ON allocation_request_items;
DROP POLICY IF EXISTS "Purchase Manager manage allocation_request_items" ON allocation_request_items;

-- Allow supervisors and purchase managers to update/delete allocation request items
-- This policy allows updates/deletes for items in allocation requests that are not packed
-- Application layer ensures users can only edit requests for their cloud kitchen
-- This works for both Supabase auth and key-based login
CREATE POLICY "Supervisors and purchase managers can update allocation request items" ON allocation_request_items
  FOR UPDATE
  TO public
  USING (
    -- Allow update if the allocation request is not packed
    -- Application layer ensures users can only edit requests for their cloud kitchen
    EXISTS (
      SELECT 1 FROM public.allocation_requests
      WHERE allocation_requests.id = allocation_request_items.allocation_request_id
      AND allocation_requests.is_packed = false
    )
  )
  WITH CHECK (
    -- Ensure the updated item still belongs to an unpacked request
    EXISTS (
      SELECT 1 FROM public.allocation_requests
      WHERE allocation_requests.id = allocation_request_items.allocation_request_id
      AND allocation_requests.is_packed = false
    )
  );

CREATE POLICY "Supervisors and purchase managers can delete allocation request items" ON allocation_request_items
  FOR DELETE
  TO public
  USING (
    -- Allow delete if the allocation request is not packed
    -- Application layer ensures users can only delete items from requests for their cloud kitchen
    EXISTS (
      SELECT 1 FROM public.allocation_requests
      WHERE allocation_requests.id = allocation_request_items.allocation_request_id
      AND allocation_requests.is_packed = false
    )
  );

-- =====================================================
-- NOTES:
-- =====================================================
-- These policies allow:
-- 1. Supervisors and purchase managers to update/delete items in allocation requests
-- 2. Only for requests that are not packed (is_packed = false)
-- 
-- Security considerations:
-- - The policies allow updates/deletes for any unpacked request
-- - Application layer MUST enforce cloud_kitchen_id matching
-- - Frontend route protection ensures only authorized users can access the edit functionality
-- - This approach works for both Supabase auth and key-based login
--
-- Why this approach:
-- - Key-based login users don't have auth.uid(), so we can't check user identity in RLS
-- - Application layer already validates user's cloud_kitchen_id before allowing edits
-- - Only unpacked requests can be edited, providing an additional security layer
--
-- For production, consider:
-- - Using Supabase auth for all users
-- - Implementing custom JWT claims with cloud_kitchen_id
-- - Using Edge Functions for sensitive operations
