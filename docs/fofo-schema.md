# FOFO dashboard — the schema, in plain words

Companion to [`fofo-dashboard-spec.md`](fofo-dashboard-spec.md): the spec says
*what the feature does*; this one says *what tables hold it and why*. For a
shorter, plain-English walkthrough of every table, read
[`fofo-schema-explained.md`](fofo-schema-explained.md) first.

**Status:** everything in `migrations/fofo/` (01–13) was applied to the live database on 2026-09-13.
Facts marked "today" in §1–2 were read from the live database before that, and
row counts will have moved since.

---

## 1. What already exists today

| Table | Rows | What it is |
|---|---|---|
| `cloud_kitchens` | 3 | Production sites. Hold inventory. |
| `outlets` | 77 | Storefronts. Each belongs to one cloud kitchen. |
| `raw_materials` | 331 | The catalogue — raw, semi-finished, finished and non-food. |
| `inventory` | 993 | Quantity per (material, kitchen). **Derived**, kept in sync by a trigger. |
| `stock_in_batches` | 5,072 | The real stock and cost record: what is left, what it cost, what GST was paid. |
| `stock_out` / `stock_out_items` | 1,789 / 15,074 | Stock leaving a kitchen. |
| `stock_out_batch_consumption` | 12,024 | Which batches each stock-out ate. Makes a stock-out reversible. |
| `service_kits` / `service_kit_items` | 1 / 5 | What goes out **alongside** a finished product. A packing rule — **not** a recipe. |
| `users` | 11 | Staff only. FOFO franchisees will not live here. |
| `audit_events` | 2,444 | Every audited action. Written only by server-side functions. |
| `franchise_outlet_codes`, `franchise_daily_snapshot(_items)` | 64 / 0 | **The FOCO side.** Nothing to do with this feature. |

### Three facts about the live data you need before designing anything

**1. `outlets` has no address or contact columns.** Only `id`,
`cloud_kitchen_id`, `name`, `code`, `is_active`, timestamps. So a franchise's
address and contact details have nowhere to live today — they go on the new
franchise table.

**2. Brand codes are lowercase; outlet codes are uppercase.**

```
outlets.code            →  BP1042, EC1026, NK0033
raw_materials.brand_codes →  {bp}, {bp,ec}, {ec,nk}, {ip}, {bp,ec,nk}
```

Matching a franchise's brands to a material's brands **must lowercase both
sides**. Comparing `'EC'` to `'ec'` silently returns nothing, and the failure
looks like "this franchise has no products" rather than like a bug.

**3. The word `franchise_` is already taken** in the `public` schema by the FOCO
dashboard. That is why every FOFO table goes in its own `fofo` schema — no
prefix games, no ambiguity about which franchise programme a table serves.

---

## 2. Who can read what today (this drives the architecture)

The internal app talks to Postgres directly using the **anon key**, which ships
inside the JavaScript bundle and is therefore public. RLS is the only gate. The
live policies for the `public` role — which is what the anon key gets — are:

| Table | Policy | Effect |
|---|---|---|
| `raw_materials` | `is_active = true AND deleted_at IS NULL` | Every active material is readable |
| `inventory` | `cloud_kitchen_id IS NOT NULL` | **Every stock level, every kitchen** |
| `stock_in_batches` | `… OR (auth.uid() IS NULL)` | **Every purchase cost and GST rate, company-wide** |
| `outlets` | `is_active = true AND deleted_at IS NULL` | Every outlet |

That `auth.uid() IS NULL` branch on `stock_in_batches` means an unauthenticated
caller holding the anon key can read **every purchase price Gastronomix has ever
paid**. For staff-only software that has been survivable. Handing the same key
to fifty franchisees we sell to at a margin would not be.

**This is the reason the FOFO app gets no Supabase key at all**, and the reason
the new tables live in a schema PostgREST does not expose. It is not caution in
the abstract — it is these four rows.

