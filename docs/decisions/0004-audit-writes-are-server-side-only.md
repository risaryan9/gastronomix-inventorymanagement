# 0004. Audit events are written only by server-side functions

Date: 2026-09-03 (recorded); decided 2026-06/07
Status: Accepted

## Context

The audit trail is only worth having if a client cannot forge or suppress
entries. `docs/AUDIT_TRAIL_REQUIREMENTS.md` catalogues the twenty action points
(A1–H1) that must produce one.

## Decision

### The client supplies facts, never the verdict

`log_audit_event()` and `log_auth_event()` are internal. Every audited flow goes
through a `SECURITY DEFINER` function that **hardcodes its own `category`,
`action`, `severity` and `entity_type` server-side** and accepts only business
data — quantities, before/after catalog fields, items — plus
`p_acting_user_id`.

So a caller supplies *what happened to the stock*, and never *what kind of event
gets logged*. `pack_allocation_request` set the shape;
`log_manual_inventory_adjustment`, `log_raw_material_created/updated` and
`log_self_stock_out` follow it. These narrow RPCs are **deliberately
client-callable** — their grants are correct as they are.

There are no client-side inserts into `audit_events`.

### `REVOKE ... FROM PUBLIC` does not work in this database

Both internal helpers were documented as internal and both migrations ended with
`REVOKE EXECUTE ... FROM PUBLIC`. **Neither REVOKE did anything**, and both
functions were callable by `anon` for months.

This project's database has:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

so every function receives **direct, by-name grants at CREATE time**.
`REVOKE ... FROM PUBLIC` only strips the implicit privilege held via `PUBLIC`;
it does not touch a privilege granted to a role by name.

The anon key ships inside the frontend bundle and is therefore public. Anyone
holding it could have called `log_audit_event()` with arbitrary arguments —
forging any actor, any action, any severity — or buried a real event under
noise.

**Any new function meant to be internal must revoke `anon` and `authenticated`
by name.** `service_role` is deliberately left with access: that key is
server-side only.

## Consequences

- Adding an audited action means a new narrow RPC, not a new client insert.
- Every `SECURITY DEFINER` helper added from here on needs its grants checked
  against `pg_proc.proacl`, not assumed from the `REVOKE` line beneath it. A
  `REVOKE ... FROM PUBLIC` that reads as protection is the exact shape of the
  bug that was live here.
- The read side renders events from a registry (`ACTION_META` in
  `lib/auditEvents.js`) rather than per-action components, because each action
  carries a differently-shaped payload. Extend the registry; do not add
  components. Events are keyed `category:action` — `create`/`update` are not
  unique across categories.

## Where it lives

- `migrations/replace-audit-logs-with-audit-events.sql` — the spine
- `migrations/wire-legacy-audit-writers-to-audit-events.sql` — the narrow-RPC shape
- `migrations/fix-internal-audit-helper-grants.sql` — the grants analysis in full
- `frontend/src/lib/auditEvents.js` — read side
- `docs/AUDIT_TRAIL_REQUIREMENTS.md`
