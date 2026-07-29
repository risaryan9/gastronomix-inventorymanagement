// Audit trail — read side.
//
// docs/AUDIT_TRAIL_REQUIREMENTS.md catalogues twenty action points (A1–H1) and
// §6 defines the `audit_events` spine they all write to. This module is the
// admin-facing *read* of that spine: the query, plus the per-action knowledge
// needed to render an event as something a human can review rather than as a
// row of jsonb.
//
// WHY A REGISTRY RATHER THAN PER-ACTION COMPONENTS
//
// Each action writes a differently-shaped payload (a stock-in carries
// supplier/invoice/per-item cost; a manual adjustment carries an old and new
// on-hand quantity and a reason; a catalog edit carries a before/after record).
// Rendering that well means action-specific knowledge somewhere. Keeping it
// here — as data — means the card and the drawer stay generic, and the
// remaining audit subsections (Requisitions & Stock Out, Dispatch & Checkout,
// Access & Overrides) extend ACTION_META instead of adding new components.
//
// Events are keyed `category:action`, not action alone: the catalog actions are
// named `create` / `update`, which are not unique across categories.

import { supabase } from './supabase'
import { getBusinessDate } from './businessDate'

/* ------------------------------------------------------------------ *
 * Action registry
 * ------------------------------------------------------------------ */

export const FAMILY = {
  INVENTORY: 'inventory',
  CATALOG: 'catalog',
  REQUISITION: 'requisition',
  STOCK_OUT: 'stock_out',
  DISPATCH: 'dispatch',
  CHECKOUT: 'checkout',
}

