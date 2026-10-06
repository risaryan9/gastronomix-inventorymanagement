import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/ui/Icon.jsx'
import LoadState from '../../components/LoadState.jsx'
import InvoicePdfButton from '../../components/payments/InvoicePdfButton.jsx'
import PaySheet from '../../components/payments/PaySheet.jsx'
import { brandClass } from '../../lib/catalog.js'
import { formatDate, formatINR } from '../../lib/format.js'
import { useApi } from '../../lib/useApi.js'

/*
 * Invoices with money still due, each with a Checkout button that opens the
 * pay sheet (components/payments/PaySheet.jsx). Usually a logistics invoice,
 * raised after packing (spec §8.4); store credit can pay part or all of one
 * (decision 0013).
 *
 * A checkout still waiting for its payment is not listed here: it is shown on
 * its order, which is where it is paid from.
 *
 * Spec §8.2: a new checkout is blocked while dues are unpaid, so the total due
 * is the first thing on the page.
 *
 * GET /api/franchise/payments/pending (api/_lib/orders.js). What is due is
 * worked out on the server from payments and credit applied; nothing stores it.
 */

function PaymentRow({ item, onCheckout, index }) {
  const { order } = item
  return (
    <li className="animate-rise-in rounded-2xl border-2 border-border bg-card p-4 shadow-card sm:p-5" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black ${brandClass(order.outlet.brand)}`}>{order.outlet.brand}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-foreground">{item.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.invoice.invoiceNumber} · {order.outlet.name} · for{' '}
            <Link to={`/orders/${order.id}`} className="font-semibold text-accent-text hover:underline">{order.orderNumber}</Link>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.invoice.description || 'Issued'} · {formatDate(item.createdAt)}
            {item.alreadyPaid ? ` · ${formatINR(item.alreadyPaid)} of ${formatINR(item.total)} paid` : ''}
          </p>
          <InvoicePdfButton invoiceId={item.invoice.id} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Due</p>
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
  const { data, error, loading, reload } = useApi('franchise/payments/pending')
  const [paying, setPaying] = useState(null)

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Pending payments</h1>
      <p className="mt-1 text-sm text-muted-foreground">Invoices with money still due.</p>

      {/* A reload after a payment keeps the list on screen, so no skeleton then. */}
      <LoadState loading={loading && !data} error={error} reload={reload} blocks={['h-24', 'h-40']} />
      {data && <PendingList data={data} onPay={setPaying} />}

      <PaySheet key={paying?.id || 'none'} payment={paying} creditAvailable={data?.storeCreditAvailable || 0} onClose={() => setPaying(null)} onChanged={reload} />
    </div>
  )
}

function PendingList({ data, onPay }) {
  const { invoices, totalDue, storeCreditAvailable } = data
  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Invoices due</p>
          <p className={`mt-1 text-2xl font-black ${totalDue > 0 ? 'text-destructive' : 'text-foreground'}`}>{formatINR(totalDue)}</p>
          <p className="text-xs text-muted-foreground">{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</p>
        </div>
        <Link to="/store-credit" className="group rounded-2xl border-2 border-border bg-card p-4 transition-colors hover:border-accent/50">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Store credit available</p>
          <p className="mt-1 text-2xl font-black text-success">{formatINR(storeCreditAvailable)}</p>
          <p className="text-xs text-muted-foreground group-hover:text-accent-text">Can pay any invoice · see statement</p>
        </Link>
      </div>

      {totalDue > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          New orders cannot be checked out while an invoice is unpaid. Pay what is due to order again.
        </p>
      )}

      {invoices.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
          <Icon name="check" className="h-8 w-8 text-success" />
          <p className="mt-3 font-semibold text-foreground">Nothing to pay</p>
          <p className="mt-1 text-sm text-muted-foreground">You are all settled up.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {invoices.map((item, i) => <PaymentRow key={item.id} item={item} index={i} onCheckout={onPay} />)}
        </ul>
      )}
    </>
  )
}
