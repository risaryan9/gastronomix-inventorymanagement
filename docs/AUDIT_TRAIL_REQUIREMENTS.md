# Audit Trail Requirements

> **Purpose of this document.** A plain-language catalogue of *every place in the
> application where a non-admin user performs an action that management (Admins)
> should be able to review after the fact.* For each place we record **what the
> user does**, **where in the code it happens**, and **why the business logic
> demands an audit entry**. This is a scoping document only — it deliberately
> does **not** define table schemas, column names, or the technical shape of the
> audit records. That comes later.

---

## 1. Scope & Ground Rules

- **Actors in scope = everyone except Admin.** Admins are the highest role and
  effectively *are* the auditors, so their own actions are **out of scope** for
  this document. Anything a lower role does that carries business risk belongs
  here.
- **Non-admin roles** (all of these authenticate by **login key**, which
  bypasses row-level security at the database and relies on the app to enforce
  who-can-do-what — that alone is a reason to log their actions):
  - `purchase_manager` — inventory "in", catalog, cost, stock-out/packing.
  - `supervisor` — creates outlet requisitions, runs the outlet closing/checkout.
  - `bp_operator` — Boom Pizza operator; a restricted supervisor (creates
    requisitions, no closing form).
  - `dispatch_executive` — builds daily dispatch plans.
  - `kitchen_executive` — confirms/locks dispatch plans for the kitchen.
  - `operators` — **reference data**, not a login actor. Operator names are
    attached to outlet checkout forms; they are created/managed by Admins in
    `AdminOperators`. Listed here only so it's clear they were considered and
    excluded.
- **What deserves an audit entry (business-logic test).** An action qualifies if
  any of the following is true:
  1. It **changes physical inventory** (increment or decrement) — money and stock
     on the shelf.
  2. It **touches cost / financial data** (unit cost, GST, invoice, total cost).
  3. It **reverses or overrides** a prior transaction (cancellations, edits after
     the fact, re-activations).
  4. It **records reconciliation facts** used to judge outlets/staff (wastage,
     returns, variance between requested vs dispatched).
  5. It **locks or finalizes** a plan that drives downstream production/dispatch.
  6. It is an **authentication event** on a shared, key-based, RLS-bypassing login.

- **Legend for "Current status"**
  - ✅ **Audited** — an `audit_events` row is already written today.
  - ❌ **GAP** — the action happens but **no** audit entry is written.
  - ⚠️ **Partial / verify** — audited only in some branches, or logging may live
    inside a database RPC that must be confirmed.

- **What already exists.** `audit_logs` has been replaced by `audit_events` +
  `audit_auth_events` (see §6 for the schema, `migrations/replace-audit-logs-with-audit-events.sql`
  for the table/RLS/helper-function migration). **Nine** flows now write to
  `audit_events`:
  - **A1/A2 (auth)** — `authenticate_user_by_key` calls `log_auth_event()` on
    both the success and failure branch, writing an `audit_events` row plus its
    `audit_auth_events` satellite
    (`migrations/wire-auth-events-to-authenticate-user-by-key.sql`). This was
    the last flow still using the helpers created-but-left-unwired by the
    schema migration. Same migration also adds `current_request_ip()` /
    `current_request_user_agent()`, which read the real client IP and user agent
    out of PostgREST's request headers — closing the §6.5 open item.
  - `pack_allocation_request` (D1), `cancel_allocation_packing` (D4), and
    `confirm_checkout_form` (F2) call the internal `log_audit_event()` helper
    directly (re-pointed in the same migration above).
  - `manualInventoryAdjust.js` (B2), `Materials.jsx`'s create/update (C1/C2),
    and `StockOut.jsx`'s self-stock-out branch (D2) — previously raw
    `.from('audit_logs').insert(...)` calls from the client — now call one of
    four narrow, purpose-built RPCs (`log_manual_inventory_adjustment`,
    `log_raw_material_created`, `log_raw_material_updated`,
    `log_self_stock_out`) added in
    `migrations/wire-legacy-audit-writers-to-audit-events.sql`. Each RPC
    hardcodes its own `category`/`action`/`severity`/`entity_type` server-side
    and only accepts the business facts as parameters, so the client supplies
    data but never controls what kind of event gets logged.
  Everything marked ❌ below is a place the business logic says *should* log
  but doesn't yet — that's the next phase of work, not covered by this pass.

### Decisions (settled — see §5 for detail)

1. **Auth logging:** both successful **and** failed login attempts are in scope.
2. **Where new logging lives:** inside the database (new/extended Postgres
   functions or triggers), matching the pattern already used by
   `pack_allocation_request`, `cancel_allocation_packing`, and
   `confirm_checkout_form` — **not** client-side inserts. Schemas for these are
   a later step; this document only marks *where* a DB-side audit hook is
   needed.
3. **Read/report access:** not required for now — this document covers
   state-changing actions only.
4. **Edit granularity:** record-level ("record X was edited by Y at Z", with
   the before/after payload the RPC already has on hand) is sufficient for the
   first pass — no field-by-field diffing required.

---

## 2. Summary Table

