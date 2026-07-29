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
    why: 'A reactivation reverses a prior decision to retire a material, which §1 names outright as a reverse/override. Logged as critical.',
  },
}

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
  cloud_kitchen:cloud_kitchens!audit_events_cloud_kitchen_id_fkey ( id, name )
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
  const [kitchensRes, materialsRes] = await Promise.all([
    supabase.from('cloud_kitchens').select('id, name').order('name'),
    supabase.from('raw_materials').select('id, name, code, unit'),
  ])

  if (kitchensRes.error) throw kitchensRes.error
  if (materialsRes.error) throw materialsRes.error

  const materials = new Map()
  ;(materialsRes.data || []).forEach((material) => materials.set(material.id, material))

  return { kitchens: kitchensRes.data || [], materials }
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

export const resolveMaterial = (lookups, id) =>
  lookups?.materials?.get(id) || { id, name: 'Unknown material', code: id ? String(id).slice(0, 8) : '—', unit: null }

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

const itemRows = (payload, lookups) => {
  const items = Array.isArray(payload?.items) ? payload.items : []
  return items.map((item) => {
    const material = resolveMaterial(lookups, item.raw_material_id)
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

/**
 * Reduces one event to the facts a reviewer scans for, so the card component
 * never has to know which action it is rendering.
 */
export const describeEvent = (event, lookups) => {
  const meta = metaFor(event)
  const oldValues = event.old_values || null
  const newValues = event.new_values || null
  const kitchen = kitchenName(event, lookups)

  const base = {
    meta,
    family: meta.family,
    title: meta.label,
    glyph: meta.glyph,
    severity: event.severity,
    kitchen,
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

/* ------------------------------------------------------------------ *
 * Aggregates for the summary strip
 * ------------------------------------------------------------------ */

export const summarizeEvents = (events) => {
  let received = 0
  let receipts = 0
  let adjustments = 0
  let adjustmentNet = 0
  let catalogChanges = 0
  let critical = 0

  events.forEach((event) => {
    const key = eventKey(event)
    if (event.severity === 'critical') critical += 1

    if (key === 'inventory_in:stock_in_received' || key === 'inventory_in:inter_cloud_transfer_received') {
      const cost = Number(event.new_values?.total_cost)
      if (!Number.isNaN(cost)) received += cost
      receipts += 1
    }

    if (key === 'inventory_in:inventory_increment' || key === 'inventory_out:inventory_decrement') {
      adjustments += 1
      const from = Number(event.old_values?.quantity)
      const to = Number(event.new_values?.quantity)
      if (!Number.isNaN(from) && !Number.isNaN(to)) adjustmentNet += to - from
    }

    if (event.category === 'catalog') catalogChanges += 1
  })

  return { total: events.length, received, receipts, adjustments, adjustmentNet, catalogChanges, critical }
}
