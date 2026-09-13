# 0015. FOFO data is reached only through the partner app's server

Date: 2026-09-13
Status: Accepted

## Context

The internal app has no backend. It talks to PostgREST with the anon key, which
ships inside its JavaScript bundle and is therefore public. RLS is the only gate,
and the live policies are loose: `stock_in_batches` is readable by any caller
without an Auth session (`… OR auth.uid() IS NULL`), which means **every purchase
cost and GST rate in the company** is readable with that key. `inventory`,
`raw_materials` and `outlets` are similarly open (`fofo-schema.md` §2).

For staff-only software that has been survivable. FOFO hands a login to
franchisees we sell to at a margin, so costs and stock levels must not be
reachable by them — and a franchisee holding the same key would reach both.

## Decision

**The partner app holds no Supabase key.** Not the anon key, not any key. The
browser talks only to the partner app's own `/api/*` Vercel functions, which hold
the service_role key server-side and return final prices only.

**FOFO tables live in a `fofo` schema that is not on Supabase's exposed-schema
list.** RLS is on with no policies. So no key reaches them through PostgREST even
if a policy is later written wrong. A consequence that catches people: the
service_role key through `supabase-js` cannot reach them either — the server uses
a direct Postgres connection.

**Internal staff reach `fofo` through the same server, never directly.** The
internal app cannot see the schema, so the PM accept, kitchen-executive pack,
logistics invoice, admin onboarding and reporting screens call partner-app
endpoints:

- **Admins** send their Supabase Auth session. The server checks `public.users`
  (active, role `admin`); the database functions check again.
- **Purchase managers and kitchen staff** log in by key, not Supabase Auth. The
  server checks the key **once** and issues a short-lived pass (~12 h) for later
  requests. The check is a quiet lookup — not `authenticate_user_by_key`, which
  writes a login audit event on every call. Wrong keys are rate-limited.
- Every staff action checks the **kitchen**, not only the role: a PM acts only on
  orders whose `cloud_kitchen_id` is theirs.

## Alternatives

**Give the partner app the anon key and write FOFO RLS policies.** Rejected: it
exposes the existing loose policies on costs and stock to every franchisee, and
fixing those policies touches every internal screen.

**Tighten the existing `public` policies first.** Worth doing on its own schedule,
but not as a precondition — the internal tool works, and the blast radius is
every screen (spec §4).

**Thin `public` wrappers around `fofo` functions for the internal app.** Rejected
for staff screens: key-login staff have no Auth session, and
`public.is_purchase_manager_or_admin()` returns true for any caller *without* one,
so a wrapper cannot tell a purchase manager from an anonymous caller with the
public key. Only a server that has checked the key can.

## Consequences

- Every FOFO feature, franchise-facing or internal, is a server endpoint. More
  code than a PostgREST call, and the only place that can strip cost and margin.
- `/api` responses must never include `unit_base_cost` or `margin_percent` — the
  orders endpoint as well as the catalogue, since `order_items` carries both.
- Never prefix a secret env var with `VITE_`; Vite ships those to the browser.
  The partner build fails if a secret name or value reaches the bundle.
- If the `public` policies are ever tightened and staff move to Supabase Auth,
  the staff pass can go; the no-key rule for franchisees stays.

## Where it lives

- `partner-frontend/vite.config.js` — the build that refuses secrets in the bundle
- `partner-frontend/api/` — the server
- `migrations/fofo/03-create-fofo-schema.sql` — the unexposed schema
- `docs/fofo-dashboard-spec.md` §4, §11, §12
- `docs/fofo-schema.md` §2 — the live policies that forced this
