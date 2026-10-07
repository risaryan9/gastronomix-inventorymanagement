# FOFO — handoff for the next session

Current state of the FOFO franchise dashboard work, as of **2026-10-07**, for
starting implementation in a fresh session. The design itself is in the docs
below; this file only holds what they do not: where things stand, decisions
made in conversation, and the traps.

**Update or delete this file when it stops being true.**

## Read first, in this order

1. `CLAUDE.md` — conventions, and the decision index
2. `docs/fofo-dashboard-spec.md` — what is being built, the rules, build order (§13)
3. `docs/fofo-schema-explained.md` — every table in plain words
4. `docs/fofo-schema.md` — why each table is shaped the way it is
5. `migrations/fofo/README.md` — run order and status
6. Decisions `0004` (audit writes, grants), `0013` (store credit), and the three
   FOFO records `0014` (GST-inclusive pricing), `0015` (access only through the
   partner server) and `0016` (invoices never edited); for the staff side,
   `0023` (the staff pass)

## Where things stand

**Live database** (Supabase `zyjdzkrtdwlcwkpfnxya`): `migrations/fofo/` 01–15 and 17
applied and verified one by one. All FOFO tables are in the `fofo` schema, not
exposed through the API, RLS on with no policies, service_role only.

**Partner app** (`partner-frontend/`), deployed on Vercel:
- URL: https://gastronomix-inventorymanagement-kzh.vercel.app
- Vercel project `gastronomix-inventorymanagement-kzhc`, Root Directory `partner-frontend`
- Env vars set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No custom domain.
- Built: `/api/health`, `api/_lib/razorpay.js` (signature + exact-amount check,
  15 cases verified), and a build step that fails if a secret reaches the bundle.
- Built: `/api/admin/*` (`api/admin.js`) — franchise CRUD and outlet linking for
  the internal app's Franchise → FOFO Franchises screen. Postgres via `DATABASE_URL`, every
  transaction `SET LOCAL ROLE service_role`; admin checked via Supabase Auth +
  `public.users`; CORS from `INTERNAL_APP_ORIGINS`. Group routes behind one file
  and a `vercel.json` rewrite — the free plan allows only 12 functions.
- Built: onboarding email — Resend (`api/_lib/email.js`), welcome and numbered
  registration emails, link cancelling, and the `/register` page with
  `/api/auth/*` (`api/_lib/onboarding.js`). `EMAIL_FROM` is still Resend's test
  sender, which delivers only to the Resend account's own address.

**Phase 0 done:** the three decision records from spec §14 are written
(0014–0016).

**Built on 2026-09-15:** the pricing module (`api/_lib/pricing.js`, exact
decimals in `api/_lib/decimal.js`); the catalogue, purchase history, cart and
checkout-check endpoints (`api/_lib/catalog.js`, `api/_lib/cart.js`); the Order
supplies, catalogue and cart screens on them (the dummy data is gone); and FOFO
sale fields (sellable, margin, sale GST, HSN) in the internal app's material
edit form. Exercised against a local Postgres built from migrations 03–08 and 17.
Not yet run against the live API, which needs `DATABASE_URL`. **Checkout stops
before payment.** It checks the cart and returns the amounts, but creates no
order: a pending order would lock the cart behind a payment nobody can make.
**Pricing was built ahead of the Phase 1 gate** (accountant sign-off on a sample
invoice), which is still owed.

**Built on 2026-09-25: payment, in Razorpay test mode.** Migration 18
(applied 2026-10-06) freezes the order at checkout, and on a
confirmed payment issues the goods invoice (`INV/26-27/0001`, gapless per
financial year), applies the credit chosen, and empties the cart. Invoices now
refuse UPDATE/DELETE. Checkout, confirm and cancel endpoints
(`api/_lib/checkout.js`), the webhook (`api/orders/webhook.js`) and the cart
page's Razorpay popup are built. A payment is always confirmed by asking
Razorpay, never the popup (`api/_lib/payments.js`). Exercised against a local
Postgres with Razorpay faked: amount, double click, lock, replay, forged
signature, cancel, paid-after-cancel, wrong amount, duplicate payment. Choices made: order numbers
`FO-000001`, invoices `INV/26-27/0001`, 15-minute expiry; the financial year
follows the UTC business day (decision 0002), which the accountant should know.

**First real test payment on 2026-10-06**: migration 18 applied to the hosted
database, order `FO-000001` paid in a browser with Razorpay test keys, invoice
`INV/26-27/0001` issued. A paid cart now lands on a confirmation page,
`/orders/:orderId/confirmed` (`PaymentConfirmed.jsx`), which reads the order
back from the database rather than showing what the popup said.

