# Admin Dashboard — Gap Analysis & Enhancement Plan

**Created:** 2 August 2026
**Last updated:** 2 August 2026 — after Phase 1 and the Kitchen Wise Overview
**Method:** Code read of `frontend/src/pages/AdminDashboard.jsx` + admin sub-pages, cross-referenced against the live Supabase database (row counts and data-quality profiling run directly against production).

This is a living plan. §1–§2 are the current state; §3–§5 are the original findings, kept as the record of why the work was scoped this way; §6–§8 are what is left.

---

## 1. Where the admin dashboard is now

The sidebar has 6 groups and 17 sub-sections. Fourteen are built; **three are still placeholder text**, all in Reports.

| Section | Status |
|---|---|
| Overview → **Cloud Kitchen Overview** | ✅ built — KPI strip, kitchen cards, cross-kitchen charts |
| Overview → **Kitchen Wise Overview** | ✅ built — per-kitchen KPIs, analytics, ledgers, outlets |
| Overview → Outlets | ✅ |
| Operations → Materials / Vendors / Recipes / Dispatch Brands | ✅ |
| People → Users / Operators | ✅ |
| Reports → Requisitions Reports | ✅ |
| Reports → **Sales** | ❌ placeholder — genuinely blocked, see §4F |
| Reports → **Performance** | ❌ placeholder |
| Reports → **Trends** | ❌ placeholder |
| Audits → 4 sub-sections | ✅ |
| Franchise → Data Cloning | ✅ |

The landing screen is no longer a placeholder — it is the Cloud Kitchen Overview.

---

## 2. What has been built

### 2.1 URL routing for the whole dashboard *(Phase 1, item 1)*

The active section lived in component state, so nothing survived the address bar. Every section now has a URL:

```
/invmanagement/dashboard/admin/<group>/<section>
/invmanagement/dashboard/admin/overview/kitchen-wise/<kitchenId>?tab=stock-in
```

`pages/admin/adminNavigation.js` is the single source of truth — the sidebar and the router are both generated from it, so a new section is one entry and the URL, nav item and route cannot drift apart. A section may declare `paramPath` to also answer on a parameterised path. Group index routes redirect to their first child; an unknown admin URL lands on the default section rather than bouncing out to the session redirect.

Path builders live in `pages/admin/adminPaths.js`, a leaf module with no imports. This is not stylistic: `adminNavigation.js` imports every admin screen, so a screen importing a builder from it would close an import cycle, and a module-level constant in that screen would then evaluate against a half-initialised module and throw at import time — a white screen the build would not catch.

### 2.2 Overview → Cloud Kitchen Overview *(Phase 1, item 2)*

Read-only. Six KPI tiles (inventory value, spend with period-on-period delta, pending requisitions, out of stock, low stock, dead stock) over one card per cloud kitchen. Cards link into the Kitchen Wise Overview.

Below the cards, three Recharts comparisons: **spend over time** by kitchen, **inventory value** by kitchen, **stock-outs** by kitchen.

Every tile and card stat is captioned "as of now" or with the date range, because the screen mixes point-in-time stock metrics with flow metrics — without the caption, a range change that moves half the numbers and leaves the rest reads as a bug.

### 2.3 Overview → Kitchen Wise Overview

Everything recorded for one cloud kitchen. Kitchen and open tab are both in the URL.

- **Summary** — six stats for the kitchen
- **Analytics** — spend trend, top materials by value, internal use by reason
- **Stock In** ledger — receipts with supplier, invoice, type, receiver, cost
- **Stock Out** ledger — allocations, internal use, transfers and dispatches
- **Outlets** — the outlets this kitchen serves, with allocations over the range, last allocation and pending requisitions

Ledger rows open a **record modal**: the record's fields, its line items, and the audit trail tied to it. The audit trail renders through the same `describeEvent` + `EventBody` pipeline as the Audits section, so an event looks identical in both places. It is collapsed by default, but whether one *exists* is resolved on open — a record with none says "No audit log tied to this record" rather than offering a disclosure onto nothing.

Tables follow the purchase manager's inventory table: `border-2` card, header on the page background, accent wash on hover, sortable columns with accent arrows, status pills.

### 2.4 The RLS gap that would have made every cost figure zero

Found while writing the overview queries, not by testing. The admin logs in through Supabase auth with `cloud_kitchen_id = NULL`, and the only SELECT policies on `stock_in` and `stock_in_batches` were kitchen-scoped:

```
(auth.uid() IS NOT NULL AND is_purchase_manager_or_admin()
 AND EXISTS (… users.cloud_kitchen_id = stock_in.cloud_kitchen_id))
OR (auth.uid() IS NULL)
```

