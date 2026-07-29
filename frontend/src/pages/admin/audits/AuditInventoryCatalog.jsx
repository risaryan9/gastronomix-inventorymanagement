// Admin ▸ Audits ▸ Inventory & Catalog
//
// Covers the action points docs/AUDIT_TRAIL_REQUIREMENTS.md groups as inbound
// inventory and catalog maintenance:
//
//   B1  stock-in finalize .................. inventory_in / stock_in_received
//   B2  manual inventory adjustment ........ inventory_in|out / inventory_increment|decrement
//   D3  inter-cloud transfer, destination .. inventory_in / inter_cloud_transfer_received
//   C1  create raw material ................ catalog / create
//   C2  edit raw material .................. catalog / update
//   C3  deactivate / reactivate ............ catalog / deactivate|reactivate
//
// B2's decrement is logged under `inventory_out` but belongs here: increment
// and decrement are one user action — a manual override of on-hand stock — and
// only read correctly as a pair. Requisitions & Stock Out therefore covers
// genuine outbound movement (D1/D2/D4) rather than adjustments.

import { useEffect, useMemo, useState } from 'react'
import PaginationControls from '../../../components/PaginationControls'
import AuditFilterBar from '../../../components/audits/AuditFilterBar'
import AuditEventCard from '../../../components/audits/AuditEventCard'
import AuditDetailDrawer from '../../../components/audits/AuditDetailDrawer'
import AuditSummaryStrip from '../../../components/audits/AuditSummaryStrip'
import {
  ACTION_META,
  FAMILY,
  actorName,
  businessDayOf,
  describeEvent,
  eventKey,
  fetchAuditLookups,
  fetchCorrelatedEvents,
  fetchInventoryCatalogEvents,
  formatBusinessDay,
  formatCurrency,
  formatQty,
  summarizeEvents,
} from '../../../lib/auditEvents'
import { getBusinessDate } from '../../../lib/businessDate'
// ⚠️ TEMPORARY — remove this import and the mergeDemoEvents() call below once
// every action point in this subsection has produced a real event. See the
// header of lib/demoAuditEvents.js.
import { demoCorrelatedEvents, demoSubsectionEvents } from '../../../lib/demoAuditEvents'

const PAGE_SIZE = 15

const DEFAULT_FILTERS = {
  range: 'all',
  from: '',
  to: '',
  family: 'all',
  actions: ['all'],
  severity: 'all',
  kitchenId: 'all',
  actorId: 'all',
  withCost: false,
  search: '',
}

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
]

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'review', label: 'Review' },
  { value: 'info', label: 'Info' },
]

const shiftBusinessDate = (days) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return getBusinessDate(date)
}

/**
 * ⚠️ TEMPORARY. Adds placeholder events only for the action types that have no
 * real event yet, so anything genuinely recorded is shown on its own and never
 * padded out. Delete along with lib/demoAuditEvents.js.
 */
const mergeDemoEvents = (realEvents) => {
  const realKeys = new Set(realEvents.map(eventKey))
  const missingKeys = Object.keys(ACTION_META).filter((key) => !realKeys.has(key))
  if (!missingKeys.length) return { events: realEvents, demoKeys: [] }

  const demo = demoSubsectionEvents().filter((event) => missingKeys.includes(eventKey(event)))
  const events = [...realEvents, ...demo].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  )
  return { events, demoKeys: [...new Set(demo.map(eventKey))] }
}