> Worth fixing separately, on its own schedule: that `auth.uid() IS NULL` branch
> is doing more than key-based login needs. Not part of this project, and not to
> be touched while building it.

---

## 3. Changes to existing tables

### 3.1 `raw_materials` — four columns

In `migrations/fofo/01-add-fofo-sale-columns-to-materials.sql`. Applied.

| Column | Plain meaning |
|---|---|
| `is_fofo_sellable` | "May we sell this to a franchise?" Default false. |
| `hsn_code` | The tax classification code, printed on the invoice. |
| `sale_gst_percent` | The GST we **charge**. Not the GST we **paid** — that is `stock_in_batches.gst_percent`. |
| `sale_margin_percent` | Our markup. `15` means 15%. Applied to the GST-inclusive cost. |

A CHECK stops the dangerous half-filled state: a material cannot be marked
sellable unless it has a GST rate and a margin. So nothing can
reach the dashboard that we do not know how to price or how much tax to
charge on. **HSN is optional**: classifying the catalogue is the accounting
team's job and should not block listing a material, and the code never changes
a price or a tax amount. GST rules generally expect it on B2B tax invoices, so
sellable materials without one are a list to close before these invoices are
used as the official ones — the migration's verification block prints it.

`is_fofo_sellable` is **deliberately separate** from the existing
`is_requisitionable`. They answer different questions — "may our own outlet ask
for this internally" versus "may we sell this for money" — and a material can be
either, both or neither.

### 3.2 `outlets` — one column

```sql
ALTER TABLE public.outlets
  ADD COLUMN ownership_model text NOT NULL DEFAULT 'foco'
  CHECK (ownership_model IN ('foco','fofo'));
```

Says whether an outlet is company-operated or franchise-operated. Default
`'foco'` is correct for all 77 existing rows.

### 3.3 `audit_events` — three columns *(migration 10)*

| Column | Plain meaning |
|---|---|
| `actor_franchise_user_id` | The franchise login that acted. Never set together with `actor_user_id`, which is staff. |
| `franchise_id` | The franchise the event concerns — on franchise-user, staff and system events alike, so one filter finds everything that happened to a franchise. |
| `actor_label` | Who acted, readably, copied at the time: *priya@testfoods.in (Test Foods)*. |

Franchise users are not in `public.users`, so the existing `actor_user_id`
cannot name them. `actor_label` is stored rather than looked up because the audit
screens live in the internal app, which cannot read the `fofo` schema — and
because an audit record should say who the actor was when they acted.

FOFO events are written only by **`fofo.log_fofo_audit_event`**. It takes a staff
actor, a franchise-user actor, or neither (a system event such as a Razorpay
webhook), derives the role and label itself, and refuses a franchise user acting
for another franchise. `public.log_audit_event` is left untouched: every internal
flow calls it, and changing its signature would reset its grants. Categories gain
`fofo_account` for franchises, welcome emails, invitations and users.

`store_credit_applications` gains `applied_by_franchise_user_id` the same way,
and `apply_store_credit` takes the acting franchise user.

### 3.4 `stock_out` — one column

```sql
ALTER TABLE public.stock_out
  ADD COLUMN fofo_order_id uuid REFERENCES fofo.orders(id);
```

When stock leaves the shelf for a FOFO order, this says which order. Without it
you can see that 7 kg of chicken left, but not why. `stock_out` already carries
`allocation_request_id` for the internal equivalent — this is the same idea.

---

## 4. New tables in `public`: the BOM

These are an **internal catalogue feature**, not a FOFO one — the FOFO dashboard
just happens to be the first thing that needs them. So they stay in `public`
alongside `service_kits`.

The word "recipe" is free for exactly this purpose: decision 0012 renamed the
old `recipes` table to `service_kits` so this feature could have the name.

