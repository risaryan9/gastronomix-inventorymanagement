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
  for the table/RLS/helper-function migration). **All twenty** action points now
  write to `audit_events`:
  - **F1/G1/G2/H1** — `save_checkout_draft()`, `save_dispatch_plan()` and
    `lock_dispatch_plan()`, in
    `migrations/wire-checkout-and-dispatch-plan-to-audit-events.sql`. These
    closed the last four gaps and, along the way, fixed a data-loss bug in the
    checkout draft save, centralised the business-day rule for `plan_date`, and
    added the status guards that neither the client nor RLS was enforcing (see
    §3.F1, §3.G1, §3.H1).
  - **E1–E4** — `save_allocation_request()` (create/edit/delete-lines) and
    `add_items_to_allocation_request()` (the PM's pre-pack additions), in
    `migrations/wire-requisitions-to-audit-events.sql`. The first replaces three
    near-identical client-side `confirmAllocation` implementations with one
    function, and centralises the business-day rule the three had disagreed on
    (see the callout under §3.E1 — the day boundary is 05:30 IST, deliberately).
  - **D3** — `receive_inter_cloud_transfer()`
    (`migrations/wire-inter-cloud-destination-leg-to-audit-events.sql`) owns the
    destination-side writes of an inter-cloud transfer and logs them against the
    destination kitchen, sharing a `correlation_id` with the source leg so the
    two halves are reviewable as a matched pair. Same migration re-points
    `log_self_stock_out` to stamp that correlation on the source side.
  - **B1/C3** — `finalize_stock_in()` and `set_raw_material_active()`
    (`migrations/wire-stock-in-and-catalog-status-to-audit-events.sql`) own
    their write paths outright: the stock-in header/inventory/batches, and the
    `is_active` flip, happen *inside* the function that logs them. Unlike the
    log-only RPCs below, the audit row cannot be skipped by a client that
    declines to ask for it.
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
  **Nothing is marked ❌ any more.** Every action point this document
  catalogued is audited; what's left is the follow-on work in §6.5, not gaps in
  coverage.

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
| B1 | Stock-In finalize (receive stock) | purchase_manager | Inventory In | ✅ |
| B2 | Manual inventory adjustment (increment/decrement) | purchase_manager | Inventory In | ✅ |
| C1 | Create raw material | purchase_manager | Catalog | ✅ |
| C2 | Edit raw material (incl. cost) | purchase_manager | Catalog | ✅ |
| C3 | Deactivate / reactivate raw material | admin in UI (see §3.C) | Catalog | ✅ |
| D1 | Regular stock-out / pack requisition (deduct inventory) | purchase_manager | Stock Out | ✅ |
| D2 | Self stock-out (wastage / adjust / dispatch / R&D) | purchase_manager | Stock Out | ✅ |
| D3 | Inter-cloud-kitchen transfer — destination leg | purchase_manager | Stock Out | ✅ |
| D4 | Cancel allocation packing (reverse FIFO) | purchase_manager | Stock Out | ✅ |
| E1 | Create allocation request (requisition) | supervisor, bp_operator, PM | Requisitions | ✅ |
| E2 | Edit allocation request items/quantities | supervisor, bp_operator, PM | Requisitions | ✅ |
| E3 | Delete allocation request items | supervisor, bp_operator, PM | Requisitions | ✅ |
| E4 | PM adds an item to a supervisor's requisition (pre-pack) | purchase_manager | Requisitions | ✅ |
| F1 | Save checkout/closing draft (returns, wastage, extra consumption) | supervisor | Checkout | ✅ |
| F2 | Confirm/lock checkout form | supervisor | Checkout | ✅ |
| G1 | Create/save dispatch plan + items | dispatch_executive | Dispatch Plan | ✅ |
| G2 | Delete/replace dispatch plan items | dispatch_executive | Dispatch Plan | ✅ |
| H1 | Confirm & lock dispatch plan | kitchen_executive | Kitchen | ✅ |

**20 audited, 0 partial, 0 gaps** across 20 action points — the catalogue is complete.

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
  now makes a single `finalize_stock_in` RPC call
  (`migrations/wire-stock-in-and-catalog-status-to-audit-events.sql`) in place
  of the three separate client inserts it used to run. The RPC creates the
  `stock_in` header, the `inventory` rows and the `stock_in_batches`, and logs —
  `action: 'stock_in_received'`, `category: 'inventory_in'`, `severity:
  'review'`, with supplier, invoice number, per-item unit cost and GST in
  `new_values`, not just a total.
- **Why audit:** This is the single largest *inbound* value event. It raises
  physical stock **and** sets the cost basis (unit cost, GST, supplier, invoice
  number) that later drives every FIFO cost calculation and outlet cost report.
  Inflated quantities, wrong costs, or fake suppliers are classic procurement
  fraud vectors. Management must be able to see who received what, at what cost,
  against which invoice. **Now logged**, at the granularity that reason
  demands.
- **Status:** ✅ Audited, DB-side.
- **Two bugs closed on the way in**, both consequences of the flow having been
  three unrelated client calls:
  1. **It was not atomic.** A failure on the batches insert left an orphaned
     `stock_in` header — a receipt carrying a cost, a supplier and an invoice
     number, but no stock and no batches — and the code simply threw. All three
     writes now commit or roll back together.
  2. **The header total could disagree with the batches.** `total_cost` was
     computed from the GST typed into the form, but the batch was written with
     `gst_percent = 0` whenever `stock_in_type = 'kitchen'`. GST is now
     normalized once, server-side, and both the stored batch and the total are
     derived from that same value. `calculateTotalCost()` survives in the
     frontend as the live form preview only — it is no longer what gets stored.
- **Note:** the RPC accepts only `stock_in_type` `purchase` or `kitchen`. The
  other two valid values — `inter_cloud` (D3's destination leg) and
  `manual_inventory` (B2) — are minted by their own flows with their own audit
  entries, and this function must not become a second way to produce them.
- **Note:** the invoice image is still uploaded to storage by the client
  *before* the RPC runs, so a failure can leave an unreferenced file in the
  bucket. That was already true and is unchanged.

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
- **What happens:** a material is soft-deleted (`is_active = false`) or restored
  (`is_active = true`) from the edit modal.
- **Where:** `Materials.jsx` inline modal buttons, both of which now call the
  `set_raw_material_active` RPC
  (`migrations/wire-stock-in-and-catalog-status-to-audit-events.sql`) instead of
  updating `raw_materials` directly — `category: 'catalog'`, `action:
  'deactivate'` / `'reactivate'`, `severity: 'critical'`, with the before/after
  `is_active` plus the material's name/code/unit.
- **Why audit:** Deactivating a material hides it from allocation and reporting —
  a way to make an item "disappear" without deleting its history.
- **Status:** ✅ Audited, DB-side.
- **Unlike C1/C2, the write path itself moved server-side.** C1/C2 kept their
  client-side insert/update and call a log-only RPC afterwards, which a client
  can simply decline to call. `set_raw_material_active` owns the `is_active`
  flip, so there is no way to perform the action without producing the audit
  row. C1/C2 are candidates for the same treatment later.
- **Idempotent by design:** if the material is already in the requested state
  the RPC returns `changed: false` and writes nothing, so a double-clicked
  confirm button can't produce two identical "deactivated" rows that read as two
  separate decisions.
- **Severity is `critical`, not `review`.** §1's criterion 3 names
  "re-activations" outright as a reverse/override, and §6.3 maps criterion 3 to
  critical. Both directions are rare, so neither crowds the review queue.

> **⚠️ Scope correction for all of section C.** This document lists C1/C2/C3 as
> `purchase_manager` actions. **They are not.** In `Materials.jsx`, `handleAddNew`
> (C1), `handleEdit` (C2) and both the deactivate and reactivate modals are all
> gated on `isAdminMode`, and the PM route (`App.jsx` → `<Materials />`) leaves
> `isAdminMode` at its default of `false`. A purchase manager sees the Materials
> screen **read-only**; every catalog write in the UI today is an Admin action,
> which §1 would otherwise put out of scope.
>
> C3 was still worth closing, because **that gate is cosmetic**. The UPDATE
> policy on `raw_materials` is `is_purchase_manager_or_admin()`, and that
> function ends in `RETURN true` for anon — and *every* key-based login is anon.
> So any key holder, of any role, can flip `is_active` with a direct API call
> regardless of what the UI shows them. That is exactly the "the application is
> the only gate" exposure §1 gives as the reason to audit key-based roles at
> all. See §4 for the general form of this problem.

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
- **Where:** `StockOut.jsx`'s inter-cloud branch now makes a single
  `receive_inter_cloud_transfer` RPC call
  (`migrations/wire-inter-cloud-destination-leg-to-audit-events.sql`) in place
  of the destination-side inserts it used to run. The RPC creates the
  destination `stock_in` + `stock_in_batches` + `inventory` rows and logs —
  `action: 'inter_cloud_transfer_received'`, `category: 'inventory_in'`,
  `severity: 'review'`, on the **destination** kitchen.
- **Why audit:** Value crosses an organizational boundary (kitchen A → kitchen
  B) and **mints new inventory and cost at a second kitchen**. Because it's
  cross-kitchen and high value, both legs should be reviewable as a matched
  pair. **Now logged**, and paired.
- **Status:** ✅ Audited, DB-side. *(This was the document's last ⚠️.)*
- **How the pair is tied together.** Both legs derive `correlation_id`
  deterministically as **the source `stock_out`'s id**. Neither side needs a
  client-generated UUID and neither needs to run first — each already knows
  that id, so each reaches the same answer independently. Only inter-cloud
  self-stock-outs are stamped; wastage / R&D / dispatch have no second leg, and
  correlating them would pollute the partial index on `correlation_id` for no
  benefit. Closing this needed **no frontend change to the source leg** —
  `log_self_stock_out` already receives both `p_stock_out_id` and `p_reason`,
  so it derives the correlation itself and keeps its exact signature.
- **The RPC can't be used to mint stock anywhere else.** Both kitchens are read
  off the source `stock_out` row rather than accepted as parameters, and the
  function rejects any stock-out that isn't a genuine inter-cloud transfer. The
  caller supplies only the per-item FIFO cost, which is the one fact the
  destination side cannot recompute (the source batches are already spent by
  then). It is also **idempotent on `source_stock_out_id`** — a retry returns
  `created: false` rather than minting the inventory a second time.
- **Known gap, unchanged by this:** the source FIFO consume and the destination
  mint are still separate client calls with no transaction spanning them, so a
  hard failure of the destination call consumes stock at the source that never
  arrives at the destination. It predates this work and isn't made worse by it —
  and the idempotency guard now makes the natural fix, retrying the destination
  call, safe. Closing it properly means folding both legs into one RPC, which
  would rewrite D2's already-audited path.
- **Not backfilled.** The 20 transfers predating this migration have no
  destination event, and their source legs predate the `correlation_id` stamp,
  so they show a single uncorrelated source event. Reconstructing them was
  possible (all 20 have `stock_in.source_stock_out_id` intact) but deliberately
  skipped: an audit trail is a contemporaneous record, and rows written long
  after the fact make the table's history look like it was always there.

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
  accountable. Over-requesting is the first step in diversion. **Now logged** —
  `action: 'requisition_created'`, `category: 'requisition'`, `severity:
  'review'`, with the full item list in `new_values`.
- **Status:** ✅ Audited, DB-side.
- **All three entry points now call one function.** `save_allocation_request`
  (`migrations/wire-requisitions-to-audit-events.sql`) replaces the three
  near-identical `confirmAllocation` implementations, which had drifted from
  each other. It handles create *and* edit, because that is one user action —
  the modal decides which based on whether a request already exists.
- **It also enforces one requisition per outlet per day.** Each page checked a
  weaker version of this in JS (packed requests only), and no unique constraint
  backs it. The rule is now real. Data was clean when this shipped — 0 duplicate
  outlet/day pairs across 145 requests — so nothing needed reconciling.

> **📅 `request_date` is now decided in one place — and that place uses UTC on
> purpose. Read this before "fixing" it.**
>
> The three pages disagreed: `OutletsPageBase` used browser-local time, both
> `OutletDetails` pages used `toISOString()` — UTC. `request_date` is now
> derived server-side by `public.business_today()`, so all three agree and none
> can drift again.
>
> **That helper deliberately returns the UTC date, which puts the day boundary
> at 05:30 IST rather than midnight.** This looks wrong and is not.
>
> It was briefly changed to `(now() AT TIME ZONE 'Asia/Kolkata')::date` on the
> reasoning that the business is in India, so IST must be right. That broke a
> real workflow and had to be reverted
> (`migrations/revert-business-day-to-utc.sql`). A late shift routinely works
> past midnight, and that work belongs to the day it started. Under IST, a
> dispatch plan locked at 10:00 and a closing form filed at 00:30 the next
> morning land on different days, and the supervisor is told **"No locked
> dispatch plan found for today"** with no way through. See §3.G1 and §3.H1 —
> the kitchen executive was blocked the same way.
>
> This is routine traffic: **20 records were created in the midnight hour alone**
> (6 stock-outs, 4 stock-ins, 10 requisitions), plus more at 01:00 and 04:00 IST.
>
> The honest version of this rule is "the business day starts at 06:00 IST";
> UTC approximates it at 05:30. If that ever needs to be exact, change
> `business_today()` **and** `getBusinessDate()` in
> `frontend/src/lib/businessDate.js` together — records written under one
> definition and searched for under another is precisely the failure above.

#### E2 — Edit allocation request items / quantities
- **What happens:** The same `confirmAllocation` flows, when editing an existing
  request, **update** item quantities (and the request header).
- **Where:** `OutletsPageBase.jsx` update path (~line 509 header, 548 item qty);
  `supervisor/OutletDetails.jsx` (~line 300 header, 373 item qty);
  `purchase-manager/OutletDetails.jsx` (~line 303 header, 375 item qty).
- **Why audit:** Editing a requisition **after** it was created changes the
  authorized amounts — potentially after stock has been discussed or partially
  planned. **Now logged** — `action: 'requisition_updated'`, `category:
  'requisition'`, `severity: 'review'`, carrying the whole item list before and
  after, per decision #4's record-level granularity.
- **Status:** ✅ Audited, DB-side.
- **A no-op edit writes nothing.** Re-opening a requisition and pressing Confirm
  without changing anything returns `changed: false` and produces no audit row —
  that isn't a decision anyone needs to review.
- **Quantity comparison is now exact.** The client compared quantities with a
  `0.0001` tolerance to work around JS float error. Server-side these are
  `numeric`, so `IS DISTINCT FROM` is exact — and numeric equality ignores
  trailing zeros, so `5.0` vs `5.00` still counts as unchanged.

#### E3 — Delete allocation request items
- **What happens:** During an edit, removed line items are **deleted** from
  `allocation_request_items`.
- **Where:** `OutletsPageBase.jsx` (~line 556); `supervisor/OutletDetails.jsx`
  (~line 390); `purchase-manager/OutletDetails.jsx` (~line 392).
- **Why audit:** Deleting a requested line erases evidence of what was originally
  asked for. Deletions of authorization records should always be logged.
  **Now logged.**
- **Status:** ✅ Audited, DB-side.
- **Deletions get their own event, deliberately.** An edit that removes lines
  writes *two* rows: the `requisition_updated` above, plus
  `requisition_items_deleted` at `category: 'reversal'`, `severity: 'critical'`
  — the classification §6.3 gives E3. They share a `correlation_id` (the request
  id) so the pair is linkable. Folding the deletion into the edit row would have
  buried a critical action inside a routine one; a separate row means it surfaces
  in the critical queue on its own. Only correlated when a deletion actually
  happened, so the partial index on `correlation_id` stays meaningful.
- The removed lines are snapshotted into `old_values` **before** the delete runs,
  the same reason `cancel_allocation_packing` does it: the audit row has to
  outlive the rows it describes.

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
  moment. **Now logged** — `action: 'requisition_items_added_by_pm'`, `category:
  'requisition'`, `severity: 'review'`, recording the added lines alongside the
  `requested_by` and `supervisor_name` of the person whose request was widened.
- **Status:** ✅ Audited, DB-side.
- **A separate RPC from E1–E3, not the same one.** The doc offered either; a
  dedicated `add_items_to_allocation_request` won because the semantics differ.
  `save_allocation_request` **replaces** the item set from the outlet's own
  screen; this one **appends** from the PM's packing modal. Giving it its own
  action name is the whole point — "the PM widened someone else's request after
  they submitted it" has to stay distinguishable from a supervisor editing their
  own.

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
- **Where:** `Checkout.jsx` → `handleSaveDraft` now makes a single
  `save_checkout_draft` RPC call
  (`migrations/wire-checkout-and-dispatch-plan-to-audit-events.sql`) in place of
  the up-to-seven separate client calls it used to run — `action:
  'checkout_draft_created'` / `'checkout_draft_updated'`, `category:
  'checkout'`, `severity: 'review'`, with the full return/wastage/additional
  breakdown before *and* after.
- **Why audit:** **Wastage and returns are the primary loss/shrinkage numbers.**
  They directly affect how an outlet is evaluated and are the easiest figures to
  fudge (under-report returns, over-report wastage). A supervisor can save a
  draft multiple times before confirming. **Every save is now captured**,
  including the delete-then-reinsert churn, with the per-item detail F2 never
  had.
- **Status:** ✅ Audited, DB-side.
- **Every draft save shares a `correlation_id`** (the checkout form's id), so
  the chain of drafts and the final F2 confirm are reviewable as one sequence —
  the exact case §6.2 named when the column was designed.
- **🐛 A data-loss bug fixed here.** The old flow was: update the form, delete
  the returns, delete the wastage, delete the additional, then re-insert all
  three. No transaction spanned them, **and the three deletes never checked
  their error result.** A failure between the deletes and the re-inserts wiped
  the supervisor's previously saved figures with nothing written back — silent
  loss of precisely the numbers this section calls the primary shrinkage
  figures. It is now all-or-nothing.
- **A confirmed form can no longer be edited.** `handleSaveDraft` set
  `status: 'draft'` unconditionally, and the only thing stopping it running on a
  confirmed form was the UI hiding the button (`Checkout.jsx` ~line 913).
  Nothing in RLS enforced it (see §4). F2 no longer creates a `stock_in` (see
  `docs/decisions/0010-dispatch-and-closing-do-not-move-stock.md`), but the lock
  still holds for a better reason: a purchase manager will have keyed stock
  against these figures by hand, and numbers that move after someone has acted
  on them are worse than numbers that cannot be corrected. The RPC refuses.

#### F2 — Confirm / lock checkout form
- **What happens:** Supervisor finalizes the closing via the
  `confirm_checkout_form` RPC: it validates the dispatch plan is locked and
  within a 24-hour window, totals the returned quantities, and marks the
  checkout form `confirmed`. **It does not move stock** — see
  `migrations/stop-checkout-confirm-from-creating-stock-in.sql`. It used to
  create a `stock_in` + batches from the returns; the purchase manager now
  records that movement by hand.
- **Where:** `Checkout.jsx` → `handleFinalConfirm` (RPC ~line 455/460); the RPC
  itself originally defined in `migrations/create-confirm-checkout-function.sql`,
  re-pointed at `audit_events` via `log_audit_event()` in
  `migrations/replace-audit-logs-with-audit-events.sql` (`action:
  'checkout_confirmed'`, `category: 'checkout'`, recording
  `total_returned_qty`; `stock_in_id` was dropped when the stock movement was).
- **Why audit:** Confirmation is the point the numbers become "official" for
  the day and the sheet closes to edits. **Already logged.** Note it captures the finalized totals only — the underlying
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
- **Where:** `DispatchExecutiveDashboard.jsx` → `handleSaveDispatchPlan` now
  makes a single `save_dispatch_plan` RPC call
  (`migrations/wire-checkout-and-dispatch-plan-to-audit-events.sql`) —
  `action: 'dispatch_plan_created'` / `'dispatch_plan_updated'`, `category:
  'dispatch_plan'`, `severity: 'review'`, with the full item list.
- **Why audit:** The dispatch plan is the **production/dispatch authorization** —
  it commits kitchen capacity and stock. Changing planned quantities has direct
  downstream inventory and cost impact, so the author and the numbers should be
  on record. **Now logged.**
- **Status:** ✅ Audited, DB-side.
- **`plan_date` is decided server-side by `public.business_today()`**, the same
  helper `save_allocation_request` uses, so a plan and a requisition can never
  disagree about what day it is. That matters here specifically: `checkout_form`
  finds its dispatch plan **by date**, so any drift between the two breaks the
  closing flow outright.
- **⚠️ Do not switch this to IST.** It was, briefly, and it blocked the late
  shift: a plan locked at 10:00 IST could not be closed against at 00:30 the
  next morning, because the plan was dated the 29th and the closing screen asked
  for the 30th. Reverted in `migrations/revert-business-day-to-utc.sql`. The
  full reasoning is in the callout under §3.E1 — read it before changing the
  day boundary.
- **The edit race is actually closed now.** The client checked `status = 'draft'`
  twice before mutating items, with a comment conceding it only "reduces race
  with kitchen lock". The RPC takes `FOR UPDATE` on the plan row and checks
  status inside the same transaction, so a concurrent lock must wait and one of
  the two loses cleanly.

#### G2 — Delete / replace dispatch plan items
- **What happens:** Re-saving a plan **deletes** existing `dispatch_plan_items`
  and inserts the new set.
- **Where:** `DispatchExecutiveDashboard.jsx` (~line 790 delete, 805 re-insert).
- **Why audit:** A full replace silently discards the previous plan. Without a
  log there's no way to see a plan was revised or by how much. This is the
  same reversal/overwrite risk category as D4 and E3. **Now logged.**
- **Status:** ✅ Audited, DB-side.
- **The replace gets its own critical event**, exactly as E3's deletions do: a
  re-save writes `dispatch_plan_updated` (dispatch_plan/review) *and*
  `dispatch_plan_items_replaced` (`category: 'reversal'`, `severity:
  'critical'`) carrying the discarded plan in `old_values`. They share a
  `correlation_id`, and the reversal row sets **`reversed_event_id`** pointing
  at the previous save it overwrites — the use §6.1 imagined for that column
  when it named "G2 → the G1 save it replaces".

---

### H. Kitchen Execution (Kitchen Executive)

#### H1 — Confirm & lock dispatch plan
- **What happens:** Kitchen executive adjusts final `dispatch_plan_items` and
  sets the `dispatch_plan` to a confirmed/locked state.
- **Where:** `frontend/src/pages/KitchenExecutiveDashboard.jsx` →
  `handleConfirmLock` (~line 420; items delete 451 / insert 465; plan update 472).
- **Where:** `KitchenExecutiveDashboard.jsx` → `handleConfirmLock` now makes a
  single `lock_dispatch_plan` RPC call
  (`migrations/wire-checkout-and-dispatch-plan-to-audit-events.sql`) —
  `action: 'dispatch_plan_locked'`, `category: 'dispatch_plan'`, `severity:
  'review'`, with the plan's items before and after the lock.
- **Why audit:** Locking is the **hand-off from planning to execution** — after
  this, the plan is treated as final for production and stock movement. Who
  locked it, when, and what the final quantities were is a decision management
  needs to reconstruct. **Now logged.**
- **Status:** ✅ Audited, DB-side.
- **It records whether the kitchen changed the numbers.** The event carries
  `quantities_changed_by_kitchen`, computed by comparing the dispatch
  executive's items against the kitchen's final set. That is the single most
  interesting fact about a lock — "the kitchen quietly cut outlet X's order"
  is now answerable with a filter instead of by diffing two payloads by hand.
- **⚠️ It checked nothing before locking.** `handleConfirmLock` deleted the
  items, re-inserted, and set `status = 'locked'` regardless of the plan's
  current state — and nothing in RLS constrained it either (see §4). Locking an
  already-locked plan silently overwrote the quantities the kitchen was already
  working to, *after* `confirm_checkout_form` had begun trusting them (it
  requires `status = 'locked'` and reads `locked_at` for its 24-hour window).
  The RPC now refuses unless the plan is still a draft. Note the dispatch side
  was already defending against this exact race from its end — its comment
  named "race with kitchen lock" — while the kitchen side had no guard at all.

---

## 4. Cross-Cutting Notes

- **Where the codebase already does this well, it does it very well.** The
  three existing RPCs (`pack_allocation_request`, `cancel_allocation_packing`,
  `confirm_checkout_form`) are the model to copy: acting user id passed in
  explicitly, a `SECURITY DEFINER` function that can't be bypassed by the
  calling role, and — in `cancel_allocation_packing`'s case — a full snapshot
  taken *before* a hard delete specifically so the audit trail survives it.
  Every new gap closed under decision #2 should follow this same shape.
  *Caveat learned the hard way:* "can't be bypassed" holds only if the function
  grants are actually right. The two internal-only helpers behind all of this
  were callable by `anon` for months because their `REVOKE` was written against
  `PUBLIC` instead of by name — see the first bullet in §6.5.
- **Real highest-priority gaps, after correcting the RPC findings above:**
  1. ~~**Auth (A1/A2)**~~ — **closed.** Was the foundation gap: every other
     audit entry's value depends on being able to trace it back to a login
     event. `authenticate_user_by_key` now logs both outcomes (see §3.A).
  2. ~~**Requisition create/edit/delete/PM-add (E1–E4)**~~ — **closed.** The
     authorizing document for essentially all outbound stock is now logged
     across all three page entry points, including the PM's own after-the-fact
     additions.
  3. ~~**Checkout draft save (F1)**~~ — **closed.** Every draft save is logged
     with its per-item return/wastage/additional breakdown, correlated to the
     final confirm.
  4. ~~**Stock-in receiving (B1)**~~ — **closed.** The largest inbound financial
     event (quantity + cost + supplier + invoice) is now logged in full by
     `finalize_stock_in()`.
  5. ~~**Dispatch planning (G1/G2) and kitchen lock (H1)**~~ — **closed.** The
     whole plan → lock → checkout chain is now audited end to end, not just at
     its final step.

  **All five are closed. Every action point in §2 is ✅.** What remains is not
  gaps in the catalogue but the follow-on work listed in §6.5 — chiefly the
  read/report side (decision #3 deferred it) and the RLS concerns below, which
  are security issues this document surfaced rather than audit gaps.
- **Reversals & deletes remain the highest-risk category in general** — now
  fully covered: D4 (cancel packing), E3 (delete request lines), F1's
  delete-then-reinsert churn, and G2 (replace plan items) each write a
  `reversal`-category row at `critical` severity, carrying a snapshot taken
  before the rows disappear.
- **⚠️ Moving a write server-side can silently *remove* a security guard —
  found while closing E1–E4.** `allocation_request_items` has INSERT, UPDATE and
  DELETE policies that all require the parent request to have
  `is_packed = false`. A `SECURITY DEFINER` function owned by `postgres`
  bypasses RLS entirely, so wrapping those writes in an RPC would have quietly
  dropped the only thing stopping an already-packed requisition from being
  edited — after stock has physically left against a fixed item list. Both new
  functions re-assert `is_packed = false` in their own logic. **Any future gap
  closed this way must check what RLS was doing for that table first**, and
  carry it across by hand.
  **Followed up for F1/G1–G2/H1, and the answer was the opposite one.** The
  `checkout_form_*` and `dispatch_plan*` policies are pure role and
  cloud-kitchen scoping — *none* encodes a status guard — so nothing was lost
  by moving those writes. But that means there was never any database-level
  protection against saving a draft over a **confirmed** checkout form, or
  editing and re-locking an **already-locked** dispatch plan. The only defences
  were in JavaScript, and `handleConfirmLock` had none at all. The three new
  functions enforce those rules server-side; see §3.F1, §3.G1 and §3.H1.
- ~~**D3's destination leg is the one remaining "partial."**~~ — **closed, and
  with it the last ⚠️ in this document.** Both legs of an inter-cloud transfer
  are now logged and share a `correlation_id`, so the pair is reviewable
  together instead of only the depleting half being visible. Every remaining
  item is a clean ✅ or ❌.
- **⚠️ Role gates in the UI are not role gates in the database — found while
  closing C3, but general.** Several RLS policies are written in terms of
  `is_purchase_manager_or_admin()`, and that function's final statement is
  `RETURN true` for anon sessions. Every key-based login *is* anon. The comment
  in the function is explicit that this is intentional — "application-level
  validation ensures only authorized users can access" — so the app's role
  checks are the only thing standing between any key holder and these tables.
  Concretely: the Materials screen hides catalog editing behind `isAdminMode`,
  but a supervisor's or bp_operator's key can still update `raw_materials`
  directly through the API. This is the same exposure §1 cites as the reason to
  audit key-based roles at all, and it is *why* auditing them is load-bearing
  rather than merely nice to have — the audit trail is currently the only
  after-the-fact control on these paths.
  **Not changed here.** `is_purchase_manager_or_admin()` guards `inventory`,
  `stock_in`, `raw_materials` and more, so tightening it is a systemic security
  change that deserves its own scoped pass, not a side effect of an audit
  ticket.
- **Out of scope by design:** all Admin pages
  (`AdminUsers`, `AdminOutlets`, `AdminVendors`, `AdminOperators`,
  `AdminServiceKits`, `AdminBrandDispatch`, `AdminFranchiseCloning`,
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
   that was plain client-side table access has since been closed exactly this
   way: B1 (`finalize_stock_in`), C3 (`set_raw_material_active`), D3's
   destination leg (`receive_inter_cloud_transfer`), E1–E4
   (`save_allocation_request`, `add_items_to_allocation_request`), F1
   (`save_checkout_draft`), G1–G2 (`save_dispatch_plan`) and H1
   (`lock_dispatch_plan`). **Decision #2 is fully carried out — no audited
   action is written from the client any more.** The one deliberate exception is
   the four narrow log-only RPCs behind B2/C1/C2/D2, where the business logic
   still runs client-side and only the audit write is server-side; those remain
   candidates for the stronger treatment.
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
> populate `ip_address`/`user_agent`;
> `migrations/wire-stock-in-and-catalog-status-to-audit-events.sql` adds
> `finalize_stock_in` (B1) and `set_raw_material_active` (C3), the first two
> functions to own their write path rather than just log alongside it;
> `migrations/wire-inter-cloud-destination-leg-to-audit-events.sql` adds
> `receive_inter_cloud_transfer` (D3) and is the first use of
> `correlation_id` in anger;
> `migrations/wire-requisitions-to-audit-events.sql` adds
> `save_allocation_request` and `add_items_to_allocation_request` (E1–E4);
> `migrations/wire-checkout-and-dispatch-plan-to-audit-events.sql` adds
> `save_checkout_draft` (F1), `save_dispatch_plan` (G1/G2) and
> `lock_dispatch_plan` (H1), closing the last four.
> `migrations/fix-internal-audit-helper-grants.sql` then makes the two internal
> helpers genuinely internal (see §6.5).
>
> **The schema survived all twenty action points without a single change** —
> no new column, no altered constraint, no RLS edit. Every design bet in §6.2
> paid off in practice: `correlation_id` (D3's two legs, E3's deletions, F1's
> draft chain, G2's replaces), `reversed_event_id` (D4, G2), `severity` as a
> triage filter, and `cloud_kitchen_id` on the row itself. Still nominally a
> v1, but it is now a v1 that has been fully exercised.

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
  F1 deletes, G2, A2, **and C3** — criterion 3 names "re-activations"
  explicitly, and a deactivation is the doc's own "make an item disappear
  without deleting its history". C3 was missing from this list only because it
  was still a gap when the list was written.
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
  check: `audit_events.cloud_kitchen_id = <acting PM's kitchen>`. **Fully borne
  out:** all twenty action points are now wired, introducing the `stock_in`,
  `raw_material`, `allocation_request`, `checkout_form` and `dispatch_plan`
  entity types (and, for auth, none at all) — and not one of them required an
  RLS change. Under the old `audit_logs` policy each would have needed its own
  new `EXISTS` branch.
- **D3** (formerly the one "partial") is now two rows sharing one
  `correlation_id` — reviewable as a matched pair instead of only the source
  leg being visible. **Shipped**, and it validated the column: the id is
  derived deterministically from the source `stock_out` on both sides, so
  neither leg had to coordinate with the other to produce it.
- **D4 / G2** (reversals) point at the event they reverse via
  `reversed_event_id`, instead of an admin having to guess which prior pack
  or plan-save a cancellation corresponds to. **Both shipped** —
  `cancel_allocation_packing` links back to the pack it undoes, and
  `dispatch_plan_items_replaced` links back to the plan save it overwrites,
  exactly as §6.1 predicted.
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
  psql, migrations). Caveat for whoever reads this data: **`x-forwarded-for`
  is client-supplied and therefore spoofable** — treat the IP as corroborating,
  not proof of origin. `current_request_ip()` prefers `cf-connecting-ip`, which
  Supabase's Cloudflare layer sets and a client cannot forge.
  **Now captured on every event, not just logins**
  (`migrations/capture-request-context-on-all-audit-events.sql`). Originally
  only `log_auth_event` was wired up, which left auth rows with an IP and all
  sixteen other flows without one — the wrong way round, since a login event is
  only useful as an anchor if the actions anchored to it record where they came
  from too. Only two functions insert into `audit_events` at all, so wiring the
  helpers into `log_audit_event` covered every remaining flow without touching a
  single caller. Rows written before that migration keep a NULL IP and are
  deliberately not backfilled — inventing request context for past events would
  be fabricating evidence.
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
- **The "internal only" helpers were not actually internal — fixed in
  `migrations/fix-internal-audit-helper-grants.sql`.** `log_audit_event()` and
  `log_auth_event()` are both documented as callable only from inside another
  `SECURITY DEFINER` function, and both creating migrations end with a
  `REVOKE ... FROM PUBLIC` meant to enforce that. **Neither revoke did
  anything.** `REVOKE ... FROM PUBLIC` only strips the implicit privilege held
  via `PUBLIC`; this database has `ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`, so both
  functions were granted to those roles *by name* at creation and the revoke
  missed them entirely. Since the anon key ships in the frontend bundle, anyone
  holding it could call `log_audit_event()` with arbitrary arguments and forge
  audit rows with any actor, category, action or severity — or fabricate
  `login_success` entries via `log_auth_event()`. The follow-up migration
  revokes both by name. **Note for future work:** `CREATE OR REPLACE` preserves
  the ACL, but `DROP` + `CREATE` re-applies the default grants and silently
  re-opens this — which is exactly how it happened, when A1/A2's migration had
  to drop `log_auth_event` to add a parameter.
- **Retention/volume** — A1 now writes on every successful login, and once
  E1-E4, F1, G1-G2, H1 all start writing, volume goes up substantially (every
  draft save in F1 alone). Not urgent yet, but partitioning `audit_events` by
  `created_at` month is the natural answer if it's ever needed. Now that all
  twenty points write, this is closer than it was — F1 alone writes on every
  draft save.
- **`audit_logs` → `audit_events` migration path** itself (rename vs.
  new-table-plus-backfill vs. keeping `audit_logs` as a compatibility view)
  is a separate decision for whenever this is actually implemented — not
  addressed here.
