# 0013. Store credit is a payment, not a discount — and it is spent in parts

Date: 2026-09-11
Status: Accepted

## Context

A FOFO order is paid up front. When the purchase manager cannot supply
everything, he trims the quantity, a credit note is issued for the difference,
and the money comes back as store credit — never as a bank transfer
(`fofo-dashboard-spec.md` §10).

Two questions had to be settled before any of that could be built.

**How much of a credit can be spent at once?** The design first said: all of it
or none of it, against one invoice. That is simple, and it fails in two ways.
A ₹1,000 credit could not touch a ₹400 invoice at all. And because a goods
invoice is only created *after* the payment lands, the only invoice a franchise
can still settle is the logistics one — so under a full-application rule, credit
from a trim could never be spent on goods at all. Credit that cannot be spent
and cannot be cashed out is a liability that sits on the books forever.

**What does applying credit do to the invoice?** This is the one that costs
money if it is wrong. Reducing the new invoice looks like the obvious
implementation and is a tax error.

## Decision

### Credit is spent in parts, oldest credit first

A balance is applied to an invoice up to whatever is still owed on it. It may
span several credits; it may leave a remainder; the rest of the invoice is paid
by Razorpay. Credits are drawn down in FIFO order — `ORDER BY created_at, id`.

FIFO changes nothing about the money, because credit never expires and every
rupee is worth a rupee. It is chosen because it is deterministic: the same
question gets the same answer next year, and two concurrent redemptions walk the
credits in the same order and therefore queue instead of deadlocking. The `id`
tiebreaker is there for the reason in decision 0009.

### Applying credit never alters the invoice

The invoice is issued at its full taxable value with its full GST, and the
credit settles part of what is **payable**. Exactly as cash would.

The tax was already adjusted, once, by the credit note that created the credit —
that is what a credit note is for. Taking the same amount off a later invoice as
a discount claims the relief a second time and undercharges GST on the new sale.
The two documents do different jobs: the credit note is a tax document about the
old sale, the application is a settlement record about the new one.

### Nothing stores a balance, and nothing stores a remaining amount

Two append-only tables: `fofo.store_credits` (earned, one row per credit note)
and `fofo.store_credit_applications` (spent, one row per part-payment). What is
left of a credit is its amount less its applications. A franchise's balance is
that, summed. `fofo.store_credit_statement` presents it; nothing persists it.

### The caps are a trigger, not application code

Applications against a credit can never exceed the credit; applications against
an invoice can never exceed the invoice; and a credit and an invoice in the same
application must belong to the same franchise. A `BEFORE INSERT` trigger locks
the invoice row and then the credit row — always that order — before it counts.

## Alternatives

**A `remaining_amount` column on each credit, decremented as it is spent.** The
proposal this record came from, and the intuitive answer. Rejected for one
specific reason: it records that ₹600 of CN-0007 was consumed but **not which
invoice consumed it**. That is the first question an auditor asks, and the first
question a franchise asks when it disputes a balance. It is also a maintained
number — when it disagrees with the rows, there is no way to tell which is
right, which is the same failure as a cached balance, one level down.

**One signed ledger, positive earned and negative spent.** The original design.
Works while credit is spent whole; the moment it is spent in parts, a negative
row cannot say which credit it drew from, so "what is left of CN-0007" becomes
unanswerable.

**Enforcing the caps in the API layer.** The rule is "read a total, then write
based on it", which is only safe with the row locked. Two requests read ₹600
available, both write ₹600, and the franchise has spent ₹1,200 of a ₹600 credit.
This was reproduced against a real Postgres before the trigger was written, and
the trigger was confirmed to block it.

**Issuing the goods invoice at accept rather than at payment.** This would fix
the "credit can only be spent on logistics" problem from the other end, and it
is the better answer to a different question — whether we should be invoicing
for goods before we know we can supply them. Not decided here; see
`fofo-accounting-review.md` §7. Partial spending is correct either way.

## Consequences

- A franchise's dashboard shows a statement, not a number — credits, what each
  was spent on, what is left. That is more screen, and it is what makes a
  disputed balance settleable.
- There is **no unapply.** An application is immutable, like an invoice. A
  misapplied credit has to be corrected with a compensating credit note, and if
  that turns out to happen in practice, the thing to add is a `reversed_at`
  column and a reversal row — not an `UPDATE`.
- Redemption must go through `fofo.apply_store_credit()`. Writing application
  rows directly works and is trigger-safe, but skips the "what is still owed
  after Razorpay" arithmetic and the audit event.
- A concurrent redemption loses and raises, rather than silently applying less.
  The caller retries. An error is the right outcome; a quietly smaller
  application is not.
- Credit redeemed **at checkout**, before the goods invoice exists, is recorded
  on the order and held until the money lands. It is then applied to the invoice
  exactly as described here. See decision 0020.
- This would have to be revisited if credit ever gained an expiry date, when
  FIFO stops being an arbitrary ordering and starts being a rule about which
  money dies first.

## Where it lives

- `migrations/fofo/07-create-fofo-money-tables.sql` — the two tables, the cap trigger,
  and the `store_credit_statement` view
- `migrations/fofo/08-create-fofo-store-credit-rpcs.sql` — `store_credit_balance()` and
  `apply_store_credit()`, with the FIFO drawdown and the verification queries
- `migrations/fofo/06-add-fofo-money-audit-category.sql` — the `fofo_money` audit
  category the redemption writes with
- `docs/fofo-dashboard-spec.md` §10 — the franchise-facing rules
- `docs/fofo-schema.md` §5.4 — the tables in plain words