```sql
public.recipes
  id                 uuid primary key
  material_id        uuid not null unique   -- the thing being made
  yield_quantity     numeric not null default 1
  is_active          boolean not null default true
  notes              text
  created_at, updated_at, deleted_at

public.recipe_items
  id                    uuid primary key
  recipe_id             uuid not null  → recipes(id) on delete cascade
  component_material_id uuid not null  → raw_materials(id)
  quantity              numeric not null check (quantity > 0)
  sort_order            integer default 1
  unique (recipe_id, component_material_id)
```

**In plain words:** one row in `recipes` says "this product is made by us". The
rows in `recipe_items` say "and here is what goes into it, and how much".

**`yield_quantity`** exists because kitchens make things in batches. If one run
of marinade uses 4 kg of ingredients and produces 5 kg of marinade, the cost of
1 kg is `total ÷ 5`, not `total`. Leave it at `1` for products written per
single unit and it changes nothing.

**Only `semi_finished` and `finished` materials may have a recipe.** A raw
material is bought, not made.

**Recipes nest, and that needs a guard.** A chaap's recipe contains marinade;
marinade has its own recipe. The cost roll-up walks down through both. Nothing
in the table shape stops someone making A contain B contain A, so the guard has
to be code: walk the tree before saving and refuse a cycle, then defend again on
read with a depth cap, because data can predate the guard.

> These mirror `service_kits` deliberately — same column style, same soft-delete
> pattern. They sit next to each other in the schema and one is a packing rule
> while the other feeds money calculations, so they should at least *look*
> related and be easy to tell apart by name.

---

## 5. New schema: `fofo`

```sql
CREATE SCHEMA fofo;
```

**Do not add `fofo` to Supabase's exposed-schema list.** That single omission
means the anon key cannot reach any of these tables through the REST API, no
matter what the policies say. It is the cheapest safety net in the project.

### 5.1 Who the franchise is

```sql
fofo.franchises
  id                uuid primary key
  name              text not null          -- company or person
  gst_number        text                   -- optional, they may not have one
  address           text
  city              text
  contact_person    text
  contact_phone     text
  contact_email     text
  is_active         boolean not null default true
  created_at, updated_at, deleted_at
```

One row per FOFO franchise business. This is the customer we invoice.

```sql
fofo.franchise_outlets
  id            uuid primary key
  franchise_id  uuid not null → fofo.franchises(id)
  outlet_id     uuid not null → public.outlets(id)   UNIQUE
  created_at
```

Which outlets this franchise owns. `outlet_id` is **unique** — an outlet has
exactly one owner. Growing the franchise is just adding rows here.

Note what this table does **not** store: the cloud kitchen. That already lives
on `outlets.cloud_kitchen_id`, and copying it here would create two answers to
the same question that can drift apart.

```sql
fofo.franchise_invitations                         -- migration 11
  id                uuid primary key
  franchise_id      uuid not null → fofo.franchises(id)
  invitation_number integer not null     -- 1, 2, 3 per franchise
  sent_to_email     text not null        -- the franchise contact email, copied
  token_hash        text not null unique -- SHA-256 hex; the token is never stored
  sent_by           uuid → public.users(id)
  sent_at           timestamptz not null default now()
  expires_at        timestamptz not null
  used_at           timestamptz
  revoked_at        timestamptz
  revoked_by        uuid → public.users(id)
  unique (franchise_id, invitation_number)
```

One **registration email**. Every one goes to the franchise's main contact
email, carries a link that registers **one** login, and is numbered so the
franchise can tell them apart (*"User registration #3 for Test Foods"*). A link
is single-use, expires, and can be revoked until it is used. The link is not
tied to any email — whoever holds it chooses their own — which is a deliberate
choice; the single use and the expiry are what bound it.

The number is allocated as `max + 1` with the franchise row locked, so two
admins sending at once get #5 and #6, not two #5s. Only the token's hash is
stored, and a CHECK refuses anything that is not a 64-character hex digest, so
nothing read from the database can register an account.

