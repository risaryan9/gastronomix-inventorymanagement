// The shared shell every audit subsection renders: load, filter, group by day,
// paginate, and open the detail drawer. A subsection supplies what is different
// — which events it covers and which filters make sense for it.

import { useEffect, useMemo, useState } from 'react'
import PaginationControls from '../PaginationControls'
import AuditFilterBar from './AuditFilterBar'
import AuditEventCard from './AuditEventCard'
import AuditDetailDrawer from './AuditDetailDrawer'
import {
  ACTION_META,
  actorName,
  businessDayOf,
  describeEvent,
  eventKey,
  fetchAuditLookups,
  fetchCorrelatedEvents,
  formatBusinessDay,
} from '../../lib/auditEvents'
import { getBusinessDate } from '../../lib/businessDate'
// ⚠️ TEMPORARY — remove this import and the mergeDemoEvents() call below once
// every action type has produced a real event. See lib/demoAuditEvents.js.
import { demoCorrelatedEvents, demoSubsectionEvents } from '../../lib/demoAuditEvents'

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
  outletId: 'all',
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
 * ⚠️ TEMPORARY. Adds placeholder entries only for the action types that have no
 * real event yet, so anything genuinely recorded is shown on its own and never
 * padded out. Delete along with lib/demoAuditEvents.js.
 */
const mergeDemoEvents = (realEvents, actionKeys) => {
  const realKeys = new Set(realEvents.map(eventKey))
  const missingKeys = actionKeys.filter((key) => !realKeys.has(key))
  if (!missingKeys.length) return { events: realEvents, demoKeys: [] }

  const demo = demoSubsectionEvents().filter((event) => missingKeys.includes(eventKey(event)))
  const events = [...realEvents, ...demo].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return { events, demoKeys: [...new Set(demo.map(eventKey))] }
}

const AuditSubsectionPage = ({
  fetchEvents,
  actionKeys,
  familyOptions,
  searchPlaceholder,
  showCostToggle = false,
  showOutletFilter = false,
  // Catalog events belong to no single kitchen; picking a kitchen must not hide
  // them, or the list would read as "no catalog changes happened".
  keepCatalogOnKitchenFilter = false,
}) => {
  const [events, setEvents] = useState([])
  const [demoKeys, setDemoKeys] = useState([])
  const [lookups, setLookups] = useState({ kitchens: [], materials: new Map(), outlets: [] })
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
        const [referenceData, realEvents] = await Promise.all([fetchAuditLookups(), fetchEvents()])
        if (cancelled) return
        const merged = mergeDemoEvents(realEvents, actionKeys)
        setLookups(referenceData)
        setEvents(merged.events)
        setDemoKeys(merged.demoKeys)
      } catch (err) {
        console.error('Error loading audit events:', err)
        if (!cancelled) setError('Failed to load audit events. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetched on demand — only a couple of event types are ever linked, so
  // loading related activity up front would be wasted work.
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
        console.error('Error loading related events:', err)
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

  const outlets = useMemo(() => {
    const map = new Map()
    events.forEach((event) => {
      if (!event.outlet_id) return
      if (!map.has(event.outlet_id)) {
        map.set(event.outlet_id, {
          id: event.outlet_id,
          name:
            event.outlet?.name ||
            lookups.outlets.find((o) => o.id === event.outlet_id)?.name ||
            'Unknown outlet',
        })
      }
    })
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [events, lookups.outlets])

  const actionOptions = useMemo(() => {
    const present = new Set(events.map(eventKey))
    return actionKeys
      .filter((key) => present.has(key))
      .filter((key) => filters.family === 'all' || ACTION_META[key]?.family === filters.family)
      .map((key) => ({ value: key, label: ACTION_META[key]?.label || key }))
  }, [events, filters.family, actionKeys])

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

      if (filters.kitchenId !== 'all') {
        const exempt = keepCatalogOnKitchenFilter && event.category === 'catalog'
        if (!exempt && event.cloud_kitchen_id !== filters.kitchenId) return false
      }

      if (filters.outletId === 'none' && event.outlet_id) return false
      if (filters.outletId !== 'all' && filters.outletId !== 'none' && event.outlet_id !== filters.outletId) {
        return false
      }

      if (filters.actorId !== 'all' && event.actor_user_id !== filters.actorId) return false
      if (showCostToggle && filters.withCost && !description.hasCost) return false

      if (search) {
        const haystack = [
          description.searchText,
          description.title,
          description.contextLine,
          description.detail,
          actorName(event),
          description.kitchen,
          description.outlet,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }

      return true
    })
  }, [decorated, filters, dateBounds, keepCatalogOnKitchenFilter, showCostToggle])

  useEffect(() => {
    setPage(1)
  }, [filters])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

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

  const isFiltered = useMemo(() => JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS), [filters])
  const demoLabels = demoKeys.map((key) => ACTION_META[key]?.label).filter(Boolean)

  return (
    <div className="space-y-4">
      {demoLabels.length > 0 && (
        <div className="border border-dashed border-accent/50 bg-accent/5 rounded-xl p-4">
          <p className="text-sm text-foreground">
            <span className="font-bold text-accent">Placeholder entries in view.</span> Nothing has been recorded
            yet for: {demoLabels.join(', ')}. Entries of those types are examples only, so this screen can be
            reviewed before the real thing happens. Everything else on this page is real.
          </p>
        </div>
      )}

      <AuditFilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        rangeOptions={RANGE_OPTIONS}
        familyOptions={familyOptions}
        severityOptions={SEVERITY_OPTIONS}
        actionOptions={actionOptions}
        kitchens={lookups.kitchens}
        actors={actors}
        outlets={showOutletFilter ? outlets : null}
        showCostToggle={showCostToggle}
        showCatalogNote={keepCatalogOnKitchenFilter}
        searchPlaceholder={searchPlaceholder}
        isFiltered={isFiltered}
        resultCount={filtered.length}
        totalCount={decorated.length}
      />

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
              : 'Nothing has been recorded here yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedPage.map((group) => (
            <div key={group.day} className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-foreground">{formatBusinessDay(group.day)}</h3>
                <span className="text-xs text-muted-foreground">
                  {group.rows.length} event{group.rows.length === 1 ? '' : 's'}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
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

export default AuditSubsectionPage
