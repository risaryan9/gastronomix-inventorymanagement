# 0011. A low-stock threshold is per cloud kitchen, with a company default

Date: 2026-09-04
Status: Accepted

## Context

`raw_materials.low_stock_threshold` was one number per material for the whole
company. Seven places read it and turn it into a status: the purchase manager's
Inventory and Overview, the dashboard's notification counts, `adminOverview.js`,
`adminKitchenDetail.js`, the supervisor's catalog, and the Materials list.

The kitchens are not interchangeable. CK2 is a central store, not a kitchen, and
holds stock on a different scale from CK1 and CK3. A single number was either
too high for the kitchens — everything permanently "low" — or too low for the
store, which then never warned about anything.

## Decision

The threshold is resolved per (material, cloud kitchen):

    override row in material_stock_thresholds, if one exists
    otherwise raw_materials.low_stock_threshold

`raw_materials.low_stock_threshold` keeps its column and all 331 of its values
and becomes **the default** — the "All cloud kitchens" field on the admin
material form. No data moved, because every value it held was already meant
company-wide.

Three rules follow from that and are mirrored in the database and the frontend:

- **No row means inherit.** Clearing a kitchen's field deletes the override.
- **`0` is not "no row".** It stores 0, which the status rule
  (`threshold > 0 && quantity <= threshold`) already reads as "never flag this
  material as low". The override column is therefore `NOT NULL`: absence has to
  be expressible only by the row's absence, so the two answers stay distinct.
- **The resolution happens in one module**, `lib/stockThresholds.js`, for the
  reason `lib/inventoryValuation.js` exists — the same three lines computed on
  seven screens produced disagreeing badges once already.

Only the admin sets thresholds, per-kitchen and default alike. That is a UI
rule, not an RLS one — see Consequences.

## Alternatives

**Revive `inventory.low_stock_threshold`.** The original schema
(`migrations/supabase-schema.sql`) declared exactly this column and an
`idx_inventory_low_stock` over it; neither was ever applied. It was the
tempting option: `inventory` is already unique on
`(cloud_kitchen_id, raw_material_id)`, which is the grain we need, and five of
the seven consumers already query that table, so the override would have cost no
extra request anywhere.

It lost on two counts. Inventory rows are stock state, written by the sync
trigger on `stock_in_batches`; a threshold is policy the admin sets, and putting
one in the other's table means a config value maintained by machinery that knows
nothing about it. And inventory rows exist only where
`trigger_create_inventory_for_new_material` put them — a cloud kitchen added
after a material was created has no row for it, so the admin could not store a
threshold until stock first arrived.

**A nullable column per kitchen on `raw_materials`.** Kitchens are data. Adding
a kitchen would become a migration.

**Resolving in Postgres, as a view or an RPC.** It would remove the extra
request each screen now makes. It also puts the rule in a place the frontend
cannot see while every consumer of it is in the frontend, and PostgREST cannot
embed a view through `inventory` without a foreign key, so the screens would
have queried it separately anyway. Worth revisiting if these tables grow enough
to move the folds in `adminOverview.js` into SQL — the two changes belong
together.

## Consequences

- Every screen that shows a low-stock figure now pays one extra query for the
  overrides. They are small (materials × kitchens, ~1000 rows today) and paged
  with a unique tiebreaker per [0009](0009-paged-queries-need-a-unique-tiebreaker.md).
- **Two kitchens can hold the same quantity of the same material and only one
  count as low.** That is the feature, but it means a screenshot of a low-stock
  count is no longer comparable across kitchens without saying which kitchen.
- The Materials list and the supervisor catalog show **the reader's own
  kitchen's** threshold. In admin mode there is no single kitchen to be right
  about, so the column falls back to the default and the per-kitchen values live
  on the material's form.
- **Admin-only is enforced in the UI, not by RLS.** This app logs in by key, so
  the PostgREST client is anonymous and `is_purchase_manager_or_admin()` returns
  true for every key-based session whatever the user's role — the same
  limitation [0004](0004-audit-writes-are-server-side-only.md) records for
  `REVOKE … FROM PUBLIC`. The write policy on `material_stock_thresholds` is the
  same shape as the one on `raw_materials` and is no weaker, but it is not the
  guarantee its name suggests. Moving thresholds behind a `SECURITY DEFINER` RPC
  that checks the acting user's role would be the fix, and would have to happen
  alongside the same fix for the material catalog itself.
- Audit events carry the per-kitchen values as `threshold_<kitchen code>` keys
  alongside `low_stock_threshold`. A kitchen that follows the default is logged
  as null rather than as the inherited number, so the log never shows a setting
  nobody made.

## Where it lives

- `migrations/add-per-cloud-kitchen-stock-thresholds.sql` — the table, its
  constraints and its policies
- `frontend/src/lib/stockThresholds.js` — the resolution rule and every read and
  write of the table
- `frontend/src/pages/purchase-manager/Materials.jsx` — the admin form's
  "All cloud kitchens" field plus one per kitchen
- `frontend/src/lib/adminOverview.js`, `frontend/src/lib/adminKitchenDetail.js`,
  `frontend/src/pages/purchase-manager/Inventory.jsx`,
  `frontend/src/pages/purchase-manager/Overview.jsx`,
  `frontend/src/pages/PurchaseManagerDashboard.jsx`,
  `frontend/src/pages/supervisor/RawMaterials.jsx` — the consumers
