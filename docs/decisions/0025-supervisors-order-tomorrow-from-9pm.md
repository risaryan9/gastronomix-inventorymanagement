# 0025. Supervisors order tomorrow from 21:00; only the requisition date moves

Date: 2026-10-15
Status: Accepted

## Context

Under [0005](0005-requisition-cutoff-is-a-database-trigger.md) a supervisor at a
Nippu Kodi or El Chaapo outlet could raise a requisition only between 05:30 IST
and the kitchen's cutoff (10:30–11:30). Supervisors who start late would rather
send tomorrow's order the night before, sometimes after midnight, than wake up
for it.

The business day is the UTC date ([0002](0002-business-day-is-the-utc-date.md)),
so between midnight and 05:30 IST the business day is still yesterday. A
requisition raised then, or at 22:00, would be dated today: a day whose window
has closed and whose packing may be done.

## Decision

**The window for business day D runs from 21:00 IST on D-1 to the cutoff on D,
and a requisition raised in the night part of it is dated D**, the day it is
for.

In UTC this is one rule with no midnight case: from 15:30 UTC (21:00 IST) until
the UTC day ends (05:30 IST), a cutoff-bound supervisor's requisition is for the
next UTC date. 22:00 IST and 02:00 IST are 16:30 and 20:30 UTC on the same UTC
day. Between the cutoff and 21:00, nothing is open.

**Only `request_date` moves, and only for NK/EC supervisors.** `business_today()`
and `getBusinessDate()` are untouched. Checkout, closing, dispatch, stock
movements and reports all keep the UTC business day. The screens that decide
"which requisition is this" use `getRequisitionDate()`; nothing else does.

**The database dates the row.** `public.requisition_date_for()` is the rule;
`save_allocation_request` calls it. The cutoff trigger now also refuses a
supervisor's row whose `request_date` is not that date, which closes an older
hole: RLS lets a supervisor insert directly, and the trigger used to check only
the clock.

**The cutoff must be before 21:00 IST** (CHECK
`cloud_kitchens_requisition_cutoff_before_next_window`), so today's window and
tomorrow's can never overlap.

## Alternatives

**Open at midnight IST instead of 21:00.** Fixes only the supervisors still up
after midnight; one at 22:30 stays locked out. Same work, same risks, smaller
benefit.

**Move the business day to midnight IST.** Tried and reverted (0002): dispatch
plans and closing forms split across two days and supervisors were stuck at
checkout. This decision deliberately moves one column instead of the day.

**Shift everyone's requisitions, not only NK/EC supervisors.** Rejected on data.
Boom Pizza operators raise about 200 requisitions a month between 21:00 and
01:00, dated the day they are raised and packed around 07:00 the next morning.
Simulated over the 60 days to 2026-10-15, shifting them produced a collision
with the one-requisition-per-outlet-per-day rule; supervisors only produced
none. The purchase manager also stays on today, so a late phone request at 22:00
still lands on today, which is what 0005 keeps them exempt for.

**Roll any late submission onto tomorrow, from the cutoff onwards.** The
alternative 0005 rejected. A fixed 21:00 keeps the afternoon closed, so the
day's demand still settles at the cutoff, and gives the evening shift its window.

## Consequences

- **The rule is written twice**: `public.requisition_date_for()` (what is
  stored) and `getRequisitionDate()` in `frontend/src/lib/requisitionCutoff.js`
  (what the screen shows). 21:00 IST appears as `TIME '15:30'` in one and
  `NEXT_DAY_OPENS_IST` in the other. Change both.
- **The NK/EC brand list is now in two places, not three**: the trigger reads it
  from `public.requisition_cutoff_applies()`, alongside `CUTOFF_BRANDS`.
- **Between 21:00 and 05:30, a requisition can be dated after
  `business_today()`.** Anything that splits requisitions into "today" and
  "before today" must treat a later date as today's work. Stock Out does
  (`>= businessToday`). The purchase manager's pending counts, which match
  today exactly, leave it out until 05:30.
- **Packing it at night** would write a stock-out dated today against a
  requisition dated tomorrow. One stock-out in 60 days was made after 20:00, so
  this is left alone.
- **After 21:00 the supervisor's screen is on tomorrow**, so today's unpacked
  requisition is no longer offered for editing there. Packing finishes by
  mid-afternoon, so this should not come up.
- A direct API insert by any supervisor with a date other than
  `requisition_date_for()` is now refused, Boom Pizza outlets included.
- Still open, as before: editing is not blocked by the cutoff, and supervisors
  can still `UPDATE` `request_date` directly through RLS.

## Where it lives

- `migrations/open-tomorrows-requisition-window-at-9pm.sql`:
  `requisition_cutoff_applies`, `requisition_date_for`,
  `save_allocation_request`, `enforce_requisition_cutoff`, the CHECK
- `frontend/src/lib/requisitionCutoff.js`: `getRequisitionDate`,
  `evaluateCutoff`, `NEXT_DAY_OPENS_IST`
- `frontend/src/components/outlets/OutletsPageBase.jsx`,
  `frontend/src/pages/supervisor/OutletDetails.jsx`: the supervisor screens
- `frontend/src/pages/purchase-manager/StockOut.jsx`: tomorrow's listed with today's
- `docs/REQUISITION_CUTOFF.md`: the whole feature
