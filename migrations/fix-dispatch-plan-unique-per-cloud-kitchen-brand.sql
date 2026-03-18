-- =====================================================================
-- Fix dispatch_plan unique constraint: one plan per cloud kitchen per
-- brand per day (not one plan per day globally).
-- Drops dispatch_plan_unique_per_day and adds the correct constraint.
-- =====================================================================

BEGIN;

-- Drop the old constraint/index that only allowed one plan per day globally
-- (constraint and backing unique index may share the same name)
ALTER TABLE public.dispatch_plan
  DROP CONSTRAINT IF EXISTS dispatch_plan_unique_per_day;

DROP INDEX IF EXISTS public.dispatch_plan_unique_per_day;

-- One dispatch plan per (cloud_kitchen_id, brand, plan_date)
ALTER TABLE public.dispatch_plan
  ADD CONSTRAINT dispatch_plan_unique_per_cloud_kitchen_brand_day
  UNIQUE (cloud_kitchen_id, brand, plan_date);

COMMENT ON CONSTRAINT dispatch_plan_unique_per_cloud_kitchen_brand_day ON public.dispatch_plan IS
  'One dispatch plan per cloud kitchen per brand per day (e.g. Nippu Kodi and El Chaapo can each have a plan for the same day).';

COMMIT;