For the admin the `EXISTS` can never be true — NULL never equals a kitchen id — so the admin read **zero rows from both tables**. Quantities were unaffected (`inventory` has a permissive public read), which is why it had never surfaced: the gap only showed up in money.

`migrations/add-admin-read-policies-for-stock-in.sql` adds two read-only policies via the existing `is_admin()`. **Applied.** The pages still detect the condition and hide cost tiles rather than showing a confident zero, so the same failure elsewhere is visible rather than silent.

### 2.5 Accessibility and shared code

Fixed: URL routing (§5.1), `inert` on collapsed sidebar panels so keyboard users can no longer tab into invisible items (§5.2), `aria-expanded` / `aria-controls` / `aria-current` on the nav (§5.3), the hardcoded `text-black` (§5.4). New modals ship with `role="dialog"`, `aria-modal`, Escape, focus-on-close-button and body scroll lock. Tables carry `aria-sort`.

Shared modules extracted so the screens cannot drift: `lib/formatNumbers.js`, `lib/chartTheme.js`, `lib/fetchAllRows.js` (pages PostgREST results so a row cap cannot silently truncate a total), `hooks/useTableSort.js`.

### 2.6 Design decisions worth not re-litigating

- **Kitchens are cards, not table rows** — there are three of them and that is not changing soon.
- **Comparison charts sit below the cards**, not inside each card. A chart inside one kitchen's card compares nothing.
- **KPI values are white.** Severity colouring made the strip harder to scan and decided for the reader what counts as bad. The brand accent does structural work instead — a hairline rule on the leading edge, section markers, table totals.
- **No healthy/low/out status stack.** Its natural third segment, healthy green, measures **ΔE 4.1 against critical red under deuteranopia** — a red-green colourblind reader could not separate "fine" from "out of stock" on the one chart whose job is flagging what is out. Any future status-coloured chart needs the palette validated first; the three kitchen hues clear all-pairs at ΔE 9.4 CVD / 20.9 normal-vision against this app's card surface.
- **Charts have no data-table twin.** Both bar charts label values at the bar tips; the line chart's per-period values are tooltip-only until the detailed analytics screens land.
- **Ledger rows open a modal**, not an expanded row. Page size 15.
- **No Inventory tab** on the Kitchen Wise Overview — dropped in favour of the two ledgers plus Outlets.

---

## 3. The original structural gap, and what is left of it

The admin could edit **catalogue** things but see no **stock**:

- ~~No **Stock In** ledger~~ → ✅ per kitchen, with line items and audit
- ~~No **Stock Out** ledger~~ → ✅ per kitchen, with line items and audit
- ~~No **cross-kitchen comparison**~~ → ✅ Cloud Kitchen Overview
- **No cross-kitchen Inventory browser** — deliberately not built. Stock *value*, out-of-stock and low-stock counts appear as roll-ups on both overviews; there is no screen listing stock per material per kitchen. Revisit if the roll-ups prove insufficient.
- **No unified all-kitchen movement ledger** — the ledgers are per kitchen. A cross-kitchen ledger with export is still §4C.

---

## 4. The data (unchanged — this was never the blocker)

**4 months of clean transactional history (2026-04-02 → 2026-08-02):**

| Table | Rows | Quality |
|---|---|---|
| `stock_in` | 300 | **300/300 have cost** ✅ |
| `stock_in_batches` | 3,053 | **all have `unit_cost`** ✅ (FIFO with cost basis) |
| `stock_out` | 824 | 658 self, 166 with dispatch brand |
| `stock_out_items` | 7,202 | line-level detail ✅ |
| `stock_out_batch_consumption` | 3,502 | **exact cost-of-goods per issue** ✅ |
| `allocation_requests` / `_items` | 175 / 778 | request-vs-fulfilled linkage is **100% intact** ✅ |
| `inventory` | 876 | live stock per kitchen × material |

Figures as measured: **₹8,50,442** inventory value, **₹21,19,060** spend in 30 days, **9** pending requisitions, **₹76,258** dead stock across 19 batches older than 60 days, **21** material×kitchen pairs unmoved in 45 days.

`docs/ADMIN_DASHBOARD_ANALYTICS.md` specs 26 widgets and claims fill-rate is blocked by missing request↔fulfilment linkage. That claim is **out of date** — every packed requisition links cleanly to its stock-out, so fill rate is computable today.

### 4C. Cross-kitchen Stock Movements ledger *(not built)*
A unified ledger of every movement across all kitchens with date/kitchen/material/type filters and **value** per movement, plus Excel export (`xlsx` and `jspdf` are already dependencies).

