# FOFO dashboard — build specification

**Status:** design settled. The database is built — `migrations/fofo/` 01–11,
applied to the live database on 2026-09-13, including 10 (franchise users in the
audit trail) and 11 (onboarding: welcome email and registration links). The partner app on Vercel has a health check and a tested
Razorpay webhook check; the accept function, invoice numbering, API endpoints
and screens are not built yet.

This is the single document to read before writing any FOFO code. The early
ideation notes and Q&A it was distilled from have been removed: several of
their answers were later reversed (bank refunds, all-or-nothing store credit,
manual stock-out on accept), and this document records the settled version.

**Contents**

1. [What is being built](#1-what-is-being-built)
2. [Words that are easy to confuse](#2-words-that-are-easy-to-confuse)
3. [The system this plugs into](#3-the-system-this-plugs-into)
4. [Architecture](#4-architecture)
5. [The BOM feature (prerequisite)](#5-the-bom-feature-prerequisite)
6. [How a price is built](#6-how-a-price-is-built)
7. [Data model](#7-data-model)
8. [Flows](#8-flows)
9. [Order state machine](#9-order-state-machine)
10. [Money documents](#10-money-documents)
11. [Security rules](#11-security-rules)
12. [API surface](#12-api-surface)
13. [Build order](#13-build-order)
14. [Things that look like bugs and are not](#14-things-that-look-like-bugs-and-are-not)
15. [Deliberately not built](#15-deliberately-not-built)

---

## 1. What is being built

Gastronomix runs two franchise models:

- **FOCO** — franchise owned, **company** operated. The company runs the outlet.
  These franchisees already have a dashboard; it only *shows* analytics and
  sales. It is read-only and is not touched by this project.
- **FOFO** — franchise owned, **franchise** operated. The franchisee runs their
  own outlet and **buys supplies from Gastronomix**.

This project builds the FOFO dashboard: a web app on its own domain where a
franchisee browses a catalogue of materials, builds a cart, pays by Razorpay,
and tracks the order until it ships. Refunds come back as store credit.

The internal half — a purchase manager accepting orders, a kitchen executive
packing them — is built **inside the existing internal app**, not the new one.

**Why this is riskier than it looks.** The FOCO dashboard reads data. This one
takes money, moves stock, and issues GST documents. Most of the care in this
spec comes from that difference.

---

## 2. Words that are easy to confuse

| Term | Meaning |
|---|---|
| **Cloud kitchen** | A production site (`cloud_kitchens`). Holds inventory. Staff belong to one. |
| **Outlet** | A storefront (`outlets`). Belongs to exactly one cloud kitchen via `cloud_kitchen_id`. |
| **Serving kitchen** | The cloud kitchen of the outlet an order is for. Decides price and stock. |
| **Brand** | Boom Pizza (BP), El Chaapo (EC), Nippu Kodi (NK). Derived from the first two characters of an outlet code (`EC1026` → `EC`). |
| **Service kit** (`service_kits`) | What goes out *alongside* a finished product — the butter it is cooked in, the chutney on the plate. A **packing rule**. Auto-fills a dispatch plan. **Not a recipe.** |
| **Recipe / BOM** (`recipes`, new) | What a product is **made of**. Feeds the cost roll-up. This is the new feature in section 5. |
| **Requisitionable** | Whether one of *our* outlets may ask for a material internally. Nothing to do with FOFO. |
| **FOFO sellable** | Whether we may sell a material to a third party for money. |

> Decision [0012](decisions/0012-service-kits-are-not-bills-of-materials.md)
> renamed `recipes` → `service_kits` specifically so the BOM could take the word
> "recipe". Read it before touching either. Wiring the wrong table into a cost
> calculation is the failure it was written to prevent.

---

## 3. The system this plugs into

### Tables you will read from

| Table | Notes |
|---|---|
| `raw_materials` | The catalogue. `material_type` is `raw_material` / `semi_finished` / `finished` / `non_food`. `brand_codes` is a text array; **NULL means all brands**, and `'ip'` means internal production (never sellable). |
| `outlets` | `code`, `cloud_kitchen_id`, `name`. Brand comes from `code[0:2]`. |
| `cloud_kitchens` | Production sites. |
| `inventory` | Per (material, kitchen) quantity. **Derived** — a trigger keeps it in sync with the sum of batch remainders. Never write to it directly. |
| `stock_in_batches` | The real source of stock and cost: `quantity_remaining`, `unit_cost` (ex-GST), `gst_percent`, `cloud_kitchen_id`, `created_at`. |
| `stock_out`, `stock_out_items` | Stock leaving a kitchen. |
| `stock_out_batch_consumption` | Which batches a stock-out ate. Makes stock-outs reversible. |
| `users` | Staff only. `role` is one of `supervisor`, `purchase_manager`, `admin`, `dispatch_executive`, `kitchen_executive`, `bp_operator`. **FOFO franchisees are not in this table.** |
| `audit_events` | Written only by `SECURITY DEFINER` functions. |

### Functions to copy rather than reinvent

- **`fifo_consume(p_stock_out_id, p_raw_material_id, p_quantity, p_cloud_kitchen_id)`**
  — decrements oldest batches first, locks them `FOR UPDATE` so two callers
  cannot double-spend, logs every batch touched, and **raises** if short:
  `Insufficient stock for material %. Short by % units`. Inventory can never go
  negative. FOFO stock-out uses this as-is.
- **`pack_allocation_request(...)`** — the atomic pattern: create the stock-out,
  consume FIFO, flip the status, write the audit event, all in one transaction.
  The FOFO accept RPC should be shaped exactly like it.

### Front-end modules to read from, not re-implement

- **`frontend/src/lib/inventoryValuation.js`** — `gstInclusiveUnitCost(batch)`,
  `BATCH_VALUATION_COLUMNS`, `onlyActiveMaterials(query)`. The GST-inclusive
  unit cost is the **base for FOFO pricing** (section 6).
- **`frontend/src/lib/businessDate.js`** — "today" is the **UTC** date on
  purpose (decision 0002).
- **`frontend/src/lib/pdfCurrency.js`** — `₹` cannot be rendered by jsPDF
  (decision 0007). Screen, CSV and Excel use `₹`; PDFs go through this module.
- **`frontend/src/lib/adminKitchenDetail.js`** — `brandForOutletCode(code)`,
  the existing "first two characters" rule.

### How the internal app talks to the database today

There is **no backend**. `frontend/src/lib/supabase.js` creates a `supabase-js`
client with the anon key, and roughly 216 `.from(...)` and 21 `.rpc(...)` calls
go straight to PostgREST. Rules are enforced by RLS and by `SECURITY DEFINER`
functions, not by any server code.

Two consequences that shape this whole project:

1. **The anon key is public** — it ships inside the JavaScript bundle.
2. **Costs and stock are readable by anyone holding it.** Verified against the
   live database: `stock_in_batches`'s SELECT policy ends in
   `OR (auth.uid() IS NULL)`, so an unauthenticated caller reads **every
   purchase cost and GST rate in the company**; `inventory` allows any row with
   a non-null `cloud_kitchen_id`; `raw_materials` and `outlets` allow every
   active row. See `fofo-schema.md` §2 for the exact policies.

`supabase/functions/adjust-inventory` exists but **nothing calls it** — the app
does that work client-side in `lib/manualInventoryAdjust.js`. Treat it as dead
code, not as a pattern.

---

## 4. Architecture

```
app.gastronomix.com          partner app (*.vercel.app for now)
(internal tool, unchanged)   (FOFO app — NO Supabase key)
        |                             |
   supabase-js                   plain HTTPS
   (anon key)                         |
        |                    Vercel serverless functions
        |                    (service_role key, server-side only)
        |                             |
        +-------------+---------------+
                      |
              same Postgres database
        public schema  +  fofo schema (not exposed to PostgREST)
```

**Rules:**

- The partner app **never** holds a Supabase key and never talks to PostgREST.
  Everything goes through `/api/*`.
- New FOFO tables live in a **`fofo` schema** left off Supabase's exposed-schema
  list, so the anon key cannot reach them even if a policy is wrong.
- **Serverless, not a server.** Traffic is small, and Razorpay signature
  verification needs server code anyway. Vercel functions, because the frontend
  already deploys there and Razorpay's Node SDK works without friction.
- The PM and kitchen-executive screens go in `frontend/` (the existing app) and
  use the existing anon-key + RPC pattern.
- **Do not modify existing RLS policies** unless forced. The internal tool works;
  the blast radius is every screen.

Repo layout:

```
frontend/               internal tool (existing)
partner-frontend/       FOFO app (new)
partner-frontend/api/   its Vercel serverless functions (new)
migrations/             shared, as today; FOFO files in migrations/fofo/
```

`api/` sits **inside** `partner-frontend/`, not at the repo root. Each Vercel
project is pointed at one Root Directory and only finds functions in an `api/`
folder inside it — at the root, the partner project would never see them.

**No custom domain yet.** The partner app runs on its free `*.vercel.app`
address until one is bought. Supabase's auth redirect URL and the Razorpay
webhook point at that address, and both change when a domain is added. Setup
steps are in `partner-frontend/README.md`.

Separate Vercel projects per frontend, so a bad deploy on one cannot take down
the other.

---

## 5. The BOM feature (prerequisite)

**The FOFO catalogue cannot price a single made good without this.** Build it
first, as part of Phase 1.

Finished and semi-finished materials are produced, not purchased, so they have
no purchase cost. A BOM lists what goes into making one, and the cost is rolled
up from component costs — which move every time a vendor's price changes.

### Tables (public schema — this is an internal catalogue feature)

```sql
public.recipes
  id                 uuid pk
  material_id        uuid not null unique references raw_materials(id)
  yield_quantity     numeric not null default 1   -- how much one run produces
  is_active          boolean not null default true
  notes              text
  created_at, updated_at, deleted_at

public.recipe_items
  id                    uuid pk
  recipe_id             uuid not null references recipes(id) on delete cascade
  component_material_id uuid not null references raw_materials(id)
  quantity              numeric not null check (quantity > 0)
  unique (recipe_id, component_material_id)
```

> **Assumption to confirm:** `yield_quantity` exists because kitchens make
> things in batches — a marinade run yields 5 kg, not 1. Per-unit cost is
> `sum(components) / yield_quantity`. If BOMs are always written per single
> unit, leave it at 1 and it costs nothing.

### Rules

- **Only `semi_finished` and `finished` materials may have a recipe.**
- **Recipes nest.** A chaap's BOM contains a marinade, and the marinade has its
  own BOM. The roll-up **recurses**.
- **A loop guard is mandatory.** A BOM must not be able to contain itself,
  directly or through a chain. Enforce on write (walk the tree before saving)
  and defend again on read with a depth cap, because data can predate the guard.
- **A component with no purchase history anywhere cannot be added to a BOM.**
  Blocked in the admin UI. This is the first line of defence, not the guarantee
  — see section 6.

---

## 6. How a price is built

This is the most load-bearing section in the document.

```
                    base cost
                        ↓
              × (1 + margin_percent/100)      →  unit_price_ex_gst
                        ↓
              × (1 + sale_gst_percent/100)    →  unit_price_inc_gst
```

Where `base cost` depends on the material:

| Material type | Base cost |
|---|---|
| `raw_material`, `non_food` | GST-inclusive purchase cost (below) |
| `semi_finished`, `finished` | BOM food cost (below) |

### 6.1 Tax on tax is correct here

**Gastronomix cannot claim input tax credit** — a food business under the no-ITC
scheme. GST paid to a vendor never comes back, so it is simply part of what the
material cost.

Chicken bought at ₹100 with 10% input tax cost **₹110**. Margin *and* output GST
apply to ₹110, not ₹100.

That means the base is exactly `gstInclusiveUnitCost()` from
`lib/inventoryValuation.js` — the same figure decision 0003 values stock at:

```js
unit_cost * (1 + gst_percent / 100)
```

**This reads like the classic tax-on-tax bug and is not one.** Anyone who
"corrects" it to the bare `unit_cost` will under-price every item by the input
tax rate. It is written into the migration's column comment for that reason.

### 6.2 What one ingredient costs

Take the **first** rule that applies, always **in the serving kitchen**:

1. **Batches with stock left** → the **quantity-weighted** average of their
   GST-inclusive cost.

   Weighted, not a plain average of rates. With 1 kg left at ₹100 and 99 kg left
   at ₹200, the answer is **₹199**, not ₹150:

   ```
   SUM(quantity_remaining * unit_cost * (1 + gst_percent/100))
   / SUM(quantity_remaining)
   ```

   Average the GST-inclusive figure per batch, because `gst_percent` can differ
   between batches of the same material.

2. **History but nothing on the shelf** → the GST-inclusive cost of the **most
   recent batch** in that kitchen. A product that sold yesterday keeps its price
   when stock hits zero overnight. **No age limit** — an eight-month-old batch
   price is still the price.

3. **No history in this kitchen at all** → **the material has no cost here**,
   and anything needing it cannot be priced.

### 6.3 Food cost, for made goods

```
food_cost(material, kitchen) =
    SUM over recipe_items of
        quantity * cost_of(component, kitchen)
    / recipe.yield_quantity
```

where `cost_of` recurses into another recipe when the component is itself made,
and otherwise uses section 6.2.

- **Components only.** No labour, gas, packaging or wastage allowance.
- **Per cloud kitchen**, because batches are. The same product genuinely costs
  different amounts in different cities. A franchise with outlets in two cities
  sees two prices for the same item — expected, not a bug.

### 6.4 A product that cannot be priced is not sold

A BOM is one list for the whole company, but costs are per kitchen. So a BOM
built from materials bought in Bangalore can still fail in Hyderabad, where one
of those components has never been bought. The admin-side block catches "never
bought anywhere"; it cannot catch "never bought **here**".

**The rule is the same one at the right scope:** if any component has no cost in
the serving kitchen, the product shows as **unavailable** to that franchise,
with a message asking them to contact the company.

**Never fall back to another kitchen's price.** If Hyderabad has never bought
butter, they most likely cannot *make* the chaap at all. A missing cost is a
signal that the kitchen does not stock the ingredient. Borrowing Bangalore's
price would let a franchise pay for something the serving kitchen cannot
produce — which becomes a trim, which becomes store credit they cannot cash out.

**Staff must be told.** A franchise seeing "contact us" will mostly assume we do
not sell it. Build a small internal report:

> **Products that cannot be priced, by kitchen**
> Hyderabad — Peri Peri Soya Chaap — missing cost: Butter

This clusters right after a new kitchen opens or a new BOM is added, and is
empty most days.

### 6.5 Which materials appear at all

A material shows in a franchise's catalogue only if **all** of these hold:

1. `is_fofo_sellable = true`
2. `is_active = true` and `deleted_at IS NULL`
3. Its `brand_codes` match a brand the franchise owns — where **NULL means all
   brands** — and do **not** contain `'ip'`
4. It can be priced in the serving kitchen (section 6.4)

The franchise's brands are the distinct first-two-characters of the codes of the
outlets mapped to them. Use `brandForOutletCode()` from
`lib/adminKitchenDetail.js` rather than writing a fourth copy of that rule.

---

## 7. Data model

### 7.1 Change to an existing table

`migrations/fofo/01-add-fofo-sale-columns-to-materials.sql` — applied.
Adds to `raw_materials`:

| Column | Meaning |
|---|---|
| `is_fofo_sellable` | boolean, default false. Separate from `is_requisitionable`. |
| `hsn_code` | text. Printed on the invoice. **Optional.** |
| `sale_gst_percent` | numeric. Output GST rate. **Not** `stock_in_batches.gst_percent`, which is what a vendor charged us. |
| `sale_margin_percent` | numeric. Markup over the **GST-inclusive** cost. `15` means 15%. |

A CHECK makes the dangerous state impossible: a material cannot be flagged
sellable without a GST rate and a margin. HSN is optional — it does not
affect any price or tax amount, and classifying the catalogue is left to the
accounting team.

Also applied (`04-add-ownership-model-to-outlets.sql`,
`09-link-stock-out-to-fofo-orders.sql`):

```sql
ALTER TABLE public.outlets
  ADD COLUMN ownership_model text NOT NULL DEFAULT 'foco'
  CHECK (ownership_model IN ('foco','fofo'));

ALTER TABLE public.stock_out
  ADD COLUMN fofo_order_id uuid REFERENCES fofo.orders(id);
```

### 7.2 New `fofo` schema

```sql
CREATE SCHEMA fofo;   -- deliberately NOT added to Supabase exposed schemas
```

**Identity**

```
fofo.franchises
  id, name, gst_number (nullable), address, city,
  contact_person, contact_phone, contact_email,
  is_active, created_at, updated_at, deleted_at

fofo.franchise_outlets
  id, franchise_id → franchises, outlet_id → public.outlets (UNIQUE)
  -- the serving kitchen comes from outlets.cloud_kitchen_id; do not duplicate it

fofo.franchise_invitations                      -- one per registration email
  id, franchise_id, invitation_number (1, 2, 3 per franchise),
  sent_to_email, token_hash (SHA-256, never the token),
  sent_by, sent_at, expires_at, used_at, revoked_at, revoked_by

fofo.franchise_users                            -- created on registration
  id, franchise_id, email (unique, lowercase), auth_user_id (Supabase Auth),
  invitation_id (unique), is_active, activated_at
```

`fofo.franchises` also carries `welcome_email_last_sent_at`.

**Cart — live, never frozen**

```
fofo.carts        id, franchise_id, outlet_id (UNIQUE while live)
fofo.cart_items   id, cart_id, raw_material_id, quantity
```

Carts hold **no prices**. Prices are computed live on every read, and only
frozen at checkout.

**Orders**

```
fofo.orders
  id, order_number (unique), franchise_id, outlet_id, cloud_kitchen_id,
  status, expires_at, razorpay_order_id (unique),
  placed_at, accepted_at, accepted_by, packed_at, ready_at,
  shipped_at, delivered_at,
  shipping_carrier, shipping_tracking_ref, shipping_notes,
  subtotal, gst_total, grand_total, amount_paise (generated),
  created_at, updated_at

fofo.order_items
  id, order_id, raw_material_id,
  quantity_ordered, quantity_accepted,
  unit_base_cost, margin_percent, gst_percent, hsn_code,
  unit_price_ex_gst, unit_price_inc_gst
```

Every price field on `order_items` is **frozen at checkout**. Never recompute
them from the catalogue afterwards, or old orders change retroactively.

Shipping lives on the order, not on an invoice. A separate `shipments` table is
only needed if one order can ship in several parts — it cannot today.

**Money**

```
fofo.invoices        id, invoice_number (unique), order_id, franchise_id,
                     invoice_type ('goods'|'logistics'), issued_at,
                     buyer_name, buyer_gstin, buyer_address, buyer_city,
                     taxable_value, gst_amount, total

fofo.invoice_items   id, invoice_id, description, hsn_code, quantity,
                     unit_price_ex_gst, gst_percent,
                     line_taxable_value, line_gst, line_total

fofo.payments        id, invoice_id, razorpay_order_id,
                     razorpay_payment_id (UNIQUE), amount, status,
                     signature_verified_at, raw_webhook jsonb, created_at

fofo.credit_notes    id, credit_note_number (unique), invoice_id, order_id,
                     amount, reason, issued_at, issued_by

fofo.store_credits   id, franchise_id, credit_note_id (UNIQUE, NOT NULL),
                     amount, reason, created_at

fofo.store_credit_applications
                     id, credit_id, invoice_id, amount, applied_by,
                     created_at
```

Four things that matter here:

- **`invoice_items` is a copy, not a view onto `order_items`.** If it joins live,
  trimming a quantity silently rewrites last month's invoice — the exact bug the
  invoice/credit-note split exists to prevent.
- **Nothing stores a balance, or a remaining amount.** A franchise's balance is
  everything earned less everything applied, worked out on every read
  (`fofo.store_credit_balance()`). A stored figure is how you end up with a
  number nobody can explain.
- **Spending is its own table, not a negative row.** Credit is drawn down in
  parts, and a decremented `remaining` column would record that ₹600 of a credit
  was used without recording *which invoice used it*. An application row answers
  both directions. See section 10.
- **The unique key on `credit_note_id`** is what stops a retried webhook or a
  double-clicked button crediting twice. The two amount caps — never more than
  the credit, never more than the invoice — are a trigger, because a CHECK
  cannot see other rows.

---

## 8. Flows

### 8.1 Onboarding

1. **Admin creates the franchise** in the admin dashboard — name, optional
   GSTIN, address, city, contact person, phone, and the **main contact email**.
2. **Outlets** are created in `public.outlets` as normal, with
   `ownership_model = 'fofo'`, then linked via `fofo.franchise_outlets`.
3. **Welcome email** — a button. Sends an informational message to the main
   contact email. No link. Independent of everything else, and can be sent
   again. `welcome_email_last_sent_at` shows when it last went.
4. **Registration emails** — a separate button, **one email per login**: a
   franchise that needs four logins gets four emails. Every one goes to the
   **main contact email**, never to the person, and the franchise passes each
   link to whoever should have it.
   - Each is **numbered per franchise** and says so in the subject —
     *"User registration #3 for Test Foods"* — so they are not identical.
   - Each link is **single-use**, **expires** (7 days recommended; the server
     sets it), and can be **revoked** by an admin until it is used.
   - A resend is a new email with the next number, never the old link again.
5. **Registration** — whoever opens a link enters **an email of their choosing**
   and a password. The server creates the Supabase Auth user, then
   `claim_franchise_invitation` creates the `fofo.franchise_users` row linked
   to the franchise and marks the link spent. If the claim fails (used,
   expired, revoked, email taken) the server deletes the Auth user it created.

**The link is not tied to an email, by decision.** It goes to the franchise's
own inbox and managing it is their responsibility. What limits the damage from
a forwarded or leaked link is that it registers at most one person, expires,
and can be cancelled.

**Everything a user does is on behalf of their franchise**, and the audit trail
names the person: `audit_events.actor_franchise_user_id`, `franchise_id`, and a
readable `actor_label` such as *priya@testfoods.in (Test Foods)*. Admin sends
and revokes are audited too, under category `fofo_account`.

**User management.** Admins get a complete user management dashboard; a
franchise gets a limited one. What "limited" allows — seeing their users,
deactivating one, requesting another registration email — is **not settled
yet**. Deactivation uses `franchise_users.is_active`, and login must refuse an
inactive user.

Adding outlets later is just more `franchise_outlets` rows. Their catalogue
widens automatically, because brands are derived from the outlets they own.

### 8.2 Placing an order

1. Franchise picks an **outlet** and browses its catalogue. Prices are **live**
   and move as costs move.
2. They add items to a cart. The cart stores quantities only.
3. **Proceed to payment** freezes everything:
   - prices are copied onto `order_items`
   - order status becomes `pending_payment`
   - `expires_at` is set
   - any previous live pending order for that outlet is killed
   - a Razorpay order is created
4. They pay in the Razorpay popup.
5. Razorpay's **webhook** arrives at `/api/orders/webhook`. The server verifies
   the signature, then marks the order `paid` and issues the goods invoice.

**If they have unpaid dues, step 3 is blocked.**

**The webhook checks the payment, not just the signature.** A valid signature
proves Razorpay sent the message; it does not prove the payment is the one we
asked for. The order is marked paid only if the captured payment is for that
order's `razorpay_order_id`, in INR, and exactly `amount_paise`. A signed but
mismatched payment has still moved money — record it for manual review, do not
mark the order paid (`partner-frontend/api/_lib/razorpay.js`).

Four rules that make freezing safe:

1. **Expiry blocks *starting* a payment; it never cancels one.** A valid webhook
   for an order that expired two minutes ago still marks it paid. A slow OTP
   must not cost us their money and a support call. `paid` always beats
   `expired`.
2. **No invoice number until money lands.** The order number is allocated at
   freeze, where gaps are harmless. The invoice number is allocated only on
   confirmed payment — a GST sequence cannot have holes, and abandoned carts
   would punch them.
3. **Expiry is computed, not swept.** Compare `now()` against `expires_at` on
   read. A cron job flipping statuses is a second source of truth that races
   with the webhook and goes stale if it dies.
4. **One live pending order per outlet.** Otherwise someone freezes a price,
   waits, freezes again, and pays whichever turned out cheaper.

The cart survives until payment succeeds, so an expiry drops them back on an
intact cart. Match the TTL to Razorpay's own order expiry so two clocks cannot
disagree. Keep expired rows; do not delete them.

### 8.3 The purchase manager accepts

The order appears on the dashboard of the PM whose cloud kitchen serves that
outlet.

**Stock is checked at accept, and if it is not there the system stops.** That is
a hard rule, not a warning. The PM then chooses:

- **Trim the quantity.** A credit note field appears and is **required**. He
  confirms the credit note, then accepts.
- **Stock up first.** Do a vendor stock-in to top up the kitchen, then accept in
  full.

He can only **decrease**. There is no increase, and no cancelling a whole order.

Accept is **one atomic RPC**, shaped like `pack_allocation_request`:

1. validate the order is `paid` and not already accepted
2. write `quantity_accepted` on each line
3. create the `stock_out` (with `fofo_order_id` set) and `stock_out_items`
4. `fifo_consume` each line — raises and rolls everything back if short
5. create the credit note and its `store_credits` row, if trimmed
6. set status `accepted`
7. write the audit event

Two supporting rules:

- **The quantity box is capped at what is on hand** — a convenience, not the
  guarantee, since the number goes stale between reading and clicking.
- **Accept is all-or-nothing.** If a requisition took the stock while he was
  typing, the whole thing rolls back, the order stays `paid`, and he sees how
  short he is.

**What leaves the shelf is the finished good itself**, not its BOM components.

### 8.4 Packing and shipping

1. The accepted order appears on the **kitchen executive's** dashboard. They
   pack it and print labels. Status → `packed`.
2. The kitchen executive tells the PM (verbally, as today).
3. The PM raises a **logistics invoice** — a second invoice against the same
   order. This creates a due on the franchise's dashboard. Status →
   `ready_to_ship`.
4. When the carrier details arrive, the PM fills in the shipping fields on the
   order. Status → `shipped`, later `delivered`.

Shipping cost is **not** estimated at checkout. Mode of transport, destination
and packaging vary too much to compute automatically.

---

## 9. Order state machine

```
                    ┌─────────────────┐
                    │ pending_payment │──── expires_at passes ──▶ expired
                    └────────┬────────┘
                             │ verified webhook
                             ▼
    payment_failed ◀──── ┌──────┐
                         │ paid │   (this is "Placed" to the franchise)
                         └───┬──┘
                             │ PM accepts (atomic: stock-out + optional credit note)
                             ▼
                       ┌──────────┐
                       │ accepted │
                       └────┬─────┘
                            │ kitchen executive packs
                            ▼
                       ┌────────┐
                       │ packed │
                       └───┬────┘
                           │ PM raises logistics invoice
                           ▼
                    ┌───────────────┐
                    │ ready_to_ship │
                    └───────┬───────┘
                            │ PM adds shipping info
                            ▼
                       ┌─────────┐      ┌───────────┐
                       │ shipped │─────▶│ delivered │
                       └─────────┘      └───────────┘
```

`cancelled` exists as an admin-only exceptional state. The PM cannot reach it.

**`paid` is terminal against expiry.** Once an order is `paid`, `expires_at` is
irrelevant forever.

---

## 10. Money documents

Four different things, often confused:

| Thing | What it is | Changes after creation? |
|---|---|---|
| `orders` | The job: what they asked for, where it goes, how far along | Yes — this is the living record |
| `invoices` | The bill: "you owe ₹X for these lines" | **Never** |
| `credit_notes` | "Part of that bill was wrong — ₹Y comes back" | Never |
| `store_credits` + `store_credit_applications` | Their wallet statement: what was earned, and what each part of it was spent on | Append-only |

**One order can have two invoices** — goods, then logistics. That is why the
invoice is not a column on the order.

**An invoice is never edited.** When the PM trims a quantity, the invoice stays
exactly as issued and a credit note is created pointing at it. Invoice and
credit-note numbers must be **gapless and sequential per financial year**.

### Store credit rules

- Refunds are **always** store credit. Never a bank transfer.
- Credit **never expires** and **cannot be cashed out**.
- **Credit is spent in parts.** ₹1,000 of credit settles a ₹400 invoice and
  leaves ₹600. Where a balance spans several credits it is drawn down
  **oldest first**, and where it is smaller than the invoice the rest is paid by
  Razorpay.
- **Credit is a payment, not a discount.** The invoice is issued at full value
  with full GST and the credit settles part of what is payable — exactly as cash
  would. It never reduces an invoice's taxable value. Decision
  [0013](decisions/0013-store-credit-is-a-payment-not-a-discount.md) exists
  because this is the one rule that, if "simplified" into a discount line,
  silently undercharges GST.
- The balance is always earned less applied, computed on read. Never cache it,
  and never keep a remaining amount per credit either — see decision 0013 for
  why the obvious column loses information you need.

> **Superseded trade-off, kept for the record.** This design originally applied
> a balance to one invoice *in full or not at all*. Combined with no
> availability on the dashboard (so franchises over-order), trims making credit,
> and no cash-out, that could leave a franchise holding a balance no invoice
> ever matched. Worse, a goods invoice is only created *after* payment, so a
> full-application rule meant credit could only ever be spent on logistics
> invoices. Partial spending removes both problems and costs one extra table.

---

## 11. Security rules

1. **The partner app holds no Supabase key.** Not the anon key, not any key.
2. **The margin never leaves the server.** Not in a response, not in a token,
   not in a cached payload. The API returns final prices only.
3. **No inventory data reaches a franchise** — no stock levels, no availability,
   not even hints. The one unavoidable exception is a product showing as
   unavailable because it cannot be priced in their kitchen, which reveals
   nothing about quantities.
4. **Razorpay signatures are verified server-side.** The browser never tells the
   database that a payment succeeded. The webhook needs the **raw body** — if
   Vercel parses the JSON first, re-serializing gives different bytes and every
   signature check fails.
5. **Webhooks are idempotent.** Razorpay retries. `razorpay_payment_id` is
   unique; a repeat is a no-op, not a second payment.
6. **Every money-moving write produces an audit event**, written by a
   `SECURITY DEFINER` function, never a client insert (decision 0004).
7. **Any new internal function must revoke `anon` and `authenticated` by name.**
   `REVOKE ... FROM PUBLIC` does **not** work in this database — see decision
   0004. Check `pg_proc.proacl`, do not assume.
8. **Registration tokens are never stored.** The server generates a random
   token, puts it in the link, and stores only its SHA-256 hash — a CHECK
   rejects anything that is not a 64-character hex digest. Links are
   single-use, expiring and revocable.
9. **Every franchise action names the person.** FOFO audit events go through
   `fofo.log_fofo_audit_event`, which derives the actor's role and label itself
   and refuses a franchise user acting for a different franchise.
10. **Franchise isolation is tested, not assumed.** Two test franchises; log in
   as A and attempt to read B's orders by guessing IDs and tampering with
   bodies. All attempts must fail, and the attempts should be written down.

---

## 12. API surface

All under `/api/`, all server-side, all authenticated as a franchise user
except the webhook.

| Endpoint | Does |
|---|---|
| `GET /api/health` | Proves the `vercel.json` catch-all rewrite does not swallow `/api` |
| `POST /api/auth/register` | Registration through a link: creates the Auth user, then claims the invitation; deletes the Auth user if the claim fails |
| `POST /api/auth/*` | Login, logout, password reset. Refuses an inactive franchise user |
| `GET /api/outlets` | The outlets this franchise owns |
| `GET /api/catalog?outlet_id=` | Sellable materials with **final prices**, cost and margin stripped |
| `GET/PUT /api/cart` | Live cart contents, priced on read |
| `POST /api/checkout` | Freezes prices, creates the order + Razorpay order, returns what the popup needs |
| `POST /api/orders/webhook` | **Razorpay only.** Verifies signature, marks paid, issues the invoice. Idempotent. Raw body. |
| `GET /api/orders` / `GET /api/orders/:id` | Order list and detail |
| `GET /api/invoices` / `:id/pdf` | Invoices and their PDFs (`pdfCurrency`, decision 0007) |
| `GET /api/credit/balance` | Earned less applied, plus the per-credit statement behind it |
| `POST /api/credit/redeem` | Applies credit to one invoice, oldest first, up to what is still owed. Returns the amount applied; repeating it is a no-op |

**Admin onboarding endpoints.** The admin dashboard lives in the internal app,
but sending email and generating tokens need server code, and the internal app
cannot reach the `fofo` schema through its public API. So the admin's buttons
call these, authenticated with the admin's **Supabase Auth session** and checked
against `public.users` (active, role `admin`) — the database functions check
again:

| Endpoint | Does |
|---|---|
| `POST /api/admin/franchises/:id/welcome-email` | Sends the welcome email, then `record_welcome_email_sent` |
| `POST /api/admin/franchises/:id/invitations` | Generates a token, `create_franchise_invitation`, then sends the numbered email |
| `POST /api/admin/invitations/:id/revoke` | `revoke_franchise_invitation` |

> **Open: how the other internal screens reach `fofo`.** PM accept, KE pack, the
> logistics invoice and the unpriceable-product report were meant to call
> Postgres RPCs from `frontend/` the existing way. That cannot work as drawn:
> the `fofo` schema is deliberately not exposed, so the internal app's client
> cannot see those functions. Either they get server endpoints like the admin
> ones above, or thin `public` wrappers that check an authenticated staff role.
> Decide before building 8.3.

---

## 13. Build order

Build in order of what hurts most if it is wrong:

| Phase | What | Gate |
|---|---|---|
| 0 | Three decision records (section 14) | — |
| 1 | BOM tables + roll-up + pricing module, **no UI** | Accountant signs off a sample invoice and credit note |
| 2 | `fofo` schema, one endpoint, one domain | No Supabase key or cost price visible in the browser |
| 3 | Franchise auth | Franchise A provably cannot read B's orders |
| 4 | Razorpay in test mode, on a dummy order | Replay, forge and double-click all fail |
| 5 | Happy path end to end, one outlet | One real order, delivered |
| 6 | Trims, credit notes, credit redemption, logistics invoice | Balance reconciles by hand after 20 operations |
| 7 | Polish: PDFs, labels, reports | — |

Phases 0–4 produce almost nothing to demo. That is the plan, not a delay — each
ends in a check that can actually be run.

Run `npm run build` in `frontend/` before committing. There is no test suite;
verify pricing by exercising the pure builders directly with real material data.

---

## 14. Things that look like bugs and are not

Write these three as records in `docs/decisions/` before writing code — each
will otherwise be "fixed" back into a bug by someone who was not part of the
design.

1. **Margin and output GST apply to the GST-INCLUSIVE cost.** Reads as the
   classic tax-on-tax error. Correct here because there is no input tax credit
   to claim. Section 6.1.
2. **The FOFO app holds no Supabase key.** Looks like pointless indirection
   until you notice that `stock_in_batches` is readable by an unauthenticated
   caller and the anon key is in the bundle. Section 4.
3. **An invoice is never edited.** A trim creates a credit note instead, because
   a GST invoice sequence cannot have holes or rewrites. Section 10.

Existing decisions this feature leans on, all in `docs/decisions/`:

| Record | Why it matters here |
|---|---|
| 0002 | "Today" is the UTC date. No FOFO ordering cutoff exists, so this bites only reports. |
| 0003 | Stock is valued GST-inclusive. Its `gstInclusiveUnitCost()` is the FOFO pricing base. |
| 0004 | Audit writes are server-side only, and `REVOKE ... FROM PUBLIC` does not work here. |
| 0006 | `brand_codes`: NULL means all brands; `'ip'` means internal production. |
| 0007 | PDFs cannot render `₹`. |
| 0008 | No browser alerts or confirms. |
| 0009 | Paged queries need a unique tiebreaker. |
| 0010 | Dispatch and closing do not move stock. FOFO accept **does** — a deliberate difference. |
| 0012 | A service kit is not a BOM. Read before touching either. |
| 0013 | Store credit is a payment, not a discount — and is spent in parts. |

---

## 15. Deliberately not built

- **Bank refunds.** Refunds are store credit, always.
- **Cancelling an order as a PM.** Trim only.
- **Shipping estimates at checkout.** Too variable; billed after packing.
- **Availability on the franchise dashboard.** No inventory data reaches them.
- **Damaged or short deliveries.** Operations handle these by hand. Rare enough
  not to earn a feature.
- **Label printing.** Prototype later. Buy the printer early — thermal printing
  from a browser has hardware surprises in it.
- **Cashing out store credit.** Credit is spendable, in parts, against any
  invoice — but it never becomes money in a bank account.