export const ACTION_META = {
  'inventory_in:stock_in_received': {
    label: 'Stock In Received',
    family: FAMILY.INVENTORY,
    glyph: '↓',
    why: 'The largest inbound value event: it raises physical stock and sets the cost basis (unit cost, GST, supplier, invoice) every later FIFO calculation depends on.',
  },
  'inventory_in:inventory_increment': {
    label: 'Manual Increment',
    family: FAMILY.INVENTORY,
    glyph: '+',
    why: 'A discretionary override of on-hand stock with a free-text reason — the kind of action that can mask shrinkage, so the before/after and the reason are both on record.',
  },
  'inventory_out:inventory_decrement': {
    label: 'Manual Decrement',
    family: FAMILY.INVENTORY,
    glyph: '−',
    why: 'A discretionary override of on-hand stock with a free-text reason — the kind of action that can mask shrinkage, so the before/after and the reason are both on record.',
  },
  'inventory_in:inter_cloud_transfer_received': {
    label: 'Inter-Cloud Transfer Received',
    family: FAMILY.INVENTORY,
    glyph: '⇄',
    why: 'Value crossing a kitchen boundary mints new inventory and cost at the destination. Both legs share a correlation id so the pair is reviewable together.',
  },
  'catalog:create': {
    label: 'Material Created',
    family: FAMILY.CATALOG,
    glyph: '✚',
    why: 'A new catalog item defines the unit every future quantity is expressed in, and becomes receivable and allocatable stock.',
  },
  'catalog:update': {
    label: 'Material Edited',
    family: FAMILY.CATALOG,
    glyph: '✎',
    why: 'Changing a material retroactively affects valuation and reporting; changing its unit silently distorts every quantity recorded against it.',
  },
  'catalog:deactivate': {
    label: 'Material Deactivated',
    family: FAMILY.CATALOG,
    glyph: '⊘',
    why: 'Deactivating hides a material from allocation and reporting — a way to make an item disappear without deleting its history. Logged as critical.',
  },
  'catalog:reactivate': {
    label: 'Material Reactivated',
    family: FAMILY.CATALOG,
    glyph: '⟳',
    why: 'Bringing a retired material back reverses an earlier decision, so both directions are recorded.',
  },

  /* ------------------------- requisitions & stock out ------------------------ */

  'requisition:requisition_created': {
    label: 'Requisition Raised',
    family: FAMILY.REQUISITION,
    glyph: '✎',
    why: 'The requisition is what authorises stock to leave the kitchen for an outlet. Who asked for how much, for which outlet, on which day is the basis for consumption analytics and for holding an outlet to its numbers.',
  },
  'requisition:requisition_updated': {
    label: 'Requisition Edited',
    family: FAMILY.REQUISITION,
    glyph: '✎',
    why: 'Editing a requisition after it was raised changes the amounts an outlet is authorised to receive — potentially after the stock has already been discussed or planned for.',
  },
  'reversal:requisition_items_deleted': {
    label: 'Requisition Lines Removed',
    family: FAMILY.REQUISITION,
    glyph: '⊘',
    why: 'Removing a line erases the evidence of what was originally asked for, so it is recorded separately from the edit that contained it.',
  },
  'requisition:requisition_items_added_by_pm': {
    label: 'Items Added by Purchase Manager',
    family: FAMILY.REQUISITION,
    glyph: '＋',
    why: 'The purchase manager widened an outlet’s request after the supervisor submitted it, without the supervisor being involved at that moment.',
  },
  'inventory_out:requisition_packed': {
    label: 'Requisition Packed',
    family: FAMILY.STOCK_OUT,
    glyph: '↑',
    why: 'The main outbound event: stock physically leaves the kitchen for an outlet, at the cost of the batches it came from. The most frequent and highest-value movement in the system.',
  },
  'inventory_out:stock_out': {
    label: 'Stock Out',
    family: FAMILY.STOCK_OUT,
    glyph: '↑',
    why: 'Stock booked out with no receiving outlet — wastage, staff food, kitchen production, or a transfer to another kitchen. It reduces stock with no one on the other end to confirm it arrived.',
  },
  /* -------------------------- dispatch & checkout -------------------------- */

  'dispatch_plan:dispatch_plan_created': {
    label: 'Dispatch Plan Created',
    family: FAMILY.DISPATCH,
    glyph: '▤',
    why: 'The dispatch plan is what the kitchen produces and ships to. It commits kitchen capacity and stock for the day, so the quantities and who set them are on record.',
  },
  'dispatch_plan:dispatch_plan_updated': {
    label: 'Dispatch Plan Revised',
    family: FAMILY.DISPATCH,
    glyph: '▤',
    why: 'Re-saving a plan changes what the kitchen is working to. Without a record there is no way to see that a plan was revised, or by how much.',
  },
  'reversal:dispatch_plan_items_replaced': {
    label: 'Previous Plan Discarded',
    family: FAMILY.DISPATCH,
    glyph: '⊘',
    why: 'A re-save throws away the entire previous plan. The discarded version is kept here so a revision can be compared against what it replaced.',
  },
  'dispatch_plan:dispatch_plan_locked': {
    label: 'Dispatch Plan Locked',
    family: FAMILY.DISPATCH,
    glyph: '▣',
    why: 'Locking hands the plan from planning to the kitchen floor; after this it is treated as final for production and stock movement.',
  },
  'checkout:checkout_draft_created': {
    label: 'Closing Sheet Started',
    family: FAMILY.CHECKOUT,
    glyph: '✎',
    why: 'The closing sheet reconciles what an outlet was given against what came back. Returns and wastage are the outlet\u2019s loss figures and the easiest numbers to fudge.',
  },
  'checkout:checkout_draft_updated': {
    label: 'Closing Sheet Saved',
    family: FAMILY.CHECKOUT,
    glyph: '✎',
    why: 'A closing sheet can be saved repeatedly before it is confirmed. Every save is kept, so a figure that moved between saves is visible rather than lost.',
  },
  'checkout:checkout_confirmed': {
    label: 'Closing Confirmed',
    family: FAMILY.CHECKOUT,
    glyph: '✔',
    why: 'Confirming makes the day\u2019s figures official and puts the returned stock back into inventory. After this the sheet can no longer be edited.',
  },

  'reversal:requisition_packing_cancelled': {
    label: 'Packing Cancelled',
    family: FAMILY.STOCK_OUT,
    glyph: '⟲',
    why: 'Cancelling a pack puts the stock back and reopens the requisition. Pack, cancel and re-pack is the pattern used to paper over a discrepancy, so every cancellation is recorded in full.',
  },
}

// Self stock-outs record why the stock left; the raw values are hyphenated
// slugs, and these are what they mean.
export const STOCK_OUT_REASON_LABEL = {
  wastage: 'Wastage',
  'staff-food': 'Staff food',
  'internal-production': 'Kitchen production',
  'culinary-r&d': 'Culinary R&D',
  'culinary-rnd': 'Culinary R&D',
  dispatch: 'Brand dispatch',
  'inter-cloud-kitchen': 'Transfer to another kitchen',
  adjustment: 'Stock adjustment',
}

