-- =====================================================
-- Migration: Add manual_inventory stock_in_type
-- Extends stock_in_type CHECK constraint to support manual inventory adjustments
-- =====================================================

-- =====================================================
-- 1. Update stock_in_type CHECK constraint
-- =====================================================

ALTER TABLE public.stock_in
DROP CONSTRAINT IF EXISTS stock_in_stock_in_type_check;

ALTER TABLE public.stock_in
ADD CONSTRAINT stock_in_stock_in_type_check CHECK (
  stock_in_type = ANY (ARRAY['purchase'::text, 'kitchen'::text, 'inter_cloud'::text, 'manual_inventory'::text])
);

COMMENT ON COLUMN public.stock_in.stock_in_type IS
  'Type: purchase (vendor), kitchen (in-house), inter_cloud (transfer from another cloud kitchen), manual_inventory (manual adjustment increment).';

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. manual_inventory type is used for manual inventory increments (client: manualInventoryAdjust.js)
--    when incrementing inventory via manual adjustment
-- 2. For decrements, a stock_out record is created instead (no stock_in)
-- 3. No RLS policy changes needed - existing policies allow purchase managers
--    to create stock_in records for their cloud kitchen regardless of type
