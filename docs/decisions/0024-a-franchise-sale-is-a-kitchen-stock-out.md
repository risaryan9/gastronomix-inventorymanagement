# 0024. A franchise sale leaves stock as a kitchen stock-out

Date: 2026-10-07
Status: Accepted

## Context

When a purchase manager accepts a FOFO order, stock leaves the kitchen and a
`public.stock_out` row records it, linked to the order by `fofo_order_id`
(migration 09).

`stock_out` allows exactly two shapes, enforced by
`stock_out_self_stock_out_check`:

- **a requisition**: `self_stock_out = false`, with an `allocation_request_id`
  and an `outlet_id`, both required;
- **a kitchen stock-out**: `self_stock_out = true`, with a `reason`, and neither
  of those.

A sale to a franchise is neither. It goes to an outlet, but there is no
allocation request. Migration 09 assumed a third shape would simply be written;
the constraint, which predates it, refuses one.

## Decision

**A franchise sale is written as a kitchen stock-out**: `self_stock_out = true`,
`reason = 'franchise-order'`, `fofo_order_id` set, `outlet_id` and
`allocation_request_id` null. `fofo.accept_order` (migration 16) is the only
thing that writes it.

The outlet is not lost. It is on the order, one join away through
`fofo_order_id`, and the stock-out's `notes` name the order, the franchise and
the outlet for anyone reading the row by eye.

## Alternatives

**Widen the constraint to allow a third shape** (`self_stock_out = false`, an
outlet, a FOFO order, no allocation request). Reads more naturally, and is what
09 imagined. Rejected because across the internal app `self_stock_out = false`
*means* "one of our own outlets took this through a requisition": the Stock Out
history reads such rows as outlet stock-outs with an allocation request behind
them, and the admin kitchen detail counts them per outlet
(`lib/adminKitchenDetail.js`). A franchise sale would have appeared in those as
something it is not. Each place that filters on `self_stock_out = false` would
have needed checking and changing before the first order could be accepted.
(The requisition reports start from allocation requests, so they would not have
seen it either way.)

**Leave stock alone at accept and have the purchase manager stock out by hand**,
as dispatch does (decision 0010). Rejected: the franchise has already paid, so
the goods must be committed at the moment they are promised, and the accept must
be able to fail as a whole if they are not there (09).

## Consequences

- **A franchise sale shows wherever kitchen stock-outs show**, with the reason
  "franchise order": the Stock Out history, the Overview's recent stock-outs
  (as "Self Stock Out"), and the admin kitchen breakdown by reason. It is not
  counted against any of our own outlets. That is the intended reading:
  stock left the kitchen, not for one of our outlets.
- **`reason = 'franchise-order'` must not be offered in the kitchen stock-out
  form.** It is not in `KITCHEN_REASON_OPTIONS` and must stay out: a stock-out
  with that reason and no order behind it would be a sale nobody was billed for.
- **To find franchise sales, filter on `fofo_order_id IS NOT NULL`**, not on the
  reason. The reason is a label; the link is the fact.
- **A report of "wastage and other kitchen stock-outs" now includes sales**
  unless it filters by reason. The admin breakdown is by reason, so it shows
  them as their own line. Anything new that sums kitchen stock-outs as loss
  must exclude this reason.
- The labels live in two maps (`STOCK_OUT_REASON_LABEL`,
  `SELF_STOCK_OUT_REASONS`); screens without an entry print the slug with its
  hyphen removed, which is why the slug is plain words.
- If the constraint is ever widened for another reason, this could become its
  own shape. That would be a data migration of existing rows, and a new record.

## Where it lives

- `migrations/fofo/16-create-fofo-accept-order-rpc.sql` — `fofo.accept_order`
- `migrations/fofo/09-link-stock-out-to-fofo-orders.sql` — `stock_out.fofo_order_id`
- `frontend/src/lib/auditEvents.js`, `frontend/src/lib/adminKitchenDetail.js` — the labels
- `frontend/src/pages/purchase-manager/StockOut.jsx` — `KITCHEN_REASON_OPTIONS`, which must not gain it
