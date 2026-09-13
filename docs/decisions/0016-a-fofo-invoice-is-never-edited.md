# 0016. A FOFO invoice is never edited — a trim issues a credit note

Date: 2026-09-13
Status: Accepted

## Context

A franchise pays up front, and the goods invoice is issued when the payment
lands. The purchase manager checks stock later, at accept, and may have to trim
a quantity. At that point the invoice says more than was supplied.

The obvious fix is to update the invoice line and its totals. That is a tax
error: a GST invoice, once issued, is a document the buyer may already have
filed against, and invoice numbers must run gapless and unaltered per financial
year.

## Decision

**An invoice row and its lines are never updated or deleted.** Not a quantity,
not a total. A trim creates a **credit note** pointing at the invoice for the
difference, and the money comes back as store credit (decision 0013).

**`invoice_items` is a copy, not a view onto `order_items`.** The order is the
living record — `quantity_accepted` is written on it at accept. If the invoice
joined live to the order, that write would silently rewrite an issued invoice.
The buyer's name, GSTIN and address are copied onto the invoice for the same
reason.

**Numbers are allocated only when the document is really issued.** An invoice
number when money is confirmed, never at checkout — an abandoned checkout must
not punch a hole in the series. Order numbers are allocated at checkout, where
gaps are harmless.

## Alternatives

**Edit the invoice on a trim.** Rejected above: rewrites a filed tax document.

**Cancel the invoice and reissue it.** Legal, but leaves a cancelled number in
the series and two documents for one sale, and the cancelled one still has to be
reported. A credit note is the instrument designed for exactly this.

**Issue the goods invoice at accept instead of at payment**, treating the payment
as an advance receipt (`fofo-accounting-review.md` finding 7). This would make
most credit notes unnecessary. It is **still open**, and does not change this
record: whenever the invoice is issued, it is never edited afterwards.

## Consequences

- Every screen must say which figure it shows — ordered, accepted, invoiced or
  credited. `orders.subtotal`/`grand_total` stay at the ordered amounts after a
  trim.
- A credit note must never exceed what is left of its invoice. No constraint
  enforces that yet; the accept function (migration 12) must check it.
- **Immutability is a rule, not yet a guard.** Nothing in the database refuses an
  `UPDATE` on `fofo.invoices` today. Only the server's service_role connection can
  write there, but a `BEFORE UPDATE OR DELETE` trigger would make the rule
  impossible to break rather than merely documented.
- Gapless numbering needs a counter row locked inside the issuing transaction,
  not a sequence (sequences skip on rollback). Not built yet.

## Where it lives

- `migrations/fofo/07-create-fofo-money-tables.sql` — invoices, invoice_items,
  credit_notes, and the header explaining the split
- `docs/fofo-dashboard-spec.md` §7.2, §10
- `docs/fofo-accounting-review.md` findings 7, 10, 16
