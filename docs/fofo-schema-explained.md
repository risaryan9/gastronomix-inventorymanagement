# The FOFO database, explained simply

This explains every table the FOFO franchise dashboard adds to the database,
in plain words. For the full reasoning behind each choice, see
[`fofo-schema.md`](fofo-schema.md). For the order to run the files in, see
[`migrations/fofo/README.md`](../migrations/fofo/README.md).

**Status:** all of it — `migrations/fofo/` files 01–13 — was applied to the live
database on 2026-09-13.

---

## The big picture

A FOFO franchise **buys supplies from Gastronomix**. To support that, the
database needs to know five things:

| Group | Question it answers | Tables |
|---|---|---|
| **Catalogue** | What can we sell, and what does it cost to make? | `raw_materials` (4 new columns), `recipes`, `recipe_items` |
| **Customers** | Who is the franchise, which outlets do they own, who can log in? | `franchises`, `franchise_outlets`, `franchise_users` |
| **Shopping** | What are they buying right now, and what did they order? | `carts`, `cart_items`, `orders`, `order_items` |
| **Money** | What did we bill, what did they pay, what do we owe back? | `invoices`, `invoice_items`, `payments`, `credit_notes`, `store_credits`, `store_credit_applications` |
| **Stock** | Which stock left the kitchen for which order? | `stock_out` (1 new column) |

The catalogue and stock tables are existing tables in `public`. Everything
else is new and lives in a separate **`fofo` schema**, which is hidden from the
internal app's public key on purpose — see [Keeping it private](#keeping-it-private).

```
cloud_kitchens ── outlets ── franchise_outlets ── franchises ── franchise_users
                     │                                 │
                     ├── carts ── cart_items           └── store_credits
                     │                                        │
                     └── orders ── order_items                │ (spent through)
                           │                                  │
                           ├── invoices ── invoice_items      │
                           │     ├── payments                 │
                           │     ├── credit_notes ────────────┘
                           │     └── store_credit_applications
                           │
                           └── stock_out (what left the shelf)
```

---

## 1. Catalogue

### `raw_materials` — 4 new columns *(file 01)*

The existing material list gets four columns so we can sell to franchises:

| Column | Plain meaning |
|---|---|
| `is_fofo_sellable` | "Can a franchise buy this?" Off by default. |
| `hsn_code` | The tax category code printed on the invoice. Optional. |
| `sale_gst_percent` | The GST rate **we charge** the franchise (e.g. 5). |
| `sale_margin_percent` | Our markup, e.g. 15 means 15%. |

**Rule:** a material cannot be switched to sellable unless its GST rate and
margin are filled in. So nothing reaches a franchise that we do not know how
to price or tax. **The HSN code is optional** — it never changes a price or a
tax amount, so a missing code leaves the invoice line without one rather than
blocking the sale.

### `recipes` and `recipe_items` — the bill of materials *(file 02)*

Finished and semi-finished items (a marinated chaap, a sauce) are **made**, not
bought, so they have no purchase price. A recipe lists what goes into one, so
its cost can be added up from its ingredients.

- **`recipes`** — one row says "this item is made by us". `yield_quantity` is how
  much one batch makes (a batch of marinade might make 5 kg).
- **`recipe_items`** — the ingredients of that recipe and how much of each.

**Rules:**
- Only `semi_finished` and `finished` materials can have a recipe.
- One live recipe per item.
- Recipes can contain other made items (a chaap contains a marinade, which has
  its own recipe), but a recipe can **never contain itself**, even through a
  chain. The database refuses the loop.

> Not to be confused with **service kits**, the existing feature for what goes
> out *alongside* a dish. A service kit is a packing rule, not a recipe.

---

## 2. Customers

### `outlets` — 1 new column *(file 04)*

`ownership_model` is `'foco'` (company runs it) or `'fofo'` (franchise runs it).
All 77 existing outlets become `'foco'` automatically.

### `franchises` *(file 03)*

One row per franchise **business** — the company we invoice. Name, GSTIN
(optional, since some are not registered), address, city and contact details.

### `franchise_outlets` *(file 03)*

Which outlets each franchise owns. **An outlet has exactly one owner.** Adding an
outlet to a franchise is just adding a row, and their catalogue grows to match,
because the brands they can buy are worked out from their outlets.

### Onboarding: the welcome email and registration links *(file 11)*

How a franchise gets its logins:

1. The admin creates the franchise, with its **main contact email**.
2. **Welcome email** — one button, sends a friendly message with no link. Can be
   sent again; `welcome_email_last_sent_at` shows when it last went.
3. **Registration emails** — another button, **one email per login**. Every one
   goes to the franchise's main email, and the franchise hands each link to the
   right person.
