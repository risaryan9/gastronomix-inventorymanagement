// Admin ▸ Audits ▸ Inventory & Catalog
//
// Stock coming into a kitchen, and changes to the material catalog it is
// counted in: stock-in receipts, manual on-hand overrides in either direction,
// the receiving half of an inter-cloud transfer, and catalog creates, edits,
// deactivations and reactivations.
//
// Manual decrements are recorded as outbound movement but are listed here, not
// under Requisitions & Stock Out: an increment and a decrement are one user
// action — a manual override of on-hand stock — and only read correctly as a
// pair.

import AuditSubsectionPage from '../../../components/audits/AuditSubsectionPage'
import {
  FAMILY,
  fetchInventoryCatalogEvents,
  formatCurrency,
  formatQty,
  summarizeEvents,
} from '../../../lib/auditEvents'

const ACTION_KEYS = [
  'inventory_in:stock_in_received',
  'inventory_in:inventory_increment',
  'inventory_out:inventory_decrement',
  'inventory_in:inter_cloud_transfer_received',
  'catalog:create',
  'catalog:update',
  'catalog:deactivate',
  'catalog:reactivate',
]

const FAMILY_OPTIONS = [
  { value: 'all', label: 'All events' },
  { value: FAMILY.INVENTORY, label: 'Inventory movements' },
  { value: FAMILY.CATALOG, label: 'Catalog changes' },
]

const buildTiles = (summary) => [
  { id: 'total', label: 'Total events', value: String(summary.total), sub: 'all recorded' },
  {
    id: 'received',
    label: 'Value received',
    value: formatCurrency(summary.received),
    sub: `${summary.receipts} receipt${summary.receipts === 1 ? '' : 's'}`,
    tone: 'accent',
  },
  {
    id: 'adjustments',
    label: 'Manual adjustments',
    value: String(summary.adjustments),
    sub: summary.adjustments
      ? `net ${summary.adjustmentNet > 0 ? '+' : ''}${formatQty(summary.adjustmentNet)} across units`
      : 'no overrides',
    tone: summary.adjustmentNet < 0 ? 'negative' : 'default',
  },
  {
    id: 'catalog',
    label: 'Catalog changes',
    value: String(summary.catalogChanges),
    sub: 'creates, edits, status flips',
  },
  {
    id: 'critical',
    label: 'Critical',
    value: String(summary.critical),
    sub: 'reversals & overrides',
    tone: summary.critical ? 'critical' : 'default',
  },
]

const AuditInventoryCatalog = () => (
  <AuditSubsectionPage
    fetchEvents={fetchInventoryCatalogEvents}
    actionKeys={ACTION_KEYS}
    familyOptions={FAMILY_OPTIONS}
    summarize={summarizeEvents}
    buildTiles={buildTiles}
    searchPlaceholder="Search material, supplier, invoice, reason, or person…"
    showCostToggle
    keepCatalogOnKitchenFilter
  />
)

export default AuditInventoryCatalog
