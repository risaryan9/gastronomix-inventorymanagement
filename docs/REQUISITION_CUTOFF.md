# Requisition Cutoff

**Added:** 5 August 2026
**Applies to:** Nippu Kodi and El Chaapo outlets, supervisor-raised requisitions only
**Enforced by:** `trg_enforce_requisition_cutoff` on `public.allocation_requests`
**Migration:** `migrations/add-requisition-cutoff-per-cloud-kitchen.sql`
**Amended:** 15 October 2026: tomorrow's window opens at 21:00 IST
(`migrations/open-tomorrows-requisition-window-at-9pm.sql`, decision 0025)

## What it does

Each cloud kitchen carries a time of day after which supervisors can no longer
create a requisition. The default is **11:30 IST**, and the admin can change it
per kitchen from **Overview → Kitchen Wise Overview**, in the card above the KPI
tiles.

The window a supervisor has for business day D is:

```
[ 21:00 IST on D-1 , cutoff on D )        e.g. 21:00 – 11:30 IST next morning
[ 15:30 UTC on D-1 , cutoff-5:30 on D )   the same window, in UTC
```

A requisition raised in the night part of it (21:00–05:30 IST) is **dated D**,
the day it is for, not the business day it was raised in. Between the cutoff
and 21:00, creating a requisition fails; nothing is queued, the write is
refused and the supervisor is told when tomorrow's window opens.

Until 15 October 2026 the window opened at 05:30 IST, when the business day
begins. The next section explains why the business day still begins then, and
why that does not stop the window opening the night before.

## Why the business day is not "midnight to midnight", and how the night window lives with it

This is the part most likely to be misread, so it is worth being exact. The
first half below explains the original 05:30 window and still holds for the
business day. The second half is how the 21:00 window was added without
touching it.

`request_date` is set by `public.business_today()`, which returns the **UTC**
date. That is deliberate and documented at length in
`frontend/src/lib/businessDate.js`: the business day does not roll over until
05:30 IST, so a late shift's work stays on the day it started. Changing it
broke real workflows once already.

So the requisition window is not "from midnight to 11:30". It is "from the
moment the business day begins to 11:30", and the business day begins at 05:30
IST. A supervisor submitting at 02:00 IST is still working inside *yesterday's*
business day, whose cutoff passed fourteen hours earlier — that submission is
refused, and correctly so.

The trigger does the comparison in UTC for exactly this reason. In UTC the rule
is one line with no special cases:

```sql
(now() AT TIME ZONE 'UTC')::time >= (cutoff_ist - INTERVAL '5 hours 30 minutes')
```

02:00 IST is 20:30 UTC on the previous day, and 20:30 ≥ 06:00, so it blocks
without anyone having to write a rule about it. Compare IST times instead and
you need a special case for 00:00–05:29 or you will silently allow the one
window that should be shut.

India has no daylight saving, so the 5:30 offset is a constant and not a
simplification that will bite later.

### The 21:00 window (decision 0025)

Supervisors who start late wanted to send tomorrow's order the night before,
sometimes after midnight. Moving the business day to fix that is what 0002
forbids. Instead **only the requisition's date moves**:
`public.requisition_date_for(user, outlet)` returns `business_today() + 1` for
an NK/EC supervisor from 15:30 UTC (21:00 IST), and `business_today()` for
everyone and everything else. In UTC that needs no midnight case either: 22:00
IST is 16:30 UTC and 02:00 IST is 20:30 UTC, the same UTC day, both past 15:30.

`save_allocation_request` dates the row with it, and the trigger lets a
requisition dated tomorrow through without looking at today's cutoff.
`business_today()` and `getBusinessDate()` are untouched, so checkout, closing,
dispatch and reports carry on exactly as before. The supervisor's screens ask
`getRequisitionDate()` in `frontend/src/lib/requisitionCutoff.js` which
requisition they are about; that function mirrors `requisition_date_for()`.

The cutoff must be earlier than 21:00 IST (a second CHECK), so today's window
and tomorrow's never overlap.

## Scope, and why each exemption exists

