import { Link, Navigate, useParams } from 'react-router-dom'
import Icon from '../../components/ui/Icon.jsx'
import InvoicePdfButton from '../../components/payments/InvoicePdfButton.jsx'
import LoadState from '../../components/LoadState.jsx'
import { brandClass, SETTLEMENT_LABEL } from '../../lib/catalog.js'
import { formatDate, formatINR, formatQty, formatTime } from '../../lib/format.js'
import { useApi } from '../../lib/useApi.js'

/*
 * /orders/:orderId/confirmed — "your payment went through", with the details.
 *
 * The cart sends the franchise here once the server says the order is paid
 * (Cart.jsx, usePayment). It is a page of its own, not a panel on the cart, so
 * it survives a refresh and can be opened again from a bookmark.
 *
 * NOTHING HERE COMES FROM THE CART OR THE POPUP. The page reads the order back
 * with GET /api/franchise/orders?id= (api/_lib/orders.js), so every figure is
 * what the database recorded: the goods invoice issued when the payment landed
 * and what settled it. If it says paid, it is paid.
 *
 * An order with no goods invoice has not been paid (still waiting, expired, or
 * failed), so there is nothing to confirm and the page sends the reader to the
 * order itself, which says where it stands.
 */

const panel = 'rounded-2xl border-2 border-border bg-card p-4 shadow-card sm:p-5'

function Detail({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-semibold text-foreground">{children}</dd>
    </div>
  )
}

export default function PaymentConfirmed() {
  const { orderId } = useParams()
  const { data: order, error, loading, reload } = useApi(`franchise/orders?id=${encodeURIComponent(orderId)}`)

  if (error?.status === 404 || error?.status === 400) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground">Order not found</h1>
        <Link to="/orders" className="mt-4 inline-block text-sm font-semibold text-accent-text hover:underline">Back to orders</Link>
      </div>
    )
  }
  if (!order) return <LoadState loading={loading} error={error} reload={reload} blocks={['h-48', 'h-40', 'h-56']} />

  const invoice = order.invoices.find((i) => i.type === 'goods')
  if (!invoice) return <Navigate to={`/orders/${order.id}`} replace />

  const settled = (kind) => invoice.settlements.filter((s) => s.kind === kind)
  const sum = (rows) => Math.round(rows.reduce((total, s) => total + s.amount, 0) * 100) / 100
  const online = settled('razorpay')
  const paidOnline = sum(online)
  const paidCredit = sum(settled('store_credit'))
  const paidAt = order.timeline.paid || order.placedAt

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className={`${panel} flex animate-rise-in flex-col items-center px-6 py-8 text-center`}>
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
          <Icon name="check" className="h-7 w-7" strokeWidth={3} />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">Payment confirmed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Order {order.orderNumber} is placed. {order.outlet.kitchenName} will check stock and confirm it.
        </p>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Amount paid</p>
        <p className="text-3xl font-black text-foreground">{formatINR(invoice.paid)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(paidAt)}, {formatTime(paidAt)}</p>
      </section>

      <section className={`${panel} animate-rise-in`} style={{ animationDelay: '60ms' }}>
        <h2 className="text-base font-bold text-foreground">Payment details</h2>
        <dl className="mt-2 divide-y divide-border">
          <Detail label="Order number">{order.orderNumber}</Detail>
          <Detail label="Invoice number">
            {invoice.invoiceNumber}
            <span className="block font-normal"><InvoicePdfButton invoiceId={invoice.id} /></span>
          </Detail>
          <Detail label="Outlet">
            <span className={`mr-1.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-black ${brandClass(order.outlet.brand)}`}>{order.outlet.brand}</span>
            {order.outlet.name}
          </Detail>
          <Detail label="Supplied by">{order.outlet.kitchenName}</Detail>
          {paidOnline > 0 && <Detail label={SETTLEMENT_LABEL.razorpay}>{formatINR(paidOnline)}</Detail>}
          {online.filter((s) => s.reference).map((s) => (
            <Detail key={s.reference} label="Payment reference"><span className="font-mono text-xs">{s.reference}</span></Detail>
          ))}
          {paidCredit > 0 && (
            <Detail label={SETTLEMENT_LABEL.store_credit}><span className="text-success">{formatINR(paidCredit)}</span></Detail>
          )}
          {invoice.amountDue > 0 && (
            <Detail label="Still due"><span className="text-destructive">{formatINR(invoice.amountDue)}</span></Detail>
          )}
        </dl>
        {paidCredit > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">Credit is a payment, so your invoice shows the full total and GST.</p>
        )}
      </section>

      <section className={`${panel} animate-rise-in`} style={{ animationDelay: '120ms' }}>
        <h2 className="text-base font-bold text-foreground">
          {order.lines.length} {order.lines.length === 1 ? 'supply' : 'supplies'} ordered
        </h2>
        <ul className="mt-2 divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-4 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{line.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatQty(line.quantityOrdered, line.unit)} × {formatINR(line.unitPriceIncGst)} · GST {line.gstPercent}%
                </p>
              </div>
              <p className="shrink-0 font-semibold text-foreground">{formatINR(line.ordered.total)}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t-2 border-border pt-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subtotal (before GST)</dt><dd className="font-semibold text-foreground">{formatINR(order.subtotal)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">GST</dt><dd className="font-semibold text-foreground">{formatINR(order.gstTotal)}</dd></div>
          <div className="flex justify-between gap-4 pt-1 text-base"><dt className="font-bold text-foreground">Order total</dt><dd className="font-black text-foreground">{formatINR(order.grandTotal)}</dd></div>
        </dl>
      </section>

      <p className="flex items-start gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        If less can be supplied than you ordered, the difference comes back as store credit; the invoice itself is not changed.
      </p>

      <div className="flex flex-wrap justify-center gap-2 pb-2">
        <Link to={`/orders/${order.id}`} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-accent-foreground hover:brightness-110">
          View order
        </Link>
        <Link to={`/order/${order.outlet.id}`} className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:border-accent/60">
          Order more for {order.outlet.name}
        </Link>
        <Link to="/orders" className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:border-accent/60">
          All orders
        </Link>
      </div>
    </div>
  )
}