| # | Action | Role(s) | Area | Status |
|---|--------|---------|------|--------|
| A1 | Key-based login (success) | supervisor, PM, bp_operator, executives | Auth | ✅ |
| A2 | Key-based login (failure / invalid key) | any non-admin | Auth | ✅ |
| B1 | Stock-In finalize (receive stock) | purchase_manager | Inventory In | ❌ |
| B2 | Manual inventory adjustment (increment/decrement) | purchase_manager | Inventory In | ✅ |
| C1 | Create raw material | purchase_manager | Catalog | ✅ |
| C2 | Edit raw material (incl. cost) | purchase_manager | Catalog | ✅ |
| C3 | Deactivate / reactivate raw material | purchase_manager | Catalog | ❌ |
| D1 | Regular stock-out / pack requisition (deduct inventory) | purchase_manager | Stock Out | ✅ |
| D2 | Self stock-out (wastage / adjust / dispatch / R&D) | purchase_manager | Stock Out | ✅ |
| D3 | Inter-cloud-kitchen transfer — destination leg | purchase_manager | Stock Out | ⚠️ |
| D4 | Cancel allocation packing (reverse FIFO) | purchase_manager | Stock Out | ✅ |
| E1 | Create allocation request (requisition) | supervisor, bp_operator, PM | Requisitions | ❌ |
| E2 | Edit allocation request items/quantities | supervisor, bp_operator, PM | Requisitions | ❌ |
| E3 | Delete allocation request items | supervisor, bp_operator, PM | Requisitions | ❌ |
| E4 | PM adds an item to a supervisor's requisition (pre-pack) | purchase_manager | Requisitions | ❌ |
| F1 | Save checkout/closing draft (returns, wastage, extra consumption) | supervisor | Checkout | ❌ |
| F2 | Confirm/lock checkout form | supervisor | Checkout | ✅ |
| G1 | Create/save dispatch plan + items | dispatch_executive | Dispatch Plan | ❌ |
| G2 | Delete/replace dispatch plan items | dispatch_executive | Dispatch Plan | ❌ |
| H1 | Confirm & lock dispatch plan | kitchen_executive | Kitchen | ❌ |

**9 audited, 1 partial, 10 gaps** across 20 action points.

---

## 3. Detailed Requirements

### A. Authentication & Session

#### A1 — Key-based login (success)
- **What happens:** A supervisor, purchase manager, bp_operator, or executive
  signs in with a shared **login key** scoped to a cloud kitchen and role.
- **Where:** `frontend/src/pages/Login.jsx` → `handleKeyLogin` (RPC
  `authenticate_user_by_key`, ~line 100–137). The audit write lives **inside
  `authenticate_user_by_key` itself**
  (`migrations/wire-auth-events-to-authenticate-user-by-key.sql`), which calls
  `log_auth_event()` on the success branch before returning the user row —
  `action: 'login_success'`, `category: 'auth'`, `severity: 'info'`, plus the
  `audit_auth_events` satellite row carrying the hashed key and
  `resolved_user_id`.
- **Why audit:** Key-based logins run as the anonymous DB role and **bypass
  RLS**; the application is the only gate. A login key is a shared secret that
  can be passed around. Recording *who authenticated, from where (user agent /
  IP), and when* is the anchor every other audited action ties back to. Without
  it there is no way to attribute a burst of inventory changes to a person or a
  device. **Now logged**, including IP and user agent (see §6.5).
- **Status:** ✅ Audited, DB-side.
- **Note on severity:** successful logins are by far the highest-volume event in
  the trail and are "purely additive with no financial or physical-stock effect"
  — §6.3's own definition of `info` — so they are logged as `info` and stay out
  of the review queue. A2 remains `critical`. This is the first real user of the
  `info` level, which §6.3 had reserved but left unused.
- **Note on the login path:** because all logging happens inside the RPC, this
  required **no frontend change**. `handleKeyLogin` is unchanged and cannot opt
  out of being audited.

#### A2 — Key-based login (failure / invalid key)
- **What happens:** A login attempt with a wrong/expired/guessed key returns no
  matching row; the frontend then raises "Invalid login key or user not found".
- **Where:** the failure branch of `authenticate_user_by_key`
  (`migrations/wire-auth-events-to-authenticate-user-by-key.sql`) — `action:
  'login_failed'`, `category: 'auth'`, `severity: 'critical'`. The frontend
  error branch in `Login.jsx` (~line 141–158) is untouched.
- **Why audit:** Repeated failures against a shared key are the primary signal
  of a brute-force or an ex-employee still trying old credentials. Security
  monitoring is impossible if only successes are visible. **Now logged.**
- **Status:** ✅ Audited, DB-side.
- **Failure reasons.** After the authentication query misses, the function runs
  a second lookup on the **normalized key alone** (ignoring role / kitchen /
  active / deleted) purely to classify the failure. This separates a blind guess
  from someone holding a real but stale credential — a much stronger signal than
  a flat "login failed". `failure_reason` is one of:
  - `no_matching_key` — nobody has this key. Guessing/brute force.
  - `deleted_user` — key belongs to a soft-deleted user.
  - `inactive_user` — key belongs to a deactivated user (e.g. ex-employee).
  - `role_mismatch` — real key, wrong role selected.
  - `cloud_kitchen_mismatch` — real key, wrong kitchen selected.
- **The failure reason never reaches the client.** It is written to
  `audit_auth_events` only; the function still returns zero rows in every
  failure case, so the login screen shows the same generic message regardless.
  An attacker cannot use this to discover whether a key is valid.
- **Attributing a rejected key.** `audit_auth_events.resolved_user_id` means
  "who actually got in", so it stays `NULL` on failure per the schema's
  contract. The user whose key was presented but rejected is recorded instead as
  `matched_user_id` inside the event's `new_values` payload — so "someone tried
  Ravi's old key three times last night" is still answerable.
- *(Admin email/password login via `handleAdminLogin` is intentionally out of
  scope — Admin action.)*

---

