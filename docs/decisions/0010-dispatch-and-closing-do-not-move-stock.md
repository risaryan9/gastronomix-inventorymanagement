# 0010. The dispatch plan and the closing sheet are records; they do not move stock

Date: 2026-09-03
Status: Accepted — **deliberately temporary, see "Where this is going"**

## Context

The dispatch/closing flow half-moved stock. Confirming a supervisor's closing
sheet created a `stock_in` plus `stock_in_batches` from the returned quantities,
and a trigger on that table pushed the totals into `inventory.quantity` — so
returns went back on the books automatically, while everything else physically
moving through the kitchen was recorded by a purchase manager by hand.

That automatic path also priced returns wrongly. It copied `unit_cost` from the
material's most recent batch but set `gst_percent = 0`, so returned stock came
back valued *excluding* GST while all other stock is valued GST-inclusive
([0003](0003-inventory-value-is-gst-inclusive.md)). A material with no prior
batch in that kitchen returned at a cost of zero.

## Decision

**Neither the dispatch plan nor the closing sheet changes what the system
believes is on the shelf.** Both are records. The purchase manager performs the
matching stock-in and stock-out, as they already do for everything else.

Concretely, `confirm_checkout_form()` no longer creates a `stock_in` or any
batches. It still validates, totals what was returned, marks the form
`confirmed`, and writes its audit event.

Two things about scope worth knowing:

- **The dispatch plan never moved stock.** `save_dispatch_plan()` writes
  `dispatch_plan` and `dispatch_plan_items` only; the kitchen executive screen
  reads `inventory` purely to show on-hand while drafting. That half of the rule
  was already true and needed no change.
- **On the closing sheet, only returns ever moved stock.** Wastage, cash,
  payment-onside and the additional details have always been stored as data.

## What stays, and why

- **Every guard on confirm** — plan exists, plan is locked, locked within 24
  hours, form not already confirmed. They read as stock guards but they are
  data-quality guards: they keep a closing sheet attached to the dispatch it
  closes.
- **The confirmed status and its edit lock.** The old reason was that a
  `stock_in` already described those numbers. The new reason is better: a
  purchase manager will have keyed stock against these figures by hand, and
  numbers that move after someone has acted on them are worse than numbers that
  cannot be corrected. (The inline comment in `save_checkout_draft()` still
  gives the old reason and is stale; correcting a comment was not judged worth a
  `CREATE OR REPLACE` of a 200-line function.)
- **`total_returned_qty`** in the audit payload — still true, still worth
  recording. `stock_in_id` was dropped along with the stock movement; nothing
  consumed it.

## Where this is going

**This is a staging post, not the destination.** The intended end state is that
the flow moves stock on its own, at both ends:

- **Locking a dispatch plan issues a stock-out** for the planned quantities.
  That is the moment the material physically leaves the kitchen for the outlets,
  and it is the event a stock-out already models.
- **Confirming the closing sheet issues a stock-in** for what came back —
  roughly what `confirm_checkout_form` used to do, done properly.

The reason it is manual today is not that automation is wrong. It is that the
automatic half that existed was wrong in ways that made the numbers untrustworthy
(the GST and zero-cost pricing above), and it was automatic on only one end —
returns came back in without the dispatch ever having gone out, so the two never
had to agree. Doing it by hand keeps one person accountable for the figures while
the flow settles.

**What must be true before the automation comes back:**

- **Both ends land together.** A stock-in for returns without a stock-out for the
  dispatch counts stock back onto a shelf it never left, which is the shape of
  the bug being removed here. Ship the pair or neither.
- **Returns price GST-inclusive**, per
  [0003](0003-inventory-value-is-gst-inclusive.md). Returned stock is the same
  stock that went out; it should come back at the cost it left at, not at a bare
  `unit_cost` with GST dropped and not at zero.
- **Returning stock is matched against what was dispatched**, not priced off
  whatever batch happens to be newest. A return is a reversal of a specific
  issue, and the batch it came from is knowable.
- **The reversal path is designed first.** A plan unlocked, a sheet corrected, a
  confirmation cancelled — each has to put the stock back. `pack_allocation_request`
  and `cancel_allocation_packing` are the pattern to follow.
- **Wastage stays out of it.** Wasted stock did not return; it should reduce
  stock, or be reported as loss, but it is not a stock-in and must never be
  folded into one.

Until all of that is true, this record stands. When it changes, supersede this
record rather than editing it — the fact that we ran the flow manually for a
period is part of how the numbers from that period should be read.

## Alternatives

**An off switch per kitchen, defaulting to off.** Rejected. "For now" invites a
flag, but a dormant code path nobody exercises rots, and it doubles what every
future reader has to reason about. Git and this record are the restore path, and
they say exactly what the code did.

**Reversing the stock-ins that past confirmations created.** Rejected. Inventory
keeps whatever those returns added. Reversing would subtract a second time
wherever a purchase manager has already corrected a count by hand, and it would
rewrite history to look as though this had always been the rule.

## Consequences

- **Returns are captured but nothing acts on them automatically.** The purchase
  manager needs to see what came back. That is what the returns view in the
  purchase manager section is for — without it this change silently drops the
  returns on the floor.
- Inventory will drift from physical stock if a return is never keyed in. That
  is the accepted trade: a wrong number entered automatically is harder to
  notice than a missing one.
- The GST-and-zero-cost pricing bug described above is gone with the code that
  had it. If automatic returns ever come back, they must price GST-inclusive per
  [0003](0003-inventory-value-is-gst-inclusive.md).
- Historical `stock_in` rows with `stock_in_type = 'kitchen'` and a
  "Supervisor checkout return for dispatch_plan …" note are from the old
  behaviour. They are real and stay.

## Where it lives

- `migrations/stop-checkout-confirm-from-creating-stock-in.sql`
- `migrations/sync-inventory-from-batches-trigger.sql` — the trigger that used
  to be fed, still in place for genuine stock-ins
- `frontend/src/pages/supervisor/Checkout.jsx` — the confirm modal and its
  success message
- `docs/AUDIT_TRAIL_REQUIREMENTS.md` §3.F1/F2
- `CHECKOUT_FEATURE_IMPLEMENTATION.md`, `CHECKOUT_FEATURE_QUICK_START.md` —
  both describe the old behaviour and carry a banner saying so
