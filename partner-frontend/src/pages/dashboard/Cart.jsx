import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Alert from '../../components/Alert.jsx'
import Icon from '../../components/ui/Icon.jsx'
import QuantityStepper from '../../components/ui/QuantityStepper.jsx'
import { useCart } from '../../cart/cartContext.js'
import { brandClass } from '../../lib/catalog.js'
import { formatDate, formatINR, formatQty, unitLabel } from '../../lib/format.js'

/*
 * The cart: one per outlet (decision 0020).
 *
 *   /cart              the outlets that have a cart — pick one
 *   /cart?outlet=<id>  that outlet's cart, its totals, and checkout
 *
 * The top-bar cart icon opens /cart?outlet=<id> when you are in an outlet's
 * catalogue, so the cart you were filling is the one that opens.
 *
 * Every figure here is the server's. Before checkout, a line that can no longer
 * be supplied must be removed, and a line whose price changed needs keep or
 * remove; the Checkout button stays off until nothing needs an answer, and the
 * server checks the same again. Checkout is for this outlet only — there is no
 * paying for several outlets at once.
 */

const panel = 'rounded-2xl border-2 border-border bg-card p-4 shadow-card sm:p-5'

function OutletBadge({ outlet, size = 'h-10 w-10' }) {
  return (
    <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-xl text-xs font-black ${brandClass(outlet.brand)}`}>
      {outlet.brand}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * /cart — choose an outlet
 * ------------------------------------------------------------------ */

function CartList({ outlets }) {
  if (!outlets.length) {
    return (
      <div className="mt-6 flex animate-rise-in flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
        <Icon name="cart" className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-semibold text-foreground">Your carts are empty</p>
        <p className="mt-1 text-sm text-muted-foreground">Choose an outlet and add supplies. Each outlet has its own cart.</p>
        <Link to="/order" className="mt-4 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-accent-foreground hover:brightness-110">
          Order supplies
        </Link>
      </div>
    )
  }
  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">Each outlet has its own cart, and each is checked out on its own. Choose one to review it.</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {outlets.map((outlet, i) => (
          <li key={outlet.id} className="animate-rise-in" style={{ animationDelay: `${i * 50}ms` }}>
            <Link
              to={`/cart?outlet=${outlet.id}`}
              className="group flex items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 shadow-card transition-colors hover:border-accent/60"
            >
              <OutletBadge outlet={outlet} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-foreground group-hover:text-accent-text">{outlet.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {outlet.lines} {outlet.lines === 1 ? 'supply' : 'supplies'} · {outlet.kitchenName}
                </p>
              </div>
              {outlet.locked && (
                <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-text">
                  <Icon name="clock" className="h-3 w-3" /> Paying
                </span>
              )}
              <Icon name="chevronRight" className="h-4 w-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * /cart?outlet= — one outlet's cart
 * ------------------------------------------------------------------ */

function LineRow({ line, outletId, locked }) {
  const { setQuantity, keepPrice } = useCart()
  const remove = () => setQuantity(outletId, line, 0)
  const unavailable = line.status === 'unavailable'
  const changed = line.status === 'price_changed'

  return (
    <li className={`rounded-xl border-2 p-3 sm:p-4 ${unavailable ? 'border-destructive/50 bg-destructive/5' : changed ? 'border-accent/60 bg-accent/5' : 'border-border bg-background/30'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {line.code && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{line.code}</p>}
          <p className="font-bold leading-snug text-foreground">{line.name}</p>
          {!unavailable && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatINR(line.priceIncGst)} / {unitLabel(line.unit)} · {line.gstPercent ? `includes ${line.gstPercent}% GST` : 'no GST'}
            </p>
          )}
        </div>
        {!unavailable && (
          <div className="text-right">
            <p className="font-black text-foreground">{formatINR(line.lineTotal)}</p>
            <p className="text-[11px] text-muted-foreground">{formatQty(line.quantity, line.unit)}</p>
          </div>
        )}
      </div>

      {unavailable && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-start gap-1.5 text-sm text-foreground">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            No longer available for this outlet. Remove it to check out.
          </p>
          <button type="button" onClick={remove} disabled={locked} className="rounded-lg bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground hover:brightness-110 disabled:opacity-50">
            Remove
          </button>
        </div>
      )}

      {changed && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-card p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Icon name={line.priceIncGst > line.agreedPriceIncGst ? 'trendUp' : 'trendDown'} className="h-4 w-4 text-accent-text" />
            Price changed: {formatINR(line.agreedPriceIncGst)} → {formatINR(line.priceIncGst)} / {unitLabel(line.unit)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Added at the old price{line.agreedBy ? ` by ${line.agreedBy}` : ''}{line.agreedAt ? ` on ${formatDate(line.agreedAt)}` : ''}. Keep it at the new price, or remove it.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => keepPrice(outletId, line.id)} disabled={locked} className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-black text-accent-foreground hover:brightness-110 disabled:opacity-50 sm:flex-none">
              Keep at {formatINR(line.priceIncGst)}
            </button>
            <button type="button" onClick={remove} disabled={locked} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:border-destructive/60 disabled:opacity-50 sm:flex-none">
              Remove
            </button>
          </div>
        </div>
      )}

      {line.status === 'ok' && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <QuantityStepper
            value={line.quantity}
            step={line.orderStep}
            unit={line.unit}
            disabled={locked}
            onChange={(q) => setQuantity(outletId, line, q)}
            label={`${line.name} quantity`}
          />
          <button type="button" onClick={remove} disabled={locked} className="text-sm font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50">
            Remove
          </button>
        </div>
      )}
    </li>
  )
}

