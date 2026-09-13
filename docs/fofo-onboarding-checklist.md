# FOFO onboarding — implementation checklist

In build order. Design: spec §8.1 and §12. Tick as done.

## 1. Admin franchise pages
- [x] Migration 12 written and tested locally: create/edit/deactivate franchise, link/unlink outlet (sets `ownership_model`), admin check, audit, grants
- [x] Run migration 12 in the SQL editor, then verify
- [ ] **You:** partner app env vars, in Vercel and `partner-frontend/.env` — `DATABASE_URL` (transaction pooler), `DATABASE_CA_CERT`, `INTERNAL_APP_ORIGINS`
- [ ] **You:** internal app's Vercel project — `VITE_PARTNER_API_URL` = the partner app's address
- [x] Server: DB connection (as service_role), admin-session check, CORS for the internal app only
- [x] Endpoints: list, create, edit, (de)activate franchises; link/unlink outlets — `partner-frontend/api/admin.js`
- [x] Internal app: FOFO → Franchises — list, create/edit form, outlet linking
- [ ] Try it against the live database once the env vars are set
- [x] Welcome and registration buttons, disabled ("Email not set up yet")

## 2. Email
- [ ] Choose a provider; add SPF/DKIM DNS records
- [ ] Provider key as a server-only env var (no `VITE_`)

## 3. Supabase Auth
- [ ] Custom SMTP from the email provider
- [ ] Partner app redirect URL

## 4. Onboarding flow
- [ ] Welcome email endpoint → `record_welcome_email_sent`
- [ ] Registration email endpoint → token, `create_franchise_invitation`, numbered email
- [ ] Revoke endpoint → `revoke_franchise_invitation`
- [ ] Enable the buttons; invitation list with revoke
- [ ] Partner app registration page + `POST /api/auth/register` (deletes the Auth user if the claim fails)

## 5. Test end to end
- [ ] Create franchise, link outlet, send welcome
- [ ] Send two registration emails; register with each
- [ ] Reused, expired and revoked links are refused
- [ ] Taken email is refused, and no orphan Auth user is left
- [ ] Audit events name the admin and the franchise user
