// Admin ▸ Audits ▸ Dispatch & Checkout
//
// The two ends of a dispatch day: the plan the kitchen produces and ships to,
// and the closing sheet each outlet files against it. Plan created, plan
// revised (with the version it discarded), plan locked by the kitchen, then the
// outlet's returns and wastage and the confirmation that makes them official.
//
// ⚠️ Known gap in the data, not in this screen: `confirm_checkout_form` records
// a confirmation without an outlet id or a correlation id, so a confirmed
// closing cannot be tied back to the draft saves it came from, and does not
// respond to the outlet filter. Every other event here carries both. Fixing it
// is a two-line change to that function.

import AuditSubsectionPage from '../../../components/audits/AuditSubsectionPage'
import {
  FAMILY,
  fetchDispatchCheckoutEvents,
  summarizeDispatchCheckoutEvents,
} from '../../../lib/auditEvents'

const ACTION_KEYS = [
  'dispatch_plan:dispatch_plan_created',
  'dispatch_plan:dispatch_plan_updated',
  'reversal:dispatch_plan_items_replaced',
  'dispatch_plan:dispatch_plan_locked',
  'checkout:checkout_draft_created',
  'checkout:checkout_draft_updated',
  'checkout:checkout_confirmed',
]

const FAMILY_OPTIONS = [
  { value: 'all', label: 'All events' },
  { value: FAMILY.DISPATCH, label: 'Dispatch plans' },
  { value: FAMILY.CHECKOUT, label: 'Outlet closings' },
]

const buildTiles = (summary) => [
  { id: 'total', label: 'Total events', value: String(summary.total), sub: 'all recorded' },
  {
    id: 'plans',
    label: 'Plans created',
    value: String(summary.plansCreated),
    sub: summary.plansRevised ? `${summary.plansRevised} revised afterwards` : 'none revised afterwards',
  },
  {
    id: 'locked',
    label: 'Plans locked',
    value: String(summary.plansLocked),
    sub: `${summary.lockedWithChanges} with quantities changed`,
    tone: summary.lockedWithChanges ? 'negative' : 'default',
  },
  {
    id: 'closings',
    label: 'Closings confirmed',
    value: String(summary.confirmed),
    sub: `${summary.draftSaves} sheet save${summary.draftSaves === 1 ? '' : 's'}`,
    tone: 'accent',
  },
  {
    id: 'critical',
    label: 'Critical',
    value: String(summary.critical),
    sub: 'discarded plan versions',
    tone: summary.critical ? 'critical' : 'default',
  },
]

const AuditDispatchCheckout = () => (
  <AuditSubsectionPage
    fetchEvents={fetchDispatchCheckoutEvents}
    actionKeys={ACTION_KEYS}
    familyOptions={FAMILY_OPTIONS}
    summarize={summarizeDispatchCheckoutEvents}
    buildTiles={buildTiles}
    searchPlaceholder="Search outlet, brand, material, or person…"
    showOutletFilter
  />
)

export default AuditDispatchCheckout