function Row({ label, value, strong, tone }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? 'text-base font-black text-foreground' : 'text-sm text-muted-foreground'}`}>
      <dt>{label}</dt>
      <dd className={tone === 'credit' ? 'font-semibold text-success' : strong ? '' : 'font-semibold text-foreground'}>{value}</dd>
    </div>
  )
}

function Summary({ view }) {
  const { checkout } = useCart()
  const [useCredit, setUseCredit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const credit = useCredit ? view.storeCredit.redeemable : 0
  const payable = Math.round((view.totals.total - credit) * 100) / 100
  const hasCredit = view.storeCredit.available > 0

  const onCheckout = async () => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await checkout(view.outlet.id, useCredit))
    } catch (err) {
      setResult({ ok: false, reason: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={`${panel} lg:sticky lg:top-24`}>
      <h2 className="text-base font-bold text-foreground">Order summary</h2>
      <p className="text-xs text-muted-foreground">For {view.outlet.name} · prices as of now</p>

      <dl className="mt-4 space-y-2">
        <Row label="Subtotal (before GST)" value={formatINR(view.totals.subtotal)} />
        <Row label="GST" value={formatINR(view.totals.gst)} />
        <div className="border-t border-border pt-2">
          <Row label="Total" value={formatINR(view.totals.total)} strong />
        </div>
      </dl>

      {hasCredit && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border-2 border-border bg-background/40 p-3 transition-colors hover:border-accent/50">
          <input
            type="checkbox"
            checked={useCredit}
            onChange={(e) => { setUseCredit(e.target.checked); setResult(null) }}
            disabled={view.storeCredit.redeemable <= 0}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
          />
          <span className="text-sm">
            <span className="block font-semibold text-foreground">Use store credit</span>
            <span className="text-xs text-muted-foreground">
              {formatINR(view.storeCredit.available)} available
              {view.storeCredit.redeemable < view.storeCredit.available && view.storeCredit.redeemable > 0 && ` · ${formatINR(view.storeCredit.redeemable)} can go on this order`}
            </span>
          </span>
        </label>
      )}

      {useCredit && credit > 0 && (
        <dl className="mt-3 space-y-2">
          <Row label="Store credit" value={`− ${formatINR(credit)}`} tone="credit" />
          <div className="border-t border-border pt-2">
            <Row label="To pay" value={formatINR(payable)} strong />
          </div>
          <p className="text-[11px] text-muted-foreground">Credit is a payment, so your invoice still shows the full total and GST.</p>
        </dl>
      )}

      {result && (
        <div className="mt-4">
          <Alert tone={result.ok ? 'info' : 'error'}>
            {result.ok ? result.message : result.reason}
          </Alert>
        </div>
      )}

      <button
        type="button"
        onClick={onCheckout}
        disabled={!view.canCheckout || busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-3 border-accent bg-accent px-5 py-3 text-base font-black text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? 'Checking…' : `Checkout · ${formatINR(payable)}`}
      </button>
      {!view.canCheckout && !view.lock && view.needsAnswer > 0 && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {view.needsAnswer} {view.needsAnswer === 1 ? 'supply needs' : 'supplies need'} your answer above first.
        </p>
      )}
    </aside>
  )
}

function ClearCart({ outletId, lines, locked }) {
  const { clearCart } = useCart()
  const [confirming, setConfirming] = useState(false)
  if (locked) return null
  return confirming ? (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Remove all {lines}?</span>
      <button type="button" onClick={() => { clearCart(outletId); setConfirming(false) }} className="font-bold text-destructive hover:underline">Yes, clear</button>
      <button type="button" onClick={() => setConfirming(false)} className="font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirming(true)} className="text-sm font-semibold text-muted-foreground hover:text-destructive">
      Clear cart
    </button>
  )
}

function OutletCart({ outletId }) {
  const { carts, summary, loadCart, error, clearError } = useCart()
  const [loadFailed, setLoadFailed] = useState(false)
  const view = carts[outletId]

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    loadCart(outletId).then((v) => { if (!cancelled && !v) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [outletId, loadCart])

  const others = summary.outlets.filter((o) => o.id !== outletId)

  return (
    <div>
      <Link to="/cart" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
        <Icon name="chevronLeft" /> All carts
      </Link>

      {!view ? (
        loadFailed ? (
          <div className="mt-4"><Alert>{error || 'Could not load this cart.'}</Alert></div>
        ) : (
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_22rem]">
            <div className="h-72 animate-pulse rounded-2xl border-2 border-border bg-card/60" />
            <div className="h-72 animate-pulse rounded-2xl border-2 border-border bg-card/60" />
          </div>
        )
      ) : (
        <>
          <div className="mt-2 flex animate-rise-in flex-wrap items-center gap-3">
            <OutletBadge outlet={view.outlet} size="h-11 w-11" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-bold text-foreground sm:text-3xl">{view.outlet.name}</h1>
              <p className="text-sm text-muted-foreground">Cart · supplied by {view.outlet.kitchenName}</p>
            </div>
            {view.lines.length > 0 && (
              <Link to={`/order/${outletId}`} className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:border-accent/60">
                <Icon name="plus" className="h-3.5 w-3.5" /> Add supplies
              </Link>
            )}
          </div>

          {others.length > 0 && (
            <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Other carts">
              <span className="shrink-0 self-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other carts</span>
              {others.map((o) => (
                <Link key={o.id} to={`/cart?outlet=${o.id}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:border-accent/50 hover:text-foreground">
                  {o.name} <span className="opacity-70">{o.lines}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {view.lock && (
              <Alert tone="info">
                A payment for this cart is in progress (order {view.lock.orderNumber}). The cart cannot be changed until it finishes or expires.
              </Alert>
            )}
            {error && (
              <Alert>
                {error} <button type="button" onClick={clearError} className="font-semibold text-accent-text hover:underline">Dismiss</button>
              </Alert>
            )}
          </div>

          {view.lines.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
              <Icon name="cart" className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-semibold text-foreground">This cart is empty</p>
              <Link to={`/order/${outletId}`} className="mt-4 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-accent-foreground hover:brightness-110">
                Order for {view.outlet.name}
              </Link>
            </div>
          ) : (
            <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
              <section className={panel}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-foreground">
                    {view.lines.length} {view.lines.length === 1 ? 'supply' : 'supplies'}
                  </h2>
                  <ClearCart outletId={outletId} lines={view.lines.length} locked={Boolean(view.lock)} />
                </div>
                {view.needsAnswer > 0 && (
                  <div className="mb-3">
                    <Alert tone="info">
                      Some supplies changed since they were added. Answer each highlighted one before checking out.
                    </Alert>
                  </div>
                )}
                <ul className="space-y-3">
                  {view.lines.map((line) => <LineRow key={line.id} line={line} outletId={outletId} locked={Boolean(view.lock)} />)}
                </ul>
              </section>
              <Summary key={outletId} view={view} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Cart() {
  const [params] = useSearchParams()
  const outletId = params.get('outlet')
  const { summary, refreshSummary } = useCart()

  // Someone else at the franchise may have filled or emptied a cart since.
  useEffect(() => { if (!outletId) refreshSummary() }, [outletId, refreshSummary])

  if (outletId) return <OutletCart key={outletId} outletId={outletId} />
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Carts</h1>
      <CartList outlets={summary.outlets} />
    </div>
  )
}
