# 0003. Stock is valued GST-inclusive, and a deactivated material is not stock

Date: 2026-09-03 (recorded); decided 2026-08
Status: Accepted

## Context

Four screens reported an inventory value and no two agreed on what one is. The
purchase manager's Inventory page multiplied by `unit_cost * (1 + gst/100)`; its
own Overview, the admin cloud-kitchen overview and the admin kitchen-wise
overview all used the bare `unit_cost`. Same shelf, same moment, different
totals — off by the blended tax rate.

Deactivating a material also did not take its stock out of the numbers. Three of
those four queries never joined `raw_materials` at all. Where a join existed it
was left to RLS, which is the subtler half: the SELECT policy hides inactive
rows, but on a non-`!inner` embed that returns a **null material rather than
dropping the row**. The guard read `is_active !== false`, and `null` is not
`false`, so the row survived with its value and no name.

## Decision

Both rules live in `frontend/src/lib/inventoryValuation.js`, and every screen
that *reports* an inventory figure reads from it:

1. **A batch is worth its remaining quantity at GST-inclusive cost.** GST is
   money that left the bank; a valuation without it understates by the blended
   tax rate. Select `BATCH_VALUATION_COLUMNS` rather than hand-listing columns —
   omitting `gst_percent` silently drops GST back out of the number.
2. **A deactivated or deleted material is not stock.** It contributes to no
   value, no material count, no low-stock alert.

Rule 2 is a **query filter over an `!inner` embed** (`onlyActiveMaterials`), not
a policy the caller hopes is applied. The row is dropped, not nulled.

## The deliberate exception

**Operational reads still show deactivated materials**, and this is not an
oversight to be tidied up:

- the packing modal's available stock and today's totals
- the manual adjustment path
- the kitchen executive's on-hand figures while drafting a dispatch plan

Hiding a deactivated material there would hide real stock from the person trying
to move it off the shelf. The line is **reported vs. operational**: what the
business is worth excludes it, what is physically present does not.

The real fix for the underlying oddity is to refuse to deactivate a material
that still has stock. That is its own change and has not been made.

## Consequences

- A new screen reporting an inventory figure must read from
  `inventoryValuation.js`. Recomputing it inline is how the four-way
  disagreement happened the first time.
- Every figure listed above moved upward by GST when this landed. Historical
  screenshots and any number quoted before 2026-08 are on the old basis.
- `isActiveMaterial()` exists for rows already in hand; prefer
  `onlyActiveMaterials()` on the query, since it drops the row at the source.

## Where it lives

- `frontend/src/lib/inventoryValuation.js`
- Consumers: `lib/adminOverview.js`, `lib/adminKitchenDetail.js`,
  `lib/vendorManagement.js`, `pages/PurchaseManagerDashboard.jsx`,
  `pages/purchase-manager/Inventory.jsx`, `pages/purchase-manager/Overview.jsx`,
  `pages/supervisor/Inventory.jsx`
- Commit `ca7aa6a`