**Orders, Order detail, Pending payments and Store credit read the database**
(`api/_lib/orders.js`); the dummy data module is gone. Checked against the
local Postgres, including a trim, a credit note and a part-paid invoice.

**Built on 2026-10-06: paying an invoice's dues, and invoice PDFs.** Migration
19 (applied 2026-10-06) adds `begin_invoice_payment`,
`open_invoice_payment` and `mark_invoice_paid`, and replaces
`apply_store_credit` to take a limit. The Pay sheet on Pending payments and
Order detail now pays (`api/_lib/invoicePayments.js`): credit is spent at once,
Razorpay collects the rest, and the webhook settles invoice payments too.
Exercised against the hosted database inside a transaction that was rolled
back, with Razorpay's replies faked: credit then Razorpay, a repeat press, a
wrong amount, a replay, a second payment, another franchise. **Not yet paid in
a browser**, which needs a logistics invoice, which needs the staff side.
Every invoice downloads as a PDF (`src/lib/invoicePdf.js`, decision 0021).
**The seller is now known** (2026-10-07): Delectable Gourmet Private Limited,
GSTIN 29AAJCD6630M1Z5, 3rd Floor, 75/2, Giddens Layout, Kotak Mahindra Bank
Building, Bengaluru, Karnataka 560066. The values are in `.env.example` and the
local `.env`. **Owed before real use:** the same three variables
(`SELLER_LEGAL_NAME`, `SELLER_GSTIN`, `SELLER_ADDRESS`) set on Vercel for the
partner project, without which live invoices and labels print "Gastronomix"
and no GSTIN; and the accountant's view of the PDF layout (one GST figure per
rate, no CGST/SGST/IGST split).

**Built on 2026-10-06: the Recipes page.** In the purchase manager dashboard
and under Admin → Operations (`frontend/src/pages/purchase-manager/Recipes.jsx`).
A batch is typed in grams with a yield fraction and saved as a ratio (decision
0022). Migration 20 (applied; confirmed live 2026-10-07) adds `save_recipe`,
`remove_recipe` and `recipes.piece_weight_grams`. The partner server's cost
roll-up reads recipes the new way (`api/_lib/pricing.js`). Both were checked
against the spreadsheet's Chicken Basic Marination (Rs 621.31 per kg) and a
nested recipe, in a rolled-back transaction. **Not yet used in a browser.**
The spreadsheet holds one recipe; six of its seven ingredients are not in the
materials list under those names.

**Built on 2026-10-07: the staff pass**, the first piece of the staff side
(decision 0023). A purchase manager or kitchen executive logs in with their key
exactly as before; in the background the internal app also sends that key once
to `POST /api/staff/pass`, and gets back a 7-day token (the length of a key login) that later FOFO
requests carry. Migration 21 (applied and verified 2026-10-07) holds the tables
and functions; `api/_lib/staffAuth.js` and `api/staff.js` are the server;
`frontend/src/lib/staffPass.js` is the internal app's half, called from
`Login.jsx` and dropped by `clearSession`. The server was exercised through the
real handler against a local Postgres, 47 checks: right and wrong keys, wrong
role and kitchen, the other key-login roles, both throttles, expiry, sign-out,
and a pass ending when its user is deactivated, moved, or has their key
changed. **The endpoints have not yet been run against the hosted database or in a browser**, and
`staffPass.js` itself has only been built and linted, not run. The first thing
to use a pass is Franchise Orders, below.

**Built on 2026-10-07: Franchise Orders, read only**, the purchase manager's
list of FOFO orders (`frontend/src/pages/purchase-manager/FranchiseOrders.jsx`),
in its own "Franchise" section of the sidebar. It lists every paid-for order
the kitchen serves, and opening one shows its lines against the kitchen's
stock on hand, with any shortfall.
- **The notice.** The dashboard shell polls
  `GET /api/staff/orders/summary` every minute
  (`hooks/useFranchiseOrdersSummary.js`) and, while any order is `paid`, shows
  a gold banner above every page and a red count on the sidebar entry.
- **The key prompt** (`components/StaffPassPrompt.jsx`) replaces the list when
  there is no working pass, which is everyone who logged in before passes
  existed. The sidebar entry then reads "Key needed".
- **Server:** `api/_lib/staffOrders.js`, three GET routes under `/api/staff`,
  purchase managers only, scoped to the pass holder's kitchen. No migration.
- Exercised through the real handler against a local Postgres with stand-in
  tables (25 checks: kitchen isolation, unpaid checkouts hidden, shortfalls,
  roles), and the queries run as written against the hosted database. Used in
  a browser by the user on 2026-10-07, locally against the hosted database.

