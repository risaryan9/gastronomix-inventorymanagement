-- =====================================================================
-- Mark which materials a FOFO franchise may buy, and how they are priced
--
-- The FOFO dashboard (docs/fofo-dashboard-spec.md) sells materials to
-- franchise-owned, franchise-operated outlets. Four facts about a material
-- are needed before it can appear on that dashboard, and none of them
-- exists today.
--
-- WHAT CHANGES. Four columns on raw_materials:
--
--   is_fofo_sellable    boolean NOT NULL DEFAULT false
--   hsn_code            text
--   sale_gst_percent    numeric
--   sale_margin_percent numeric
--
-- A SEPARATE FLAG, NOT is_requisitionable. That column answers "may one of
-- our own outlets ask for this" — an internal request that moves stock
-- between our kitchens and our outlets. This one answers "may we sell this
-- to a third party for money". A material can be either, both or neither,
-- and overloading the requisition flag would put every sellable material
-- into the outlet requisition picker (decision 0006).
--
-- WHY sale_gst_percent AND NOT gst_percent. stock_in_batches.gst_percent
-- already exists and means something different: the GST a vendor charged
-- us on one particular purchase. This column is the rate we charge a
-- franchise when we sell, which follows from the HSN code and is a
-- property of the material rather than of any purchase. The names must
-- differ because both tables appear in the same joins — `rm.gst_percent`
-- and `b.gst_percent` would both compile, and picking the wrong one would
-- be a silent money error on an invoice.
--
-- THE MARGIN IS APPLIED TO THE GST-INCLUSIVE COST, ON PURPOSE. This looks
-- like the classic tax-on-tax mistake and is not one. Gastronomix cannot
-- claim input tax credit on these purchases — a food business under the
-- no-ITC scheme — so GST paid to a vendor never comes back and is simply
-- part of what the material cost. Chicken bought at 100 with 10% input tax
-- cost 110, and 110 is what the margin and the output tax are computed on.
-- The base is gstInclusiveUnitCost() from lib/inventoryValuation.js, the
-- same figure decision 0003 values stock at. Anyone who "corrects" this to
-- the ex-GST unit_cost will under-price every item by the input tax rate.
--
-- THE MARGIN IS ONE GLOBAL NUMBER PER MATERIAL. Decided deliberately: a
-- material is marked up the same for every franchise. That is what makes a
-- column the right home for it rather than a per-franchise pricing table.
-- If a franchise ever needs its own rate — a volume deal, an introductory
-- discount — this column cannot express it, and the fix is a
-- fofo.material_margins table with the column as the fallback, not a
-- second column here.
--
-- THE MARGIN IS READABLE BY ANYONE HOLDING THE ANON KEY, and that is
-- accepted. The live SELECT policy on this table for the `public` role is
-- `is_active = true AND deleted_at IS NULL`, so every active material row
-- is readable, and the anon key ships inside the internal frontend bundle.
-- FOFO franchises never receive a Supabase key — their dashboard reads a
-- server-side API that returns the final price only — so the markup is not
-- exposed to the people it is charged to. The residual exposure is smaller
-- than what already applies to stock_in_batches, whose SELECT policy ends
-- in `OR (auth.uid() IS NULL)` and hands every purchase cost in the
-- company to the same key. Narrowing either is a change to the internal
-- tool's RLS, not to this migration.
--
-- NULLABLE ON PURPOSE, GUARDED BY A CHECK. The three numeric/text columns
-- are NULL for the whole existing catalogue, and defaults would be lies —
-- a 0 GST rate reads as "zero-rated" rather than "nobody filled this in",
-- and a 0 margin means selling at cost. The CHECK below makes the only
-- dangerous combination impossible: a material cannot be flagged sellable
-- without a tax rate and a margin. You cannot put an item on the dashboard
-- that we do not know how to price or how much tax to charge on.
--
-- HSN IS DELIBERATELY NOT REQUIRED. Classifying the catalogue is the
-- accounting team's job and should not block listing a material. The price
-- and the tax amount never depend on the code — only the rate does — so a
-- blank HSN cannot make an invoice wrong in money, only incomplete on paper.
-- Worth knowing: GST rules generally expect an HSN code on B2B tax invoices,
-- so a sellable material with no code is a gap to close before invoices
-- from this system are used as the official ones. The verification block
-- below lists them.
--
-- NO BACKFILL. false is right for every existing row: nothing was sellable
-- to a franchise before this migration, and the FOFO dashboard does not
-- exist yet. The catalogue gets tagged deliberately, one material at a
-- time, before launch.
--
-- NOT INDEXED. Same reasoning as is_requisitionable — the catalogue is
-- fetched whole and filtered in the browser. Add an index with the query
-- that needs it.
-- =====================================================================

BEGIN;

ALTER TABLE public.raw_materials
ADD COLUMN IF NOT EXISTS is_fofo_sellable BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.raw_materials
ADD COLUMN IF NOT EXISTS hsn_code TEXT;

ALTER TABLE public.raw_materials
ADD COLUMN IF NOT EXISTS sale_gst_percent NUMERIC;

ALTER TABLE public.raw_materials
ADD COLUMN IF NOT EXISTS sale_margin_percent NUMERIC;

COMMENT ON COLUMN public.raw_materials.is_fofo_sellable IS
'Opts a material into the FOFO franchise dashboard catalogue. Separate from is_requisitionable, which governs internal outlet requisitions: one is a sale to a third party, the other an internal stock movement. Requires sale_gst_percent and sale_margin_percent to be set; hsn_code is optional.';

