# Admin Dashboard — Gap Analysis & Enhancement Plan

**Date:** 2 August 2026
**Method:** Code read of `frontend/src/pages/AdminDashboard.jsx` + admin sub-pages, cross-referenced against the live Supabase database (row counts and data-quality profiling run directly against production).

---

## 1. What the admin dashboard is today

`frontend/src/pages/AdminDashboard.jsx` is a sidebar shell with 6 groups and 16 sub-sections. Twelve are built; **four are still placeholder text**:

| Section | Status |
|---|---|
| Overview → **Cloud Kitchen** | ❌ placeholder — *and it's the default landing screen* |
| Overview → Outlets | ✅ |
| Operations → Materials / Vendors / Recipes / Dispatch Brands | ✅ |
| People → Users / Operators | ✅ |
| Reports → Requisitions Reports | ✅ |
| Reports → **Sales** | ❌ placeholder |
| Reports → **Performance** | ❌ placeholder |
| Reports → **Trends** | ❌ placeholder |
| Audits → 4 sub-sections | ✅ (nicely built, shared filter bar) |
| Franchise → Data Cloning | ✅ |

**The single worst thing:** an admin logs in and the first screen they see says *"This is a placeholder… we'll build out this section in detail next."* There is no home screen, no numbers, nothing.

---

## 2. The structural gap: admin can manage master data, but can't see operations

The admin can edit **catalogue** things (materials, vendors, outlets, users, recipes, brands). But there is **no screen anywhere in the admin dashboard for actual stock**:

- ❌ No **Inventory** view — admin cannot see what stock exists in any kitchen
- ❌ No **Stock In** ledger — cannot see purchases/receipts
- ❌ No **Stock Out** ledger — cannot see allocations, wastage, transfers
- ❌ No **cross-kitchen comparison** — the whole point of being admin

The Purchase Manager has all of these (`src/pages/purchase-manager/`), but scoped to one kitchen. The admin — the only role that can see all 3 kitchens — has none of them. Today the only way an admin sees a transaction is by scrolling the Audit feed.

---

## 3. The data is already there — and it's rich

I profiled the live database. This is not a "we need more data" problem for most of what's missing. **4 months of clean transactional history (2026-04-02 → 2026-08-02):**

| Table | Rows | Quality |
|---|---|---|
| `stock_in` | 300 | **300/300 have cost** ✅ |
| `stock_in_batches` | 3,053 | **all have `unit_cost`** ✅ (FIFO with cost basis) |
| `stock_out` | 824 | 658 self, 166 with dispatch brand |
| `stock_out_items` | 7,202 | line-level detail ✅ |
| `stock_out_batch_consumption` | 3,502 | **exact cost-of-goods per issue** ✅ |
| `allocation_requests` / `_items` | 175 / 778 | request-vs-fulfilled linkage is **100% intact** ✅ |
| `inventory` | 876 | live stock per kitchen × material |

Some real numbers I computed straight from your data, which is what the missing dashboard *should* be showing right now:

- **₹8,50,442** total inventory value on hand (all kitchens)
- **₹21,19,060** procurement spend, last 30 days
- **9** requisitions pending (unpacked) right now
- **₹76,258** in "dead stock" — 19 batches older than 60 days still holding quantity
- **21** material×kitchen pairs holding stock with zero movement in 45 days
- Self stock-out split: internal-production 473, staff-food 143, inter-kitchen 23, R&D 14, wastage 4

Notably, `docs/ADMIN_DASHBOARD_ANALYTICS.md` already specs 26 widgets. **Zero of them are built.** The doc also claims fill-rate is blocked by missing request↔fulfilment linkage — that's now **out of date**: every packed requisition links cleanly to its stock-out, so fill-rate is computable today.

---

## 4. New sections I'd add

### A. Overview → Cloud Kitchen *(replaces the placeholder landing page)*
The admin's home. Two things:
1. **KPI strip** — inventory value, 30-day spend, pending requisitions, low-stock count, active outlets/users, with a "vs previous period" delta.
2. **Kitchen comparison table** — one row per kitchen: inventory value, stock-ins, stock-outs, low-stock items, pending requests. Click a row → drill into that kitchen.

*All computable today. No schema change.*

### B. Operations → Inventory (new)
Cross-kitchen stock table with kitchen/category/material-type filters, plus three tabs that are pure gold and currently invisible:
- **Low & out of stock** — needs reorder
- **Dead stock** — value sitting unmoved (₹76k today)
- **Negative / anomaly** — data-integrity check

### C. Operations → Stock Movements (new)
A unified ledger of every stock-in and stock-out across all kitchens, with date range, kitchen, material, type (purchase / kitchen / self / transfer) and **value** per movement (you have per-batch cost, so this is exact, not estimated). Export to Excel — `xlsx` and `jspdf` are already dependencies.