// Brands are stored as slugs (`el_chaapo`); nobody outside the database calls
// them that.
export const brandLabel = (brand) =>
  brand ? String(brand).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null

export const stockOutReasonLabel = (reason) =>
  STOCK_OUT_REASON_LABEL[reason] ||
  (reason ? String(reason).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'No reason recorded')

export const eventKey = (event) => `${event?.category}:${event?.action}`

export const metaFor = (event) =>
  ACTION_META[eventKey(event)] || {
    label: event?.action || 'Unknown action',
    family: FAMILY.INVENTORY,
    glyph: '•',
    why: null,
  }

/* ------------------------------------------------------------------ *
 * Query
 * ------------------------------------------------------------------ */

const SELECT_COLUMNS = `
  id, actor_user_id, actor_role, cloud_kitchen_id, outlet_id,
  category, action, entity_type, entity_id,
  correlation_id, reversed_event_id, severity,
  old_values, new_values, ip_address, user_agent, session_id, created_at,
  actor:users!audit_events_actor_user_id_fkey ( id, full_name, role, email ),
  cloud_kitchen:cloud_kitchens!audit_events_cloud_kitchen_id_fkey ( id, name ),
  outlet:outlets!audit_events_outlet_id_fkey ( id, name )
`

// Filtering by category *and* action together, because `create` / `update` are
// not unique action names across categories.
const INVENTORY_CATALOG_OR_FILTER = [
  'and(category.eq.inventory_in,action.in.(stock_in_received,inventory_increment,inter_cloud_transfer_received))',
  'and(category.eq.inventory_out,action.eq.inventory_decrement)',
  'and(category.eq.catalog,action.in.(create,update,deactivate,reactivate))',
].join(',')

export const AUDIT_FETCH_LIMIT = 500

