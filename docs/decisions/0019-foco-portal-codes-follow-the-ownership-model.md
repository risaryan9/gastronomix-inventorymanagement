# 0019. An outlet's FOCO portal code follows its ownership model

Date: 2026-09-14
Status: Accepted

## Context

`public.franchise_outlet_codes` holds the code FOCO franchise owners use to open
their read-only analytics portal. The portal reads codes with the anon key,
through the table's only read policy, `USING (is_active)`.

When an outlet changes from company-operated (FOCO) to franchise-operated
(FOFO), its former FOCO owners must stop seeing its sales. Migration 13 simply
refused to make an outlet FOFO while it had an active code, leaving someone to
switch the code off by hand first — in a table no screen manages.

## Decision

**The ownership model drives the portal code**, in a trigger on `public.outlets`
(migration 15):

- **FOCO → FOFO** turns the outlet's active code off (`is_active = false`) and
  records why in `deactivated_for_fofo_at`. The portal can no longer see it.
- **FOFO → FOCO** turns it back on — but only a code the FOFO switch turned off.
  A code that was off for any other reason stays off.

It is a trigger, not code in one function, because `ownership_model` has more
than one writer: the audited `fofo.set_outlet_ownership_model`, and a direct
anon-key update, which the live outlets policy allows.

**Only a FOFO outlet can be linked to a franchise**, and linking no longer
changes the model. Marking an outlet FOFO (Outlets page) and giving it to a
franchise (FOFO Franchises) are two deliberate steps.

## Alternatives

**A separate status column for portal access.** Rejected: `is_active` already is
that status, and the portal's read policy already enforces it. A second column
would do nothing unless the portal learned to check it.

**Reactivate every code on returning to FOCO.** Simpler, and today identical —
every code was active. Rejected because reversing an ownership change must not
silently undo an unrelated decision to cut someone's access.

**Keep linking able to switch the model.** It made a stray click in the
franchise screen's picker enough to turn a company-run outlet into a franchise
one, and its portal code off with it.

## Consequences

- **The lock-out relies on the portal reading codes with the anon key**
  (confirmed 2026-09-14). If the portal ever reads them with the service_role
  key, it bypasses the policy and must check `is_active` itself.
- Admins cannot see an inactive code with the internal app's own key; the
  Outlets page gets portal-code state from the partner app's `/api/admin/outlets`.
- Anyone with the anon key can list every *active* portal code through the same
  policy. If a code is what an owner types to open the portal, that is the same
  class of exposure decision 0017 fixed for staff login keys. Not addressed here.

## Where it lives

- `migrations/fofo/15-tie-foco-portal-codes-to-ownership-model.sql`
- `partner-frontend/api/_lib/franchiseAdmin.js` — `listOutlets`, `setOutletOwnershipModel`
- `frontend/src/pages/admin/AdminOutlets.jsx` — the read-only "FOCO portal code on file" box
- `frontend/src/components/admin/fofo/FranchiseDetailModal.jsx` — FOFO-only picker