### B. Inventory In (Purchase Manager)

#### B1 — Stock-In finalize (receiving stock)
- **What happens:** PM records a delivery: creates a `stock_in` header, one or
  more `stock_in_batches` (each with **unit cost + GST**), and increments
  `inventory`. Optionally uploads an invoice image.
- **Where:** `frontend/src/pages/purchase-manager/StockIn.jsx` → `handleFinalize`
  (~line 866; inserts at 978 `stock_in`, 1009 `inventory`, 1040 `stock_in_batches`).
- **Why audit:** This is the single largest *inbound* value event. It raises
  physical stock **and** sets the cost basis (unit cost, GST, supplier, invoice
  number) that later drives every FIFO cost calculation and outlet cost report.
  Inflated quantities, wrong costs, or fake suppliers are classic procurement
  fraud vectors. Management must be able to see who received what, at what cost,
  against which invoice. Per decision #2, closing this gap means wrapping
  stock-in finalization in a new Postgres function (mirroring
  `pack_allocation_request`) rather than adding a client-side insert.
- **Status:** ❌ GAP.

#### B2 — Manual inventory adjustment (increment / decrement)
- **What happens:** PM overrides an item's on-hand quantity; the system creates a
  synthetic stock-in (increment) or self stock-out + FIFO consume (decrement) and
  records the reason.
- **Where:** `frontend/src/lib/manualInventoryAdjust.js` → `adjustManualInventory`
  (called from `pages/purchase-manager/Inventory.jsx` ~line 303); audit write now
  goes through the `log_manual_inventory_adjustment` RPC
  (`migrations/wire-legacy-audit-writers-to-audit-events.sql`), which derives
  `category` (`inventory_in`/`inventory_out`) from the adjustment type
  server-side rather than trusting a client-supplied action string.
- **Why audit:** A manual override of physical stock, with a free-text reason, is
  exactly the kind of discretionary action that needs a paper trail — it can hide
  shrinkage or theft. **Already logs old vs new quantity + reason.**
- **Status:** ✅ Audited, DB-side.
- **Note:** `supabase/functions/adjust-inventory/index.ts` is a second,
  functionally-identical implementation of this same flow (still writes to the
  now-dropped `audit_logs`) but is **not called from anywhere in the frontend**
  — dead code, unaffected by this change. Worth a cleanup decision later.

---

### C. Raw Material Catalog (Purchase Manager)

#### C1 — Create raw material
- **Where:** `frontend/src/pages/purchase-manager/Materials.jsx` → `handleSubmit`
  insert branch (~line 608), audit via the `log_raw_material_created` RPC
  (~line 632; `migrations/wire-legacy-audit-writers-to-audit-events.sql`).
  `raw_materials` is a global catalog (no `cloud_kitchen_id` column), so these
  events carry a null `cloud_kitchen_id`.
- **Why audit:** New catalog items define units and (optionally) cost; they
  become allocatable/receivable stock. **Already logged.**
- **Status:** ✅ Audited, DB-side.

#### C2 — Edit raw material (including unit cost)
- **Where:** `Materials.jsx` → `handleSubmit` update branch (~line 561), audit
  via the `log_raw_material_updated` RPC (~line 569; same migration as C1).
- **Why audit:** Changing a material's **cost** retroactively affects valuation
  and outlet cost reports; changing units can silently distort every quantity.
  **Already logged with old/new values.**
- **Status:** ✅ Audited, DB-side.

#### C3 — Deactivate / reactivate raw material
- **What happens:** PM soft-deletes (`is_active = false`) or restores
  (`is_active = true`) a material from the edit modal.
- **Where:** `Materials.jsx` inline modal buttons (deactivate update ~line 1428;
  reactivate update ~line 1519). **No `audit_logs` write in these handlers.**
- **Why audit:** Deactivating a material hides it from allocation and reporting —
  a way to make an item "disappear" without deleting its history. The
  activate/deactivate toggle should be logged the same way create/edit already
  are; leaving it unlogged is an inconsistency in an otherwise-audited flow.
- **Status:** ❌ GAP.
- **Note:** unlike C1/C2, closing this one server-side would need `raw_materials`
  updates to route through a Postgres function/trigger instead of the current
  direct client `.update()`, per decision #2.

---

### D. Stock Out / Packing (Purchase Manager)

#### D1 — Regular stock-out (pack a requisition, deduct inventory)
- **What happens:** PM packs an outlet's allocation request. The regular
  (non-self) path in `handleAllocateStock` calls the **`pack_allocation_request`
  RPC**, which atomically creates the `stock_out` + `stock_out_items`, runs FIFO
  consumption against `stock_in_batches`, marks the request `is_packed = true`,
  and returns — the older client-side insert code further down the same
  function (~line 2260 onward) is only reached for the **self-stock-out**
  branch (D2), not this one.
- **Where:** `frontend/src/pages/purchase-manager/StockOut.jsx` →
  `handleAllocateStock` (~line 2106; RPC call ~line 2241); the RPC itself
  originally defined in `migrations/add-stock-out-batch-consumption-and-cancel-packing.sql`,
  re-pointed at `audit_events` via `log_audit_event()` in
  `migrations/replace-audit-logs-with-audit-events.sql` (`action:
  'requisition_packed'`, `category: 'inventory_out'`).
- **Why audit:** This is **the core outbound inventory event** — stock
  physically leaves the kitchen for an outlet, at real FIFO cost, and it's the
  most frequent, highest-value movement in the system. **Already logged
  server-side**, including the full item list and computed FIFO cost in
  `new_values`. This was initially mis-scoped as the single biggest gap in this
  document — re-reading the RPC confirmed it already logs correctly; corrected.
