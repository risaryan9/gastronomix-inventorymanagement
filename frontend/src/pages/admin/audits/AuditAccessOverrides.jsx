// Admin ▸ Audits ▸ Access & Overrides
//
// Two questions in one place: who got into the system, and what did anyone undo
// or override once they were in.
//
// Access is sign-ins with a login key, successful and rejected. Overrides are
// every action anywhere in the system that reverses or overrides something
// already recorded — a cancelled pack, removed requisition lines, a discarded
// dispatch plan, a material retired or brought back, a hand-edited stock
// figure. Those events also appear in the subsection they belong to; gathering
// them here is the point, because on their own they are scattered across four
// screens and each one is only suspicious in company.

import AuditSubsectionPage from '../../../components/audits/AuditSubsectionPage'
import { FAMILY, fetchAccessOverrideEvents } from '../../../lib/auditEvents'

const ACTION_KEYS = [
  'auth:login_success',
  'auth:login_failed',
  'reversal:requisition_packing_cancelled',
  'reversal:requisition_items_deleted',
  'reversal:dispatch_plan_items_replaced',
  'catalog:deactivate',
  'catalog:reactivate',
  'inventory_in:inventory_increment',
  'inventory_out:inventory_decrement',
]

const FAMILY_OPTIONS = [
  { value: 'all', label: 'All events' },
  { value: FAMILY.ACCESS, label: 'Sign-ins' },
  { value: FAMILY.OVERRIDE, label: 'Overrides & reversals' },
]

// The registry files each override event under the area it happened in; here
// they are all one thing.
const familyForKey = (key) => (key.startsWith('auth:') ? FAMILY.ACCESS : FAMILY.OVERRIDE)

const AuditAccessOverrides = () => (
  <AuditSubsectionPage
    fetchEvents={fetchAccessOverrideEvents}
    actionKeys={ACTION_KEYS}
    familyOptions={FAMILY_OPTIONS}
    familyForKey={familyForKey}
    searchPlaceholder="Search person, kitchen, IP address, or material…"
    note="Overrides and reversals are also listed in the subsection they happened in — they are gathered here so they can be read together."
    keepCatalogOnKitchenFilter
  />
)

export default AuditAccessOverrides