```sql
fofo.franchise_users                               -- reshaped in migration 11
  id            uuid primary key
  franchise_id  uuid not null → fofo.franchises(id)
  email         text not null unique  -- lowercase, trimmed (CHECK)
  auth_user_id  uuid not null unique  -- Supabase Auth
  invitation_id uuid unique → fofo.franchise_invitations(id)
  is_active     boolean not null default true
  activated_at  timestamptz not null default now()
  created_at, updated_at
```

The login. A franchise can have more than one person. **A row exists only once
someone has registered**, so every column that describes the account is
required. `invitation_id` records which link it came from — one link, one login.
The email is theirs to choose, and is kept lowercase so `Priya@x.in` and
`priya@x.in` cannot both register. `is_active = false` is how a user is
deactivated; login must refuse them.

`fofo.franchises` also gains `welcome_email_last_sent_at` — the welcome email is
a separate, repeatable button with no link.

**Functions** (migration 11, all server-only):

| Function | Does |
|---|---|
| `record_welcome_email_sent(franchise, admin)` | Stamps the welcome email and audits it |
| `create_franchise_invitation(franchise, token_hash, expires_at, admin)` | Allocates the next number, stores the hash, audits; returns the number and address |
| `claim_franchise_invitation(token_hash, auth_user_id, email, ip, user_agent)` | Spends a link exactly once and creates the franchise user; audits as that user |
| `revoke_franchise_invitation(invitation, admin)` | Cancels an unused link; repeating it is harmless |

Each admin function checks that the caller is an active admin, even though the
API has already checked.

**These people are not in `public.users`.** That table is staff, its `role`
CHECK lists only staff roles, and its rows are tied to a cloud kitchen. Mixing
customers into it would break both.

### 5.2 The cart — live, never frozen

```sql
fofo.carts
  id            uuid primary key
  franchise_id  uuid not null → fofo.franchises(id)
  outlet_id     uuid not null → public.outlets(id)
  created_at, updated_at
  unique (outlet_id)        -- one open cart per outlet

fofo.cart_items
  id               uuid primary key
  cart_id          uuid not null → fofo.carts(id) on delete cascade
  raw_material_id  uuid not null → public.raw_materials(id)
  quantity         numeric not null check (quantity > 0)
  unique (cart_id, raw_material_id)
```

**The cart stores no prices.** Not one column. Prices are worked out fresh every
time the cart is read, because raw material costs move and the cart must show
what things cost *now*. A price column here would be a stale number pretending
to be a promise.

The cart survives an expired checkout, so someone who walks away comes back to
an intact basket.

### 5.3 Orders

```sql
fofo.orders
  id                uuid primary key
  order_number      text not null unique
  franchise_id      uuid not null → fofo.franchises(id)
  outlet_id         uuid not null → public.outlets(id)
  cloud_kitchen_id  uuid not null → public.cloud_kitchens(id)
  status            text not null
  expires_at        timestamptz
  razorpay_order_id text unique             -- set at checkout; the webhook's way back
  placed_at         timestamptz
  accepted_at       timestamptz
  accepted_by       uuid → public.users(id)
  packed_at         timestamptz
  ready_at          timestamptz
  shipped_at        timestamptz
  delivered_at      timestamptz
  shipping_carrier  text
  shipping_tracking_ref text
  shipping_notes    text
  subtotal          numeric(14,2) not null default 0
  gst_total         numeric(14,2) not null default 0
  grand_total       numeric(14,2) not null default 0   -- check: = subtotal + gst_total
  amount_paise      bigint generated always as (grand_total * 100)
  created_at, updated_at
```

**`razorpay_order_id` is how a payment finds its order.** Razorpay's webhook
carries Razorpay's ids, not ours, and at that moment no invoice exists yet to
hang the payment on. Without this column a genuine payment arrives and nothing
can say which order it paid for. Unique, so one Razorpay order can never match
two of ours.

