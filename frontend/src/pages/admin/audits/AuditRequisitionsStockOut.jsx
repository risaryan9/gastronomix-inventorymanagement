// Admin ▸ Audits ▸ Requisitions & Stock Out
//
// The demand side and the outbound side of the same story: what an outlet asked
// for, how that request was changed after it was raised, what was actually
// packed and sent, what was booked out with no outlet on the other end, and
// what was cancelled afterwards.

import AuditSubsectionPage from '../../../components/audits/AuditSubsectionPage'
import {
  FAMILY,
  fetchRequisitionStockOutEvents,
} from '../../../lib/auditEvents'

const ACTION_KEYS = [
  'requisition:requisition_created',
  'requisition:requisition_updated',
  'reversal:requisition_items_deleted',
  'requisition:requisition_items_added_by_pm',
  'inventory_out:requisition_packed',
  'inventory_out:stock_out',
  'reversal:requisition_packing_cancelled',
]

const FAMILY_OPTIONS = [
  { value: 'all', label: 'All events' },
  { value: FAMILY.REQUISITION, label: 'Requisitions' },
  { value: FAMILY.STOCK_OUT, label: 'Stock out' },
]

const AuditRequisitionsStockOut = () => (
  <AuditSubsectionPage
    fetchEvents={fetchRequisitionStockOutEvents}
    actionKeys={ACTION_KEYS}
    familyOptions={FAMILY_OPTIONS}
    searchPlaceholder="Search outlet, material, reason, or person…"
    showOutletFilter
  />
)

export default AuditRequisitionsStockOut