### 4D. Reports → Performance *(placeholder)*
**Fill rate %** (fulfilled ÷ requested) by outlet and material, perfect-order %, request→packed turnaround, top under-fulfilled materials, activity by user. The Requisitions Report already computes per-requisition variance; this is that rolled up.

### 4E. Reports → Trends *(placeholder)*
Spend split purchase vs in-house, consumption per outlet over time, **material price trend** (four months of per-batch `unit_cost` makes ingredient inflation directly measurable), wastage trend by reason, reorder suggestions.

### 4F. Reports → Sales *(blocked)*
`checkout_form`, `checkout_form_additional`, `checkout_form_return_items` and `franchise_daily_snapshot` are **all zero rows**. The closing/checkout feature that captures cash and returns is not in production use, so there is no revenue data anywhere — Sales, COGS and margin are genuinely blocked. Hide the nav item or label it "coming soon" rather than leave a placeholder.

### 4G. Alerts / Data Health *(not built)*
- **46 active materials have no low-stock threshold set** — low-stock alerts silently skip them
- **25 stock-in records have no supplier name**
- Supplier is **free text** (7 distinct strings), unlinked to `vendors` (11 rows), so "spend by supplier" cannot be trusted; 10 active materials have no `vendor_id`
- Self stock-out reasons include a literal `"test"` and a misspelt `"cullinary-rnd"` — reason codes need a fixed list, or every wastage report is wrong

---

## 5. Accessibility & usability — original defects, with status

1. ~~**No URL routing.**~~ ✅ Fixed — §2.1.
2. ~~**Keyboard users can tab into invisible menu items.**~~ ✅ Fixed with `inert`.
3. ~~**Zero `aria-current` / `aria-expanded`.**~~ ✅ Fixed on the admin nav. Other dashboards still have none.
4. ~~**Hardcoded `text-black`.**~~ ✅ Fixed.
5. **Modals aren't real dialogs.** ❌ **Still open** in `AdminRequisitionsReports.jsx` — no `role="dialog"`, no `aria-modal`, no Escape, no focus trap, no scroll lock. New admin modals do all of this; that file was never touched.
6. **No shared filter state.** ⚠️ Partial — each overview has its own range control and they do not talk to each other. Picking "last 30 days" once should apply everywhere.
7. ~~**No charting library.**~~ ✅ Recharts 3.10.1 installed.

---

## 6. Order of work — updated

**Phase 1 — done**
1. ✅ URL routes
2. ✅ Cloud Kitchen Overview
3. ⚠️ Accessibility — items 1–4 and 7 done; **item 5 outstanding**

**Phase 1.5 — done (added after the fact)**
- ✅ Kitchen Wise Overview with ledgers, outlets, record modals and audit trails
- ✅ Admin RLS read policies for `stock_in` / `stock_in_batches`

**Phase 2 — give admin cross-kitchen operational sight**
4. Cross-kitchen Stock Movements ledger with export (§4C)
5. Data Health card (§4G)
6. Outlet detail view on the Kitchen Wise Overview — **content not yet specified**
7. Fix the `AdminRequisitionsReports` modals (§5.5)

**Phase 3 — analytics**
8. Performance — fill rate, turnaround, under-fulfilment (§4D)
9. Trends — spend, consumption, price inflation, reorder suggestions (§4E)

**Phase 4 — blocked on data**
10. Sales / COGS / margin — only once the checkout form is in production use
11. Expiry tracking, purchase orders, cycle counts — need new tables (`ADMIN_DASHBOARD_ANALYTICS.md` §7 covers these correctly)

---

## 7. Open questions

1. **Outlet detail view** — what should clicking an outlet on the Kitchen Wise Overview show? Rows are intentionally not clickable until this is decided.
2. **Inventory roll-ups** — "Out of stock", "Low stock", inventory value and dead stock still appear on both overviews as summary figures. Confirm these stay now that the Inventory tab is gone.
3. **Sales** — hide the nav item until checkout data exists, or leave it as a labelled placeholder?
4. **Shared filter state** — worth building a dashboard-level range/kitchen context, or leave each screen independent?

---

## 8. Verification status

Everything shipped so far has been checked by lint, production build, and SQL cross-checks of the computed figures against the database. The chart palette was validated with a colourblindness/contrast validator against the real card surface rather than chosen by eye.

**None of it has been verified visually in a browser.** The Chrome extension used for automated checks has not been connected during this work, so layout, label collisions, tick crowding and overflow are unchecked. This is the main outstanding risk and is worth a manual pass.