- **Status:** ✅ Audited, DB-side.

#### D2 — Self stock-out (wastage / adjustment / dispatch / R&D)
- **What happens:** PM books stock out with no receiving outlet — reasons
  include wastage (photo required), culinary R&D, dispatch (brand-linked), and
  inter-cloud-kitchen transfer (see D3). This is the client-side branch of
  `handleAllocateStock` that the RPC path in D1 does **not** cover.
- **Where:** `StockOut.jsx` → `handleAllocateStock`, self-stock-out branch;
  audit via the `log_self_stock_out` RPC (~line 2552;
  `migrations/wire-legacy-audit-writers-to-audit-events.sql`) — `action:
  'stock_out'`, `self_stock_out: true` in `new_values` along with the reason
  and item list, same shape as before.
- **Why audit:** Wastage/self-consumption directly reduces stock with no
  receiving party — prime shrinkage territory, and it covers every reason
  variant (wastage, R&D, brand dispatch, inter-cloud source leg) uniformly.
  **Already logged.**
- **Status:** ✅ Audited, DB-side.

#### D3 — Inter-cloud-kitchen transfer — destination leg
- **What happens:** Self stock-out with reason `inter-cloud-kitchen` moves stock
  from the source kitchen (audited as part of D2) and **separately creates a
  matching `stock_in` + `stock_in_batches` + `inventory` row at the destination
  kitchen**, carrying FIFO cost across.
- **Where:** `StockOut.jsx` inter-cloud branch (~line 2355–2417) — the
  destination-side inserts specifically; the D2 audit entry (now via the
  `log_self_stock_out` RPC) covers only the source kitchen's stock-out.
- **Why audit:** Value crosses an organizational boundary (kitchen A → kitchen
  B) and **mints new inventory and cost at a second kitchen** with no audit
  entry of its own — only the depleting side is logged. Because it's
  cross-kitchen and high value, both legs should be reviewable as a matched
  pair; right now only one half of the transfer has a paper trail.
- **Status:** ⚠️ Partial (source leg audited via D2; destination stock-in
  creation is not).

#### D4 — Cancel allocation packing (reverse FIFO)
- **What happens:** PM cancels a packed requisition; the
  `cancel_allocation_packing` RPC restores consumed quantities to the exact
  batches, hard-deletes the `stock_out` row, and reopens the request.
- **Where:** `StockOut.jsx` → `confirmCancelPacking` (~line 2500; RPC call
  2513, passes `p_acting_user_id`); the RPC itself originally defined in
  `migrations/add-stock-out-batch-consumption-and-cancel-packing.sql`,
  re-pointed at `audit_events` via `log_audit_event()` in
  `migrations/replace-audit-logs-with-audit-events.sql` (`action:
  'requisition_packing_cancelled'`, `category: 'reversal'`, `severity:
  'critical'`, with a full pre-delete snapshot of the stock_out/items/consumption
  rows in `old_values`, and `reversed_event_id` auto-linked back to the
  original pack event).
- **Why audit:** This is a **reversal** of a completed inventory movement — the
  category most prone to abuse (pack → cancel → re-pack to mask a discrepancy).
  **Already logged**, and notably logged well: because the underlying rows are
  hard-deleted, the RPC snapshots them into `old_values` first specifically so
  the audit trail survives the delete.
- **Status:** ✅ Audited, DB-side.

---

### E. Allocation Requests / Requisitions (Supervisor, bp_operator, Purchase Manager)

> These are the digital replacement for the paper request slips. They decide
> *what* an outlet is entitled to receive and are the reference against which
> dispatch variance is later judged.

#### E1 — Create allocation request (requisition)
- **What happens:** A supervisor/bp_operator (or PM on their behalf) creates an
  `allocation_requests` row plus `allocation_request_items` (materials +
  quantities) for an outlet on a date.
- **Where (multiple entry points):**
  - `frontend/src/components/outlets/OutletsPageBase.jsx` → `confirmAllocation`
    (insert ~line 581–595) — the shared supervisor/bp_operator flow.
  - `frontend/src/pages/supervisor/OutletDetails.jsx` → `confirmAllocation`
    (insert ~line 439–467).
  - `frontend/src/pages/purchase-manager/OutletDetails.jsx` → `confirmAllocation`
    (insert ~line 441–468).
- **Why audit:** The requisition is the **demand signal** that authorizes stock
  to leave the kitchen. Who requested how much of what, for which outlet, on which
  day is the basis for consumption analytics and for holding an outlet
  accountable. Over-requesting is the first step in diversion. None of these entry
  points log today. Per decision #2, closing this — across all three entry
  points — means introducing a shared Postgres function for creating a
  requisition (rather than each page inserting directly), similar in spirit to
  `pack_allocation_request`.
- **Status:** ❌ GAP.

#### E2 — Edit allocation request items / quantities
- **What happens:** The same `confirmAllocation` flows, when editing an existing
  request, **update** item quantities (and the request header).
- **Where:** `OutletsPageBase.jsx` update path (~line 509 header, 548 item qty);
  `supervisor/OutletDetails.jsx` (~line 300 header, 373 item qty);
  `purchase-manager/OutletDetails.jsx` (~line 303 header, 375 item qty).
- **Why audit:** Editing a requisition **after** it was created changes the
  authorized amounts — potentially after stock has been discussed or partially
  planned. Per decision #4, record-level before/after (the request as it was vs.
  as it is now) is enough for the first pass — no need for a per-field diff.