export const fetchInventoryCatalogEvents = async ({ limit = AUDIT_FETCH_LIMIT } = {}) => {
  const { data, error } = await supabase
    .from('audit_events')
    .select(SELECT_COLUMNS)
    .or(INVENTORY_CATALOG_OR_FILTER)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

// Requisitions & Stock Out. Manual inventory adjustments also land in
// `inventory_out`, but they belong with their matching increments under
// Inventory & Catalog, so they are excluded here by naming the actions.
const REQUISITION_STOCK_OUT_OR_FILTER = [
  'and(category.eq.requisition,action.in.(requisition_created,requisition_updated,requisition_items_added_by_pm))',
  'and(category.eq.inventory_out,action.in.(requisition_packed,stock_out))',
  'and(category.eq.reversal,action.in.(requisition_items_deleted,requisition_packing_cancelled))',
].join(',')

export const fetchRequisitionStockOutEvents = async ({ limit = AUDIT_FETCH_LIMIT } = {}) => {
  const { data, error } = await supabase
    .from('audit_events')
    .select(SELECT_COLUMNS)
    .or(REQUISITION_STOCK_OUT_OR_FILTER)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

// Dispatch & Checkout.
const DISPATCH_CHECKOUT_OR_FILTER = [
  'and(category.eq.dispatch_plan,action.in.(dispatch_plan_created,dispatch_plan_updated,dispatch_plan_locked))',
  'and(category.eq.checkout,action.in.(checkout_draft_created,checkout_draft_updated,checkout_confirmed))',
  'and(category.eq.reversal,action.eq.dispatch_plan_items_replaced)',
].join(',')

export const fetchDispatchCheckoutEvents = async ({ limit = AUDIT_FETCH_LIMIT } = {}) => {
  const { data, error } = await supabase
    .from('audit_events')
    .select(SELECT_COLUMNS)
    .or(DISPATCH_CHECKOUT_OR_FILTER)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

// Events sharing a correlation_id are looked up without the subsection filter
// on purpose: D3's two legs live in different subsections (the source leg is a
// stock-out), and the whole point of the column is to see them together.
export const fetchCorrelatedEvents = async (correlationId, excludeEventId) => {
  if (!correlationId) return []

  const { data, error } = await supabase
    .from('audit_events')
    .select(SELECT_COLUMNS)
    .eq('correlation_id', correlationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []).filter((event) => event.id !== excludeEventId)
}

export const fetchAuditLookups = async () => {
  const [kitchensRes, materialsRes, outletsRes] = await Promise.all([
    supabase.from('cloud_kitchens').select('id, name').order('name'),
    supabase.from('raw_materials').select('id, name, code, unit'),
    supabase.from('outlets').select('id, name').order('name'),
  ])

  if (kitchensRes.error) throw kitchensRes.error
  if (materialsRes.error) throw materialsRes.error
  if (outletsRes.error) throw outletsRes.error

  const materials = new Map()
  ;(materialsRes.data || []).forEach((material) => materials.set(material.id, material))

  const outletsById = new Map()
  ;(outletsRes.data || []).forEach((outlet) => outletsById.set(outlet.id, outlet))

  return { kitchens: kitchensRes.data || [], materials, outlets: outletsRes.data || [], outletsById }
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatCurrency = (value) => {
  const num = Number(value)
  if (value === null || value === undefined || Number.isNaN(num)) return '—'
  return `₹${currencyFormatter.format(num)}`
}

export const formatQty = (value) => {
  const num = Number(value)
  if (value === null || value === undefined || Number.isNaN(num)) return '—'
  return num.toLocaleString('en-IN', { maximumFractionDigits: 3 })
}

export const formatQtyWithUnit = (value, unit) => {
  const qty = formatQty(value)
  return unit ? `${qty} ${unit}` : qty
}

// Values arrive from a mix of client-supplied payloads and Postgres. Some
// legacy raw_materials rows literally contain the string 'NULL'.
export const isBlank = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  value === 'NULL' ||
  value === 'null'

export const displayValue = (value) => {
  if (isBlank(value)) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const IST_DATE = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }
const IST_TIME = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }

export const formatIstDate = (ts) =>
  ts ? new Date(ts).toLocaleDateString('en-IN', IST_DATE) : '—'

export const formatIstTime = (ts) =>
  ts ? `${new Date(ts).toLocaleTimeString('en-IN', IST_TIME)} IST` : '—'

export const formatIstDateTime = (ts) =>
  ts ? `${formatIstDate(ts)}, ${formatIstTime(ts)}` : '—'

export const formatRelative = (ts) => {
  if (!ts) return ''
  const diffMs = Date.now() - new Date(ts).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatIstDate(ts)
}

// The business day, not the calendar day — see lib/businessDate.js. Grouping
// the list by anything else would disagree with the dates stored on the
// records these events describe.
export const businessDayOf = (ts) => (ts ? getBusinessDate(new Date(ts)) : null)

export const formatBusinessDay = (day) => {
  if (!day) return '—'
  const today = getBusinessDate()
  const [y, m, d] = day.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  if (day === today) return `Today · ${label}`
  return label
}

export const roleLabel = (role) =>
  role ? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown role'

export const actorName = (event) =>
  event?.actor?.full_name || (event?.actor_user_id ? 'Deleted user' : 'System')

export const kitchenName = (event, lookups) => {
  if (event?.cloud_kitchen?.name) return event.cloud_kitchen.name
  if (!event?.cloud_kitchen_id) return null
  return lookups?.kitchens?.find((k) => k.id === event.cloud_kitchen_id)?.name || 'Unknown kitchen'
}

export const outletName = (event, lookups) => {
  if (event?.outlet?.name) return event.outlet.name
  if (!event?.outlet_id) return null
  return lookups?.outlets?.find((o) => o.id === event.outlet_id)?.name || 'Unknown outlet'
}

export const resolveOutlet = (lookups, id) =>
  lookups?.outletsById?.get(id) || { id, name: id ? 'Unknown outlet' : 'No outlet' }

// Some payloads carry the material name and unit alongside the id; where they
// do, that is what the actor actually saw, so prefer it over a live lookup.
export const resolveMaterial = (lookups, id, fallback) =>
  lookups?.materials?.get(id) || {
    id,
    name: fallback?.name || 'Unknown material',
    code: fallback?.code || (id ? String(id).slice(0, 8) : '—'),
    unit: fallback?.unit || null,
  }

/* ------------------------------------------------------------------ *
 * Diffing
 * ------------------------------------------------------------------ */

const CATALOG_FIELD_ORDER = [
  ['name', 'Name'],
  ['code', 'Code'],
  ['unit', 'Unit'],
  ['category', 'Category'],
  ['brand', 'Brand'],
  ['description', 'Description'],
  ['low_stock_threshold', 'Low stock threshold'],
  ['brand_codes', 'Brand codes'],
  ['is_active', 'Active'],
]

const sameValue = (a, b) => {
  if (isBlank(a) && isBlank(b)) return true
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  }
  return String(a) === String(b)
}

/**
 * Field-level before/after rows for a record-shaped payload.
 * §5 decision #4 settled on record-level granularity for what gets *logged*;
 * the payload still carries the whole record, so the read side can show which
 * fields actually moved without any extra data.
 */
export const diffRecords = (oldValues, newValues) => {
  const source = { ...(oldValues || {}), ...(newValues || {}) }
  const known = CATALOG_FIELD_ORDER.filter(([key]) => key in source)
  const extra = Object.keys(source)
    .filter((key) => !CATALOG_FIELD_ORDER.some(([k]) => k === key))
    .map((key) => [key, key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())])

  return [...known, ...extra].map(([key, label]) => ({
    key,
    label,
    from: oldValues ? oldValues[key] : undefined,
    to: newValues ? newValues[key] : undefined,
    changed: !!oldValues && !!newValues && !sameValue(oldValues[key], newValues[key]),
  }))
}

const COST_FIELD = /(cost|price|gst|rate|amount)/i

/* ------------------------------------------------------------------ *
 * Per-event derivation — everything the card needs, as plain data
 * ------------------------------------------------------------------ */

const itemRows = (payload, lookups, listKey = 'items') => {
  const items = Array.isArray(payload?.[listKey]) ? payload[listKey] : []
  return items.map((item) => {
    const material = resolveMaterial(lookups, item.raw_material_id, item)
    const quantity = Number(item.quantity)
    const unitCost = item.unit_cost === undefined ? null : Number(item.unit_cost)
    const gst = item.gst_percent === undefined ? null : Number(item.gst_percent)
    const lineTotal =
      item.line_total !== undefined && item.line_total !== null
        ? Number(item.line_total)
        : unitCost !== null && !Number.isNaN(quantity)
          ? quantity * unitCost * (1 + (gst || 0) / 100)
          : null
    return { material, quantity, unitCost, gst, lineTotal }
  })
}

// Dispatch plan lines are per material *per outlet*, so they only read
// correctly with the outlet resolved alongside the material.
const planItemRows = (payload, lookups, listKey = 'items') => {
  const items = Array.isArray(payload?.[listKey]) ? payload[listKey] : []
  return items.map((item) => ({
    material: resolveMaterial(lookups, item.raw_material_id, item),
    outlet: resolveOutlet(lookups, item.outlet_id),
    quantity: Number(item.quantity),
  }))
}

const checkoutRows = (list, lookups, quantityKey) =>
  (Array.isArray(list) ? list : []).map((item) => ({
    material: resolveMaterial(lookups, item.raw_material_id, item),
    dispatched: Number(item.dispatched_quantity),
    quantity: Number(item[quantityKey]),
  }))

const sumBy = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)

