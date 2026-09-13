# FOFO migrations

Everything the FOFO franchise dashboard adds to the database. Kept in its own
folder because it is one feature that must be applied as a set, in order — the
rest of `migrations/` is a flat history and does not work that way.

**Status: 01–11 were applied to the live database on 2026-09-13**, in number order, each verified
against the live schema before the next was run. For a fresh environment, run
them the same way — in order, on a branch or backup first, running each file's
verification block before moving on. 12 is not written yet.

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
| 12 | `12-create-fofo-accept-order-rpc.sql` | **not written yet** — the purchase manager's atomic accept | 07, 09, 10 |

01 and 02 are all Phase 1 of the build plan needs. Two rules that apply to every
file here: do **not** add `fofo` to Supabase's exposed schemas, and check any
new function's grants in `pg_proc.proacl` rather than trusting a `REVOKE`
(decision 0004). The reasoning for all of it is in `docs/fofo-schema.md`.