- **Status:** ❌ GAP.

#### E3 — Delete allocation request items
- **What happens:** During an edit, removed line items are **deleted** from
  `allocation_request_items`.
- **Where:** `OutletsPageBase.jsx` (~line 556); `supervisor/OutletDetails.jsx`
  (~line 390); `purchase-manager/OutletDetails.jsx` (~line 392).
- **Why audit:** Deleting a requested line erases evidence of what was originally
  asked for. Deletions of authorization records should always be logged.
- **Status:** ❌ GAP.

#### E4 — PM adds an item to a supervisor's requisition (pre-pack)
- **What happens:** While reviewing an outlet's requisition in the Allocate Stock
  modal (before packing), the purchase manager can add a material the supervisor
  forgot to include, set its quantity, and have it flow into the same pack. The
  new line is inserted into `allocation_request_items` (so it becomes a permanent
  part of the requisition record, not just a one-off addition to that day's
  stock-out) before `pack_allocation_request` runs. Only possible while
  `is_packed = false` — both in the UI and, as of
  `migrations/restrict-allocation-request-items-insert-to-unpacked.sql`, enforced
  by the INSERT RLS policy on `allocation_request_items` as well.
- **Where:** `frontend/src/pages/purchase-manager/StockOut.jsx` →
  `handleAddItemToAllocation` (adds the row to the in-memory list) and
  `handleAllocateStock` (the `pmAddedItems` insert immediately before the
  `pack_allocation_request` RPC call, non-self-stock-out branch).
- **Why audit:** This is a purchase manager unilaterally expanding an outlet's
  authorized request *after* the supervisor submitted it and outside the normal
  "one requisition per outlet per day" flow — exactly the kind of after-the-fact
  addition that needs a "who added what, and why" trail, distinct from E1
  (original creation) and E2 (editing existing quantities) because the PM is
  acting on the supervisor's behalf without the supervisor's direct input at that
  moment. Per decision #2, this should ultimately be logged from inside a Postgres
  function (ideally the same one that would close E1/E2/E3, or a small dedicated
  RPC wrapping this insert) rather than the current plain client-side insert.
- **Status:** ❌ GAP. *(New action point — introduced together with the feature
  itself; not a regression in previously-audited behavior.)*

---

### F. Checkout / Outlet Closing (Supervisor)

> The closing form reconciles what an outlet was given against what came back —
> the system's shrinkage/wastage ledger.

#### F1 — Save checkout / closing draft
- **What happens:** Supervisor records the outlet's end-of-day figures:
  `checkout_form_return_items` (stock returned), `checkout_form_wastage_items`
  (declared wastage), and `checkout_form_additional` (extra consumption). Saving
  a draft deletes and re-inserts these child rows.
- **Where:** `frontend/src/pages/supervisor/Checkout.jsx` → `handleSaveDraft`
  (~line 311; form insert/update 321/347, returns 397, wastage 404, additional
  414; deletes at 332/337/342).
- **Why audit:** **Wastage and returns are the primary loss/shrinkage numbers.**
  They directly affect how an outlet is evaluated and are the easiest figures to
  fudge (under-report returns, over-report wastage). A supervisor can save a
  draft multiple times before confirming — right now none of those saves are
  logged, only the final confirm (F2) is, and even that only records an
  aggregate total, not the return/wastage/additional line breakdown. Every
  draft save should be captured, including the delete-then-reinsert churn that
  can quietly change earlier figures before the form is ever confirmed. Per
  decision #2, this should be logged from inside a Postgres function once the
  draft-save path is moved server-side (it is currently plain client
  inserts/deletes/updates, unlike the confirm step in F2 which already runs
  through an RPC).
- **Status:** ❌ GAP.

#### F2 — Confirm / lock checkout form
- **What happens:** Supervisor finalizes the closing via the
  `confirm_checkout_form` RPC: it validates the dispatch plan is locked and
  within a 24-hour window, creates a `stock_in` + batches for returned
  quantities, and marks the checkout form `confirmed`.
- **Where:** `Checkout.jsx` → `handleFinalConfirm` (RPC ~line 455/460); the RPC
  itself originally defined in `migrations/create-confirm-checkout-function.sql`,
  re-pointed at `audit_events` via `log_audit_event()` in
  `migrations/replace-audit-logs-with-audit-events.sql` (`action:
  'checkout_confirmed'`, `category: 'checkout'`, recording the resulting
  `stock_in_id` and `total_returned_qty`).
- **Why audit:** Confirmation is the point the numbers become "official" for
  the day and inventory is actually updated from the returns. **Already
  logged.** Note it captures the finalized totals only — the underlying
  per-item wastage/return detail leading up to it is what F1 still needs to
  cover.
- **Status:** ✅ Audited, DB-side.

---

### G. Dispatch Planning (Dispatch Executive)

#### G1 — Create / save dispatch plan + items
- **What happens:** Dispatch executive builds the day's `dispatch_plan` and
  `dispatch_plan_items` (quantities per brand/outlet/material) that drive what the
  kitchen produces and ships.
- **Where:** `frontend/src/pages/DispatchExecutiveDashboard.jsx` →
  `handleSaveDispatchPlan` (~line 724; plan insert 836, items insert 860).
- **Why audit:** The dispatch plan is the **production/dispatch authorization** —
  it commits kitchen capacity and stock. Changing planned quantities has direct
  downstream inventory and cost impact, so the author and the numbers should be
  on record. Per decision #2, this means introducing a Postgres function for
  dispatch-plan save (this flow is currently plain client inserts).