**`amount_paise` is what Razorpay is asked for, and what it is checked
against.** Razorpay works in whole paise. The column is generated from
`grand_total`, so it cannot drift, and the webhook compares Razorpay's integer
with this integer — no conversion to rupees in between. The check itself is
`partner-frontend/api/_lib/razorpay.js`: a valid signature is not enough, the
captured payment must also be for this Razorpay order, in INR, captured, and
**exactly** this amount. A correctly signed ₹1 payment is still correctly
signed.

**Money has one precision and one rounding rule.** Amounts are
`numeric(14,2)`; unit prices are `numeric(14,4)`, because a weighted-average
cost is rarely a whole paisa and rounding it before multiplying by 12.5 kg moves
the line. The rule: **work out each line, round it to the paisa, then add
rounded lines.** Rounding the unit price first, or rounding only the total, gives
a different answer — and the order, the invoice and Razorpay must all agree.
Note `numeric(14,2)` quietly *rounds* a third decimal rather than rejecting it,
so the type alone catches nothing; the arithmetic CHECKs on invoices do.

**Why `cloud_kitchen_id` is copied here** even though it could be derived from
the outlet: an order is served by whichever kitchen the outlet belonged to *at
the time of ordering*. If an outlet is later moved to a different kitchen, old
orders must not silently change which kitchen fulfilled them. This is a
deliberate snapshot, not duplication.

**Why shipping lives on the order** and not on an invoice: the invoice is a
money document about what is owed. Where a box went is about the job. A separate
`shipments` table would only be needed if one order could ship in several
parts — it cannot today.

```sql
fofo.order_items
  id                  uuid primary key
  order_id            uuid not null → fofo.orders(id) on delete cascade
  raw_material_id     uuid not null → public.raw_materials(id)
  quantity_ordered    numeric not null check (quantity_ordered > 0)
  quantity_accepted   numeric check (quantity_accepted >= 0)
  unit_base_cost      numeric(14,4) not null  -- GST-inclusive cost, or BOM food cost
  margin_percent      numeric(7,3) not null
  gst_percent         numeric(7,3) not null
  hsn_code            text                  -- optional, copied from the material
  unit_price_ex_gst   numeric(14,4) not null
  unit_price_inc_gst  numeric(14,4) not null
```

**Every price column here is frozen at checkout.** The whole calculation is
stored — cost, margin, GST rate, and both resulting prices — not just the final
number. That way, six months later, you can answer "why was this ₹128.80?"
without guessing what the margin was that day.

Never recompute these from the catalogue. Recomputing is how an old invoice
silently changes.

`quantity_accepted` is null until the purchase manager accepts. If he trims,
`quantity_ordered` keeps the original — the difference is what the credit note
is for, and both numbers need to survive for the paperwork to make sense.

### 5.4 Money

```sql
fofo.invoices
  id              uuid primary key
  invoice_number  text not null unique
  order_id        uuid not null → fofo.orders(id)
  franchise_id    uuid not null → fofo.franchises(id)
  invoice_type    text not null check (invoice_type in ('goods','logistics'))
  issued_at       timestamptz not null default now()
  buyer_name      text not null               -- copied from the franchise at issue
  buyer_gstin     text                        --   ″   (null = unregistered that day)
  buyer_address   text not null               --   ″
  buyer_city      text                        --   ″
  taxable_value   numeric(14,2) not null
  gst_amount      numeric(14,2) not null
  total           numeric(14,2) not null      -- check: = taxable_value + gst_amount

fofo.invoice_items
  id                  uuid primary key
  invoice_id          uuid not null → fofo.invoices(id) on delete cascade
  description         text not null
  hsn_code            text
  quantity            numeric not null
  unit_price_ex_gst   numeric(14,4) not null
  gst_percent         numeric(7,3) not null
  line_taxable_value  numeric(14,2) not null  -- check: = round(quantity × unit price, 2)
  line_gst            numeric(14,2) not null  -- check: = round(taxable × rate / 100, 2)
  line_total          numeric(14,2) not null  -- check: = taxable + gst
```

