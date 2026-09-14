# 0018. Franchise sessions are the partner app's, not Supabase's

Date: 2026-09-14
Status: Accepted

## Context

Franchise users sign in to the partner app with an email and password held by
Supabase Auth (registration, migration 11). Supabase Auth normally hands the
browser a JWT and a refresh token, and the app talks to Supabase with them.

The partner app holds no Supabase key and never talks to PostgREST (decision
0015). And the Auth project is shared with the internal app, whose tables are
governed by RLS written for staff.

## Decision

**Supabase Auth checks the password; the partner app owns the session.**

- `POST /api/auth/login` sends the email and password to Supabase Auth from the
  server. If Supabase accepts them, the server ends that Supabase session at
  once and starts its own: 32 random bytes in an `HttpOnly; Secure;
  SameSite=Lax` cookie named `__Host-gx_session`, valid 7 days. Only the token's
  SHA-256 is stored (`fofo.franchise_sessions`).
- Every signed-in request resolves the cookie through
  `fofo.resolve_franchise_session`, which also checks that the user and the
  franchise are still active and ends the session if not. Deactivation takes
  effect on the next request.
- Every franchise endpoint scopes its queries to the franchise that function
  returns — never to a franchise id from the request.
- Sign-in is throttled in the database (5 failures per email, 30 per IP, in 15
  minutes), because serverless functions share no memory.
- A Supabase login that is not a franchise user — an internal admin — gets the
  same "incorrect email or password" as a wrong password.
- Password reset uses Supabase's recovery email, landing on `/reset-password`,
  and ends every partner-app session the user had.

## Alternatives

**Keep the Supabase JWT in the browser.** It would need the anon key in the
bundle, contradicting 0015, and the JWT works against PostgREST directly. Checked
on 2026-09-14: a signed-in non-staff user fails the staff checks in RLS and reads
no more than the anon key already allows — but that is a property of today's
policies, not a guarantee, and those policies are not written with outsiders in
mind.

**Keep the Supabase session server-side and refresh it.** Adds refresh-token
storage and rotation for nothing: nothing on the server calls Supabase as the
user. A session of our own is one table and a hash.

**A signed cookie (JWT) with no table.** Cannot be revoked on sign-out, password
reset or deactivation before it expires. The table is what makes those immediate.

## Consequences

- One indexed read per signed-in request, and at most one write per session per
  five minutes (`last_seen_at`).
- CSRF rests on `SameSite=Lax` plus an Origin check on every state-changing
  request (`requireSameOrigin`). Any new POST endpoint must keep calling it.
- Signing out of the partner app does not affect the internal app, and vice
  versa: they share users, not sessions.
- If staff ever reach `fofo` through this server (0015's staff pass), they need
  their own session kind; this table is franchise users only.

## Where it lives

- `migrations/fofo/14-add-franchise-sessions.sql`
- `partner-frontend/api/_lib/franchiseAuth.js`, `supabaseAuth.js`
- `partner-frontend/api/auth.js`, `api/franchise.js`
- `partner-frontend/src/auth/`
