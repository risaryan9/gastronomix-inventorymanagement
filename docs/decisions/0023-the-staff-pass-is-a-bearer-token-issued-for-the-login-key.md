# 0023. The staff pass is a bearer token issued for the login key

Date: 2026-10-07
Status: Accepted

## Context

Purchase managers and kitchen executives act on FOFO orders (accept, pack,
logistics invoice, shipping). Those live in the `fofo` schema, which the internal
app cannot reach, so their screens call the partner app's server (decision 0015).
The server must know who is calling.

These two roles log in with a key, not Supabase Auth. After login the internal
app holds only a `user_session` entry in `localStorage`: the browser's own memory
of who logged in, which anyone can write. It is proof of nothing. And the app
deliberately does not keep the key (decision 0017), so it cannot send the key
with each request either.

Decision 0015 said the answer is a pass: check the key once, then trust a
temporary token. This record is how that pass is built.

**In plain words:** a visitor badge. The key is the ID shown once at the front
desk; the badge is what every door checks afterwards; the badge stops working
after a week, or sooner if it is cancelled.

## Decision

**The server checks the key once and issues a random token, valid 7 days.**
`POST /api/staff/pass` takes the key, role and kitchen, and
`fofo.issue_staff_pass` applies the same test as `authenticate_user_by_key`.
Only the token's SHA-256 is stored (`fofo.staff_passes`).

**Seven days because that is how long a key login lasts in the internal app.**
The pass and the login start together and run out together, so staff are never
asked for their key a second time in the ordinary course. Decision 0015 had
pencilled in about 12 hours; that was changed on 2026-10-07, before anything
used a pass, once it was clear it meant a key prompt most mornings.

**The internal app asks for it at key login, in the background.** That is the
only moment it has the key. Login neither waits for the partner app nor fails
without it. Staff do nothing new.

**It is a bearer token kept in `localStorage`, not a cookie.** The internal app
and the partner app are different sites; a cookie from the partner app would be
a third-party cookie in the internal app, which browsers increasingly refuse to
send. The token is sent as `Authorization: Bearer`.

**Only `purchase_manager` and `kitchen_executive` get one.** The other key-login
roles are refused.

**The pass is checked against the user on every request.** It ends, with the
reason recorded, when a request finds the user deactivated or deleted, in
another role, in another kitchen, or with a different key. Rotating a key in
Admin → Users therefore signs that person out of FOFO. Signing out of the
internal app ends it too.

**A pass says who, not what.** It yields a role and a kitchen. Every endpoint
that touches an order must still check that the order is that kitchen's.

**Issuing a pass is not an audit event.** The login it follows is already
audited by `authenticate_user_by_key`; a second event would read as two logins.
Every attempt, right or wrong, goes to `fofo.staff_pass_attempts`.

**Wrong keys are throttled in the database:** 10 from one IP, or 30 for one role
in one kitchen, in 15 minutes.

## Alternatives

**A cookie, as franchise sessions use (0018).** HttpOnly would keep the token
from scripts, which is better. It does not work across two sites without
`SameSite=None` and third-party cookie access, which Safari and Firefox block.
Serving the internal app and the API from one site would make it possible; that
is a hosting change, not this one.

**Send the key with every request.** Needs the key kept in the browser, which
0017 rejected: a stolen key is a full login, for ever. A stolen pass is at most
7 days of FOFO actions for one kitchen, and ends when the key is rotated.

**A signed token with no table.** Cannot be ended early. The table is what makes
deactivation and key rotation take effect on the next request.

**A 12-hour pass, a working day.** A copied token would be worth less: the token
is readable by any script on the page. But a key login lasts 7 days, so the pass
would run out while its holder was still logged in, and the first FOFO action of
most days would ask for the key again. Not chosen: staff were to notice no
change. It is one constant (`PASS_MS`) to go back.

**Move staff to Supabase Auth.** The right end state (0015), and then the pass
goes. It means an email and password for every kitchen login.

## Consequences

- **The pass length and the key-login length must stay equal.** `PASS_MS`
  (server) and the `expires_at` set in `Login.jsx` are both 7 days. Shorten the
  pass alone and staff get a key prompt while still logged in.
- **Someone can still be logged in with no working pass**: the partner app was
  unreachable when they logged in, or the pass was ended early. `staffRequest`
  throws `StaffPassRequired`, and the screen must ask for the key and call
  `requestStaffPass`. Every FOFO staff screen has to handle this, though it is
  now the exception. Nothing else in the internal app is affected.
- **A copied pass works for up to 7 days.** Rotating that person's key ends it
  at once.
- **A pass is checked when it is used, not when the user changes.** One that
  sits unused while a user is deactivated and then reactivated works again. So
  does one whose key was changed and changed back.
- **Only 401 means "ask for the key again."** Staff endpoints must not answer
  401 for anything else; a wrong role is 403.
- **A script running in the internal app can read the pass.** Weigh that before
  adding a third-party script to that app, or lengthening the pass.
- **The role list is in three places:** `staff_passes_role_known` and
  `issue_staff_pass` (migration 21), `STAFF_ROLES` (server), `STAFF_PASS_ROLES`
  (internal app).
- **The key test is in two places:** `issue_staff_pass` and
  `authenticate_user_by_key`. If they drift, someone who can log in cannot get
  a pass.
- **The throttle guards this door only.** `authenticate_user_by_key` is callable
  with the internal app's public key and is not throttled, so keys can still be
  guessed there. The per-kitchen count also lets someone stop a kitchen
  *getting* passes for 15 minutes; passes already held keep working.
- **The pass does not close the catalog holes.** `save_recipe`, `remove_recipe`
  and the `raw_materials` policies still trust whoever holds the public key.
  Closing them means moving those writes behind this server too.

## Where it lives

- `migrations/fofo/21-add-staff-passes.sql` — tables and functions
- `partner-frontend/api/_lib/staffAuth.js` — `issuePass`, `requireStaff`, `endPass`
- `partner-frontend/api/staff.js` — `/api/staff/*`
- `frontend/src/lib/staffPass.js` — the internal app's half
- `frontend/src/pages/Login.jsx`, `frontend/src/lib/auth.js` — asked for at login, dropped at sign-out