**The buyer is copied onto the invoice**, for the same reason the lines are. A
tax invoice names who it was issued to, and that has to stay what it was on the
day: if a franchise registers for GST or moves next year, last year's invoices
keep last year's details. `buyer_address` is required even though the
franchise's address is optional — an invoice cannot be issued to a franchise
with no address on file. Credit notes do not repeat the buyer; they point at an
invoice, and the invoice never changes. The buyer's **state** is not here yet;
it belongs with the CGST/SGST/IGST split, which is still to be designed.

**One order can have two invoices** — the goods, then the transport. That is
exactly why the invoice is a table and not a few columns on the order.

**`invoice_items` is a copy, not a view.** It repeats data that also sits in
`order_items`, and that repetition is the point: an invoice must say what it
said on the day it was issued, forever. If it joined live to `order_items`, a
quantity trim in September would rewrite an invoice from August.

**An invoice row is never updated.** Not the total, not a line. Wrong amounts
are corrected by a credit note.

```sql
fofo.payments
  id                    uuid primary key
  invoice_id            uuid not null → fofo.invoices(id)
  razorpay_order_id     text
  razorpay_payment_id   text unique          -- the idempotency key
  amount                numeric(14,2) not null
  status                text not null
  signature_verified_at timestamptz
  raw_webhook           jsonb
  created_at
```

**`razorpay_payment_id` is unique, and that is a safety feature, not tidiness.**
Razorpay retries webhooks. Without the constraint, a retry records a second
payment and the franchise appears to have paid twice.

`raw_webhook` keeps what Razorpay actually sent. When a payment is disputed
months later, the stored payload is the evidence.

```sql
fofo.credit_notes
  id                 uuid primary key
  credit_note_number text not null unique
  invoice_id         uuid not null → fofo.invoices(id)
  order_id           uuid not null → fofo.orders(id)
  amount             numeric(14,2) not null check (amount > 0)
  reason             text not null
  issued_at          timestamptz not null default now()
  issued_by          uuid → public.users(id)
```

The formal "part of that bill was wrong". Points back at the invoice it
corrects. Numbers must be **gapless and sequential per financial year**, same as
invoices — that is a tax requirement, not a preference.

Store credit is **two** tables: what was earned, and what has been spent of it.

```sql
fofo.store_credits                -- earned. One row per credit note.
  id             uuid primary key
  franchise_id   uuid not null → fofo.franchises(id)
  credit_note_id uuid not null unique → fofo.credit_notes(id)
  amount         numeric(14,2) not null check (amount > 0)
  reason         text not null
  created_at     timestamptz not null default now()

fofo.store_credit_applications    -- spent. One row per part-payment.
  id             uuid primary key
  credit_id      uuid not null → fofo.store_credits(id)
  invoice_id     uuid not null → fofo.invoices(id)
  amount         numeric(14,2) not null check (amount > 0)
  applied_by     uuid → public.users(id)     -- null when the franchise did it
  created_at     timestamptz not null default now()
```

**Credit is spent in parts.** ₹1,000 earned may settle three invoices over a
month. What is left of one credit is its amount less the applications against
it, and what a franchise has in total is that, summed:

```sql
SELECT fofo.store_credit_balance('<franchise>');            -- one number
SELECT * FROM fofo.store_credit_statement                   -- the rows behind it
WHERE franchise_id = '<franchise>' ORDER BY earned_at;
```

**Nothing stores a balance, and nothing stores a remaining amount either.** A
`remaining_amount` column on each credit, decremented as it is spent, is the
obvious design and it is worse in one specific way: it records that ₹600 of
CN-0007 was used but **not which invoice used it**. That is the first question
an auditor asks and the first question a franchise asks when it disputes the
balance. An application row answers it in both directions — where a credit went,
and how an invoice was settled — and cannot drift from the rows it is derived
from, because it *is* the rows.

