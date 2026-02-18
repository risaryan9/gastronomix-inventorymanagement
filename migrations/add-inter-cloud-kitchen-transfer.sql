-- =====================================================
-- Migration: Inter Cloud Kitchen Transfer
-- Adds support for transferring stock from one cloud kitchen to another.
-- =====================================================

-- =====================================================
-- 1. stock_out: add destination kitchen column
-- =====================================================

ALTER TABLE public.stock_out
ADD COLUMN IF NOT EXISTS transfer_to_cloud_kitchen_id uuid NULL
REFERENCES public.cloud_kitchens (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.stock_out.transfer_to_cloud_kitchen_id IS
  'Destination cloud kitchen for inter-cloud transfer; only set when reason is inter-cloud-kitchen.';

CREATE INDEX IF NOT EXISTS idx_stock_out_transfer_to_cloud_kitchen_id
ON public.stock_out USING btree (transfer_to_cloud_kitchen_id) TABLESPACE pg_default;

-- Enforce transfer_to_cloud_kitchen_id when reason is inter-cloud
ALTER TABLE public.stock_out
DROP CONSTRAINT IF EXISTS stock_out_inter_cloud_transfer_check;

ALTER TABLE public.stock_out
ADD CONSTRAINT stock_out_inter_cloud_transfer_check CHECK (
  (reason IS DISTINCT FROM 'inter-cloud-kitchen')
  OR (transfer_to_cloud_kitchen_id IS NOT NULL AND transfer_to_cloud_kitchen_id != cloud_kitchen_id)
);

-- =====================================================
-- 2. stock_in: allow type 'inter_cloud'
-- =====================================================

ALTER TABLE public.stock_in
DROP CONSTRAINT IF EXISTS stock_in_stock_in_type_check;

ALTER TABLE public.stock_in
ADD CONSTRAINT stock_in_stock_in_type_check CHECK (
  stock_in_type = ANY (ARRAY['purchase'::text, 'kitchen'::text, 'inter_cloud'::text])
);

COMMENT ON COLUMN public.stock_in.stock_in_type IS
  'Type: purchase (vendor), kitchen (in-house), inter_cloud (transfer from another cloud kitchen).';

-- =====================================================
-- 3. Optional: stock_in.source_stock_out_id for traceability
-- =====================================================

ALTER TABLE public.stock_in
ADD COLUMN IF NOT EXISTS source_stock_out_id uuid NULL
REFERENCES public.stock_out (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.stock_in.source_stock_out_id IS
  'When stock_in_type = inter_cloud, links to the source stock_out (transfer out) record.';

CREATE INDEX IF NOT EXISTS idx_stock_in_source_stock_out_id
ON public.stock_in USING btree (source_stock_out_id) TABLESPACE pg_default;