| Who | Subject to the cutoff? | Why |
|---|---|---|
| Supervisor, NK or EC outlet | **Yes** | The case the feature was asked for. |
| Supervisor, BP outlet | No | Boom Pizza was explicitly excluded. Its outlets run through operators on a different flow. |
| `bp_operator` | No | Same reason; the role only ever touches BP outlets. It also stays on today's date at night: BP operators already raise ~200 requisitions a month between 21:00 and 01:00, dated the day raised and packed the next morning, and shifting them collided with one-per-outlet-per-day. |
| Purchase manager | No | The PM raises requisitions from the same shared Outlets page and is the one packing them. Keeping them exempt leaves a way to enter a genuine late request taken over the phone. A PM's requisition is always dated today, at any hour. |
| Admin | No | Not restricted anywhere in this app. |

The brand list is **hard-coded** in two places that must agree:

- `ARRAY['NK', 'EC']` in `public.requisition_cutoff_applies()`, which both the
  trigger and `requisition_date_for()` call (until 15 October 2026 it was
  `c_locked_brands` inside the trigger)
- `CUTOFF_BRANDS = ['NK', 'EC']` in `frontend/src/lib/requisitionCutoff.js`

This was a deliberate choice over a `brands` table with an `enforces_cutoff`
flag. A table would imply the set is expected to change and would bury a policy
decision inside data, where nobody reads it. Adding a brand is a one-line
migration, a one-line frontend change, and an edit to the table above.

Brand is derived from the **outlet code prefix** (`NK1001`, `EC1025`, `BP…`),
which is how every screen in this app already derives it.

## Where it is enforced

**The database is the lock.** A `BEFORE INSERT` trigger on
`allocation_requests` refuses the row. Since 15 October 2026 it also refuses a
supervisor's row whose `request_date` is not `requisition_date_for()`: RLS lets
a supervisor insert directly, and the trigger used to check only the clock, so
a direct insert could carry any date. Three pages call
`save_allocation_request()` — `components/outlets/OutletsPageBase.jsx`,
`pages/purchase-manager/OutletDetails.jsx` and
`pages/supervisor/OutletDetails.jsx` — and a trigger sits under all three, plus
any future caller and any direct PostgREST insert. `save_allocation_request` is
`SECURITY DEFINER`, which skips RLS but **not** triggers.

The guard was put in a trigger rather than inside `save_allocation_request`
because that function is ~350 lines and `CREATE OR REPLACE` requires restating
the whole body. Copying it to add six lines of guard is a good way to lose
something else in the process.

Dating the row, on the other hand, had to happen inside
`save_allocation_request`, because its one-requisition-per-outlet-per-day check
runs against the date before the insert. The 0025 migration restates the body
for that, copied from the live function (its `prosrc` md5 checked against the
repo) with two lines changed and marked.

**The frontend is a courtesy.** `frontend/src/lib/requisitionCutoff.js` and the
banner in `OutletsPageBase.jsx` exist so a supervisor learns the window has
closed before filling in a form they cannot submit, and, at night, that they
are ordering for tomorrow ("Ordering for Fri, 16 Oct"). That code runs on the
supervisor's own device, off that device's clock, and can be read and changed by
anyone who opens the console. Never move a rule there and consider it enforced.

One consequence: `pages/supervisor/OutletDetails.jsx` — an orphaned route with
no link pointing at it — has **no banner**, but its writes are still refused by
the trigger. It fails with the database's message rather than a friendly one.

## Known hole: editing is not blocked

The cutoff blocks **creating** a requisition. It does **not** block editing one
that already exists and has not been packed. This was decided knowingly.

The cost: a supervisor can create a requisition with one token line at 11:29 and
add the rest of the order at 16:00. If that starts happening, the fix is to
extend the trigger to `BEFORE UPDATE` on `allocation_request_items` — but note
that the purchase manager legitimately adjusts those same rows while packing, so
the update guard would need the same role check the insert guard has.

The audit trail already records every edit (`requisition_updated`, and
`requisition_items_deleted` at critical severity), so the behaviour is visible
before anyone has to go looking for it.