`fofo.store_credit_statement` is a view giving exactly that remaining figure per
credit. It is computed on every read, which at any volume this business will
reach costs nothing worth measuring.

**Two amounts can never be overdrawn**, and neither check can be a CHECK
constraint, because both have to look at other rows:

- applications against one credit can never exceed the credit
- applications against one invoice can never exceed the invoice

A `BEFORE INSERT` trigger enforces both, and locks the invoice row and then the
credit row before it counts. The lock is the whole point: two redemptions
arriving together would otherwise both read "₹600 left", both write ₹600, and
spend ₹1,200 of a ₹600 credit. The same trigger refuses an application whose
credit and invoice belong to different franchises — two foreign keys pointing at
two tables cannot see each other, so nothing else would catch it.

**`credit_note_id` is NOT NULL and unique.** Every rupee of store credit traces
back to a credit note, because a refund is a tax document before it is a
balance. Unique means a double-clicked button or a retried webhook is a no-op
rather than free money.

**Applying credit never touches the invoice.** Store credit is a payment, not a
discount: the invoice keeps its full taxable value and its full GST, and the
credit settles part of what is payable. The tax was already adjusted once, by
the credit note. Taking it off the new invoice as well would claim the same
relief twice and undercharge GST — see
[decision 0013](decisions/0013-store-credit-is-a-payment-not-a-discount.md).

---

## 6. How it all joins up

```
public.cloud_kitchens
        │
        │ (a kitchen serves many outlets)
        ▼
public.outlets ───────────────► fofo.franchise_outlets ──► fofo.franchises
   │  ownership_model='fofo'                                    │      │
   │                                                            │      │
   │                                              fofo.franchise_users │
   │                                                                   │
   │                                                  fofo.store_credits
   │                                                             │  (drawn down by)
   │                                      fofo.store_credit_applications
   │
   ├──► fofo.carts ──► fofo.cart_items ──► public.raw_materials
   │
   └──► fofo.orders ──┬──► fofo.order_items ──► public.raw_materials
                      │                              │
                      │                              └──► public.recipes
                      │                                     └──► public.recipe_items
                      │                                            (nests)
                      ├──► fofo.invoices ──┬──► fofo.invoice_items
                      │         ▲          ├──► fofo.payments
                      │         │          └──► fofo.credit_notes
                      │         │                    └──► fofo.store_credits
                      │         │                              │
                      │         └── fofo.store_credit_applications
                      │
                      └──► public.stock_out (via fofo_order_id)
                                  └──► public.stock_out_batch_consumption
                                            └──► public.stock_in_batches
```

Read the right-hand column bottom-up and you have the price story: batches carry
the cost, recipes roll costs up for made goods, order items freeze the result,
and invoices make it permanent.

---

## 7. The rules the schema itself enforces

Constraints worth writing, because each one makes a real mistake impossible
rather than merely discouraged:

