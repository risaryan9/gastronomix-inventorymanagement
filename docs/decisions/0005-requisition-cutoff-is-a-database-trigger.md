# 0005. The requisition cutoff is a database trigger; the frontend is a courtesy

Date: 2026-09-03 (recorded); decided 2026-08
Status: Accepted

## Context

Outlets could raise a requisition at any hour, so the day's demand was never
settled early enough to buy and pack against. Each cloud kitchen now carries a
cutoff time — default 11:30 IST — after which supervisors cannot raise one.

## Decision

### The lock is a `BEFORE INSERT` trigger

Not a check inside `save_allocation_request()`. Three pages call that function
and it is ~350 lines; `CREATE OR REPLACE` to add six lines of guard means
restating the whole body, which is a good way to lose something else. A trigger
sits under **every** write path — all three callers, any future one, and a
direct PostgREST insert. `SECURITY DEFINER` skips RLS, not triggers.

### The frontend half cannot be the lock, and says so

`frontend/src/lib/requisitionCutoff.js` runs on the supervisor's device, off
that device's clock, in code they can open. Every function in it is advisory.
It exists so the window closing is visible *before* someone fills in a form that
cannot be submitted. The database is what refuses the write, and its message is
what the user sees.

### The window is computed in UTC

`request_date` comes from `business_today()`, the UTC date
([0002](0002-business-day-is-the-utc-date.md)), so the window is 05:30 IST to
the cutoff — not midnight to the cutoff. The trigger compares UTC clock time
against cutoff minus 5:30, which needs **no special case for 00:00–05:29 IST**:
that hour belongs to the previous business day, and in UTC it is already 20:30
the day before, well past any cutoff. Comparing IST times would need that case
written out, and forgetting it would silently leave open the one window that
must be shut.

### The cutoff column stores IST

Everyone who talks about this time says "half past eleven". A column holding
`06:00` that means 11:30 is a trap for whoever reads it next. A CHECK keeps it
later than 05:30.

### The exempt list is hard-coded, deliberately

Nippu Kodi and El Chaapo only (`CUTOFF_BRANDS = ['NK', 'EC']`, mirroring
`c_locked_brands` in the trigger). Boom Pizza is exempt because its operators
run a different flow. The purchase manager is exempt because they raise
requisitions from the same shared page and are the one packing them — that is
how a genuine late request taken over the phone still gets in.

Both are policy decisions, not gaps. A table would imply the set is expected to
change and would bury the decision inside data nobody reads.

## Consequences

- The brand list exists in two places and must stay in step: the trigger and
  `CUTOFF_BRANDS`.
- Editing an existing requisition is not blocked — see `docs/REQUISITION_CUTOFF.md`.
- Changing the cutoff arithmetic to IST would reintroduce the 00:00–05:29 case.

## Where it lives

- `migrations/add-requisition-cutoff-per-cloud-kitchen.sql` — the trigger
- `frontend/src/lib/requisitionCutoff.js` — the advisory UI half
- `docs/REQUISITION_CUTOFF.md` — the whole feature
- Commit `ac116cb`