- **Status:** ❌ GAP.

#### G2 — Delete / replace dispatch plan items
- **What happens:** Re-saving a plan **deletes** existing `dispatch_plan_items`
  and inserts the new set.
- **Where:** `DispatchExecutiveDashboard.jsx` (~line 790 delete, 805 re-insert).
- **Why audit:** A full replace silently discards the previous plan. Without a
  log there's no way to see a plan was revised or by how much. This is the
  same reversal/overwrite risk category as D4 and E3.
- **Status:** ❌ GAP.

---

### H. Kitchen Execution (Kitchen Executive)

#### H1 — Confirm & lock dispatch plan
- **What happens:** Kitchen executive adjusts final `dispatch_plan_items` and
  sets the `dispatch_plan` to a confirmed/locked state.
- **Where:** `frontend/src/pages/KitchenExecutiveDashboard.jsx` →
  `handleConfirmLock` (~line 420; items delete 451 / insert 465; plan update 472).
- **Why audit:** Locking is the **hand-off from planning to execution** — after
  this, the plan is treated as final for production and stock movement. Who locked
  it, when, and what the final quantities were is a decision management needs to
  reconstruct. Per decision #2, this belongs in a Postgres function (e.g. a
  `lock_dispatch_plan` RPC), consistent with how `confirm_checkout_form` gates
  and logs the analogous downstream step.
- **Status:** ❌ GAP.

---

## 4. Cross-Cutting Notes

- **Where the codebase already does this well, it does it very well.** The
  three existing RPCs (`pack_allocation_request`, `cancel_allocation_packing`,
  `confirm_checkout_form`) are the model to copy: acting user id passed in
  explicitly, a `SECURITY DEFINER` function that can't be bypassed by the
  calling role, and — in `cancel_allocation_packing`'s case — a full snapshot
  taken *before* a hard delete specifically so the audit trail survives it.
  Every new gap closed under decision #2 should follow this same shape.
- **Real highest-priority gaps, after correcting the RPC findings above:**
  1. ~~**Auth (A1/A2)**~~ — **closed.** Was the foundation gap: every other
     audit entry's value depends on being able to trace it back to a login
     event. `authenticate_user_by_key` now logs both outcomes (see §3.A).
  2. **Requisition create/edit/delete/PM-add (E1–E4)** — now the top remaining
     gap. The authorizing document for essentially all outbound stock has no
     audit trail at all, across all three page entry points, including the PM's
     own after-the-fact additions.
  3. **Checkout draft save (F1)** — the actual wastage/return/extra-consumption
     figures are set here, potentially over several saves; only the final
     confirm (F2) is logged, and only as an aggregate.
  4. **Stock-in receiving (B1)** — the largest inbound financial event
     (quantity + cost + supplier + invoice) has no audit trail.
  5. **Dispatch planning (G1/G2) and kitchen lock (H1)** — the plan → lock →
     checkout chain is audited only at its very last step (F2); the
     plan-authoring and kitchen-confirmation steps that precede it aren't.
- **Reversals & deletes remain the highest-risk category in general** — this is
  already reflected in D4 and F2 being audited via RPC. The same treatment is
  still owed to E3 (delete request items), F1's delete-then-reinsert churn, and
  G2 (replace plan items).
- **D3's destination leg is the one remaining "partial."** The source side of
  an inter-cloud transfer is covered by D2's audit entry; the new inventory
  minted at the destination kitchen is not separately logged.