### D. Reports → Performance *(fills the placeholder)*
This is where **fill rate** lives — the metric your business actually runs on:
- **Fill rate %** = fulfilled qty ÷ requested qty, by outlet and by material
- **Perfect-order %** — requisitions delivered 100% complete
- **Turnaround time** — request date → packed date
- **Top under-fulfilled materials** — what you keep running short on
- **Activity by user** — who is doing the stock-ins/outs

The existing Requisitions Report already computes variance per requisition; this is that same logic rolled up into trends instead of one-at-a-time.

### E. Reports → Trends *(fills the placeholder)*
- Spend over time, split purchase vs in-house
- Consumption per outlet over time (spot growing/shrinking outlets)
- Material price trend — you have `unit_cost` per batch over 4 months, so **ingredient inflation is directly measurable**
- Wastage & internal-consumption trend by reason
- **Reorder suggestions** — average daily consumption × lead time vs current stock

### F. Reports → Sales — ⚠️ **cannot build yet**
Be aware: `checkout_form`, `checkout_form_additional`, `checkout_form_return_items` and `franchise_daily_snapshot` are **all zero rows**. The closing/checkout feature that captures cash and returns isn't in production use yet. Until it is, there is no revenue data anywhere in the system, so Sales, COGS and margin are genuinely blocked. I'd either hide this nav item or label it "coming soon" rather than leave a placeholder.

### G. Alerts / Data Health (new, small but high value)
A card surfacing what's quietly broken:
- **46 active materials have no low-stock threshold set** — meaning low-stock alerts silently skip them
- **25 stock-in records have no supplier name**
- Supplier is **free text** (7 distinct strings) and not linked to the `vendors` table (11 rows) — so "spend by supplier" can't be trusted yet; 10 active materials have no `vendor_id`
- Self stock-out reasons include a literal `"test"` entry and a misspelt `"cullinary-rnd"` — reason codes need to be a fixed list, not free text, or every wastage report will be wrong

---

## 5. Accessibility & usability — concrete defects

These are the "accessible" half of the question, and they're all in code I read:

1. **No URL routing.** `AdminDashboard.jsx:77-78` keeps the active section in React state. So: you can't bookmark a section, can't share a link to it, browser Back doesn't work, and **a page refresh throws you back to the placeholder**. The Purchase Manager dashboard does this correctly with nested routes (`App.jsx`) — the admin dashboard should match.

2. **Keyboard users can tab into invisible menu items.** `AdminDashboard.jsx:187-193` hides collapsed sub-menus with `max-h-0 opacity-0 overflow-hidden`. CSS hides them visually but they stay in the tab order — a keyboard or screen-reader user tabs into buttons they can't see. Needs `hidden` or the `inert` attribute.

3. **Zero `aria-current` or `aria-expanded` in the entire codebase.** A screen reader can't tell which section is active or whether a menu is open. The collapse arrow is a bare `▸` character.

4. **Hardcoded `text-black`** on the active nav item (`AdminDashboard.jsx:173`) — breaks in dark theme; everything else uses semantic tokens.

5. **Modals aren't real dialogs.** The two modals in `AdminRequisitionsReports.jsx` have no `role="dialog"`, no `aria-modal`, no Escape-to-close, no focus trap, and no body scroll lock — even though `useBodyScrollLock` exists in the repo and `AuditDetailDrawer.jsx` already does all of this correctly. Escape handling exists in exactly one file across the whole app.

6. **No shared filter state.** Every section re-implements its own kitchen dropdown and date filter. Pick "Kitchen A, last 30 days" once and it should apply everywhere — right now you re-select it in each section.

7. **No charting library installed.** Everything is tables. For trends you'll need either a small library (Recharts) or hand-rolled SVG sparklines — worth deciding before building section E.

---

## 6. Suggested order of work

**Phase 1 — stop the bleeding (biggest win per hour)**
1. Move nav into URL routes (fixes refresh/back/bookmark in one change)
2. Build Overview → Cloud Kitchen: KPI strip + kitchen comparison
3. Fix the accessibility defects above (small, mechanical)

**Phase 2 — give admin operational sight**
4. Inventory section (with low-stock / dead-stock / anomaly tabs)
5. Stock Movements ledger with export
6. Data Health card

**Phase 3 — analytics**
7. Performance (fill rate, turnaround, under-fulfilment)
8. Trends (spend, consumption, price inflation, reorder suggestions)

**Phase 4 — blocked on data**
9. Sales/COGS/margin — only after the checkout form is actually in production use
10. Expiry tracking, purchase orders, cycle counts — all need new tables (the analytics doc §7 covers these correctly)

---

## 7. Open decisions before building

Two things worth deciding first:

1. Whether **Sales should be hidden** until checkout data exists.
2. Whether you want **Inventory/Stock Movements as new admin sections** or as an "admin mode" reuse of the existing Purchase Manager pages (like Materials already does with `isAdminMode`). The reuse route is much less code but those pages assume a single kitchen, so they'd need a kitchen selector threaded through.