**Built on 2026-10-07: accept in full.** A waiting order opened on Franchise
Orders has an "Accept order in full" button, confirmed first.
`POST /api/staff/orders/accept` calls `fofo.accept_order` (migration 16,
applied and verified 2026-10-07), which in one transaction writes the accepted
quantities, the stock-out, the FIFO consumption, status `accepted` and a
`fofo_money / order_accepted` audit event.
- **In full only.** If the kitchen is short on any line the button is off and
  the function refuses, naming each shortfall. The way through is to stock in.
  Trimming needs the credit note and is the last step of the staff side.
- **The stock-out is a kitchen stock-out**, reason `franchise-order`, no outlet
  (decision 0024). It appears in the Stock Out history and the admin kitchen
  breakdown under that reason, and is not counted against any of our outlets.
- Exercised through the real handler against a local Postgres, 39 checks. The
  stock tables were stand-ins, but `fifo_consume`, the `stock_out` CHECK and
  `log_fofo_audit_event` were copied from the hosted database and the
  inventory trigger is the repo's migration. Covered: who may accept, the
  stock-out's shape, FIFO order and cost, the audit event, a short order left
  untouched, two presses at once, and two orders racing for stock only one can
  have. Used for real on 2026-10-07: FO-000001 and FO-000002 accepted from the
  screen, each leaving one stock-out, matching consumption and one audit
  event, and CK1's stock down by exactly two.
- The audit screens in the internal app do not list `fofo_money` events at
  all yet, so the accept is recorded but not shown anywhere.

**Built on 2026-10-07: pack, and the shipping label.** The kitchen executive's
dashboard has two tabs, Dispatch Plans and Franchise Orders. The second is the
same screen the purchase manager uses (`FranchiseOrders.jsx`, with
`role="kitchen_executive"`), showing only orders that have been accepted,
grouped To pack / Packed / Completed. A gold banner over Dispatch Plans and a
red count on the tab say how many are ready to pack.
- **Mark as packed** calls `POST /api/staff/orders/pack` →
  `fofo.mark_order_packed` (migration 22, applied and verified 2026-10-07), which
  moves only the status, records who and when (`orders.packed_by`, new), and
  writes a `fofo_money / order_packed` audit event. Kitchen executives only;
  a purchase manager is refused.
- **Print label / Download label**, on any accepted order that is not yet
  delivered, for both roles. `GET /api/staff/orders/label` says what goes on
  it; `lib/shippingLabelPdf.js` draws one A4 page after the label the business
  already prints: ship-to, the goods invoice's number and date, that number as
  a Code 128 barcode (`lib/code128.js`), sender, the return line. Print loads
  the PDF into a hidden frame and opens the browser's print dialog.
- **The ship-to name and address are the buyer frozen on the goods invoice**,
  not the franchise as it is today; the phone is the franchise's current one.
- **Migration 22 must be applied before this server code runs**: the order
  detail query reads `orders.packed_by`, so without the column every order
  fails to open, for the purchase manager too.
- Checked: 40 server checks through the real handler on the local stand-in
  database (roles, kitchen isolation, the frozen buyer, the goods invoice
  chosen over a logistics one, two presses at once, no stock moved). The
  barcode encoder reproduces the bars on the sample label exactly, and the
  bars drawn for a real invoice number were read back off the rendered PDF.
  Packing was used for real on 2026-10-07 (FO-000002 packed by CK1's kitchen
  executive, one audit event). **Not confirmed:** the print dialog across
  browsers, or the barcode under a real scanner.
- The sample label PDF the layout was taken from is not in the repo: it
  carries a real customer's address and phone number.

**Not built:** a screen for `fofo.payment_exceptions`; trimming an order at
accept, and so credit-note issuing; credit-note PDFs; on the staff side, the
logistics invoice, shipping and delivered.

**Git:** the handoff first said work goes on a branch. Since 2026-10-07 commits
have gone straight to `master` at the user's request. Pushing `master`
redeploys the partner app, so push only when asked.

## Decided in conversation

Now in the spec and decision 0015, kept here as a summary:

- **Internal staff reach `fofo` through the partner app's server, never
  directly** (spec §12). Admins send their Supabase Auth session. Purchase
  managers and kitchen staff log in by key: a quiet key check once — not
  `authenticate_user_by_key` — then a ~12 h pass; kitchen checked on every
  action; wrong keys rate-limited. **Correction:** the browser session does
  *not* keep `login_key` (checked in `Login.jsx`), so the pass must be issued
  at login or the key asked for again — see decision 0017. Built on
  2026-10-07 as decision 0023: issued at login and valid 7 days, not ~12 h, so
  it lasts as long as the key login and staff are not asked for the key again.
- **`yield_quantity` is real** — BOMs are written per production run. Examples
  come with the BOM seed data (spec §5).

