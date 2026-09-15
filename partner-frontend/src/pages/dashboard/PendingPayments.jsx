import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/ui/Icon.jsx'
import PaySheet from '../../components/payments/PaySheet.jsx'
import { brandClass } from '../../lib/catalog.js'
import { formatDate, formatINR } from '../../lib/format.js'
import { listPendingPayments, storeCreditStatement } from '../../dummy/ordersAndMoney.js'

/*
 * Everything the franchise still has to pay, in one place, each with a Checkout
 * button:
 *
 *   Checkouts waiting for payment   a checkout was started but its payment has
 *                                   not landed. Prices and any store credit
 *                                   chosen are held until the window closes
 *                                   (decision 0020); after that it drops off and
 *                                   the cart is checked out again.
 *   Invoices with money due         usually a logistics invoice, raised after
 *                                   packing (spec §8.4). Store credit can pay
 *                                   part or all of it (decision 0013).
 *
 * Spec §8.2: a new checkout is blocked while dues are unpaid, so the total due
 * is the first thing on the page.
 *
 * DUMMY DATA: src/dummy/ordersAndMoney.js until GET /api/franchise/payments/pending exists.
 */

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function TimeLeft({ expiresAt }) {
  const now = useNow(15_000)
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60_000))
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-text">
      <Icon name="clock" className="h-3 w-3" />
      {minutes <= 0 ? 'Closing now' : `${minutes} min left`}
    </span>
  )
}

function PaymentRow({ item, onCheckout, index }) {
  const { order } = item
  const isCheckout = item.kind === 'checkout'
  return (
    <li className="animate-rise-in rounded-2xl border-2 border-border bg-card p-4 shadow-card sm:p-5" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black ${brandClass(order.outlet.brand)}`}>{order.outlet.brand}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-foreground">{isCheckout ? 'Checkout waiting for payment' : item.title}</p>
            {isCheckout && <TimeLeft expiresAt={item.expiresAt} />}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isCheckout ? order.orderNumber : item.invoice.invoiceNumber} · {order.outlet.name}
            {!isCheckout && <> · for <Link to={`/orders/${order.id}`} className="font-semibold text-accent-text hover:underline">{order.orderNumber}</Link></>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isCheckout
              ? `${order.lines.length} supplies · started ${formatDate(item.createdAt)}${item.storeCreditHeld ? ` · ${formatINR(item.storeCreditHeld)} store credit held` : ''}`
              : `${item.invoice.description || 'Issued'} · ${formatDate(item.createdAt)}${item.alreadyPaid ? ` · ${formatINR(item.alreadyPaid)} of ${formatINR(item.total)} paid` : ''}`}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{isCheckout ? 'To pay' : 'Due'}</p>
          <p className="text-xl font-black text-foreground">{formatINR(item.amountDue)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/orders/${order.id}`} className="rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-foreground hover:border-accent/60">
            View order
          </Link>
          <button
            type="button"
            onClick={() => onCheckout(item)}
            className="inline-flex items-center gap-2 rounded-xl border-3 border-accent bg-accent px-5 py-2 text-sm font-black text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 active:scale-[0.98]"
          >
            Checkout <Icon name="chevronRight" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  )
}

export default function PendingPayments() {
  const items = useMemo(() => listPendingPayments(), [])
  const credit = useMemo(() => storeCreditStatement(), [])
  const [paying, setPaying] = useState(null)

  const checkouts = items.filter((i) => i.kind === 'checkout')
  const invoices = items.filter((i) => i.kind === 'invoice')
  const totalDue = invoices.reduce((s, i) => s + i.amountDue, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Pending payments</h1>
      <p className="mt-1 text-sm text-muted-foreground">Checkouts waiting for their payment, and invoices with money still due.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border-2 border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Invoices due</p>
          <p className={`mt-1 text-2xl font-black ${totalDue > 0 ? 'text-destructive' : 'text-foreground'}`}>{formatINR(totalDue)}</p>
          <p className="text-xs text-muted-foreground">{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Checkouts waiting</p>
          <p className="mt-1 text-2xl font-black text-foreground">{checkouts.length}</p>
          <p className="text-xs text-muted-foreground">Carts locked until paid or expired</p>
        </div>
        <Link to="/store-credit" className="group rounded-2xl border-2 border-border bg-card p-4 transition-colors hover:border-accent/50">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Store credit available</p>
          <p className="mt-1 text-2xl font-black text-success">{formatINR(credit.available)}</p>
          <p className="text-xs text-muted-foreground group-hover:text-accent-text">Can pay any invoice · see statement</p>
        </Link>
      </div>

      {totalDue > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          New orders cannot be checked out while an invoice is unpaid. Pay what is due to order again.
        </p>
      )}

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
          <Icon name="check" className="h-8 w-8 text-success" />
          <p className="mt-3 font-semibold text-foreground">Nothing to pay</p>
          <p className="mt-1 text-sm text-muted-foreground">You are all settled up.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {checkouts.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-bold text-foreground">Checkouts waiting for payment</h2>
              <ul className="space-y-3">
                {checkouts.map((item, i) => <PaymentRow key={item.id} item={item} index={i} onCheckout={setPaying} />)}
              </ul>
            </section>
          )}
          {invoices.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-bold text-foreground">Invoices with money due</h2>
              <ul className="space-y-3">
                {invoices.map((item, i) => <PaymentRow key={item.id} item={item} index={i} onCheckout={setPaying} />)}
              </ul>
            </section>
          )}
        </div>
      )}

      <PaySheet key={paying?.id || 'none'} payment={paying} creditAvailable={credit.available} onClose={() => setPaying(null)} />
    </div>
  )
}