| Rule | How |
|---|---|
| A sellable material is priceable and taxable | CHECK on `raw_materials`: sellable ⇒ GST rate and margin present (HSN optional) |
| An outlet has exactly one owner | `UNIQUE (outlet_id)` on `franchise_outlets` |
| One open cart per outlet | `UNIQUE (outlet_id)` on `carts` |
| One live pending order per outlet | Partial unique index on `orders (outlet_id) WHERE status = 'pending_payment'` |
| A credit note is credited once | `UNIQUE (credit_note_id)` on `store_credits` |
| A credit is never overdrawn | trigger on `store_credit_applications`: applied ≤ credit, under a row lock |
| An invoice never absorbs more credit than it is worth | same trigger: applied ≤ `invoices.total` |
| One franchise's credit cannot settle another's bill | same trigger, comparing both owners |
| An audit event has at most one actor | CHECK on `audit_events`: staff or franchise user, not both |
| A franchise-user event says which franchise | CHECK on `audit_events` |
| A registration link registers one login | `used_at` under a row lock; `UNIQUE (invitation_id)` on `franchise_users` |
| Registration emails are numbered per franchise | `UNIQUE (franchise_id, invitation_number)` |
| A raw token is never stored | CHECK on `token_hash`: 64 lowercase hex characters |
| One email, one login, regardless of case | CHECK lowercase + `UNIQUE (email)` on `franchise_users` |
| A webhook retry is not a second payment | `UNIQUE (razorpay_payment_id)` on `payments` |
| A material appears once per cart | `UNIQUE (cart_id, raw_material_id)` |
| A component appears once per recipe | `UNIQUE (recipe_id, component_material_id)` |
| Quantities are never negative | CHECKs on cart, order and recipe quantities |

Things the schema **cannot** enforce, which therefore need code and a test:

- A recipe must not contain itself, through any depth of nesting.
- Invoice and credit-note numbers must be gapless per financial year.
- Store credit must be applied as a **payment** and never as a discount line —
  no constraint can see the difference, and getting it wrong undercharges GST.
- `quantity_accepted` must never exceed `quantity_ordered` (a CHECK can do this
  one, and should).
- A franchise only ever sees its own rows — that is the API's job, since these
  tables are not reachable by PostgREST at all.

---

## 8. Naming, for consistency with what is there

- Snake case, plural table names — matches everything existing.
- `uuid` primary keys with `extensions.uuid_generate_v4()` defaults.
- `created_at` / `updated_at` as `timestamptz default now()`.
- `deleted_at` for soft delete on anything a human curates (franchises,
  recipes). Transactional rows — orders, invoices, payments, ledger entries —
  are **never** soft-deleted; they get a status, or they stay.
- Money as `numeric`. Never float.
- Migration files named for what they do, opening with a comment block
  explaining the change and its reasoning, per `CLAUDE.md`.

---

## 9. Migration order

All of these live in `migrations/fofo/`, numbered in the order they must run.
**01–13 were applied to the live database on 2026-09-13**, in order, each verified before the next.

1. `01-add-fofo-sale-columns-to-materials.sql`
2. `02-add-recipes-and-recipe-items.sql` — the BOM tables
3. `03-create-fofo-schema.sql` — the schema plus franchises, franchise_outlets,
   franchise_users
4. `04-add-ownership-model-to-outlets.sql`
5. `05-create-fofo-orders-and-carts.sql`
6. `06-add-fofo-money-audit-category.sql` — lets `audit_events.category` carry
   `fofo_money`; its CHECK is a closed list
7. `07-create-fofo-money-tables.sql` — invoices, invoice_items, payments,
   credit_notes, store_credits, store_credit_applications
8. `08-create-fofo-store-credit-rpcs.sql` — the balance, and applying credit to an
   invoice oldest-first
9. `09-link-stock-out-to-fofo-orders.sql` — needs `fofo.orders` to exist first
10. `10-track-franchise-users-in-audit-events.sql` — audit actors for franchise
    users, `log_fofo_audit_event`, `apply_store_credit` naming the user.
11. `11-add-franchise-registration-invitations.sql` — the welcome email stamp,
    numbered registration links, `franchise_users` reshaped for registration.
12. `12-add-franchise-admin-functions.sql` — create, edit and deactivate
    franchises; link and unlink outlets.
13. `13-add-outlet-ownership-model-controls.sql` — an admin marks an outlet
    FOCO or FOFO; a trigger keeps an outlet a franchise owns marked FOFO.
14. `14-create-fofo-accept-order-rpc.sql` — **not written yet.** The atomic
    accept, modelled on `pack_allocation_request`

The pricing module (Phase 1) only reads what 01–02 added, so it can be built
and checked against real data without touching the `fofo` schema.
