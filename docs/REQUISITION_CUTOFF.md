# Requisition Cutoff

**Added:** 5 August 2026
**Applies to:** Nippu Kodi and El Chaapo outlets, supervisor-raised requisitions only
**Enforced by:** `trg_enforce_requisition_cutoff` on `public.allocation_requests`
**Migration:** `migrations/add-requisition-cutoff-per-cloud-kitchen.sql`

## What it does

Each cloud kitchen carries a time of day after which supervisors can no longer
create a requisition. The default is **11:30 IST**, and the admin can change it
per kitchen from **Overview → Kitchen Wise Overview**, in the card above the KPI
tiles.

The window a supervisor has is:

```
[ 05:30 IST , cutoff )      e.g. 05:30 – 11:30 IST
[ 00:00 UTC , cutoff-5:30 ) the same window, in UTC
```

Outside it, creating a requisition fails. Nothing is queued, nothing rolls over
to tomorrow — the write is refused and the supervisor is told when the next
window opens.

## Why the window starts at 05:30 and not at midnight

This is the part most likely to be misread, so it is worth being exact.

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

## Scope, and why each exemption exists

| Who | Subject to the cutoff? | Why |
|---|---|---|
| Supervisor, NK or EC outlet | **Yes** | The case the feature was asked for. |
| Supervisor, BP outlet | No | Boom Pizza was explicitly excluded. Its outlets run through operators on a different flow. |
| `bp_operator` | No | Same reason; the role only ever touches BP outlets. |
| Purchase manager | No | The PM raises requisitions from the same shared Outlets page and is the one packing them. Keeping them exempt leaves a way to enter a genuine late request taken over the phone. |
| Admin | No | Not restricted anywhere in this app. |

The brand list is **hard-coded** in two places that must agree:

- `c_locked_brands text[] := ARRAY['NK', 'EC']` in `enforce_requisition_cutoff()`
- `CUTOFF_BRANDS = ['NK', 'EC']` in `frontend/src/lib/requisitionCutoff.js`

This was a deliberate choice over a `brands` table with an `enforces_cutoff`
flag. A table would imply the set is expected to change and would bury a policy
decision inside data, where nobody reads it. Adding a brand is a one-line
migration, a one-line frontend change, and an edit to the table above.

Brand is derived from the **outlet code prefix** (`NK1001`, `EC1025`, `BP…`),
which is how every screen in this app already derives it.

## Where it is enforced

**The database is the lock.** A `BEFORE INSERT` trigger on
`allocation_requests` refuses the row. Three pages call
`save_allocation_request()` — `components/outlets/OutletsPageBase.jsx`,
`pages/purchase-manager/OutletDetails.jsx` and
`pages/supervisor/OutletDetails.jsx` — and a trigger sits under all three, plus
any future caller and any direct PostgREST insert. `save_allocation_request` is
`SECURITY DEFINER`, which skips RLS but **not** triggers.

The guard was put in a trigger rather than inside `save_allocation_request`
because that function is ~350 lines and `CREATE OR REPLACE` requires restating
the whole body. Copying it to add six lines of guard is a good way to lose
something else in the process.

**The frontend is a courtesy.** `frontend/src/lib/requisitionCutoff.js` and the
banner in `OutletsPageBase.jsx` exist so a supervisor learns the window has
closed before filling in a form they cannot submit. That code runs on the
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

## Schema

```sql
ALTER TABLE public.cloud_kitchens
ADD COLUMN requisition_cutoff_ist time NOT NULL DEFAULT '11:30';

ALTER TABLE public.cloud_kitchens
ADD CONSTRAINT cloud_kitchens_requisition_cutoff_after_day_start
CHECK (requisition_cutoff_ist > TIME '05:30');
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

Current state per kitchen, in both timezones, plus whether the window is open
right now:

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

## Rolling it back

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
| `frontend/src/lib/requisitionCutoff.js` | Brand list, IST↔UTC conversion, window evaluation, read/write helpers |
| `frontend/src/components/admin/kitchen/RequisitionCutoffCard.jsx` | The admin control, above the KPI tiles |
| `frontend/src/pages/admin/AdminKitchenWiseOverview.jsx` | Mounts the card |
| `frontend/src/components/outlets/OutletsPageBase.jsx` | Supervisor banner, countdown, and the create-blocked path |
| `frontend/src/lib/businessDate.js` | Why the business day is UTC — read this before changing any of the above |
