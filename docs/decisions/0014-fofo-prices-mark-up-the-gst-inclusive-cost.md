# 0014. FOFO prices mark up the GST-inclusive cost — tax on tax is correct here

Date: 2026-09-13
Status: Accepted

## Context

A FOFO franchise buys materials from Gastronomix at cost plus a margin, plus
output GST. The cost of a bought material comes from `stock_in_batches`, which
holds `unit_cost` (ex-GST, what the vendor's invoice shows before tax) and
`gst_percent` (the input tax the vendor charged).

The obvious formula starts from `unit_cost`. Applying margin and output GST on
top of a figure that already contains GST reads as the classic tax-on-tax bug,
and a reviewer who has seen that bug before will "fix" it.

## Decision

The base cost of a bought material is its **GST-inclusive** unit cost:

```
base               = unit_cost × (1 + gst_percent / 100)
unit_price_ex_gst  = base × (1 + sale_margin_percent / 100)
unit_price_inc_gst = unit_price_ex_gst × (1 + sale_gst_percent / 100)
```

**Gastronomix cannot claim input tax credit** — it is a food business under the
no-ITC scheme. GST paid to a vendor never comes back, so it is part of what the
material cost, exactly like freight would be. Chicken bought at ₹100 with 10%
input tax cost ₹110, and ₹110 is what the margin and the output tax apply to.

This is the same figure stock is valued at (decision 0003), computed by the same
function: `gstInclusiveUnitCost()` in `frontend/src/lib/inventoryValuation.js`.
For made goods the base is the BOM food cost, which rolls up the same
GST-inclusive component costs (spec §6.3), so the rule reaches them too.

## Alternatives

**Mark up the ex-GST `unit_cost`.** Correct for a business that claims input tax
credit, where input GST is recovered and is not a cost. Here it under-prices
every item by its input tax rate — on a 10% item, 10% of the base cost is sold
at no margin and never recovered.

**Mark up the ex-GST cost, but pick a higher margin to compensate.** Rejected:
input GST rates differ by material and by batch, so no single margin
compensates correctly, and the margin would stop meaning what it says.

## Consequences

- If Gastronomix ever becomes eligible to claim input tax credit, this rule
  flips: the base becomes `unit_cost`, and decision 0003's valuation changes with
  it. Revisit both together.
- The input GST rate (`stock_in_batches.gst_percent`) and the output rate
  (`raw_materials.sale_gst_percent`) are different columns with different names
  on purpose — both appear in the same joins, and picking the wrong one is a
  silent money error.
- Because `gst_percent` can differ between batches of the same material, the
  weighted average is taken over each batch's GST-inclusive cost, not by
  averaging `unit_cost` and applying one rate afterwards (spec §6.2).

## Where it lives

- `migrations/fofo/01-add-fofo-sale-columns-to-materials.sql` — the header and the
  `sale_margin_percent` column comment
- `frontend/src/lib/inventoryValuation.js` — `gstInclusiveUnitCost()`
- `docs/fofo-dashboard-spec.md` §6 — the full pricing rule
- `docs/decisions/0003-inventory-value-is-gst-inclusive.md`
