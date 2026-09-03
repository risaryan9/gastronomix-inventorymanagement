# 0002. The business day is the UTC date

Date: 2026-09-03 (recorded); decided 2026-02, after a reversal
Status: Accepted

**If you are here because deriving an Indian business's dates from UTC looks
like a bug: it is not. Read this before changing it. Someone already did.**

## Context

`allocation_requests.request_date`, `dispatch_plan.plan_date`,
`stock_out.allocation_date` and `stock_in.receipt_date` are Postgres `date`
columns. A date has no timezone, so something has to decide when the day rolls
over. That is a business question, not a display one.

## Decision

The business day is the **UTC** date, on both sides:

- `public.business_today()` in the database
- `getBusinessDate()` in `frontend/src/lib/businessDate.js`

UTC runs 5:30 behind IST, so this means in practice: **the business day does not
roll over until 05:30 IST.** That matches how the kitchen runs — a late shift
routinely finishes after midnight, and that work belongs to the day it started.

## Alternatives

**IST (`now() AT TIME ZONE 'Asia/Kolkata'`).** This was tried, on the reasoning
that the business is in India so UTC must be wrong. It broke real work:

- A dispatch plan locked at 10:00 IST and its closing form filed at 00:30 the
  next morning landed on different days, so Checkout showed "No locked dispatch
  plan found for today" and the supervisor had no way through.
- A draft plan carried past midnight vanished from "today" and could not be
  locked.
- The dispatch executive's duplicate-plan guard lifted at midnight, so a second
  plan could be created for the same working night.

Not hypothetical: 20 records were created in the midnight hour alone — 6
stock-outs, 4 stock-ins, 10 requisitions — plus more at 01:00 and 04:00 IST.

**Scattering `toISOString()` back through the call sites.** Rejected when the
revert was made: the rule now lives in exactly one place on each side so the two
cannot drift apart.

## Consequences

- **The two definitions must change together, or not at all.** Records written
  under one definition and searched for under another is precisely the failure
  above. A change to `getBusinessDate()` without the matching change to
  `business_today()` is a data-integrity bug, not a display bug.
- The requisition cutoff ([0005](0005-requisition-cutoff-is-a-database-trigger.md))
  does its arithmetic in UTC for the same reason, and gets the 00:00–05:29 IST
  case right for free.
- The honest version of this rule is "the business day starts at 06:00 IST"; UTC
  approximates it at 05:30. Making it exact is a legitimate improvement — but it
  is a change to both definitions, in one migration, not a tweak to either.

## Where it lives

- `frontend/src/lib/businessDate.js` — carries the long-form warning
- `migrations/revert-business-day-to-utc.sql` — `public.business_today()`
- Commit `166ff9f` — the revert, with the traffic that justified it