4. The person opens the link, types **any email they like** and a password, and
   their login is created and attached to the franchise.

### `franchise_invitations` *(file 11)*

One row per registration email.

- **Numbered per franchise** — #1, #2, #3 — and the number is in the email's
  subject, so the franchise can tell them apart.
- **Each link works once**, **expires**, and an admin can **cancel** it before
  it is used. Sending again means a new email with the next number.
- The secret part of the link is **never stored** — only a scrambled version of
  it (a hash) — so nobody reading the database could use it to sign up.

### `franchise_users` *(files 03, 11)*

The people who log in for a franchise. One franchise can have several.

- A row is created **when someone registers**, not before.
- Email is unique and stored in lowercase, so the same address can't sign up
  twice with different capital letters.
- `invitation_id` says which registration link they used.
- `is_active` switches a user off when they leave.
- These people are **not** in the staff `users` table — customers and staff are
  kept apart.

---

## 3. Shopping

### `carts` and `cart_items` *(file 05)*

The basket a franchise is filling for one outlet.

- One cart per outlet, and each material appears once in it.
- **The cart stores quantities only, never prices.** Prices move as our costs
  move, so they are worked out fresh every time the cart is shown.
- The cart survives if a payment is abandoned, so they come back to a full basket.

### `orders` *(file 05)*

Created when the franchise clicks **pay**. This is the job: what they asked
for, where it goes, and how far along it is.

**Status** moves through:

```
pending_payment → paid → accepted → packed → ready_to_ship → shipped → delivered
      │
      ├→ expired          (they did not pay in time)
      └→ payment_failed
                                  cancelled (admin only, exceptional)
```

Key columns in plain words:

| Column | Meaning |
|---|---|
| `cloud_kitchen_id` | The kitchen that serves this order, **copied at the time**. If the outlet later moves kitchens, old orders do not change. |
| `expires_at` | When the frozen prices stop being offered. A payment that arrives late still counts — paid always wins over expired. |
| `razorpay_order_id` | Razorpay's id for this payment. It is how an incoming payment finds its order. |
| `subtotal`, `gst_total`, `grand_total` | The order's value. `subtotal` is the selling price before GST, **markup already included**; `gst_total` is the GST on that; `grand_total` is what the franchise pays and must equal `subtotal + gst_total`. Our markup is not a separate total — it can be worked out from the order lines. |
| `amount_paise` | `grand_total` in paise (₹450.63 → 45063), calculated automatically. This is what Razorpay is asked for and what the payment is checked against. |
| shipping columns | Carrier, tracking reference and notes, filled in when it ships. |

**Rule:** only **one unpaid order per outlet** at a time. Otherwise someone
could lock in a price, wait, lock in another, and pay whichever is cheaper.

### `order_items` *(file 05)*

The lines of an order, with **every price frozen at the moment they clicked
pay**: our cost, the margin, the GST rate, the HSN code, and the price with and
without GST. So six months later you can still answer "why was this ₹450.63?"

- `quantity_ordered` — what they asked for.
- `quantity_accepted` — what the purchase manager could actually supply. Empty
  until accepted, and it can never be more than what was ordered. The
  difference is what a credit note pays back.

---

## 4. Money

Four different things that are easy to mix up:

| Thing | In plain words | Ever changes? |
|---|---|---|
| **Order** | The job | Yes |
| **Invoice** | The bill | **Never** |
| **Credit note** | "Part of that bill was wrong — this much comes back" | Never |
| **Store credit** | Their wallet: what they earned back, and what they spent | Only added to |

### `invoices` and `invoice_items` *(file 07)*

The bill. One order has **one goods invoice**, and can also have **logistics
invoices** for transport, raised after packing.

- **Never edited.** A mistake is corrected with a credit note, not by changing
  the bill.
- **The buyer is copied onto the invoice** — name, GSTIN, address, city — so an
  old invoice keeps showing who it was issued to on that day, even if the
  franchise later moves or registers for GST. An address is required.
- **The lines are copied too**, not linked to the order. Changing an order must
  never rewrite a bill that has already been issued.
- `total` must equal `taxable_value + gst_amount`.

### `payments` *(file 07)*

Money received through Razorpay against an invoice.

- `razorpay_payment_id` is unique, so a payment message that Razorpay sends
  twice is not recorded twice.
- `raw_webhook` keeps exactly what Razorpay sent, as evidence if a payment is
  ever disputed.

### `credit_notes` *(file 07)*

The formal document saying part of an invoice was wrong. Created when the
purchase manager has to supply less than was ordered. Points at the invoice it
corrects and must give a reason.

### `store_credits` and `store_credit_applications` *(file 07)*

