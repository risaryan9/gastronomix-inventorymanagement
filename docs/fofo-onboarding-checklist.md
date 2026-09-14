# FOFO onboarding — implementation checklist

In build order. Design: spec §8.1 and §12. Tick as done. "Live" items are checked
against the live database's audit trail, not assumed.

## 1. Admin franchise pages
- [x] Migration 12 written and tested locally: create/edit/deactivate franchise, link/unlink outlet (sets `ownership_model`), admin check, audit, grants
- [x] Run migration 12 in the SQL editor, then verify
- [x] Partner app env vars in Vercel — `DATABASE_URL` (transaction pooler), `DATABASE_CA_CERT`, `INTERNAL_APP_ORIGINS`
- [x] Internal app's Vercel project — `VITE_PARTNER_API_URL` = the partner app's address
- [x] Server: DB connection (as service_role), admin-session check, CORS for the internal app only
- [x] Endpoints: list, create, edit, (de)activate franchises; link/unlink outlets — `partner-frontend/api/admin.js`
- [x] Internal app: Franchise → FOFO Franchises — list, create/edit form, outlet linking
- [x] Live: franchise created and edited from the screen, audited
- [x] Live: outlet linked from the screen — EC1027 to Testing franchise, audited (2026-09-14)
- [ ] Live: unlink an outlet from the screen

## 1b. Outlet FOCO/FOFO model
- [x] Migration 13: `set_outlet_ownership_model` (audited; refuses FOFO with an active FOCO code) + trigger refusing FOCO for a franchise-owned outlet — applied and verified
- [x] Endpoint `PUT /api/admin/outlets/:id/ownership-model`
- [x] Outlets page: Model column and filter; Ownership Model field in the add and edit forms
- [x] Migration 15 written and tested locally: FOFO turns the FOCO portal code off, FOCO back on (only if the switch turned it off); linking accepts FOFO outlets only (decision 0019)
- [x] Migration 15 applied and verified
- [x] Outlets edit form: read-only "FOCO portal code on file" box when the model is FOFO; warning before saving FOCO → FOFO on an outlet whose code is on
- [x] Franchise picker: FOFO outlets only
- [x] Live: EC1027 marked FOFO from the edit form — its active portal code turned off (`deactivated_for_fofo_at` set), audited with the code's state before and after
- [x] Live: that code is no longer visible to the public key the portal uses (checked through the REST API; 63 of 64 codes still visible)
- [x] Live: EC1027 then linked to Testing franchise
- [ ] Live: confirm EC1027 cannot be set back to FOCO while linked
- [ ] Live: unlink it, set it back to FOCO, confirm its portal code is on again
- [ ] Live: confirm with a FOCO owner (or the portal itself) that EC1027's code no longer opens the portal

## 2. Email
- [x] Provider: Resend. `RESEND_API_KEY`, `EMAIL_FROM`, `PARTNER_APP_URL` in the partner app's Vercel project
- [x] Sending through the test sender `onboarding@resend.dev` — delivers **only to the Resend account's own address**, so the test franchise's contact email must be that address
- [x] Emails styled like the app: dark by default, light palette for mail apps that follow the system theme
- [ ] Company domain: add it in Resend, add its SPF/DKIM DNS records, verify, change `EMAIL_FROM` — no code change

## 3. Supabase Auth
- [x] Partner app redirect URL (`/reset-password`) — a live password reset completed through it
- [ ] Turn off public sign-ups (Authentication → Sign In / Providers) — cannot be checked from the database; confirm in the dashboard
- [ ] Custom SMTP from Resend — **after** the company domain is verified. Until then Supabase's built-in mailer delivers reset emails only to Supabase organisation members, a few an hour

## 4. Onboarding flow
- [x] Welcome email endpoint → send, then `record_welcome_email_sent` (not recorded if the send fails)
- [x] Registration email endpoint → token (hash stored), `create_franchise_invitation`, numbered email; a failed send cancels the link
- [x] Revoke endpoint → `revoke_franchise_invitation`
- [x] Buttons enabled (with confirmation); Cancel on open links
- [x] Partner app `/register#token=…` page + `POST /api/auth/registration-link` and `POST /api/auth/register` (deletes the Auth user if the claim fails)
- [x] Tested locally against fake Resend and Supabase Auth (47 checks)
- [x] Live: welcome email sent; two registration emails sent; one used to register

## 4b. Franchise sign-in (spec Phase 3) and dashboard shell
- [x] Migration 14: sessions, sign-in throttling, audited sign-in/out and reset — applied and verified
- [x] `/api/auth/login`, `logout`, `session`, `password-reset`, `password-reset/complete`; `/api/franchise/outlets` scoped to the session's franchise (decision 0018)
- [x] Partner app pages: `/login`, `/forgot-password`, `/reset-password`; dashboard shell with placeholder sections (Overview, Order supplies, Cart, Orders, Invoices, Store credit, Account)
- [x] Tested locally: 52 API checks + a real-browser sign-in/refresh/sign-out run
- [x] Live: registered, signed in, signed out, reset the password, signed in with the new one — all audited under the user

## 5. Test end to end
- [x] Create franchise, send welcome
- [x] Link an outlet to it
- [x] Send two registration emails; register with one
- [ ] Register with the second (still open)
- [ ] Reused, expired and revoked links are refused — tested locally, not yet live (no link has been cancelled live)
- [ ] Taken email is refused, and no orphan Auth user is left — tested locally, not yet live
- [x] Audit events name the admin and the franchise user
- [ ] Deactivate the franchise and confirm its user is signed out on the next page load; reactivate

## Next
- [ ] Spec Phase 1: BOM tables are in; the cost roll-up and pricing module, no UI — accountant signs off a sample invoice
- [ ] Franchise user management: what a franchise may do with its own users is still undecided (spec §8.1); admins have no user screen yet either

## Loose ends
- [ ] **Rotate the database password** — the current one was shared in a chat and is guessable. Long random, update `DATABASE_URL` in Vercel, redeploy, allow a few minutes for the transaction pooler to pick it up
- [ ] **Rotate all 23 staff login keys** — they were readable before the fix (decision 0017)
- [x] **Staff login keys were readable by anyone with the internal app's public key** (decision 0017) — fixed and verified against the live REST API
- [x] Stray `docs/prod-ca-2021.crt` deleted
- [ ] `partner-frontend/.env` for local development (same values as Vercel; `PARTNER_APP_URL=http://localhost:5174`)
- [ ] Registered emails are marked confirmed without a confirmation email (by decision the address is the registrant's choice; confirmation would need Supabase SMTP). Revisit with custom SMTP
- [ ] FOFO audit events have no labels in the internal app's audit screens yet (`lib/auditEvents.js`)
- [ ] Pre-existing: the RLS policy on `public.outlets` lets any caller without a Supabase session write outlets (`is_supervisor_or_admin()` returns true for them) — fix separately
- [ ] Pre-existing: staff emails and phone numbers are readable with the internal app's public key (decision 0017)
- [ ] Pre-existing: every *active* FOCO portal code is readable with the public key (decision 0019) — if a code is the portal's password, same class of exposure as the staff login keys
