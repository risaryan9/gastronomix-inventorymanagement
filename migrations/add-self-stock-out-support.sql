-- =====================================================
-- Migration: Add Self Stock Out Support
-- This migration adds support for self stock outs where
-- the purchase manager can allocate stock for internal
-- cloud kitchen use (R&D, testing, etc.) without an
-- outlet or allocation request.
-- =====================================================

-- =====================================================
-- STEP 1: Add new columns to stock_out table
-- =====================================================

-- Add self_stock_out boolean column (default false for existing records)
ALTER TABLE public.stock_out 
ADD COLUMN IF NOT EXISTS self_stock_out BOOLEAN NOT NULL DEFAULT false;

-- Add reason column (required for self stock outs)
ALTER TABLE public.stock_out 
ADD COLUMN IF NOT EXISTS reason TEXT NULL;

-- =====================================================
-- STEP 2: Modify constraints to make allocation_request_id 
-- and outlet_id nullable (since self stock outs don't need them)
-- =====================================================

-- Drop the NOT NULL constraint on allocation_request_id
ALTER TABLE public.stock_out 
ALTER COLUMN allocation_request_id DROP NOT NULL;

-- Drop the NOT NULL constraint on outlet_id
ALTER TABLE public.stock_out 
ALTER COLUMN outlet_id DROP NOT NULL;

-- =====================================================
-- STEP 3: Add check constraint to ensure data integrity
-- =====================================================

-- Add constraint: if self_stock_out = true, then reason must be provided
-- and allocation_request_id/outlet_id must be NULL
-- if self_stock_out = false, then allocation_request_id/outlet_id must be provided
ALTER TABLE public.stock_out 
ADD CONSTRAINT stock_out_self_stock_out_check 
CHECK (
  (
    -- For self stock outs
    self_stock_out = true 
    AND reason IS NOT NULL 
    AND reason != ''
    AND allocation_request_id IS NULL 
    AND outlet_id IS NULL
  )
  OR
  (
    -- For regular stock outs (outlet allocations)
    self_stock_out = false 
    AND allocation_request_id IS NOT NULL 
    AND outlet_id IS NOT NULL
  )
);

-- =====================================================
-- STEP 4: Add index for self_stock_out queries
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_stock_out_self_stock_out 
ON public.stock_out USING btree (self_stock_out, cloud_kitchen_id, allocation_date) 
TABLESPACE pg_default;

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. Existing stock_out records will have self_stock_out = false
--    and will continue to work as before
--
-- 2. New self stock outs will have:
--    - self_stock_out = true
--    - reason = mandatory text explaining why
--    - allocation_request_id = NULL
--    - outlet_id = NULL
--    - cloud_kitchen_id = set to the cloud kitchen
--
-- 3. The check constraint ensures data integrity:
--    - Self stock outs MUST have a reason
--    - Self stock outs CANNOT have allocation_request_id or outlet_id
--    - Regular stock outs MUST have allocation_request_id and outlet_id
--
-- 4. The FIFO logic, inventory decrement, and stock_out_items
--    creation will work the same way for both types
--
-- 5. Audit logs will be created for self stock outs to track
--    internal consumption