## What this changed for the people using it

Measured over the 60 days before the migration:

| Brand | Requisitions | Created inside 05:30–11:30 IST | Created after 11:30 IST | Created 00:00–05:29 IST (previous business day) |
|---|---|---|---|---|
| EC | 58 | 23 | 32 | 3 |
| NK | 5 | 3 | 2 | 0 |
| BP *(exempt)* | 141 | 34 | 93 | 14 |

**Roughly 60% of EC and NK requisitions, as staff were actually submitting them,
would have been refused.** That is the intent of the change rather than a
defect, but it is a change to how most supervisors work, not a quiet tidy-up.
Expect pushback in the first week, and expect requests to move the time — which
is why the time is a setting rather than a constant.

If the volume of legitimate late requests turns out to be high, the alternative
already considered was to roll a late submission onto the **next** business day
instead of refusing it. That keeps today's kitchen plan clean while letting an
evening shift prepare tomorrow's ask, and it fits the 22:00–23:00 traffic
visible in the table above. It was rejected in favour of the hard block.

A narrower form of it was adopted on 15 October 2026 (decision 0025): not "any
time after the cutoff", but from 21:00 IST, so the afternoon stays closed and
the day's demand still settles at the cutoff.

## Schema

```sql
ALTER TABLE public.cloud_kitchens
ADD COLUMN requisition_cutoff_ist time NOT NULL DEFAULT '11:30';

ALTER TABLE public.cloud_kitchens
ADD CONSTRAINT cloud_kitchens_requisition_cutoff_after_day_start
CHECK (requisition_cutoff_ist > TIME '05:30');

-- added with the 21:00 window
ALTER TABLE public.cloud_kitchens
ADD CONSTRAINT cloud_kitchens_requisition_cutoff_before_next_window
CHECK (requisition_cutoff_ist < TIME '21:00');
```

Stored **as IST**, not UTC. Everyone who talks about this time says "half past
eleven", and a column holding `06:00` that means 11:30 is a trap for the next
person. The trigger converts on read; the admin screen never converts at all.

The `CHECK` matters: a cutoff at or before 05:30 IST would produce a window of
zero or negative length, and the subtraction would wrap past midnight into a
time that silently allows everything. The constraint makes that unreachable
instead of trusting a form to prevent it.

**RLS needed no changes.** `Admin full access to cloud_kitchens` already covers
the admin's update, and `Public can read active cloud kitchens for login`
already lets a key-logged-in supervisor read the cutoff.

**Changing the cutoff is not audited.** `updated_at` records when it last moved,
but not who moved it or what it was before. If that matters, it needs a new
action in the audit taxonomy — see `docs/AUDIT_TRAIL_REQUIREMENTS.md`.

## Verifying it

What a requisition raised right now would be dated, per role and brand.
Between 21:00 and 05:30 IST the supervisor NK/EC rows should show
`business_today + 1`, every other row `business_today`:

```sql
SELECT u.role, upper(left(o.code, 2)) AS brand,
       public.requisition_date_for(u.id, o.id) AS dated,
       public.business_today() AS business_today
FROM public.users u CROSS JOIN public.outlets o
WHERE u.role IN ('supervisor', 'purchase_manager', 'bp_operator')
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2;
```

Current state per kitchen, in both timezones, plus whether today's window is
open right now (this query predates the 21:00 window and does not show it):

```sql
SELECT name,
       requisition_cutoff_ist AS cutoff_ist,
       requisition_cutoff_ist - INTERVAL '5 hours 30 minutes' AS cutoff_utc,
       (now() AT TIME ZONE 'UTC')::time AS now_utc,
       (now() AT TIME ZONE 'UTC')::time
         < (requisition_cutoff_ist - INTERVAL '5 hours 30 minutes') AS window_open
FROM public.cloud_kitchens
WHERE is_active AND deleted_at IS NULL
ORDER BY name;
```

The behaviour table this was checked against, before the migration was applied:

