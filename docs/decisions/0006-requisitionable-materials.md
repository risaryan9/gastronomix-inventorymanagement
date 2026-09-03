# 0006. Whether an outlet can requisition a material is three questions, not one

Date: 2026-09-03 (recorded); decided 2026-07/08
Status: Accepted

## Context

The requisition picker originally offered exactly one kind of material: anything
whose `material_type` was not `non_food` was dropped. Outlets need to be able to
ask for some raw materials too, and occasionally a semi-finished or finished one
— but only some, chosen deliberately, not the whole catalogue.

Three separate mechanisms now bear on the answer, and they are easy to mistake
for each other.

## Decision

Each column answers a different question. None of them subsumes another.

| Column | Question |
|---|---|
| `material_type` / `is_requisitionable` | **May** an outlet ask for this at all? |
| `brand_codes` | **Which brand's** form shows it? |
| `brand_codes` containing `'ip'` | Internal production — excluded from all of them |

**May they ask:** `material_type === 'non_food' OR is_requisitionable === true`.
Non-food qualifies automatically by type — which is why the flag needed no
backfill, `false` already being right for every existing row. Everything else is
opted in one material at a time by an admin. Switching a material *to* non-food
clears the flag rather than storing a `true` that no longer means anything.

**Which brand:** empty `brand_codes` means **"All Brands", not "no brands"**.
This reading is load-bearing in both the picker and the catalog.

**Internal production:** the `'ip'` sentinel is exclusive with "All Brands" and
with specific-brand mapping. In the picker it is excluded implicitly — `'ip'`
never matches a selected brand of `bp`/`ec`/`nk` — and in the catalog badge it
is excluded explicitly.

The admin toggle needed no new gating: `handleAddNew`, `handleEdit` and
`handleSubmit` already return early outside admin mode, so the purchase manager
reads the catalogue and cannot edit it. Non-food gets a sentence rather than a
checkbox, because a control that cannot change the outcome is worse than none.

## Consequences

- **The "may they ask" rule is duplicated** in `OutletsPageBase.jsx:441` (the
  picker) and `Materials.jsx:66` (the catalog badge). They must stay in step.
  The badge deliberately applies the picker's whole rule rather than showing
  only flagged materials — it answers "does this appear in requisitions", and
  any narrower reading misleads about non-food.
- Picker rows carry a type tag. The list used to be one kind of thing; now that
  flagged raw and semi-finished materials sit beside packaging, the tag is what
  separates a masala from the packet it goes in.
- `is_requisitionable` is in the audit trail's catalogue field order, so turning
  it on reads as `Requisitionable: No -> Yes` rather than a raw column name.

## Where it lives

- `frontend/src/components/outlets/OutletsPageBase.jsx` — the picker
- `frontend/src/pages/purchase-manager/Materials.jsx` — the catalog and toggle
- `migrations/add-requisitionable-flag-to-materials.sql`
- Commits `b401925`, `efeb8c2`
