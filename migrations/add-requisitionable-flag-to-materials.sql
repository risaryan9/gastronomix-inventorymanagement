-- =====================================================================
-- Let materials other than non-food be requisitioned by outlets
--
-- Until now the outlet requisition form offered exactly one kind of
-- material: the picker in components/outlets/OutletsPageBase.jsx drops
-- anything whose material_type is not 'non_food'. Outlets need to be able
-- to ask for some raw materials too, and occasionally a semi-finished or
-- finished one — but only some, chosen deliberately, not the whole
-- catalogue.
--
-- WHAT CHANGES. One column on raw_materials:
--
--   is_requisitionable boolean NOT NULL DEFAULT false
--
-- The picker's rule becomes "non_food, OR flagged". Non-food stays
-- automatic — every non-food material mapped to the brand keeps showing up
-- with nothing to tick, exactly as today — and the flag is what admits a
-- raw_material, semi_finished or finished material to the same list.
--
-- NO BACKFILL. The default is the correct value for every existing row.
-- Non-food materials qualify by type and never read this column, and no
-- material of any other type was requisitionable before this migration, so
-- setting the flag on one would grant access nobody has granted yet.
--
-- BRAND MAPPING IS UNCHANGED. This column answers "may an outlet ask for
-- this at all"; brand_codes still answers "which brand's form shows it".
-- NULL brand_codes means every brand, an array names the brands, and the
-- 'ip' sentinel means internal production only. 'ip' still wins: a flagged
-- material mapped to internal production appears in no brand's form,
-- because the brand check runs regardless of how the material qualified.
--
-- NOT INDEXED. The requisition form fetches the whole active catalogue in
-- one query and filters it in the browser, so nothing selects on this
-- column server-side. A boolean index over a few thousand rows that no
-- query uses is maintenance without a reader; add it with the query that
-- needs it.
-- =====================================================================

BEGIN;

ALTER TABLE public.raw_materials
ADD COLUMN IF NOT EXISTS is_requisitionable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.raw_materials.is_requisitionable IS
'Opts a raw_material, semi_finished or finished material into the outlet requisition form. Non-food materials are requisitionable by type and ignore this column. brand_codes still decides which brand''s form shows the material, including the ''ip'' internal-production sentinel that excludes it from all of them.';

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- SELECT material_type,
--        is_requisitionable,
--        COUNT(*) AS materials
-- FROM public.raw_materials
-- WHERE deleted_at IS NULL AND is_active = true
-- GROUP BY material_type, is_requisitionable
-- ORDER BY material_type, is_requisitionable;
--
-- Everything an outlet can currently ask for, and why it qualifies:
--
-- SELECT name, code, material_type, brand_codes,
--        CASE WHEN material_type = 'non_food' THEN 'by type' ELSE 'by flag' END AS reason
-- FROM public.raw_materials
-- WHERE deleted_at IS NULL
--   AND is_active = true
--   AND (material_type = 'non_food' OR is_requisitionable = true)
--   AND (brand_codes IS NULL OR NOT ('ip' = ANY(brand_codes)))
-- ORDER BY material_type, name;

-- =====================================================================
-- Rollback
-- =====================================================================
-- ALTER TABLE public.raw_materials DROP COLUMN IF EXISTS is_requisitionable;