const AuditInventoryCatalog = () => {
  const [events, setEvents] = useState([])
  const [demoKeys, setDemoKeys] = useState([])
  const [lookups, setLookups] = useState({ kitchens: [], materials: new Map() })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [correlated, setCorrelated] = useState([])
  const [correlatedLoading, setCorrelatedLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        setError('')
        const [referenceData, realEvents] = await Promise.all([
          fetchAuditLookups(),
          fetchInventoryCatalogEvents(),
        ])
        if (cancelled) return
        const merged = mergeDemoEvents(realEvents)
        setLookups(referenceData)
        setEvents(merged.events)
        setDemoKeys(merged.demoKeys)
      } catch (err) {
        console.error('Error loading inventory & catalog audit events:', err)
        if (!cancelled) setError('Failed to load audit events. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Correlated events are fetched on demand — only D3's two legs use the column
  // in this subsection, so loading them up front would be wasted work.
  useEffect(() => {
    if (!selectedEvent?.correlation_id) {
      setCorrelated([])
      return
    }

    let cancelled = false
    const load = async () => {
      setCorrelatedLoading(true)
      try {
        const related = selectedEvent.__demo
          ? demoCorrelatedEvents(selectedEvent.correlation_id, selectedEvent.id)
          : await fetchCorrelatedEvents(selectedEvent.correlation_id, selectedEvent.id)
        if (!cancelled) setCorrelated(related)
      } catch (err) {
        console.error('Error loading correlated events:', err)
        if (!cancelled) setCorrelated([])
      } finally {
        if (!cancelled) setCorrelatedLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [selectedEvent])

  const decorated = useMemo(
    () => events.map((event) => ({ event, description: describeEvent(event, lookups) })),
    [events, lookups]
  )

  const actors = useMemo(() => {
    const map = new Map()
    events.forEach((event) => {
      if (!event.actor_user_id) return
      if (!map.has(event.actor_user_id)) {
        map.set(event.actor_user_id, { id: event.actor_user_id, name: actorName(event) })
      }
    })
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [events])

  const actionOptions = useMemo(() => {
    const present = new Set(events.map(eventKey))
    return Object.entries(ACTION_META)
      .filter(([key]) => present.has(key))
      .filter(([, meta]) => filters.family === 'all' || meta.family === filters.family)
      .map(([key, meta]) => ({ value: key, label: meta.label }))
  }, [events, filters.family])

  const dateBounds = useMemo(() => {
    switch (filters.range) {
      case 'today':
        return { from: getBusinessDate(), to: getBusinessDate() }
      case '7d':
        return { from: shiftBusinessDate(6), to: getBusinessDate() }
      case '30d':
        return { from: shiftBusinessDate(29), to: getBusinessDate() }
      case 'custom':
        return { from: filters.from || null, to: filters.to || null }
      default:
        return { from: null, to: null }
    }
  }, [filters.range, filters.from, filters.to])

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase()

    return decorated.filter(({ event, description }) => {
      const day = businessDayOf(event.created_at)
      if (dateBounds.from && day < dateBounds.from) return false
      if (dateBounds.to && day > dateBounds.to) return false

      if (filters.family !== 'all' && description.family !== filters.family) return false
      if (!filters.actions.includes('all') && !filters.actions.includes(eventKey(event))) return false
      if (filters.severity !== 'all' && event.severity !== filters.severity) return false

      // Catalog events carry no cloud kitchen (raw_materials is global), so a
      // kitchen filter must not hide them — it would read as "no catalog
      // changes happened", which is the opposite of the truth.
      if (
        filters.kitchenId !== 'all' &&
        event.category !== 'catalog' &&
        event.cloud_kitchen_id !== filters.kitchenId
      ) {
        return false
      }

      if (filters.actorId !== 'all' && event.actor_user_id !== filters.actorId) return false
      if (filters.withCost && !description.hasCost) return false

      if (search) {
        const haystack = [
          description.searchText,
          description.title,
          description.contextLine,
          actorName(event),
          description.kitchen,
          event.action,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }

      return true
    })
  }, [decorated, filters, dateBounds])

  // Deliberately computed over every event, not the filtered set: these are the
  // subsection's standing totals, and a number that moves when you narrow the
  // list stops being a reference point.
  const summary = useMemo(() => summarizeEvents(events), [events])

  useEffect(() => {
    setPage(1)
  }, [filters])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )

  const groupedPage = useMemo(() => {
    const groups = []
    pageRows.forEach((row) => {
      const day = businessDayOf(row.event.created_at)
      const last = groups[groups.length - 1]
      if (last && last.day === day) last.rows.push(row)
      else groups.push({ day, rows: [row] })
    })
    return groups
  }, [pageRows])

  const isFiltered = useMemo(
    () => JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS),
    [filters]
  )

  const tiles = [
    {
      id: 'total',
      label: 'Total events',
      value: String(summary.total),
      sub: 'all recorded',
    },
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

  const demoLabels = demoKeys.map((key) => ACTION_META[key]?.label).filter(Boolean)

  return (
    <div className="space-y-4">
      {/* Demo notice */}
      {demoLabels.length > 0 && (
        <div className="border border-dashed border-accent/50 bg-accent/5 rounded-xl p-4">
          <p className="text-sm text-foreground">
            <span className="font-bold text-accent">Placeholder entries in view.</span> No real event has been
            recorded yet for: {demoLabels.join(', ')}. Entries of those types are rendered from the frontend so
            the layout can be reviewed, are badged <span className="font-bold text-accent">DEMO</span>, and were
            never written to <span className="font-mono">audit_events</span>. Real events are shown as-is and are
            never padded.
          </p>
        </div>
      )}

      <AuditSummaryStrip tiles={tiles} />

      <AuditFilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        rangeOptions={RANGE_OPTIONS}
        familyOptions={[
          { value: 'all', label: 'All events' },
          { value: FAMILY.INVENTORY, label: 'Inventory movements' },
          { value: FAMILY.CATALOG, label: 'Catalog changes' },
        ]}
        severityOptions={SEVERITY_OPTIONS}
        actionOptions={actionOptions}
        kitchens={lookups.kitchens}
        actors={actors}
        isFiltered={isFiltered}
        resultCount={filtered.length}
        totalCount={decorated.length}
      />

      {/* List */}
      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          Loading audit events…
        </div>
      ) : error ? (
        <div className="bg-card border border-destructive/40 rounded-xl p-12 text-center text-destructive">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-foreground font-semibold">No events match these filters.</p>
          <p className="text-sm text-muted-foreground mt-1">
            {isFiltered
              ? 'Try widening the date range or clearing the filters.'
              : 'Nothing has been recorded against these action points yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedPage.map((group) => (
            <div key={group.day} className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-foreground">{formatBusinessDay(group.day)}</h3>
                <span className="text-xs text-muted-foreground">
                  {group.rows.length} event{group.rows.length === 1 ? '' : 's'}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-3">
                {group.rows.map(({ event, description }) => (
                  <AuditEventCard
                    key={event.id}
                    event={event}
                    description={description}
                    onSelect={setSelectedEvent}
                    isSelected={selectedEvent?.id === event.id}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="flex justify-end pt-2">
            <PaginationControls currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </div>
      )}

      {selectedEvent && (
        <AuditDetailDrawer
          event={selectedEvent}
          description={describeEvent(selectedEvent, lookups)}
          correlated={correlated}
          correlatedLoading={correlatedLoading}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}

export default AuditInventoryCatalog
