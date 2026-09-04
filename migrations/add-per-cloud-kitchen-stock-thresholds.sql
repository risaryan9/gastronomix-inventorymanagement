-- =====================================================================
-- A low-stock threshold can differ per cloud kitchen
--
-- Until now a material carried one threshold for the whole company:
-- raw_materials.low_stock_threshold. Every screen that says "low stock"
-- reads it — the purchase manager's Inventory and Overview, the dashboard
-- notification counts, both admin overviews, the supervisor's catalog. But
-- the kitchens are not the same size and do not turn stock over at the same
-- rate, and CK2 is a central store rather than a kitchen at all. One number
-- was either too high for the small kitchens or too low for the store.
--
-- WHAT THIS ADDS. A material_stock_thresholds table holding one optional
-- override per (material, cloud kitchen). The effective threshold for a
-- material in a kitchen is:
--
--     override row for that (material, kitchen), if one exists
--     otherwise raw_materials.low_stock_threshold
--
-- raw_materials.low_stock_threshold therefore keeps its column and its
-- values and changes only its meaning: it is now the default, the "All
-- cloud kitchens" field on the admin form. That is why this migration
-- carries no data migration. The 331 thresholds already set are already
-- correct as defaults — moving them anywhere else would be a rename, not a
-- change, and would leave a window where a kitchen had no threshold at all.
--
-- NO ROW MEANS INHERIT, AND 0 IS NOT NO ROW. Clearing the field on the
-- admin form deletes the override row, so the kitchen goes back to
-- following the default. Entering 0 stores 0, which every consumer already
-- reads as "never flag this material as low" — the existing status rule is
-- `threshold > 0 AND quantity <= threshold`. The two are different answers
-- and the table has to be able to tell them apart, which is why the column
-- is NOT NULL and absence is expressed by the row not being there.
--
-- WHY NOT inventory.low_stock_threshold. The original schema
-- (migrations/supabase-schema.sql) declared exactly that column, plus an
-- index idx_inventory_low_stock over it; neither was ever applied and the
-- live inventory table has no such column. Reviving it would be tempting —
-- inventory is already unique on (cloud_kitchen_id, raw_material_id), which
-- is the grain we need, and every screen already queries it, so the
-- override would cost no extra request. It loses on two counts. Inventory
-- rows are stock state, written by the sync trigger on stock_in_batches; a
-- threshold is policy the admin sets, and mixing the two means a config
-- value living in a table whose rows are created and updated by machinery
-- that knows nothing about it. And inventory rows exist only where
-- trigger_create_inventory_for_new_material has put them — a cloud kitchen
-- added after a material was created has no row, so the admin could not
-- store a threshold for it until stock first arrived. See
-- docs/decisions/0011-stock-thresholds-are-per-cloud-kitchen.md.
--
-- ADMIN-ONLY IS A UI RULE, NOT AN RLS ONE. The intent is that only the
-- admin sets thresholds, per-kitchen and default alike. RLS cannot express
-- that here: this app logs in by key, so the PostgREST client is anonymous
-- and is_purchase_manager_or_admin() returns true for every key-based
-- session regardless of role — the same limitation decision 0004 records
-- for REVOKE ... FROM PUBLIC. The write policies below are therefore the
-- same shape as the ones on raw_materials, and the admin-only rule is
-- enforced by Materials.jsx showing the fields only in admin mode. That is
-- how every other role gate in this app already works; it is stated here so
-- nobody reads the policy as a guarantee it does not make.
--
-- SAFE TO RE-RUN.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.material_stock_thresholds (
  id                  uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  raw_material_id     uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  cloud_kitchen_id    uuid NOT NULL REFERENCES public.cloud_kitchens(id) ON DELETE CASCADE,
  low_stock_threshold numeric NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_stock_thresholds_material_kitchen_key
    UNIQUE (raw_material_id, cloud_kitchen_id),
  CONSTRAINT material_stock_thresholds_non_negative
    CHECK (low_stock_threshold >= 0)
);

COMMENT ON TABLE public.material_stock_thresholds IS
'One optional low-stock threshold override per (material, cloud kitchen). A row here wins over raw_materials.low_stock_threshold for that kitchen; no row means the kitchen follows the default. Deleting the row is how a kitchen goes back to the default — storing 0 is a different answer, meaning "never flag this material as low".';

COMMENT ON COLUMN public.material_stock_thresholds.low_stock_threshold IS
'Quantity at or under which this material counts as low in this kitchen, in the material''s own unit. NOT NULL: absence is expressed by the row not existing, so that 0 can keep its existing meaning.';

-- Every per-kitchen screen reads this the same way: all overrides for one
-- kitchen, keyed by material. The unique constraint's index already serves
-- lookups that lead with raw_material_id; this one serves those.
CREATE INDEX IF NOT EXISTS idx_material_stock_thresholds_cloud_kitchen
  ON public.material_stock_thresholds(cloud_kitchen_id);

-- ---------------------------------------------------------------------
-- The default column keeps its values and gains a new meaning
-- ---------------------------------------------------------------------
COMMENT ON COLUMN public.raw_materials.low_stock_threshold IS
'The default low-stock threshold, applying to every cloud kitchen that has no row in material_stock_thresholds. Shown on the admin material form as "All cloud kitchens". Before per-kitchen thresholds this was the only threshold, which is why no data had to move: every value here was already company-wide and remains correct as the default.';

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_material_stock_thresholds_updated_at
  ON public.material_stock_thresholds;

CREATE TRIGGER trg_material_stock_thresholds_updated_at
  BEFORE UPDATE ON public.material_stock_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- Read is open to everyone who can read the catalog, because everyone who
-- sees a "low stock" badge needs the number behind it — a supervisor
-- reading their own kitchen's material list included. Writes match the
-- raw_materials policies; see the header on why that is not an admin-only
-- guarantee.
-- ---------------------------------------------------------------------
-- No GRANTs here: a new table in `public` picks up anon/authenticated
-- privileges from Supabase's default privileges, which is how vendors and
-- every other table added by these migrations got theirs. RLS below is what
-- actually decides who may do what.
ALTER TABLE public.material_stock_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "All users can view material stock thresholds"
  ON public.material_stock_thresholds;
CREATE POLICY "All users can view material stock thresholds"
  ON public.material_stock_thresholds
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Purchase managers and admins manage material stock thresholds"
  ON public.material_stock_thresholds;
CREATE POLICY "Purchase managers and admins manage material stock thresholds"
  ON public.material_stock_thresholds
  FOR ALL
  TO public
  USING (public.is_purchase_manager_or_admin())
  WITH CHECK (public.is_purchase_manager_or_admin());

COMMIT;

-- =====================================================================
-- AFTER RUNNING THIS
--
-- Nothing to backfill and nothing to check for correctness — the table
-- starts empty, and an empty table means every kitchen follows the default,
-- which is exactly the behaviour that existed before this migration. The
-- first override only appears when the admin sets one.
--
-- To see what has been overridden once people start using it:
--
--   SELECT ck.code, rm.code, rm.name,
--          rm.low_stock_threshold AS default_threshold,
--          t.low_stock_threshold  AS kitchen_threshold
--   FROM public.material_stock_thresholds t
--   JOIN public.raw_materials  rm ON rm.id = t.raw_material_id
--   JOIN public.cloud_kitchens ck ON ck.id = t.cloud_kitchen_id
--   ORDER BY ck.code, rm.name;
-- =====================================================================