/**
 * Reduces one event to the facts a reviewer scans for, so the card component
 * never has to know which action it is rendering.
 */
export const describeEvent = (event, lookups) => {
  const meta = metaFor(event)
  const oldValues = event.old_values || null
  const newValues = event.new_values || null
  const kitchen = kitchenName(event, lookups)

  const outlet = outletName(event, lookups)

  const base = {
    meta,
    family: meta.family,
    title: meta.label,
    glyph: meta.glyph,
    severity: event.severity,
    kitchen,
    outlet,
    contextLine: null,
    // `detail` is the compact second line on a row; `primary` is the single
    // number or word that belongs on the right-hand side of it.
    detail: null,
    primary: null,
    change: null,
    items: [],
    reason: null,
    hasCost: false,
    searchText: '',
  }

  const key = eventKey(event)

  if (key === 'inventory_in:stock_in_received') {
    const rows = itemRows(newValues, lookups)
    const totalCost = Number(newValues?.total_cost)
    return {
      ...base,
      contextLine: [
        newValues?.supplier_name || (newValues?.stock_in_type === 'kitchen' ? 'Kitchen production' : 'No supplier recorded'),
        newValues?.invoice_number ? `Invoice ${newValues.invoice_number}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      detail: `${newValues?.item_count ?? rows.length} item${(newValues?.item_count ?? rows.length) === 1 ? '' : 's'}`,
      primary: { value: formatCurrency(totalCost), tone: 'accent' },
      items: rows,
      hasCost: !Number.isNaN(totalCost) && totalCost > 0,
      searchText: [
        newValues?.supplier_name,
        newValues?.invoice_number,
        ...rows.map((r) => `${r.material.name} ${r.material.code}`),
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'inventory_in:inter_cloud_transfer_received') {
    const rows = itemRows(newValues, lookups)
    const totalCost = Number(newValues?.total_cost)
    return {
      ...base,
      contextLine: `From ${newValues?.source_cloud_kitchen_name || 'another kitchen'} → ${kitchen || 'this kitchen'}`,
      detail: `${newValues?.item_count ?? rows.length} item${(newValues?.item_count ?? rows.length) === 1 ? '' : 's'}`,
      primary: { value: formatCurrency(totalCost), tone: 'accent' },
      items: rows,
      hasCost: !Number.isNaN(totalCost) && totalCost > 0,
      searchText: [
        newValues?.source_cloud_kitchen_name,
        ...rows.map((r) => `${r.material.name} ${r.material.code}`),
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'inventory_in:inventory_increment' || key === 'inventory_out:inventory_decrement') {
    const material = resolveMaterial(lookups, oldValues?.raw_material_id || newValues?.raw_material_id)
    const from = Number(oldValues?.quantity)
    const to = Number(newValues?.quantity)
    const actual = newValues?.actual_new_quantity === undefined ? null : Number(newValues.actual_new_quantity)
    const delta = to - from
    // The RPC records both what was asked for and what the FIFO consume could
    // actually deliver. When they disagree the request was short-filled, and
    // that is the single most interesting fact about the event.
    const shortfall = actual !== null && !Number.isNaN(actual) && Math.abs(actual - to) > 0.0001
    return {
      ...base,
      contextLine: `${material.name} · ${material.code}`,
      detail: [
        `${formatQtyWithUnit(from, material.unit)} → ${formatQtyWithUnit(to, material.unit)}`,
        shortfall ? `settled at ${formatQtyWithUnit(actual, material.unit)}` : null,
        oldValues?.reason || null,
      ]
        .filter(Boolean)
        .join(' · '),
      primary: {
        value: `${delta > 0 ? '+' : ''}${formatQtyWithUnit(delta, material.unit)}`,
        tone: delta < 0 ? 'negative' : 'positive',
      },
      change: {
        material,
        from,
        to,
        delta,
        actual,
        shortfall,
      },
      reason: oldValues?.reason || null,
      details: oldValues?.details || null,
      searchText: [material.name, material.code, oldValues?.reason, oldValues?.details].filter(Boolean).join(' '),
    }
  }

  /* ----------------------- requisitions & stock out ----------------------- */

  if (key === 'requisition:requisition_created') {
    const rows = itemRows(newValues, lookups)
    return {
      ...base,
      contextLine: outlet || 'No outlet recorded',
      detail: [
        newValues?.supervisor_name ? `Requested by ${newValues.supervisor_name}` : null,
        newValues?.request_date ? `for ${newValues.request_date}` : null,
      ]
        .filter(Boolean)
        .join(' '),
      primary: { value: `${newValues?.item_count ?? rows.length} items` },
      items: rows,
      searchText: [outlet, newValues?.supervisor_name, ...rows.map((r) => r.material.name)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'requisition:requisition_updated') {
    const before = itemRows(oldValues, lookups)
    const after = itemRows(newValues, lookups)
    const parts = [
      newValues?.items_inserted ? `${newValues.items_inserted} added` : null,
      newValues?.items_updated ? `${newValues.items_updated} changed` : null,
      newValues?.items_deleted ? `${newValues.items_deleted} removed` : null,
    ].filter(Boolean)
    return {
      ...base,
      contextLine: outlet || 'No outlet recorded',
      detail: parts.length ? parts.join(' · ') : 'Details unchanged',
      primary: { value: `${after.length} items`, tone: 'accent' },
      items: after,
      itemsBefore: before,
      searchText: [outlet, newValues?.supervisor_name, ...after.map((r) => r.material.name)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'reversal:requisition_items_deleted') {
    const removed = itemRows(oldValues, lookups, 'deleted_items')
    return {
      ...base,
      contextLine: outlet || 'No outlet recorded',
      detail: removed.map((row) => row.material.name).join(', ') || 'Lines removed',
      primary: { value: `${newValues?.deleted_count ?? removed.length} removed`, tone: 'negative' },
      items: removed,
      searchText: [outlet, ...removed.map((r) => r.material.name)].filter(Boolean).join(' '),
    }
  }

  if (key === 'requisition:requisition_items_added_by_pm') {
    const added = itemRows(newValues, lookups, 'added_items')
    return {
      ...base,
      contextLine: outlet || 'No outlet recorded',
      detail: newValues?.supervisor_name
        ? `Added to ${newValues.supervisor_name}’s requisition`
        : 'Added to an existing requisition',
      primary: { value: `${newValues?.added_count ?? added.length} added`, tone: 'accent' },
      items: added,
      searchText: [outlet, newValues?.supervisor_name, ...added.map((r) => r.material.name)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'inventory_out:requisition_packed') {
    const rows = itemRows(newValues, lookups)
    const totalCost = Number(newValues?.total_cost)
    return {
      ...base,
      contextLine: outlet || 'No outlet recorded',
      detail: `${rows.length} item${rows.length === 1 ? '' : 's'}`,
      primary: { value: formatCurrency(totalCost), tone: 'accent' },
      items: rows,
      hasCost: !Number.isNaN(totalCost) && totalCost > 0,
      searchText: [outlet, ...rows.map((r) => `${r.material.name} ${r.material.code}`)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'inventory_out:stock_out') {
    const rows = itemRows(newValues, lookups)
    const reason = stockOutReasonLabel(newValues?.reason)
    return {
      ...base,
      contextLine: reason,
      detail: newValues?.notes || rows.map((row) => row.material.name).slice(0, 3).join(', '),
      primary: { value: `${rows.length} item${rows.length === 1 ? '' : 's'}` },
      items: rows,
      reason,
      searchText: [reason, newValues?.notes, ...rows.map((r) => r.material.name)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'reversal:requisition_packing_cancelled') {
    const restored = Number(newValues?.restored_qty)
    const packedItems = (oldValues?.items || []).map((item) => {
      const material = resolveMaterial(lookups, item.raw_material_id, item)
      return { material, quantity: Number(item.quantity), unitCost: null, gst: null, lineTotal: null }
    })
    return {
      ...base,
      contextLine: outlet || 'No outlet recorded',
      detail: `${formatQty(restored)} put back across ${newValues?.restored_batch_rows ?? 0} batch${
        newValues?.restored_batch_rows === 1 ? '' : 'es'
      }`,
      primary: { value: 'Cancelled', tone: 'negative' },
      items: packedItems,
      searchText: [outlet, ...packedItems.map((r) => r.material.name)].filter(Boolean).join(' '),
    }
  }

  /* ------------------------- dispatch & checkout ------------------------- */

  if (key === 'dispatch_plan:dispatch_plan_created' || key === 'dispatch_plan:dispatch_plan_updated') {
    const rows = planItemRows(newValues, lookups)
    const outlets = new Set(rows.map((row) => row.outlet.id))
    return {
      ...base,
      contextLine:
        [brandLabel(newValues?.brand), newValues?.plan_date].filter(Boolean).join(' · ') || 'Dispatch plan',
      detail: `${outlets.size} outlet${outlets.size === 1 ? '' : 's'}`,
      primary: { value: `${newValues?.item_count ?? rows.length} lines`, tone: 'accent' },
      planItems: rows,
      searchText: [brandLabel(newValues?.brand), ...rows.map((r) => `${r.material.name} ${r.outlet.name}`)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'reversal:dispatch_plan_items_replaced') {
    const discarded = planItemRows(oldValues, lookups, 'replaced_items')
    return {
      ...base,
      contextLine: 'Previous version of the plan',
      detail: `${oldValues?.replaced_count ?? discarded.length} lines discarded, ${
        newValues?.item_count ?? 0
      } saved in their place`,
      primary: { value: `${oldValues?.replaced_count ?? discarded.length} discarded`, tone: 'negative' },
      planItems: discarded,
      searchText: discarded.map((r) => `${r.material.name} ${r.outlet.name}`).join(' '),
    }
  }

  if (key === 'dispatch_plan:dispatch_plan_locked') {
    const after = planItemRows(newValues, lookups)
    const before = planItemRows(oldValues, lookups)
    const kitchenChanged = newValues?.quantities_changed_by_kitchen === true
    return {
      ...base,
      contextLine:
        [brandLabel(newValues?.brand), newValues?.plan_date].filter(Boolean).join(' · ') || 'Dispatch plan',
      detail: kitchenChanged
        ? 'Kitchen changed the quantities before locking'
        : 'Locked without changing the quantities',
      primary: {
        value: `${newValues?.item_count ?? after.length} lines`,
        tone: kitchenChanged ? 'negative' : 'accent',
      },
      planItems: after,
      planItemsBefore: before,
      kitchenChanged,
      searchText: [brandLabel(newValues?.brand), ...after.map((r) => `${r.material.name} ${r.outlet.name}`)]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'checkout:checkout_draft_created' || key === 'checkout:checkout_draft_updated') {
    const returns = checkoutRows(newValues?.returns, lookups, 'returned_quantity').filter(
      (row) => row.quantity > 0
    )
    const wastage = checkoutRows(newValues?.wastage, lookups, 'wasted_quantity').filter(
      (row) => row.quantity > 0
    )
    const previousReturns = checkoutRows(oldValues?.returns, lookups, 'returned_quantity')
    const previousWastage = checkoutRows(oldValues?.wastage, lookups, 'wasted_quantity')
    const wastedTotal = sumBy(wastage, 'quantity')
    return {
      ...base,
      contextLine: outlet || 'Outlet closing',
      detail: `${returns.length} returned · ${wastage.length} wasted${
        newValues?.supervisor_name ? ` · ${newValues.supervisor_name}` : ''
      }`,
      primary: {
        value: `${formatQty(wastedTotal)} wasted`,
        tone: wastedTotal > 0 ? 'negative' : 'muted',
      },
      returns,
      wastage,
      previousReturns,
      previousWastage,
      additional: newValues?.additional || null,
      previousAdditional: oldValues?.additional || null,
      searchText: [
        outlet,
        newValues?.supervisor_name,
        ...returns.map((r) => r.material.name),
        ...wastage.map((r) => r.material.name),
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (key === 'checkout:checkout_confirmed') {
    const returned = Number(newValues?.total_returned_qty)
    return {
      ...base,
      contextLine: outlet || 'Outlet closing',
      detail: `${formatQty(returned)} put back into stock`,
      primary: { value: 'Confirmed', tone: 'positive' },
      totalReturned: returned,
      searchText: [outlet].filter(Boolean).join(' '),
    }
  }

  if (event.category === 'catalog') {
    const payload = newValues || oldValues || {}
    // `fields` is every field on the record (the drawer's before/after table);
    // `changes` is only the ones that moved (the card's chips).
    const fields = diffRecords(oldValues, newValues)
    const changes = fields.filter((row) => row.changed)
    const name = payload.name || oldValues?.name || 'Material'
    const code = payload.code || oldValues?.code || '—'
    const isStatusFlip = event.action === 'deactivate' || event.action === 'reactivate'

    return {
      ...base,
      contextLine: `${name} · ${code}`,
      detail: isStatusFlip
        ? displayValue(payload.category)
        : event.action === 'update'
          ? changes.map((row) => row.label).join(', ') || 'No values differ'
          : [displayValue(payload.unit), displayValue(payload.category)].filter((v) => v !== '—').join(' · '),
      primary: isStatusFlip
        ? {
            value: event.action === 'reactivate' ? 'Reactivated' : 'Deactivated',
            tone: event.action === 'reactivate' ? 'positive' : 'negative',
          }
        : event.action === 'update'
          ? {
              value: `${changes.length} field${changes.length === 1 ? '' : 's'}`,
              tone: changes.length ? 'accent' : 'muted',
            }
          : { value: 'New material', tone: 'accent' },
      fields,
      changes,
      hasCost: changes.some((row) => COST_FIELD.test(row.key)),
      searchText: [name, code, payload.category, payload.brand, ...changes.map((c) => c.label)]
        .filter(Boolean)
        .join(' '),
    }
  }

  return base
}
