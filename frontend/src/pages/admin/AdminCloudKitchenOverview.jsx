// Overview → Cloud Kitchen: the admin dashboard's landing screen.
//
// Read-only by design. It answers "what is the state of the business right now"
// and hands off to the sections that let you act on the answer.
//
// Tiles carry an "as of now" or "in period" caption because the screen mixes
// point-in-time stock metrics with flow metrics measured over the date range —
// without the label, a range change that moves half the numbers and not the
// other half reads as a bug. See lib/adminOverview.js.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CloudKitchenCharts from '../../components/admin/CloudKitchenCharts'
import { count, money } from '../../lib/formatNumbers'
import {
  RANGE_OPTIONS,
  fetchCloudKitchenOverview,
  resolveRange,
} from '../../lib/adminOverview'
import { kitchenWisePath } from './adminPaths'

const formatRange = ({ from, to }) => {
  const label = (date) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  return from === to ? label(from) : `${label(from)} – ${label(to)}`
}

const percentChange = (current, previous) => {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

/* ------------------------------------------------------------------ *
 * Presentational pieces
 * ------------------------------------------------------------------ */

const RangeControl = ({ value, onChange }) => (
  <div
    role="group"
    aria-label="Date range"
    className="inline-flex rounded-lg border border-border bg-input p-0.5"
  >
    {RANGE_OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        aria-pressed={value === option.value}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
          value === option.value
            ? 'bg-accent text-background'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
)

const Delta = ({ change }) => {
  if (change === null || !Number.isFinite(change)) return null

  const rounded = Math.round(change)
  if (rounded === 0) return <span className="text-xs font-medium text-muted-foreground">no change</span>

  // Deliberately uncoloured: rising spend is not self-evidently bad — it often
  // just means more volume. The direction is the fact; the judgement is the
  // admin's.
  return (
    <span className="text-xs font-semibold text-muted-foreground">
      {rounded > 0 ? '▲' : '▼'} {Math.abs(rounded)}% vs prior period
    </span>
  )
}

// Values stay white whatever they say. Severity is the reader's call here — a
// number that turns red decides for them, and six tiles in three colours is
// harder to scan than six in one. The brand accent does the structural work
// instead, as a hairline rule down the leading edge.
const KpiTile = ({ label, value, caption, children, unavailable = false }) => (
  <div className="bg-card border border-border border-l-2 border-l-accent/40 rounded-xl p-4 flex flex-col gap-1">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    {/* Proportional figures deliberately: tabular-nums gives every digit a zero's
        width, which reads loose at display sizes. Tabular is for columns. */}
    <p className={`text-2xl font-bold ${unavailable ? 'text-muted-foreground' : 'text-foreground'}`}>
      {unavailable ? '—' : value}
    </p>
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-muted-foreground">{caption}</span>
      {children}
    </div>
  </div>
)

const CardStat = ({ label, value }) => (
  <div>
    <dt className="text-[11px] text-muted-foreground">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
  </div>
)

// The whole card is the link into Kitchen Wise Overview — a card-sized target
// rather than a small "view" affordance tucked in a corner.
const KitchenCard = ({ kitchen, costDataAvailable, rangeLabel }) => (
  <Link
    to={kitchenWisePath(kitchen.id)}
    className="group bg-card border border-border rounded-xl p-5 flex flex-col gap-4 transition-colors hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-bold text-foreground truncate">{kitchen.name}</h3>
        <p className="text-xs text-muted-foreground">{kitchen.code || '—'}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!kitchen.is_active && (
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-semibold">
            Inactive
          </span>
        )}
        <span
          aria-hidden="true"
          className="text-muted-foreground group-hover:text-accent transition-colors"
        >
          →
        </span>
      </div>
    </header>

    <div className="border-l-2 border-accent/40 pl-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Inventory value
      </p>
      <p className="text-2xl font-bold text-foreground">
        {costDataAvailable ? money(kitchen.inventoryValue) : '—'}
      </p>
      <p className="text-[11px] text-muted-foreground">as of now</p>
    </div>

    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
      <CardStat label="Outlets" value={count(kitchen.outlets)} />
      <CardStat label="Pending requisitions" value={count(kitchen.pendingRequisitions)} />
      <CardStat label="Out of stock" value={count(kitchen.outOfStock)} />
      <CardStat label="Low stock" value={count(kitchen.lowStock)} />
      <CardStat
        label="Dead stock"
        value={costDataAvailable ? money(kitchen.deadStockValue) : '—'}
      />
      <CardStat
        label={`Spend · ${rangeLabel}`}
        value={costDataAvailable ? money(kitchen.spend) : '—'}
      />
      <CardStat label={`Stock-ins · ${rangeLabel}`} value={count(kitchen.stockInCount)} />
      <CardStat label={`Stock-outs · ${rangeLabel}`} value={count(kitchen.stockOutCount)} />
    </dl>
  </Link>
)

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

const AdminCloudKitchenOverview = () => {
  const [range, setRange] = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal) => {
    setLoading(true)
    setError('')

    try {
      const resolved = resolveRange(range, customFrom, customTo)
      const result = await fetchCloudKitchenOverview(resolved)
      if (!signal.aborted) setData(result)
    } catch (err) {
      console.error('Error loading cloud kitchen overview:', err)
      if (!signal.aborted) setError('Failed to load the overview. Please try again.')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [range, customFrom, customTo])

  useEffect(() => {
    // A custom range is only meaningful once both ends are chosen; refetching on
    // the first date would show a nonsense window while the user picks the second.
    if (range === 'custom' && !(customFrom && customTo)) return

    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load, range, customFrom, customTo])

  const rangeLabel = data ? formatRange(data.range) : ''
  const spendChange = data ? percentChange(data.totals.spend, data.previousSpend) : null

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">Cloud Kitchen Overview</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {data
                ? `${count(data.org.kitchens)} cloud kitchens · ${count(
                    data.org.outlets
                  )} active outlets · ${count(data.org.users)} active users`
                : 'Loading organisation summary…'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <RangeControl value={range} onChange={setRange} />
            {range === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  aria-label="Range start"
                  className="px-3 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(event) => setCustomTo(event.target.value)}
                  aria-label="Range end"
                  className="px-3 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Stock figures are as of now and ignore the date range. Spend, stock-ins and stock-outs are
          measured over it.
        </p>
      </div>

      {data && !data.costDataAvailable && (
        <div className="bg-card border border-amber-500/40 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            Cost figures unavailable
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            This admin cannot read <code className="text-xs">stock_in</code> or{' '}
            <code className="text-xs">stock_in_batches</code>, so inventory value, dead stock and
            spend are hidden rather than shown as zero. Apply{' '}
            <code className="text-xs">migrations/add-admin-read-policies-for-stock-in.sql</code> to
            enable them.
          </p>
        </div>
      )}

      {error ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-destructive">
          {error}
        </div>
      ) : !data ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          Loading overview…
        </div>
      ) : (
        // Changing the range holds the previous render at reduced opacity rather
        // than dropping back to a skeleton, so nothing jumps while it refetches.
        <div
          aria-busy={loading}
          className={`space-y-6 transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}
        >
          <section aria-label="Key metrics">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <KpiTile
                label="Inventory value"
                value={money(data.totals.inventoryValue)}
                caption="as of now"
                unavailable={!data.costDataAvailable}
              />
              <KpiTile
                label="Spend"
                value={money(data.totals.spend)}
                caption={rangeLabel}
                unavailable={!data.costDataAvailable}
              >
                {data.costDataAvailable && <Delta change={spendChange} />}
              </KpiTile>
              <KpiTile
                label="Pending requisitions"
                value={count(data.totals.pendingRequisitions)}
                caption="as of now"
              />
              <KpiTile
                label="Out of stock"
                value={count(data.totals.outOfStock)}
                caption="materials at zero, as of now"
              />
              <KpiTile
                label="Low stock"
                value={count(data.totals.lowStock)}
                caption="at or under threshold, as of now"
              />
              <KpiTile
                label="Dead stock"
                value={money(data.totals.deadStockValue)}
                caption="unused for 60+ days, as of now"
                unavailable={!data.costDataAvailable}
              />
            </div>
          </section>

          <section aria-label="Cloud kitchens">
            <h3 className="text-sm font-semibold text-foreground mb-3">By cloud kitchen</h3>
            {data.kitchens.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
                No cloud kitchens found.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {data.kitchens.map((kitchen) => (
                  <KitchenCard
                    key={kitchen.id}
                    kitchen={kitchen}
                    costDataAvailable={data.costDataAvailable}
                    rangeLabel={rangeLabel}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-label="Cross-kitchen comparison">
            <h3 className="text-sm font-semibold text-foreground mb-3">Cross-kitchen comparison</h3>
            <CloudKitchenCharts
              kitchens={data.kitchens}
              spendSeries={data.spendSeries}
              costDataAvailable={data.costDataAvailable}
            />
          </section>
        </div>
      )}
    </div>
  )
}

export default AdminCloudKitchenOverview
