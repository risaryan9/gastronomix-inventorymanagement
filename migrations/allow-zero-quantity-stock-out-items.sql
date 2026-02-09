-- =====================================================
-- Migration: Allow zero quantity in stock_out_items
-- Enables "pack 0" for an item (e.g. do not pack that line).
-- =====================================================

-- Drop the existing check that required quantity > 0
ALTER TABLE public.stock_out_items
DROP CONSTRAINT IF EXISTS stock_out_items_quantity_check;

-- Add new check: quantity must be >= 0 (zero is valid)
ALTER TABLE public.stock_out_items
ADD CONSTRAINT stock_out_items_quantity_check CHECK (quantity >= 0::numeric);
