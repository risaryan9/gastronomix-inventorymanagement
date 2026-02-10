-- =====================================================
-- Add Stock-In Type Column to Stock In Table
-- =====================================================
-- This migration adds support for two types of stock-in:
-- 1. purchase - Materials purchased from external vendors (raw materials)
-- 2. kitchen - Materials produced in-house (semi-finished and finished)
-- =====================================================

-- Step 1: Add stock_in_type column with CHECK constraint
ALTER TABLE public.stock_in
ADD COLUMN IF NOT EXISTS stock_in_type TEXT NOT NULL DEFAULT 'purchase'
CHECK (stock_in_type IN ('purchase', 'kitchen'));

-- Step 2: Initialize all existing rows to 'purchase'
UPDATE public.stock_in
SET stock_in_type = 'purchase'
WHERE stock_in_type IS NULL OR stock_in_type = '';

-- Step 3: Create index on stock_in_type for better query performance
CREATE INDEX IF NOT EXISTS idx_stock_in_type 
ON public.stock_in USING btree (stock_in_type) TABLESPACE pg_default;

-- Step 4: Add comments for documentation
COMMENT ON COLUMN public.stock_in.stock_in_type IS 'Type of stock-in: purchase (from vendors, raw materials) or kitchen (in-house production, semi-finished/finished)';
COMMENT ON COLUMN public.stock_in.supplier_name IS 'Required for purchase type, not applicable for kitchen type';
COMMENT ON COLUMN public.stock_in.invoice_number IS 'Required for purchase type, not applicable for kitchen type';

-- =====================================================
-- Verification Query (Optional - Run to verify)
-- =====================================================
-- SELECT stock_in_type, COUNT(*) as count
-- FROM public.stock_in
-- GROUP BY stock_in_type;

-- =====================================================
-- Rollback Instructions (If needed)
-- =====================================================
-- To rollback this migration:
-- DROP INDEX IF EXISTS idx_stock_in_type;
-- ALTER TABLE public.stock_in DROP COLUMN IF EXISTS stock_in_type;
