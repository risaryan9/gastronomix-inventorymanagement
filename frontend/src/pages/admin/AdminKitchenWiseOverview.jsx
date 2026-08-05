// Overview → Kitchen Wise Overview: everything about one cloud kitchen.
//
// Reached either from the sidebar (defaults to the first kitchen) or by clicking
// a card on the Cloud Kitchen Overview. Both the kitchen and the open tab live
// in the URL, so any view of this page is linkable and survives a refresh.
//
// Loading is split by tab. The summary and analytics load with the page; a
// ledger's rows load the first time its tab is opened and are then held, so
// switching back and forth does not refetch.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import KitchenAnalytics from '../../components/admin/kitchen/KitchenAnalytics'
import KitchenOutletsTab from '../../components/admin/kitchen/KitchenOutletsTab'
import KitchenStockInTab from '../../components/admin/kitchen/KitchenStockInTab'
import KitchenStockOutTab from '../../components/admin/kitchen/KitchenStockOutTab'
import RequisitionCutoffCard from '../../components/admin/kitchen/RequisitionCutoffCard'
import { buildKitchenColors } from '../../lib/chartTheme'
import { count, money } from '../../lib/formatNumbers'
import { RANGE_OPTIONS, resolveRange } from '../../lib/adminOverview'
import {
  fetchKitchenOutlets,
  fetchKitchenStockIn,
  fetchKitchenStockOut,
  fetchKitchenSummary,
  fetchKitchens,
} from '../../lib/adminKitchenDetail'
import { CLOUD_KITCHEN_OVERVIEW_PATH, kitchenWisePath } from './adminPaths'

const TABS = [
  { id: 'stock-in', label: 'Stock In' },
  { id: 'stock-out', label: 'Stock Out' },
  { id: 'outlets', label: 'Outlets' },
]

const formatRange = ({ from, to }) => {
  const label = (date) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  return from === to ? label(from) : `${label(from)} – ${label(to)}`
}

const Stat = ({ label, value, caption }) => (
  <div className="bg-card border border-border border-l-2 border-l-accent/40 rounded-xl p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-xl font-bold text-foreground mt-1">{value}</p>
    <p className="text-[11px] text-muted-foreground">{caption}</p>
  </div>
)

