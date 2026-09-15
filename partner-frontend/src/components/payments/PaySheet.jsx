import { useState } from 'react'
import Alert from '../Alert.jsx'
import Icon from '../ui/Icon.jsx'
import Sheet from '../ui/Sheet.jsx'
import { formatDate, formatINR } from '../../lib/format.js'
import { redeemableCredit } from '../../dummy/ordersAndMoney.js'

/*
 * Paying something that is owed: a checkout still waiting for its payment, or
 * an invoice with money due (usually a logistics invoice, spec §8.4).
 *
 *   checkout  its store credit was chosen when checkout started and is held on
 *             the order (decision 0020), so it is shown, not offered again
 *   invoice   store credit can settle part or all of what is due, like cash:
 *             the invoice keeps its full value and GST (decision 0013)
 *
 * Razorpay cannot collect less than ₹1, so credit never leaves 1–99 paise to
 * pay; when credit covers everything there is nothing for Razorpay at all.
 *
 * PAYMENTS ARE NOT LIVE. Pay stops with a message and changes nothing.
 * DUMMY DATA: `creditAvailable` and the credit rule come from
 * src/dummy/ordersAndMoney.js until the payments API exists.
 */
export default function PaySheet({ payment, creditAvailable, onClose }) {
  const [useCredit, setUseCredit] = useState(false)
  const [message, setMessage] = useState(null)

  if (!payment) return null

  const isCheckout = payment.kind === 'checkout'
  const due = isCheckout ? payment.order.grandTotal : payment.amountDue
  const credit = isCheckout
    ? payment.storeCreditHeld
    : useCredit ? redeemableCredit(creditAvailable, due) : 0
  const toPay = Math.round((due - credit) * 100) / 100
  const reference = isCheckout ? payment.order.orderNumber : payment.invoice.invoiceNumber

  const pay = () => {
    setMessage(
      toPay === 0
        ? 'Online payments are not switched on yet, so no store credit was used and nothing changed.'
        : 'Online payments are not switched on yet. Nothing was charged and nothing changed.'
    )
  }

  const footer = (
    <div className="space-y-3">
      {message && <Alert tone="info">{message}</Alert>}
      <button
        type="button"
        onClick={pay}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-3 border-accent bg-accent px-5 py-3 text-base font-black text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 active:scale-[0.99]"
      >
        <Icon name="check" className="h-4 w-4" />
        {toPay === 0 ? 'Pay with store credit' : `Pay ${formatINR(toPay)}`}
      </button>
      <p className="text-center text-[11px] text-muted-foreground">
        {toPay === 0 ? 'Store credit covers all of it — nothing goes to Razorpay.' : 'You will pay securely through Razorpay.'}
      </p>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={isCheckout ? 'Complete payment' : `Pay ${payment.title.toLowerCase()}`} subtitle={`${reference} · ${payment.order.outlet.name}`} footer={footer}>
      <div className="space-y-5">
        {isCheckout ? (
          <>
            <p className="text-sm text-muted-foreground">
              Checkout started {formatDate(payment.createdAt)}. The prices are held until the payment window closes; after that, check out again from the cart.
            </p>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {payment.order.lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 bg-background/30 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{l.name} <span className="text-muted-foreground">· {l.quantityOrdered} {l.unit}</span></span>
                  <span className="font-semibold text-foreground">{formatINR(l.ordered.total)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="rounded-xl border border-border bg-background/40 p-3 text-sm">
            <p className="font-semibold text-foreground">{payment.invoice.description || `${payment.title} for ${payment.order.orderNumber}`}</p>
            <p className="text-xs text-muted-foreground">Issued {formatDate(payment.invoice.issuedAt)}</p>
          </div>
        )}

        <dl className="space-y-2 text-sm">
          {isCheckout ? (
            <>
              <Row label="Subtotal (before GST)" value={formatINR(payment.order.subtotal)} />
              <Row label="GST" value={formatINR(payment.order.gstTotal)} />
              <Row label="Total" value={formatINR(payment.order.grandTotal)} strong />
            </>
          ) : (
            <>
              <Row label="Invoice total" value={formatINR(payment.total)} />
              {payment.alreadyPaid > 0 && <Row label="Already paid" value={`− ${formatINR(payment.alreadyPaid)}`} />}
              <Row label="Due" value={formatINR(payment.amountDue)} strong />
            </>
          )}
        </dl>

        {isCheckout ? (
          credit > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm text-foreground">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              {formatINR(credit)} of store credit was chosen at checkout and is held for this order.
            </p>
          )
        ) : (
          creditAvailable > 0 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-border bg-background/40 p-3 transition-colors hover:border-accent/50">
              <input type="checkbox" checked={useCredit} onChange={(e) => { setUseCredit(e.target.checked); setMessage(null) }} className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]" />
              <span className="text-sm">
                <span className="block font-semibold text-foreground">Use store credit</span>
                <span className="text-xs text-muted-foreground">{formatINR(creditAvailable)} available · oldest credit is used first</span>
              </span>
            </label>
          )
        )}

        <dl className="space-y-2 border-t border-border pt-3 text-sm">
          {credit > 0 && <Row label="Store credit" value={`− ${formatINR(credit)}`} tone="credit" />}
          <Row label="To pay now" value={formatINR(toPay)} strong />
        </dl>
        {credit > 0 && (
          <p className="text-[11px] text-muted-foreground">Credit is a payment, so the invoice still shows its full total and GST.</p>
        )}
      </div>
    </Sheet>
  )
}

function Row({ label, value, strong, tone }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? 'text-base font-black text-foreground' : 'text-muted-foreground'}`}>
      <dt>{label}</dt>
      <dd className={tone === 'credit' ? 'font-semibold text-success' : strong ? '' : 'font-semibold text-foreground'}>{value}</dd>
    </div>
  )
}
