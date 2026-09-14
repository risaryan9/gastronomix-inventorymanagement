# FOFO onboarding — implementation checklist

In build order. Design: spec §8.1 and §12. Tick as done.

## 1. Admin franchise pages
- [x] Migration 12 written and tested locally: create/edit/deactivate franchise, link/unlink outlet (sets `ownership_model`), admin check, audit, grants
- [x] Run migration 12 in the SQL editor, then verify
- [x] Partner app env vars in Vercel — `DATABASE_URL` (transaction pooler), `DATABASE_CA_CERT`, `INTERNAL_APP_ORIGINS`
- [x] Internal app's Vercel project — `VITE_PARTNER_API_URL` = the partner app's address
- [x] Server: DB connection (as service_role), admin-session check, CORS for the internal app only
- [x] Endpoints: list, create, edit, (de)activate franchises; link/unlink outlets — `partner-frontend/api/admin.js`
- [x] Internal app: Franchise → FOFO Franchises — list, create/edit form, outlet linking
- [x] Welcome and registration buttons, disabled ("Email not set up yet")
- [x] Live: franchise created from the screen, audited (`franchise_created`)
- [ ] Live: link and unlink an outlet from the screen

## 1b. Outlet FOCO/FOFO model
- [x] Migration 13: `set_outlet_ownership_model` (audited; refuses FOFO with an active FOCO code) + trigger refusing FOCO for a franchise-owned outlet — applied and verified
- [x] Endpoint `PUT /api/admin/outlets/:id/ownership-model`
- [x] Outlets page: Model column and filter; Ownership Model field in the add and edit forms
- [ ] Live: change an outlet's model from the form; confirm a franchise-owned outlet cannot be set to FOCO

## 2. Email
- [x] Provider: Resend. `RESEND_API_KEY`, `EMAIL_FROM`, `PARTNER_APP_URL` in the partner app's Vercel project
- [x] Sending through the test sender `onboarding@resend.dev` — delivers **only to the Resend account's own address**, so the test franchise's contact email must be that address
- [ ] Company domain: add it in Resend, add its SPF/DKIM DNS records, verify, change `EMAIL_FROM` — no code change

## 3. Supabase Auth
- [ ] Custom SMTP from Resend — **after** the company domain is verified (the test sender cannot reach franchise users)
- [ ] Partner app redirect URL

## 4. Onboarding flow
- [x] Welcome email endpoint → send, then `record_welcome_email_sent` (not recorded if the send fails)
- [x] Registration email endpoint → token (hash stored), `create_franchise_invitation`, numbered email; a failed send cancels the link
- [x] Revoke endpoint → `revoke_franchise_invitation`
- [x] Buttons enabled (with confirmation); Cancel on open links
- [x] Partner app `/register#token=…` page + `POST /api/auth/registration-link` and `POST /api/auth/register` (deletes the Auth user if the claim fails)
- [x] All of it tested locally against fake Resend and Supabase Auth (47 checks)
- [ ] Deploy, then try it live

## 5. Test end to end
- [ ] Create franchise, link outlet, send welcome
- [ ] Send two registration emails; register with each
- [ ] Reused, expired and revoked links are refused
- [ ] Taken email is refused, and no orphan Auth user is left
- [ ] Audit events name the admin and the franchise user

## Loose ends
- [ ] **Rotate the database password** — the current one was shared in a chat and is guessable. Long random, update `DATABASE_URL` in Vercel, redeploy, allow a few minutes for the transaction pooler to pick it up
- [ ] `partner-frontend/.env` for local development (same values as Vercel; `PARTNER_APP_URL=http://localhost:5174`)
- [ ] Registered emails are marked confirmed without a confirmation email (by decision the address is the registrant's choice; confirmation would need Supabase SMTP). Revisit with step 3
- [ ] Delete the stray `docs/prod-ca-2021.crt` (not committed; the server reads `DATABASE_CA_CERT`)
- [ ] FOFO audit events have no labels in the internal app's audit screens yet (`lib/auditEvents.js`)
- [ ] **Staff login keys were readable by anyone with the internal app's public key** (decision 0017). Deploy the internal app, run `migrations/stop-exposing-staff-login-keys.sql`, verify, then **rotate all 23 login keys**
- [ ] Pre-existing: the RLS policy on `public.outlets` lets any caller without a Supabase session write outlets (`is_supervisor_or_admin()` returns true for them) — fix separately