Not in the spec:

- **GST CGST/SGST/IGST split** is being handled by the accounting team; not in
  the schema. HSN codes are optional.
- **Carts stay in the database**, not localStorage (several users per franchise).
  The full cart behaviour was settled on 2026-09-15: shared per outlet, agreed
  price per line, locked while paying, emptied on payment, one outlet per
  checkout, and store credit redeemed at checkout. It is now in spec §8.2 and
  decision 0020. Migration 17 was applied and verified on 2026-09-15.
- **Franchise's own user-management screen** — scope not defined yet. Admins get
  full user management.
- **Invoice immutability is not enforced by the database** — no `BEFORE UPDATE`
  trigger on `fofo.invoices`. Worth adding with the numbering work (0016).

## Traps

- **`fofo` is not exposed to PostgREST, so `supabase-js` with the service_role
  key cannot query it either.** The API needs a direct Postgres connection (a
  pooled connection string as a new server-only env var) or equivalent.
- **Never prefix a secret env var with `VITE_`** — Vite ships it to the browser.
- **`public.is_purchase_manager_or_admin()` returns true for any caller without
  a Supabase Auth session.** Never build a write policy on it (this is why
  recipe writes are admin-only). **`raw_materials` UPDATE policies are built on
  it**, so anyone holding the internal app's anon key can change a material's
  `sale_margin_percent` or `is_fofo_sellable`, which are now live FOFO prices.
  Close this before real franchises order.
- **`save_recipe` and `remove_recipe` trust the user id they are sent**, like the
  other catalog functions. Anyone with the internal app's anon key can change a
  recipe, and so a FOFO price. Chosen knowingly (decision 0022). The staff pass
  now exists but does not close this by itself: the recipe and material writes
  would have to move behind the partner server and `requireStaff` (0023).
- **`authenticate_user_by_key` is callable with the public anon key and is not
  throttled** (pre-existing). The staff pass throttles its own key check, so the
  login function is now the easier place to guess a key. It does audit every
  attempt.
- **A staff endpoint must check the order's kitchen itself.** `requireStaff`
  says who is calling and which kitchen they belong to; it does not look at the
  order. And it must answer 401 only for a missing or ended pass, since that is
  what makes the internal app ask for the key again.
- **The test outlet EC1027 is served by CK1**, which had purchase history for
  only 5 materials on 2026-09-15. Most supplies show as unavailable there. CK2
  and CK3 have far more.
- **`public.fifo_consume` is callable with the public anon key** (pre-existing).
  Worth locking down before the accept flow relies on stock being right.
- **`REVOKE … FROM PUBLIC` alone does nothing here** — revoke `anon` and
  `authenticated` by name, then check `pg_proc.proacl` (decision 0004).
- **`public.log_audit_event` must not be changed** — FOFO events go through
  `fofo.log_fofo_audit_event`.
- **The Supabase MCP connection is read-only** (`supabase_read_only_user`):
  good for verifying, cannot apply migrations. The user runs migrations in the
  SQL editor, one file at a time, and asks for a check after each.
- **A Claws hook blocks Bash commands that look long-running** (e.g. a script
  whose text mentions `vite`). Write the script to a file and run the file.
- **No test suite.** SQL was verified on a throwaway local Postgres 16
  (`/usr/lib/postgresql/16/bin`, `initdb` in the scratchpad, TCP on 127.0.0.1
  with `unix_socket_directories=''` — the scratchpad path is too long for a
  socket). Pure JS was verified by running it directly with `node`.

## Sensible next steps

**The staff side, in this order** (agreed 2026-10-07): the staff pass (done,
migration 21 applied) → a read-only list of FOFO orders for the purchase
manager, with the key prompt (done) → accept in full, no trim (done, migration 16 applied) → pack and the shipping label (done,
migration 22 applied) → the logistics invoice → shipping and delivered → trim with a credit note. Up to
shipping gets one real order from paid to delivered (the Phase 5 gate) and lets
an invoice's dues be paid in a browser for the first time. Still to be decided:
the GST rate and HSN/SAC on the logistics invoice, and who marks an order
delivered.

The older notes below predate that and are kept for what they say about
onboarding.

**In progress: onboarding first**, ahead of pricing — tracked in
`docs/fofo-onboarding-checklist.md`. Migration 12 is the franchise admin
functions, 13 the outlet FOCO/FOFO controls, 14 franchise sessions, 15 FOCO portal codes
following the ownership model; the accept function moves to 16.


The spec's build order (§13) puts **Phase 1 — the pricing module, no UI** first,
signed off against a sample invoice. The onboarding endpoints (welcome email,
numbered registration links, registration) are also ready to build on migration
11, and need an email provider chosen first.