COMMENT ON COLUMN public.raw_materials.hsn_code IS
'HSN code for this material, as printed on a sale invoice to a FOFO franchise. Optional: NULL means not yet classified, and does NOT block is_fofo_sellable — the invoice line is then printed without a code.';

COMMENT ON COLUMN public.raw_materials.sale_gst_percent IS
'GST rate we charge a FOFO franchise on this material, normally following from its HSN classification. NOT the same as stock_in_batches.gst_percent, which records what a vendor charged us on one purchase. NULL means not yet set, which blocks is_fofo_sellable.';

COMMENT ON COLUMN public.raw_materials.sale_margin_percent IS
'Markup applied over the GST-INCLUSIVE cost to reach the FOFO dashboard price, as a percentage (15 means 15%, not 0.15). One global rate per material: every franchise pays the same markup. Applied to gstInclusiveUnitCost() from lib/inventoryValuation.js, NOT to the bare unit_cost: this is a food business that cannot claim input tax credit, so the GST paid to a vendor is a real cost and is marked up like any other. Tax on tax is correct here and must not be "fixed".';

-- A sellable material must be priceable and taxable: no dashboard listing
-- without a rate to invoice it at and a markup to sell it at. HSN is not
-- part of this rule — see the header.
ALTER TABLE public.raw_materials
DROP CONSTRAINT IF EXISTS raw_materials_fofo_sellable_needs_sale_details;

ALTER TABLE public.raw_materials
ADD CONSTRAINT raw_materials_fofo_sellable_needs_sale_details
CHECK (
  is_fofo_sellable = false
  OR (sale_gst_percent IS NOT NULL
      AND sale_margin_percent IS NOT NULL)
);

-- A rate, not a multiplier or a paise amount. Catches 0.18 and 1800.
ALTER TABLE public.raw_materials
DROP CONSTRAINT IF EXISTS raw_materials_sale_gst_percent_range;

ALTER TABLE public.raw_materials
ADD CONSTRAINT raw_materials_sale_gst_percent_range
CHECK (sale_gst_percent IS NULL OR (sale_gst_percent >= 0 AND sale_gst_percent <= 100));

-- Margin has no natural ceiling the way a tax rate does — a material may
-- legitimately be sold at several times cost — so only the floor is
-- checked. A 15 typed as 0.15 is indistinguishable from a real 0.15% and
-- cannot be caught here; the admin form is where that belongs.
ALTER TABLE public.raw_materials
DROP CONSTRAINT IF EXISTS raw_materials_sale_margin_percent_non_negative;

ALTER TABLE public.raw_materials
ADD CONSTRAINT raw_materials_sale_margin_percent_non_negative
CHECK (sale_margin_percent IS NULL OR sale_margin_percent >= 0);

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Nothing is sellable yet, and every row is unpriced:
--
-- SELECT is_fofo_sellable,
--        COUNT(*) FILTER (WHERE hsn_code IS NULL)            AS no_hsn,
--        COUNT(*) FILTER (WHERE sale_gst_percent IS NULL)    AS no_rate,
--        COUNT(*) FILTER (WHERE sale_margin_percent IS NULL) AS no_margin,
--        COUNT(*)                                            AS materials
-- FROM public.raw_materials
-- WHERE deleted_at IS NULL AND is_active = true
-- GROUP BY is_fofo_sellable;
--
-- The CHECK holds — this must fail, not succeed:
--
-- UPDATE public.raw_materials SET is_fofo_sellable = true
-- WHERE code = (SELECT code FROM public.raw_materials LIMIT 1);
--
-- Tagging one material with no HSN code, which must ALSO succeed:
--
-- UPDATE public.raw_materials
-- SET is_fofo_sellable = true, sale_gst_percent = 5, sale_margin_percent = 15
-- WHERE code = '<a real material code>';
--
-- Sellable materials still waiting for an HSN code, for the accounting team:
--
-- SELECT name, code, sale_gst_percent FROM public.raw_materials
-- WHERE is_fofo_sellable = true AND hsn_code IS NULL
--   AND deleted_at IS NULL ORDER BY name;
--
-- Tagging one material fully, which must succeed:
--
-- UPDATE public.raw_materials
-- SET is_fofo_sellable = true, hsn_code = '0406',
--     sale_gst_percent = 12, sale_margin_percent = 15
-- WHERE code = '<a real material code>';
--
-- The FOFO catalogue, once tagging begins:
--
-- SELECT name, code, material_type, brand_codes,
--        hsn_code, sale_gst_percent, sale_margin_percent
-- FROM public.raw_materials
-- WHERE deleted_at IS NULL
--   AND is_active = true
--   AND is_fofo_sellable = true
--   AND (brand_codes IS NULL OR NOT ('ip' = ANY(brand_codes)))
-- ORDER BY name;

-- =====================================================================
-- Rollback
-- =====================================================================
-- ALTER TABLE public.raw_materials
--   DROP CONSTRAINT IF EXISTS raw_materials_fofo_sellable_needs_sale_details,
--   DROP CONSTRAINT IF EXISTS raw_materials_sale_gst_percent_range,
--   DROP CONSTRAINT IF EXISTS raw_materials_sale_margin_percent_non_negative,
--   DROP COLUMN IF EXISTS is_fofo_sellable,
--   DROP COLUMN IF EXISTS hsn_code,
--   DROP COLUMN IF EXISTS sale_gst_percent,
--   DROP COLUMN IF EXISTS sale_margin_percent;
