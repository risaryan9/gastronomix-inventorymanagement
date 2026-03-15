-- Migration: Add wastage_image_url to stock_out
-- When Kitchen Stock Out reason is "wastage", a photo of the wasted items can be required and stored here.
-- =====================================================================

ALTER TABLE public.stock_out
ADD COLUMN IF NOT EXISTS wastage_image_url text NULL;

COMMENT ON COLUMN public.stock_out.wastage_image_url IS
  'Public URL of uploaded image of wasted items; required when reason is wastage (stored in Supabase Storage).';