| Submitted (IST) | Cutoff | Business day | Outcome |
|---|---|---|---|
| 09:00 | 11:30 | today | allowed |
| 11:29 | 11:30 | today | allowed |
| 11:31 | 11:30 | today | refused |
| 15:00 | 11:30 | today | refused |
| 23:00 | 11:30 | today | refused |
| 02:00 | 11:30 | **yesterday** | refused |
| 05:31 | 11:30 | today | allowed |
| 07:00 | 08:00 | today | allowed |
| 09:00 | 08:00 | today | refused |

The 21:00 window was checked on 2026-10-15 against a scratch Postgres 16 with
the migration applied and the clock injected, NK supervisor and 11:30 cutoff
unless stated:

| Submitted (IST) | Who / outlet | Outcome |
|---|---|---|
| 15 Oct 05:31 | supervisor NK | allowed, dated 15 Oct |
| 15 Oct 11:29 | supervisor NK | allowed, dated 15 Oct |
| 15 Oct 11:31 | supervisor NK | refused, "Tomorrow's open at 9:00 PM IST tonight" |
| 15 Oct 20:59 | supervisor NK | refused |
| 15 Oct 21:00 | supervisor NK | allowed, **dated 16 Oct** |
| 15 Oct 23:45 | supervisor EC | allowed, dated 16 Oct |
| 16 Oct 02:00 | supervisor EC | allowed, dated 16 Oct |
| 16 Oct 05:29 | supervisor EC | allowed, dated 16 Oct |
| 15 Oct 22:00 | purchase manager NK | allowed, dated 15 Oct |
| 15 Oct 22:00 | bp_operator BP | allowed, dated 15 Oct |
| 16 Oct 01:00 | supervisor BP | allowed, dated 15 Oct |
| 16 Oct 08:00, after one at 15 Oct 22:00 | supervisor NK | refused, "already has a requisition for 16 Oct 2026" |
| direct insert at 15 Oct 22:00, dated 20 Oct | supervisor NK | refused, "is for 16 Oct 2026, not 20 Oct 2026" |
| cutoff set to 21:00 | admin | refused by the CHECK; 20:59 accepted |

## Rolling it back

To undo only the 21:00 window, follow the ROLLBACK block at the foot of
`migrations/open-tomorrows-requisition-window-at-9pm.sql`. To remove the whole
feature, do that first, then:

```sql
DROP TRIGGER IF EXISTS trg_enforce_requisition_cutoff ON public.allocation_requests;
DROP FUNCTION IF EXISTS public.enforce_requisition_cutoff();
ALTER TABLE public.cloud_kitchens
  DROP CONSTRAINT IF EXISTS cloud_kitchens_requisition_cutoff_after_day_start;
ALTER TABLE public.cloud_kitchens DROP COLUMN IF EXISTS requisition_cutoff_ist;
```

Dropping the trigger alone is enough to disable the feature without losing the
configured times. The frontend degrades safely: `fetchKitchenCutoff` throwing
leaves `cutoffIst` null, and a null cutoff shows no banner and blocks nothing.

## Files

| File | Role |
|---|---|
| `migrations/add-requisition-cutoff-per-cloud-kitchen.sql` | Column, constraint, trigger function, trigger |
| `migrations/open-tomorrows-requisition-window-at-9pm.sql` | The 21:00 window: `requisition_cutoff_applies`, `requisition_date_for`, `save_allocation_request`, the trigger, the second CHECK |
| `frontend/src/lib/requisitionCutoff.js` | Brand list, IST↔UTC conversion, window evaluation, `getRequisitionDate`, read/write helpers |
| `frontend/src/components/admin/kitchen/RequisitionCutoffCard.jsx` | The admin control, above the KPI tiles |
| `frontend/src/pages/admin/AdminKitchenWiseOverview.jsx` | Mounts the card |
| `frontend/src/components/outlets/OutletsPageBase.jsx` | Supervisor banner, countdown, the create-blocked path, and which day's requisition the screen shows |
| `frontend/src/pages/purchase-manager/StockOut.jsx` | Lists a requisition dated tomorrow with today's, not under "Previous days" |
| `frontend/src/lib/businessDate.js` | Why the business day is UTC — read this before changing any of the above |
