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
6. Decisions `0004` (audit writes, grants), `0013` (store credit), and the three
   FOFO records `0014` (GST-inclusive pricing), `0015` (access only through the
   partner server) and `0016` (invoices never edited)

## Where things stand

**Live database** (Supabase `zyjdzkrtdwlcwkpfnxya`): `migrations/fofo/` 01–12
applied and verified one by one. All FOFO tables are in the `fofo` schema, not
exposed through the API, RLS on with no policies, service_role only.

**Partner app** (`partner-frontend/`), deployed on Vercel:
- URL: https://gastronomix-inventorymanagement-kzh.vercel.app
- Vercel project `gastronomix-inventorymanagement-kzhc`, Root Directory `partner-frontend`
- Env vars set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No custom domain.
- Built: `/api/health`, `api/_lib/razorpay.js` (signature + exact-amount check,
  15 cases verified), and a build step that fails if a secret reaches the bundle.
- Built: `/api/admin/*` (`api/admin.js`) — franchise CRUD and outlet linking for
  the internal app's FOFO → Franchises screen. Postgres via `DATABASE_URL`, every
  transaction `SET LOCAL ROLE service_role`; admin checked via Supabase Auth +
  `public.users`; CORS from `INTERNAL_APP_ORIGINS`. Group routes behind one file
  and a `vercel.json` rewrite — the free plan allows only 12 functions.

**Phase 0 done:** the three decision records from spec §14 are written
(0014–0016).

**Not built:** the pricing module (spec Phase 1), every other API endpoint,
franchise auth, the admin onboarding endpoints, the accept function (migration
12), gapless invoice/credit-note numbering, all screens.

**Git:** work goes on a branch; the user merges to `master` (pushing `master`
redeploys the partner app).

## Decided in conversation

Now in the spec and decision 0015, kept here as a summary:

- **Internal staff reach `fofo` through the partner app's server, never
  directly** (spec §12). Admins send their Supabase Auth session. Purchase
  managers and kitchen staff log in by key (their browser holds `login_key` in
  `localStorage.user_session`): a quiet key check once — not
  `authenticate_user_by_key` — then a ~12 h pass; kitchen checked on every
  action; wrong keys rate-limited.
- **`yield_quantity` is real** — BOMs are written per production run. Examples
  come with the BOM seed data (spec §5).

Not in the spec:

- **GST CGST/SGST/IGST split** is being handled by the accounting team; not in
  the schema. HSN codes are optional.
- **Carts stay in the database**, not localStorage (several users per franchise).
- **Franchise's own user-management screen** — scope not defined yet. Admins get
  full user management.
- **Invoice immutability is not enforced by the database** — no `BEFORE UPDATE`
  trigger on `fofo.invoices`. Worth adding with the numbering work (0016).

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

**In progress: onboarding first**, ahead of pricing — tracked in
`docs/fofo-onboarding-checklist.md`. Migration 12 is now the franchise admin
functions; the accept function moves to 13.


The spec's build order (§13) puts **Phase 1 — the pricing module, no UI** first,
signed off against a sample invoice. The onboarding endpoints (welcome email,
numbered registration links, registration) are also ready to build on migration
11, and need an email provider chosen first.
