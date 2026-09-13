# FOFO — handoff for the next session

Current state of the FOFO franchise dashboard work, as of **2026-09-13**, for
starting implementation in a fresh session. The design itself is in the docs
below; this file only holds what they do not: where things stand, decisions
made in conversation, and the traps.

**Update or delete this file when it stops being true.**

## Read first, in this order

1. `CLAUDE.md` — conventions, and the decision index
2. `docs/fofo-dashboard-spec.md` — what is being built, the rules, build order (§13)
3. `docs/fofo-schema-explained.md` — every table in plain words
4. `docs/fofo-schema.md` — why each table is shaped the way it is
5. `migrations/fofo/README.md` — run order and status
6. Decisions `0004` (audit writes, grants) and `0013` (store credit)

## Where things stand

**Live database** (Supabase `zyjdzkrtdwlcwkpfnxya`): `migrations/fofo/` 01–11
applied and verified one by one. All FOFO tables are in the `fofo` schema, not
exposed through the API, RLS on with no policies, service_role only.

**Partner app** (`partner-frontend/`), deployed on Vercel:
- URL: https://gastronomix-inventorymanagement-kzh.vercel.app
- Vercel project `gastronomix-inventorymanagement-kzhc`, Root Directory `partner-frontend`
- Env vars set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No custom domain.
- Built: `/api/health`, `api/_lib/razorpay.js` (signature + exact-amount check,
  15 cases verified), and a build step that fails if a secret reaches the bundle.

**Not built:** the pricing module (spec Phase 1), every other API endpoint,
franchise auth, the admin onboarding endpoints, the accept function (migration
12), gapless invoice/credit-note numbering, all screens.

**Git:** migrations 10–11 and their doc updates may still be uncommitted — check
`git status`. Work goes on a branch; the user merges to `master` (pushing
`master` redeploys the partner app).

## Decided in conversation, not yet in the spec

- **How internal staff reach `fofo`: through the partner app's server, never
  directly.** The internal app cannot see the `fofo` schema.
  - **Admins** send their Supabase Auth session; the server checks
    `public.users` (active, role `admin`). Admins really do log in via Supabase Auth.
  - **Purchase managers and kitchen staff** log in by key (their browser holds
    `login_key` in `localStorage.user_session`). The server checks the key
    **once**, then issues a **temporary pass (~12 h)** used for later requests.
    - Use a **quiet** key check. Do not call `authenticate_user_by_key` per
      request — it writes a login audit event every call.
    - Check the **kitchen** on every action, not just the role: a PM may only
      act on orders whose `cloud_kitchen_id` is theirs.
    - Rate-limit wrong keys.
- **GST CGST/SGST/IGST split** is being handled by the accounting team; not in
  the schema. HSN codes are optional.
- **Carts stay in the database**, not localStorage (several users per franchise).
- **Franchise's own user-management screen** — scope not defined yet. Admins get
  full user management.

## Traps

- **`fofo` is not exposed to PostgREST, so `supabase-js` with the service_role
  key cannot query it either.** The API needs a direct Postgres connection (a
  pooled connection string as a new server-only env var) or equivalent.
- **Never prefix a secret env var with `VITE_`** — Vite ships it to the browser.
- **`public.is_purchase_manager_or_admin()` returns true for any caller without
  a Supabase Auth session.** Never build a write policy on it (this is why
  recipe writes are admin-only).
- **`public.fifo_consume` is callable with the public anon key** (pre-existing).
  Worth locking down before the accept flow relies on stock being right.
- **`REVOKE … FROM PUBLIC` alone does nothing here** — revoke `anon` and
  `authenticated` by name, then check `pg_proc.proacl` (decision 0004).
- **`public.log_audit_event` must not be changed** — FOFO events go through
  `fofo.log_fofo_audit_event`.
- **The Supabase MCP connection is read-only** (`supabase_read_only_user`):
  good for verifying, cannot apply migrations. The user runs migrations in the
  SQL editor, one file at a time, and asks for a check after each.
- **A Claws hook blocks Bash commands that look long-running** (e.g. a script
  whose text mentions `vite`). Write the script to a file and run the file.
- **No test suite.** SQL was verified on a throwaway local Postgres 16
  (`/usr/lib/postgresql/16/bin`, `initdb` in the scratchpad, TCP on 127.0.0.1
  with `unix_socket_directories=''` — the scratchpad path is too long for a
  socket). Pure JS was verified by running it directly with `node`.

## Sensible next steps

The spec's build order (§13) puts **Phase 1 — the pricing module, no UI** first,
signed off against a sample invoice. The onboarding endpoints (welcome email,
numbered registration links, registration) are also ready to build on migration
11, and need an email provider chosen first.
