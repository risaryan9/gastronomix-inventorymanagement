import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Alert from '../../components/Alert.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PaySheet from '../../components/payments/PaySheet.jsx'
import { StatusBadge } from '../../components/catalog/OrderStatus.jsx'
import { brandClass, ORDER_STATUS, ORDER_STEPS } from '../../lib/catalog.js'
import { formatDate, formatINR, formatQty } from '../../lib/format.js'
import { getOrder, listPendingPayments, storeCreditStatement } from '../../dummy/ordersAndMoney.js'

/*
 * One order and everything that belongs to it (spec §9, §10):
 *
 *   progress      paid → accepted → packed → ready to ship → shipped → delivered
 *   supplies      what was ordered, what the purchase manager accepted, at the
 *                 prices frozen at checkout
 *   invoices      the goods invoice, issued when the payment landed, and any
 *                 logistics invoice raised after packing — each with what paid
 *                 it and what is still due
 *   credit notes  what came back when less could be supplied. The invoice is
 *                 never edited; the credit note corrects it (decision 0016)
 *   shipping      carrier and reference, once shipped
 *
 * DUMMY DATA: src/dummy/ordersAndMoney.js until GET /api/franchise/orders/:id exists.
 */

const panel = 'rounded-2xl border-2 border-border bg-card p-4 shadow-card sm:p-5'
const STEP_LABEL = { paid: 'Placed', accepted: 'Accepted', packed: 'Packed', ready_to_ship: 'Ready to ship', shipped: 'Shipped', delivered: 'Delivered' }
const time = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function Timeline({ order }) {
  const reached = ORDER_STEPS.indexOf(order.status)
  return (
    <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
      {ORDER_STEPS.map((step, i) => {
        const at = order.timeline[step]
        const done = i <= reached
        const current = i === reached
        return (
          <li key={step} className="relative flex flex-col items-center text-center">
            {/* The connector from the previous step; on a phone the steps wrap after three, so the fourth starts a row. */}
            {i > 0 && <span className={`absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 ${i <= reached ? 'bg-accent' : 'bg-muted'} ${i === 3 ? 'hidden sm:block' : ''}`} aria-hidden="true" />}
            <span className={`relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-black ${done ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground'} ${current ? 'ring-4 ring-accent/25' : ''}`}>
              {done ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={`mt-1.5 text-xs font-semibold ${done ? 'text-foreground' : 'text-muted-foreground'}`}>{STEP_LABEL[step]}</span>
            <span className="text-[10px] text-muted-foreground">{at ? time(at) : '—'}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Lines({ order }) {
  const accepted = order.lines.some((l) => l.quantityAccepted !== null)
  return (
    <section className={panel}>
      <h2 className="text-base font-bold text-foreground">Supplies</h2>
      <p className="text-xs text-muted-foreground">Prices as frozen at checkout{accepted ? ' · accepted quantities from the purchase manager' : ''}</p>
      <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Supply</th>
              <th className="py-2 pr-3 text-right font-semibold">Ordered</th>
              {accepted && <th className="py-2 pr-3 text-right font-semibold">Accepted</th>}
              <th className="py-2 pr-3 text-right font-semibold">Price</th>
              <th className="py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {order.lines.map((l) => {
              const short = l.quantityAccepted !== null && l.quantityAccepted < l.quantityOrdered
              return (
                <tr key={l.id} className={short ? 'bg-accent/5' : ''}>
                  <td className="py-2.5 pr-3">
                    <p className="font-semibold text-foreground">{l.name}</p>
                    <p className="text-[11px] text-muted-foreground">{l.code}{l.hsn ? ` · HSN ${l.hsn}` : ''} · GST {l.gstPercent}%</p>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-foreground">{formatQty(l.quantityOrdered, l.unit)}</td>
                  {accepted && (
                    <td className={`py-2.5 pr-3 text-right font-semibold ${short ? 'text-accent-text' : 'text-foreground'}`}>
                      {l.quantityAccepted === null ? '—' : formatQty(l.quantityAccepted, l.unit)}
                      {short && <span className="block text-[10px] font-normal">short {formatQty(l.quantityOrdered - l.quantityAccepted, l.unit)}</span>}
                    </td>
                  )}
                  <td className="py-2.5 pr-3 text-right text-muted-foreground">{formatINR(l.unitPriceIncGst)}</td>
                  <td className="py-2.5 text-right font-semibold text-foreground">{formatINR(l.ordered.total)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-border text-sm">
            <tr><td colSpan={accepted ? 4 : 3} className="pt-2 text-right text-muted-foreground">Subtotal (before GST)</td><td className="pt-2 text-right font-semibold text-foreground">{formatINR(order.subtotal)}</td></tr>
            <tr><td colSpan={accepted ? 4 : 3} className="text-right text-muted-foreground">GST</td><td className="text-right font-semibold text-foreground">{formatINR(order.gstTotal)}</td></tr>
            <tr><td colSpan={accepted ? 4 : 3} className="pt-1 text-right font-bold text-foreground">Order total</td><td className="pt-1 text-right text-base font-black text-foreground">{formatINR(order.grandTotal)}</td></tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

const SETTLEMENT_LABEL = { razorpay: 'Paid online', store_credit: 'Store credit' }

function InvoiceCard({ invoice, onPay }) {
  return (
    <li className="rounded-xl border-2 border-border bg-background/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{invoice.type === 'goods' ? 'Goods invoice' : 'Logistics invoice'}</p>
          <p className="font-bold text-foreground">{invoice.invoiceNumber}</p>
          <p className="text-xs text-muted-foreground">Issued {formatDate(invoice.issuedAt)}{invoice.description ? ` · ${invoice.description}` : ''}</p>
        </div>
        {invoice.amountDue > 0 ? (
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{formatINR(invoice.amountDue)} due</span>
        ) : (
          <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">Paid</span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-[11px] text-muted-foreground">Taxable value</dt><dd className="font-semibold text-foreground">{formatINR(invoice.taxableValue)}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">GST</dt><dd className="font-semibold text-foreground">{formatINR(invoice.gstAmount)}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Total</dt><dd className="font-black text-foreground">{formatINR(invoice.total)}</dd></div>
      </dl>

      {invoice.settlements.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
          {invoice.settlements.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{SETTLEMENT_LABEL[s.kind]} · {formatDate(s.at)}</span>
              <span className={`font-semibold ${s.kind === 'store_credit' ? 'text-success' : 'text-foreground'}`}>{formatINR(s.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {invoice.amountDue > 0 && (
        <button type="button" onClick={onPay} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-accent-foreground transition hover:brightness-110 active:scale-[0.99] sm:w-auto">
          Pay {formatINR(invoice.amountDue)}
        </button>
      )}
    </li>
  )
}

export default function OrderDetail() {
  const { orderId } = useParams()
  const order = useMemo(() => getOrder(orderId), [orderId])
  const pending = useMemo(() => listPendingPayments(), [])
  const creditAvailable = useMemo(() => storeCreditStatement().available, [])
  const [paying, setPaying] = useState(null)

  if (!order) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground">Order not found</h1>
        <Link to="/orders" className="mt-4 inline-block text-sm font-semibold text-accent-text hover:underline">Back to orders</Link>
      </div>
    )
  }

  const checkout = pending.find((p) => p.kind === 'checkout' && p.order.id === order.id)
  const payInvoice = (invoice) => setPaying(pending.find((p) => p.kind === 'invoice' && p.invoice.id === invoice.id))
  const closed = ['cancelled', 'expired', 'payment_failed'].includes(order.status)

  return (
    <div>
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
        <Icon name="chevronLeft" /> All orders
      </Link>

      <div className="mt-2 flex animate-rise-in flex-wrap items-center gap-3">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black ${brandClass(order.outlet.brand)}`}>{order.outlet.brand}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{order.orderNumber}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground">{order.outlet.name} · supplied by {order.outlet.kitchenName} · placed {formatDate(order.placedAt)}</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {order.status === 'pending_payment' && checkout && (
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-accent bg-accent/10 p-4 sm:flex-row sm:items-center">
            <Icon name="clock" className="h-6 w-6 shrink-0 text-accent-text" />
            <div className="flex-1 text-sm">
              <p className="font-bold text-foreground">This order is waiting for its payment</p>
              <p className="text-muted-foreground">Prices are held until {time(checkout.expiresAt)}. The outlet's cart stays locked until then.</p>
            </div>
            <button type="button" onClick={() => setPaying(checkout)} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-black text-accent-foreground hover:brightness-110">
              Pay {formatINR(checkout.amountDue)}
            </button>
          </div>
        )}
        {closed && (
          <Alert tone="info">
            {order.status === 'expired'
              ? 'The payment window for this checkout closed before a payment arrived, so nothing was charged. The outlet\'s cart was left as it was — check out again from there.'
              : order.status === 'payment_failed'
                ? 'The payment for this checkout failed, so nothing was charged. Check out again from the cart.'
                : 'This order was cancelled by Gastronomix.'}
          </Alert>
        )}

        {!closed && order.status !== 'pending_payment' && (
          <section className={panel}>
            <h2 className="mb-4 text-base font-bold text-foreground">Progress</h2>
            <Timeline order={order} />
          </section>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-5">
            <Lines order={order} />

            {order.creditNotes.length > 0 && (
              <section className={panel}>
                <h2 className="text-base font-bold text-foreground">Credit notes</h2>
                <p className="text-xs text-muted-foreground">When less could be supplied, the invoice stays as issued and a credit note returns the difference as store credit.</p>
                <ul className="mt-3 space-y-3">
                  {order.creditNotes.map((cn) => (
                    <li key={cn.id} className="rounded-xl border-2 border-success/40 bg-success/5 p-3 sm:p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-foreground">{cn.creditNoteNumber}</p>
                          <p className="text-xs text-muted-foreground">Against {cn.invoiceNumber} · {formatDate(cn.issuedAt)}</p>
                        </div>
                        <p className="font-black text-success">+ {formatINR(cn.amount)}</p>
                      </div>
                      <p className="mt-2 text-sm text-foreground">{cn.reason}</p>
                      {cn.lines.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          {cn.lines.map((l) => (
                            <li key={l.name} className="flex justify-between gap-3"><span>{l.name} · {formatQty(l.quantity, l.unit)}</span><span>{formatINR(l.amount)}</span></li>
                          ))}
                        </ul>
                      )}
                      <Link to="/store-credit" className="mt-2 inline-block text-xs font-semibold text-accent-text hover:underline">See store credit</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="space-y-5 lg:sticky lg:top-24">
            {order.invoices.length > 0 && (
              <section className={panel}>
                <h2 className="text-base font-bold text-foreground">Invoices</h2>
                <ul className="mt-3 space-y-3">
                  {order.invoices.map((inv) => <InvoiceCard key={inv.id} invoice={inv} onPay={() => payInvoice(inv)} />)}
                </ul>
              </section>
            )}

            {order.shipping && (
              <section className={panel}>
                <h2 className="flex items-center gap-2 text-base font-bold text-foreground"><Icon name="truck" /> Shipping</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Carrier</dt><dd className="font-semibold text-foreground">{order.shipping.carrier}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Reference</dt><dd className="font-mono text-xs font-semibold text-foreground">{order.shipping.trackingRef}</dd></div>
                  {order.shipping.notes && <p className="rounded-lg bg-background/50 p-2 text-xs text-muted-foreground">{order.shipping.notes}</p>}
                </dl>
              </section>
            )}

            {!order.shipping && ['paid', 'accepted', 'packed', 'ready_to_ship'].includes(order.status) && (
              <p className="flex items-start gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {order.status === 'packed'
                  ? 'Packed. A logistics invoice for transport is raised next; carrier details follow when it ships.'
                  : `${ORDER_STATUS[order.status].label}. Carrier details appear here once it ships.`}
              </p>
            )}
          </div>
        </div>
      </div>

      <PaySheet key={paying?.id || 'none'} payment={paying} creditAvailable={creditAvailable} onClose={() => setPaying(null)} />
    </div>
  )
}
