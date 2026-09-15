import { useMemo, useState } from 'react'
import Alert from '../Alert.jsx'
import Sheet from '../ui/Sheet.jsx'
import Icon from '../ui/Icon.jsx'
import QuantityStepper from '../ui/QuantityStepper.jsx'
import PriceTrend from './PriceTrend.jsx'
import { StatusBadge } from './OrderStatus.jsx'
import { formatDate, formatINR, formatQty, unitLabel } from '../../lib/format.js'
import { MATERIAL_TYPE_LABEL } from '../../lib/catalog.js'
import { useApi } from '../../lib/useApi.js'

/*
 * Everything about one supply for one outlet: what it is, what it costs now,
 * and every time this outlet has bought it — when, how much, and at what price.
 * The footer adds it to the cart or changes the quantity already there. The
 * history is what this outlet paid on its own orders — never anyone's cost.
 */
function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-background/50 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-foreground">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ItemDetail({ item, outlet, quantityInCart, locked = false, onSetQuantity, onClose }) {
  const { data, error: historyError, loading: historyLoading } = useApi(
    `franchise/catalog/history?outlet_id=${encodeURIComponent(outlet.id)}&material_id=${encodeURIComponent(item.id)}`
  )
  const history = useMemo(() => data || [], [data])
  const [qty, setQty] = useState(quantityInCart || item.orderStep)

  const totals = useMemo(() => {
    if (!history.length) return null
    const quantity = history.reduce((s, h) => s + h.quantity, 0)
    const spend = history.reduce((s, h) => s + h.lineTotal, 0)
    const last = history[0].unitPriceIncGst
    return { times: history.length, quantity, average: spend / quantity, last, change: item.available ? ((item.priceIncGst - last) / last) * 100 : 0 }
  }, [history, item.priceIncGst])

  const gstAmount = item.priceIncGst - item.priceExGst
  const inCart = quantityInCart > 0

  const footer = !item.available ? (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
      This item is not available for {outlet.name} right now. Contact Gastronomix to ask about it.
    </p>
  ) : locked ? (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0" />
      A payment for this outlet's cart is in progress. The cart can be changed again once it finishes or expires.
    </p>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <QuantityStepper value={qty} step={item.orderStep} unit={item.unit} onChange={(q) => setQty(q)} size="lg" />
      <div className="flex flex-1 items-center justify-end gap-3">
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Line total</p>
          <p className="text-lg font-black text-foreground">{formatINR(item.priceIncGst * qty)}</p>
        </div>
        <button
          type="button"
          onClick={() => { onSetQuantity(item, qty); onClose() }}
          disabled={!inCart && qty <= 0}
          className="inline-flex h-11 items-center gap-2 rounded-xl border-3 border-accent bg-accent px-5 text-base font-black text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          <Icon name="cart" className="h-4 w-4" />
          {!inCart ? 'Add to cart' : qty === 0 ? 'Remove' : 'Update cart'}
        </button>
      </div>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={item.name} subtitle={`${item.code} · per ${unitLabel(item.unit)}`} footer={footer}>
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5">
        {[item.category, MATERIAL_TYPE_LABEL[item.type], item.hsn && `HSN ${item.hsn}`, `GST ${item.gstPercent}%`, item.brands ? item.brands.join(' · ') : 'All brands']
          .filter(Boolean)
          .map((tag) => (
            <span key={tag} className="rounded-full border border-border bg-background/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{tag}</span>
          ))}
      </div>

      {item.description && <p className="text-sm leading-relaxed text-foreground">{item.description}</p>}

      {item.available && <section className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Price for {outlet.name}</p>
        <p className="mt-1 text-3xl font-black text-foreground">
          {formatINR(item.priceIncGst)} <span className="text-base font-semibold text-muted-foreground">/ {unitLabel(item.unit)}</span>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Before GST</dt><dd className="font-semibold text-foreground">{formatINR(item.priceExGst)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">GST ({item.gstPercent}%)</dt><dd className="font-semibold text-foreground">{formatINR(gstAmount)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Sold in</dt><dd className="font-semibold text-foreground">{formatQty(item.orderStep, item.unit)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Supplied by {outlet.kitchenName}. Prices can change until you pay; the price at checkout is final.</p>
      </section>}

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
          <Icon name="history" /> Bought by this outlet
        </h3>
        {historyError ? (
          <Alert>{historyError.message}</Alert>
        ) : historyLoading ? (
          <div className="h-20 animate-pulse rounded-xl bg-background/50" />
        ) : !totals ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {outlet.name} has not ordered this before.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Times ordered" value={totals.times} />
              <Stat label="Total bought" value={formatQty(totals.quantity, item.unit)} />
              <Stat label="Average paid" value={formatINR(totals.average)} hint={`per ${unitLabel(item.unit)}`} />
              <Stat
                label="Now vs last"
                value={
                  <span className={`inline-flex items-center gap-1 ${totals.change > 0.5 ? 'text-destructive' : totals.change < -0.5 ? 'text-success' : ''}`}>
                    {Math.abs(totals.change) >= 0.5 && <Icon name={totals.change > 0 ? 'trendUp' : 'trendDown'} className="h-3.5 w-3.5" />}
                    {totals.change > 0 ? '+' : ''}{totals.change.toFixed(1)}%
                  </span>
                }
                hint={`was ${formatINR(totals.last)}`}
              />
            </div>

            {item.available && <PriceTrend history={history} currentPrice={item.priceIncGst} />}

            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {history.map((h) => (
                <li key={`${h.orderId}`} className="flex items-center gap-3 bg-background/30 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{formatQty(h.quantity, item.unit)} at {formatINR(h.unitPriceIncGst)}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(h.placedAt)} · {h.orderNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{formatINR(h.lineTotal)}</p>
                    <StatusBadge status={h.status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
    </Sheet>
  )
}

// Keyed by item, so opening another item starts from its own quantity.
export default function ItemDetailSheet({ item, ...props }) {
  return item ? <ItemDetail key={item.id} item={item} {...props} /> : null
}