Refunds are **always** store credit, never a bank transfer. Store credit never
expires and cannot be cashed out.

- **`store_credits`** — money earned back. One row per credit note, never more.
- **`store_credit_applications`** — money spent. One row each time part of a
  credit is used against an invoice.

**Credit can be spent in parts.** ₹1,000 of credit can pay a ₹400 invoice and
keep ₹600 for later. When a franchise has several credits, the **oldest is used
first**.

**Nothing stores a balance.** The balance is always worked out: everything
earned minus everything spent. That way it can always be proven line by line,
and there is no stored figure that can drift out of step.

**The database refuses** to spend more than a credit is worth, more than an
invoice is worth, or one franchise's credit on another franchise's bill — even
if two requests arrive at the same moment.

**Store credit is a payment, not a discount.** Using it never changes an invoice
or its GST. It just pays part of what is owed, the same way cash would.

Helpers *(file 08)*:
- `store_credit_statement` — every credit with how much is used and how much is left.
- `store_credit_balance(franchise)` — the total left.
- `apply_store_credit(franchise, invoice)` — spends as much credit as the invoice
  needs, oldest first, and writes an audit record. Calling it twice is safe; the
  second call finds nothing left to pay.

---

## 5. Stock

### `stock_out` — 1 new column *(file 09)*

`fofo_order_id` says which FOFO order a stock-out was for. Without it you could
see that 7 kg of chicken left the kitchen, but not why. Stock leaves the shelf
when the purchase manager **accepts** an order, and what leaves is the finished
item itself, not its recipe ingredients.

### `audit_events` — who did it *(files 06, 10)*

The existing audit trail records FOFO actions too.

- File 06 adds the `fofo_money` category; file 10 adds `fofo_account` for
  franchises, emails, links and users.
- **Every franchise action names the person.** Franchise users aren't staff, so
  file 10 adds three columns: which franchise user acted, which franchise it was
  for, and a readable label like *priya@testfoods.in (Test Foods)*. The label is
  saved on the record itself, because the internal app's audit screens can't
  look inside the private FOFO tables.
- Admin actions — sending emails, cancelling a link — are recorded with the
  admin's name, and automatic ones (a Razorpay payment) as *System*.
- Store credit spent from the dashboard records which franchise user spent it.

---

## Money rules, in one place

- **Amounts** are stored in rupees with exactly 2 decimals. **Unit prices** keep
  4 decimals, because a cost per kg is rarely a whole paisa.
- **Rounding:** work out each line, round it to the paisa, then add up the lines.
  Never round the unit price first, and never round only the total — they give
  different answers. The database checks every invoice line follows this.

Worked example — 12.5 kg paneer at ₹34.3333/kg, 5% GST:

```
taxable value   12.5 × 34.3333   = 429.1662  → ₹429.17
GST             429.17 × 5%      =  21.4585  → ₹21.46
line total                                     ₹450.63
Razorpay is asked for                          45063 paise
```

---

## One order, start to finish

1. The franchise adds paneer to the **cart** — quantity only.
2. They click pay. An **order** and its **order items** are created with prices
   frozen, and Razorpay is asked for **45063 paise**.
3. Razorpay confirms the payment. It is checked — right order, captured, INR,
   exactly 45063 paise — and only then is the order marked **paid**, a
   **payment** row recorded, and the goods **invoice** issued.
4. The purchase manager **accepts** it. Stock is taken off the shelf and a
   **stock_out** row points back at the order. If only 10 kg is available, they
   trim it, a **credit note** is issued for the missing 2.5 kg, and the franchise
   gets **store credit**.
5. The kitchen packs it. A **logistics invoice** is raised for transport, which
   the franchise can pay partly or fully with that store credit.
6. It ships, then is delivered.

---

## Keeping it private

- The `fofo` schema is **not exposed** through Supabase's public API. The
  internal app's key, which is visible in its browser code, cannot reach these
  tables at all.
- Every `fofo` table has row-level security switched on with no policies, so
  only the server's own key can read or write them.
- Franchises never see our costs, margins or stock levels — only final prices.

---

## Not in the database yet

| Missing | Why it matters |
|---|---|
| CGST / SGST / IGST split, kitchen and outlet states | Needed if these invoices become the official GST invoice. Being handled by the accounting team. |
| The purchase manager's **accept** function (file 14) | Stock-out, trim and credit note in one step. Not written yet. |
| What a franchise's **own user management** screen allows | Admins get full user management; the franchise's limited version isn't defined yet. |
| Invoice and credit note **numbering** | Must be gapless per financial year. Not built yet. |
| Invoice **paid / unpaid** status | Needed to block checkout when they owe money. |
| The API and screens | The partner app currently has only a health check. |
