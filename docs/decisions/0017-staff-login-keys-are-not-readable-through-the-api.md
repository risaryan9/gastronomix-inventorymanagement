# 0017. Staff login keys are not readable through the API

Date: 2026-09-14
Status: Accepted

## Context

A login key is the password for every key-login role: purchase managers,
supervisors, dispatch and kitchen executives, Boom Pizza operators. The internal
app talks to PostgREST with the anon key, which ships in its bundle and is
therefore public.

`public.users` has a SELECT policy whose condition is `true` ("Users can view
names for allocation requests"), and anon, authenticated and PUBLIC all held
SELECT on the whole table. So anyone holding the anon key could read every
staff login key with one request and sign in as that person. Found on
2026-09-14 while checking what a FOFO franchise user's Supabase session could
reach; the exposure itself predates FOFO.

RLS cannot fix this. RLS chooses rows, and these rows are meant to be readable —
screens show staff names and phone numbers.

## Decision

**`login_key` is removed from the API by column privilege.** The table-level
SELECT grant to PUBLIC, anon and authenticated is revoked, and every other
column is granted back by name. RLS is unchanged.

A key is visible in exactly two places:

- **Key login** — `authenticate_user_by_key()`, SECURITY DEFINER, returns the row
  only to someone who typed that key.
- **Admin → Users** — `admin_list_login_keys()`, which refuses anyone who is not
  an active admin with a Supabase Auth session (`is_admin()`).

**Purchase managers no longer see their supervisors' keys.** A key-logged-in PM
has no session the database can verify, so any function returning keys "to a
PM" would return them to anyone. PMs see names and phone numbers; admins manage
keys.

## Alternatives

**A PM re-enters their own key to reveal supervisor keys.** Secure, and keeps the
feature, at the cost of a prompt. Not chosen; can be added later on top of this.

**Store the PM's key in the browser session and send it to a key-returning
function.** Leaves a credential in `localStorage`, readable by any script on the
page. Rejected.

**Hash the keys.** The right end state, since then nothing readable is a
credential — but key login and Admin → Users both work with the plain key today,
and the change touches every key holder. Not needed to close this hole.

## Consequences

- **`select('*')` on `users` fails through the API** with "permission denied for
  table users". Name the columns. This will look like a bug; it is this record.
- **A new column on `public.users` is not readable through the API until it is
  granted** (`GRANT SELECT (col) ON public.users TO anon, authenticated`). That
  is deliberate: the next secret column is not exposed by default.
- **Every key that existed before the fix must be treated as compromised** and
  rotated.
- Staff email addresses and phone numbers remain readable with the anon key
  through the same `true` policy. Less severe, not addressed here.
- The internal app's key-login session does **not** keep the key. Anything that
  needs to prove a key-login user to a server (decision 0015's staff pass) must
  do it at login, or ask for the key again.

## Where it lives

- `migrations/stop-exposing-staff-login-keys.sql` — the grants and `admin_list_login_keys()`
- `frontend/src/pages/admin/AdminUsers.jsx` — keys merged in from the function
- `frontend/src/pages/Login.jsx` — admin login names its columns
- `frontend/src/pages/purchase-manager/Overview.jsx` — supervisors without keys