const Chip = ({ active, children, ...props }) => (
  <button
    type="button"
    aria-pressed={active}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
      active
        ? 'bg-accent text-background'
        : 'bg-input border border-border text-muted-foreground hover:text-foreground'
    }`}
    {...props}
  >
    {children}
  </button>
)

const AdminKitchenWiseOverview = () => {
  const { kitchenId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : TABS[0].id

  const [range, setRange] = useState('30d')
  const [kitchens, setKitchens] = useState([])
  const [kitchensError, setKitchensError] = useState('')

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState('')

  // One entry per tab: { rows, loading, error, loaded }. Keyed by tab id so a
  // tab that has already loaded is not refetched when you switch back to it.
  const [tabData, setTabData] = useState({})

  const resolvedRange = useMemo(() => resolveRange(range), [range])
  const rangeKey = `${resolvedRange.from}:${resolvedRange.to}`

  const activeKitchen = kitchens.find((kitchen) => kitchen.id === kitchenId) ?? null
  const colorOf = useMemo(() => buildKitchenColors(kitchens), [kitchens])

  useEffect(() => {
    let cancelled = false

    fetchKitchens()
      .then((rows) => {
        if (cancelled) return
        setKitchens(rows)
        // Landing on /kitchen-wise with no kitchen picked: settle on the first.
        if (!kitchenId && rows.length > 0) {
          navigate(kitchenWisePath(rows[0].id), { replace: true })
        }
      })
      .catch((err) => {
        console.error('Error loading cloud kitchens:', err)
        if (!cancelled) setKitchensError('Failed to load cloud kitchens.')
      })

    return () => {
      cancelled = true
    }
  }, [kitchenId, navigate])

  // Kitchen or range change invalidates everything already fetched.
  useEffect(() => {
    if (!kitchenId) return
    let cancelled = false

    setTabData({})
    setSummaryLoading(true)
    setSummaryError('')

    fetchKitchenSummary(kitchenId, resolvedRange)
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch((err) => {
        console.error('Error loading kitchen summary:', err)
        if (!cancelled) setSummaryError('Failed to load this kitchen. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false)
      })

    return () => {
      cancelled = true
    }
    // resolvedRange is rebuilt each render; rangeKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitchenId, rangeKey])

  const loadTab = useCallback(
    async (tabId) => {
      const loaders = {
        'stock-in': () => fetchKitchenStockIn(kitchenId, resolvedRange),
        'stock-out': () => fetchKitchenStockOut(kitchenId, resolvedRange),
        outlets: () => fetchKitchenOutlets(kitchenId, resolvedRange),
      }

      setTabData((prev) => ({ ...prev, [tabId]: { rows: [], loading: true, error: '' } }))
      try {
        const rows = await loaders[tabId]()
        setTabData((prev) => ({ ...prev, [tabId]: { rows, loading: false, error: '' } }))
      } catch (err) {
        console.error(`Error loading ${tabId}:`, err)
        setTabData((prev) => ({
          ...prev,
          [tabId]: { rows: [], loading: false, error: 'Failed to load this data. Please try again.' },
        }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kitchenId, rangeKey]
  )

  useEffect(() => {
    if (!kitchenId || tabData[activeTab]) return
    loadTab(activeTab)
  }, [kitchenId, activeTab, tabData, loadTab])

  const active = tabData[activeTab] ?? { rows: [], loading: true, error: '' }
  const rangeLabel = formatRange(resolvedRange)

  const selectTab = (tabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tabId)
    setSearchParams(next, { replace: true })
  }

  if (kitchensError) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center text-destructive">
        {kitchensError}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header: where you are, which kitchen, and over what period */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <Link
              to={CLOUD_KITCHEN_OVERVIEW_PATH}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Cloud Kitchen Overview
            </Link>
            <h2 className="text-xl font-bold text-foreground mt-1">
              {activeKitchen?.name ?? 'Kitchen Wise Overview'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {activeKitchen?.code ? `${activeKitchen.code} · ` : ''}
              Everything recorded for this cloud kitchen.
            </p>
          </div>

          <div
            role="group"
            aria-label="Date range"
            className="inline-flex rounded-lg border border-border bg-input p-0.5 h-fit"
          >
            {RANGE_OPTIONS.filter((option) => option.value !== 'custom').map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  range === option.value
                    ? 'bg-accent text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {kitchens.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Kitchen</span>
            {kitchens.map((kitchen) => (
              <Chip
                key={kitchen.id}
                active={kitchen.id === kitchenId}
                onClick={() => navigate(kitchenWisePath(kitchen.id))}
              >
                {kitchen.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {summaryError ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-destructive">
          {summaryError}
        </div>
      ) : !summary ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          Loading kitchen…
        </div>
      ) : (
        <div
          aria-busy={summaryLoading}
          className={`space-y-6 transition-opacity duration-200 ${
            summaryLoading ? 'opacity-60' : ''
          }`}
        >
          <section aria-label="Requisition settings">
            <RequisitionCutoffCard kitchenId={kitchenId} kitchenName={activeKitchen?.name} />
          </section>

          <section aria-label="Kitchen summary">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <Stat
                label="Inventory value"
                value={money(summary.summary.inventoryValue)}
                caption="as of now"
              />
              <Stat label="Spend" value={money(summary.summary.spend)} caption={rangeLabel} />
              <Stat
                label="Stock-outs"
                value={count(summary.summary.stockOutCount)}
                caption={`${count(summary.summary.selfStockOuts)} internal · ${rangeLabel}`}
              />
              <Stat
                label="Out of stock"
                value={count(summary.summary.outOfStock)}
                caption="materials at zero, as of now"
              />
              <Stat
                label="Low stock"
                value={count(summary.summary.lowStock)}
                caption="at or under threshold"
              />
              <Stat
                label="Outlets served"
                value={count(summary.summary.outlets)}
                caption={`${count(summary.summary.pendingRequisitions)} requisitions pending`}
              />
            </div>
          </section>

          <section aria-label="Kitchen analytics">
            <h3 className="text-sm font-semibold text-foreground mb-3">Analytics</h3>
            <KitchenAnalytics analytics={summary.analytics} color={colorOf(kitchenId)} />
          </section>

          <section aria-label="Kitchen records">
            <div
              role="tablist"
              aria-label="Kitchen records"
              className="flex flex-wrap gap-1 border-b border-border mb-4"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => selectTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    activeTab === tab.id
                      ? 'border-accent text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'stock-in' && (
              <KitchenStockInTab rows={active.rows} loading={active.loading} error={active.error} />
            )}
            {activeTab === 'stock-out' && (
              <KitchenStockOutTab rows={active.rows} loading={active.loading} error={active.error} />
            )}
            {activeTab === 'outlets' && (
              <KitchenOutletsTab
                rows={active.rows}
                loading={active.loading}
                error={active.error}
                rangeLabel={rangeLabel}
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default AdminKitchenWiseOverview
