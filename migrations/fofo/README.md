# FOFO migrations

Everything the FOFO franchise dashboard adds to the database. Kept in its own
folder because it is one feature that must be applied as a set, in order — the
rest of `migrations/` is a flat history and does not work that way.

**Status: 01–15 and 17 were applied to the live database** (01–13 on 2026-09-13, 14–15 on 2026-09-14, 17 on 2026-09-15), in number order, each verified
against the live schema before the next was run. For a fresh environment, run
them the same way — in order, on a branch or backup first, running each file's
verification block before moving on. 16 is not written yet. 17 does not depend on 16 and was
run first.

| # | File | Adds | Needs |
|---|---|---|---|
| 01 | `01-add-fofo-sale-columns-to-materials.sql` | sellable flag, HSN, sale GST, margin on `raw_materials` | — |
| 02 | `02-add-recipes-and-recipe-items.sql` | BOM tables (`recipes`, `recipe_items`) | — |
| 03 | `03-create-fofo-schema.sql` | `fofo` schema, franchises, their outlets and users | — |
| 04 | `04-add-ownership-model-to-outlets.sql` | `outlets.ownership_model` | — |
| 05 | `05-create-fofo-orders-and-carts.sql` | carts, orders, order items | 03 |
| 06 | `06-add-fofo-money-audit-category.sql` | `fofo_money` audit category | — |
| 07 | `07-create-fofo-money-tables.sql` | invoices, payments, credit notes, store credit | 05 |
| 08 | `08-create-fofo-store-credit-rpcs.sql` | credit balance and redemption functions | 06, 07 |
| 09 | `09-link-stock-out-to-fofo-orders.sql` | `stock_out.fofo_order_id` | 05 |
| 10 | `10-track-franchise-users-in-audit-events.sql` | audit columns naming the franchise user; `log_fofo_audit_event`; `apply_store_credit` records who | 03, 06, 07, 08 |
| 11 | `11-add-franchise-registration-invitations.sql` | welcome email stamp, numbered registration links, `franchise_users` reshaped for registration | 03, 10 |
| 12 | `12-add-franchise-admin-functions.sql` | create/edit/deactivate franchises, link/unlink outlets; `contact_email` required | 03, 04, 05, 10, 11 |
| 13 | `13-add-outlet-ownership-model-controls.sql` | admins mark outlets FOCO/FOFO; trigger keeps a franchise-owned outlet FOFO | 03, 04, 10, 11 |
| 14 | `14-add-franchise-sessions.sql` | partner-app sessions, sign-in throttling, sign-in/out and reset audit | 03, 10, 11 |
| 15 | `15-tie-foco-portal-codes-to-ownership-model.sql` | FOFO turns an outlet's FOCO portal code off, FOCO back on; linking accepts FOFO outlets only. Replaces `set_outlet_ownership_model` (13) and `link_franchise_outlet` (12) | 12, 13 |
| 16 | `16-create-fofo-accept-order-rpc.sql` | **not written yet** — the purchase manager's atomic accept | 07, 09, 10 |
| 17 | `17-add-cart-price-agreement-lock-and-checkout-credit.sql` | applied 2026-09-15 — cart lines remember their agreed price; cart locked while paying and emptied on payment; `orders.store_credit_to_apply` held against the balance, `amount_paise` excludes it (decision 0020) | 05, 07, 08 |

01 and 02 are all Phase 1 of the build plan needs. Two rules that apply to every
file here: do **not** add `fofo` to Supabase's exposed schemas, and check any
new function's grants in `pg_proc.proacl` rather than trusting a `REVOKE`
(decision 0004). The reasoning for all of it is in `docs/fofo-schema.md`.