- **Out of scope by design:** all Admin pages
  (`AdminUsers`, `AdminOutlets`, `AdminVendors`, `AdminOperators`,
  `AdminRecipes`, `AdminBrandDispatch`, `AdminFranchiseCloning`,
  `AdminRequisitionsReports`) — these are Admin actions. Also excluded:
  `supervisor/Inventory.jsx`, `supervisor/RawMaterials.jsx`,
  `supervisor/Allocations.jsx` — present in the repo but **not routed or imported**
  anywhere (dead code); revisit if they are ever wired up. Also excluded:
  `supabase/functions/adjust-inventory/index.ts` — a dead, unused duplicate of
  B2 (see B2's note).

---

## 5. Decisions (resolved)

These were open questions raised in the first pass of this document; all four
are now settled and have been folded into the relevant sections above.

1. **Auth logging depth — both.** Both successful and failed key-based login
   attempts are in scope (A1, A2).
2. **Where logging lives — inside the database.** New audit entries are
   written from Postgres functions/triggers, not client-side inserts —
   matching the existing pattern in `pack_allocation_request`,
   `cancel_allocation_packing`, and `confirm_checkout_form`. Every ❌ gap above
   that is currently plain client-side table access (B1, C3, D3's destination
   leg, E1–E4, F1, G1–G2, H1) will need its write path moved into (or wrapped
   by) a Postgres function as part of closing it. Table/column schemas for the
   audit entries themselves are intentionally deferred to a later pass.
3. **Read/report access — not needed.** This document covers state-changing
   actions only; viewing or exporting reports is out of scope.
4. **Edit granularity — record-level is enough.** For edits (C3, E2, F1),
   logging "record X was edited by Y at Z" with the record's before/after
   payload is sufficient for the first pass; no field-by-field diffing is
   required.

---

## 6. Proposed Schema (v1 — implemented)

> This section is the technical shape §1 said we'd defer. It's now
> implemented: `migrations/replace-audit-logs-with-audit-events.sql` creates
> the tables/RLS/helper functions below and re-points D1/D4/F2 at them;
> `migrations/wire-legacy-audit-writers-to-audit-events.sql` adds the
> narrow RPCs that wire B2/C1/C2/D2 to the same schema;
> `migrations/wire-auth-events-to-authenticate-user-by-key.sql` wires A1/A2
> into `authenticate_user_by_key` and adds the request-context helpers that
> populate `ip_address`/`user_agent`. Still a v1 — expect further iteration
> as B1, C3, E1–E4, F1, G1–G2, H1 get closed.

### 6.1 Why the current `audit_logs` table won't carry this

The existing table is:

```sql
CREATE TABLE public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id     uuid REFERENCES public.users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  old_values  jsonb,
  new_values  jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz DEFAULT now()
);
```

Four concrete problems, each traceable to a specific gap above:

1. **No room for a failed login (A2).** `entity_id` is `NOT NULL`, but a
   failed login attempt updates no row — there's no entity to point at. And
   the actor isn't a real user yet — `user_id` needs to record *what was
   attempted* (login key / role / cloud kitchen), which isn't a "user"
   relationship at all. Trying to force A1 and A2 into the same shape is
   what's actually driving the need for a new table, not just new columns.
2. **Cloud-kitchen scoping is reconstructed, not stored.** Today's RLS policy
   (`migrations/audit-logs-rls-policies.sql`) has to `EXISTS`-join out to
   `inventory`, `stock_in`, `allocation_requests`, or `stock_out` *by
   `entity_type`* just to answer "does this row belong to this PM's kitchen."
   Every new `entity_type` this document adds (`checkout_form`,
   `dispatch_plan`, `raw_materials`, an auth event with no entity at all)
   needs its own new branch in that policy forever. Every audited action in
   §3 already happens against a row that has `cloud_kitchen_id` on it
   (confirmed: `allocation_requests`, `stock_in`, `stock_in_batches`,
   `stock_out`, `inventory` all carry it directly) — there's no reason not to
   copy it onto the audit row itself at write time.
3. **No way to say "this event is a reversal of that one."** D4 (cancel
   packing) and G2 (replace plan items) are both *reversals*, and §4 already
   flags reversals as the highest-risk category — but nothing links the
   cancel event back to the pack event it undoes, or a re-save back to the
   plan version it replaced. An admin reviewing a cancellation today has to
   manually find the matching original by timestamp/entity_id guesswork.
4. **No priority signal.** A2 (possible brute-force) and C1 (routine catalog
   create) land in the same table with nothing to tell an admin which rows
   are worth their attention first. §4's "real highest-priority gaps" list is
   knowledge that currently lives only in this document, not in the data.

### 6.2 Approach: one spine table, common columns pulled out of `jsonb`, one detail table for the one shape that's genuinely different

Rather than a table per audit area (A–H), which would mean 8 tables for what
is still fundamentally "who did what, to what, when" — a single **spine**
table (`audit_events`) with a handful of new *typed* columns (so RLS and
reporting can filter on real columns instead of parsing `jsonb`), plus
**one** satellite table for auth events, since A1/A2 are the one case that
doesn't have a normal actor or entity.

```sql
-- =====================================================
-- Spine table — replaces / extends audit_logs
-- =====================================================
CREATE TABLE public.audit_events (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),

  -- WHO (nullable together — see audit_auth_events for the no-actor case)
  actor_user_id     uuid REFERENCES public.users(id),
  actor_role        text,        -- role AT THE TIME of the action, not a live
                                  -- join to users.role (roles can change later)

  -- WHERE (pulled out of jsonb so RLS/reporting don't need per-entity joins)
  cloud_kitchen_id  uuid REFERENCES public.cloud_kitchens(id),
  outlet_id         uuid REFERENCES public.outlets(id),  -- null where n/a
                                                           -- (e.g. B1, C1-C3)

  -- WHAT
  category          text NOT NULL,  -- see §6.3 — maps to areas A-H
  action            text NOT NULL,  -- unchanged from today, e.g.
                                     -- 'requisition_packed', 'login_failed'
  entity_type       text,           -- nullable now (A1/A2 have none)
  entity_id         uuid,           -- nullable now (A1/A2 have none)

  -- LINKING RELATED EVENTS (new)
  correlation_id    uuid,           -- ties multi-row logical actions together
                                     -- e.g. D3's two legs, F1's chain of
                                     -- drafts + its final F2 confirm
  reversed_event_id uuid REFERENCES public.audit_events(id),
                                     -- explicit "this undoes that" link,
                                     -- e.g. D4 -> the D1 pack it cancels,
                                     -- G2 -> the G1 save it replaces

  -- PRIORITY (new)
  severity          text NOT NULL DEFAULT 'info',
                     -- 'info' | 'review' | 'critical' — see §6.3

  -- PAYLOAD (unchanged in spirit)
  old_values        jsonb,
  new_values        jsonb,

  -- CONTEXT (unchanged, but now actually populated — see §6.5)
  ip_address        inet,
  user_agent        text,
  session_id        uuid,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_cloud_kitchen ON audit_events(cloud_kitchen_id);
CREATE INDEX idx_audit_events_actor         ON audit_events(actor_user_id);
CREATE INDEX idx_audit_events_correlation   ON audit_events(correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_events_category      ON audit_events(category);
```

```sql
-- =====================================================
-- Satellite table — only for the one shape that doesn't fit the spine:
-- an authentication attempt has no valid actor and no entity.
-- =====================================================
CREATE TABLE public.audit_auth_events (
  id                       uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id                 uuid NOT NULL REFERENCES public.audit_events(id),

  attempted_login_key_hash text NOT NULL,  -- hash, never the raw key
  attempted_role           text,
  attempted_cloud_kitchen_id uuid REFERENCES public.cloud_kitchens(id),

  success                  boolean NOT NULL,
  resolved_user_id         uuid REFERENCES public.users(id),  -- null on failure
  failure_reason           text  -- e.g. 'no_matching_key', 'inactive_user'
);
```

Everything else (B–H) stays on the spine table alone — `old_values` /
`new_values` carry the item lists, quantities, and reasons exactly as the
existing RPCs already do; nothing about that payload shape needs to change.

### 6.3 `category` and `severity` — deriving them from §1's business-logic test

`category` is a direct restatement of the areas already used in §3, so
reporting can group by it without re-deriving anything:

| category | Areas | 
|---|---|
| `auth` | A1, A2 |
| `inventory_in` | B1, B2, D3 destination leg |
| `catalog` | C1, C2, C3 |
| `inventory_out` | D1, D2, D3 source leg |
| `reversal` | D4, E3, F1 deletes, G2 |
| `requisition` | E1, E2, E3, E4 |
| `checkout` | F1, F2 |
| `dispatch_plan` | G1, G2, H1 |

`severity` is a direct mapping of §1's 6-point test, so it's not a new
judgment call — just making the existing reasoning queryable:

- `critical` — criterion 3 (reversal/override) or 6 (auth failure): D4, E3,
  F1 deletes, G2, A2.
- `review` — criterion 1, 2, 4, or 5 (inventory/financial/reconciliation/lock):
  everything else that's a ❌ or ✅ in §2.
- `info` — anything purely additive with no financial or physical-stock
  effect. **A1 (successful login) is the one current item that qualifies**, and
  is deliberately logged at this level: it is the highest-volume event in the
  trail, so putting it in the review queue would bury the events that actually
  need attention. Every other item in §2 is `review` or `critical`.

### 6.4 What this fixes concretely

- **A2** now has a natural home (`audit_auth_events`) instead of being forced
  through `entity_id NOT NULL`.
- **RLS** collapses from "one `EXISTS` subquery per `entity_type`" to one
  check: `audit_events.cloud_kitchen_id = <acting PM's kitchen>` — no new
  branch needed as B1, C3, E1-E4, F1, G1-G2, H1 get wired up.
- **D3** (today's one "partial") becomes two rows sharing one
  `correlation_id` — reviewable as a matched pair instead of only the source
  leg being visible.
- **D4 / G2** (reversals) point at the event they reverse via
  `reversed_event_id`, instead of an admin having to guess which prior pack
  or plan-save a cancellation corresponds to.
- Admins get a **`severity` filter** to jump straight to "review" and
  "critical" rows instead of scrolling routine catalog creates alongside
  cancellations.

### 6.5 Open items for the next iteration

- ~~**Hash, don't store, the raw login key**~~ — **done.**
  `authenticate_user_by_key` hashes via `hash_login_key()` (sha256 of the
  normalized key) and only ever writes the digest. A `NULL` key is coalesced to
  `''` before hashing, because `hash_login_key(NULL)` is `NULL` and would
  otherwise violate `attempted_login_key_hash NOT NULL` and lose the audit row
  for that attempt entirely.
- **Who sets `severity`/`correlation_id`?** Cleanest is the same Postgres
  functions that already write the audit row today (`pack_allocation_request`
  etc.) and the new ones decision #2 calls for — not a trigger guessing after
  the fact, since the function already knows *why* it's logging.
- ~~**`ip_address`/`user_agent` are unused in practice**~~ — **resolved, and the
  answer was better than expected.** No frontend plumbing is needed: PostgREST
  exposes the inbound HTTP headers to SQL via
  `current_setting('request.headers')`, so the new `current_request_ip()` /
  `current_request_user_agent()` helpers read them server-side. `current_request_ip()`
  prefers `cf-connecting-ip` (Supabase fronts Postgres with Cloudflare), then
  the first hop of `x-forwarded-for`, then `x-real-ip`; both helpers return
  `NULL` rather than raising when called outside a request context (SQL editor,
  psql, migrations). Two caveats for whoever reads this data: **`x-forwarded-for`
  is client-supplied and therefore spoofable** — treat the IP as corroborating,
  not proof of origin — and these helpers are available to every future
  audited flow, not just auth, so B1/E1–E4/F1/G1–G2/H1 should populate them too.
  `session_id` remains unused: key-based logins have no server-side session
  object to reference.
- **A2 makes `audit_events` writable by unauthenticated callers.** This is
  inherent to logging failed logins, but worth stating plainly: anyone who can
  reach the `authenticate_user_by_key` endpoint can now cause audit rows to be
  written by submitting bad keys, with no rate limit in front of it. Acceptable
  at current scale (22 active key users, low traffic) and the alternative —
  not logging failures — defeats the point of A2. If it ever becomes a problem
  the fix is rate limiting at the edge, or collapsing repeated identical
  failures (same key hash + IP within N minutes) into a single row with a
  counter, rather than dropping the logging.
- **Retention/volume** — A1 now writes on every successful login, and once B1,
  E1-E4, F1, G1-G2, H1 all start writing, volume goes up substantially (every
  draft save in F1 alone). Not urgent yet, but partitioning `audit_events` by
  `created_at` month is the natural answer if it's ever needed.
- **`audit_logs` → `audit_events` migration path** itself (rename vs.
  new-table-plus-backfill vs. keeping `audit_logs` as a compatibility view)
  is a separate decision for whenever this is actually implemented — not
  addressed here.
