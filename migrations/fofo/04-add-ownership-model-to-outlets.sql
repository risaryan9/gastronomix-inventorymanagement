-- =====================================================================
-- Say whether an outlet is company-operated or franchise-operated
--
-- Gastronomix runs two franchise programmes and public.outlets cannot
-- currently tell them apart:
--
--   FOCO — franchise owned, COMPANY operated. We run the outlet. The
--          franchisee gets a read-only analytics dashboard.
--   FOFO — franchise owned, FRANCHISE operated. They run it, and buy
--          supplies from us (docs/fofo-dashboard-spec.md).
--
-- The distinction decides whether an outlet can be attached to a
-- fofo.franchises row, whether it has a cart, and whether stock leaving for
-- it is a sale or an internal transfer.
--
-- WHAT CHANGES. One column on outlets:
--
--   ownership_model text NOT NULL DEFAULT 'foco'
--
-- NO BACKFILL. 'foco' is correct for all 77 existing rows: every outlet
-- today is company-operated, and the FOFO programme has no outlets yet.
-- Marking one 'fofo' is a deliberate act during onboarding.
--
-- THIS IS NOT THE SAME QUESTION AS "does a franchise own it". A FOCO outlet
-- is also franchise-owned. This column says who OPERATES it, which is the
-- half that changes how the software behaves.
--
-- NOT INDEXED. 77 rows, and every screen that reads outlets already reads
-- them all. Add an index with the query that needs it.
-- =====================================================================

BEGIN;

ALTER TABLE public.outlets
ADD COLUMN IF NOT EXISTS ownership_model TEXT NOT NULL DEFAULT 'foco';

ALTER TABLE public.outlets
DROP CONSTRAINT IF EXISTS outlets_ownership_model_check;

ALTER TABLE public.outlets
ADD CONSTRAINT outlets_ownership_model_check
CHECK (ownership_model IN ('foco', 'fofo'));

COMMENT ON COLUMN public.outlets.ownership_model IS
'Who OPERATES this outlet: ''foco'' (company operated, the default and every outlet today) or ''fofo'' (franchise operated, buys supplies from us through the FOFO dashboard). Both are franchise-OWNED; this column is about operation, not ownership.';

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Every existing outlet is foco, and nothing is fofo yet:
--
-- SELECT ownership_model, COUNT(*)
-- FROM public.outlets WHERE deleted_at IS NULL
-- GROUP BY ownership_model;
--
-- The CHECK holds — this must fail:
--
-- UPDATE public.outlets SET ownership_model = 'both'
-- WHERE id = (SELECT id FROM public.outlets LIMIT 1);
--
-- Once onboarding starts, FOFO outlets and who owns them:
--
-- SELECT o.code, o.name, ck.name AS serving_kitchen, f.name AS franchise
-- FROM public.outlets o
-- JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id
-- LEFT JOIN fofo.franchise_outlets fo ON fo.outlet_id = o.id
-- LEFT JOIN fofo.franchises f ON f.id = fo.franchise_id
-- WHERE o.ownership_model = 'fofo' AND o.deleted_at IS NULL
-- ORDER BY o.code;

-- =====================================================================
-- Rollback
-- =====================================================================
-- ALTER TABLE public.outlets
--   DROP CONSTRAINT IF EXISTS outlets_ownership_model_check,
--   DROP COLUMN IF EXISTS ownership_model;
