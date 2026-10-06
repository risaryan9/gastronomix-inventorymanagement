import { useEffect, useRef, useState } from 'react'
import Alert from '../Alert.jsx'
import Icon from '../ui/Icon.jsx'
import Sheet from '../ui/Sheet.jsx'
import InvoicePdfButton from './InvoicePdfButton.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatINR } from '../../lib/format.js'
import { openPaymentPopup } from '../../lib/razorpay.js'

/*
 * Paying an invoice with money due: usually a logistics invoice (spec §8.4), or
 * the remainder left when credit chosen at checkout had been spent by the time
 * the payment landed (migration 17). Store credit can settle part or all of it,
 * like cash: the invoice keeps its full value and GST (decision 0013).
 *
 * A checkout waiting for its payment is not paid here. It is paid from its
 * outlet's cart, which resumes the same Razorpay order (api/_lib/checkout.js).
 *
 * HOW IT PAYS (api/_lib/invoicePayments.js, migration 19). Pay asks the server
 * to start: the server applies credit if it was ticked and answers either
 * "paid" (credit covered it) or with a Razorpay order for the rest. The popup
 * takes the money; when it closes, however it closes, the sheet asks the
 * server, and the server asks Razorpay. Nothing the popup says is taken as
 * proof (src/lib/razorpay.js).
 *
 * CREDIT IS SPENT WHEN PAY IS PRESSED, not when the money lands. If the popup
 * is then closed, the credit stays used and the invoice is owed that much
 * less, so every figure here follows the server's last answer rather than the
 * row the sheet was opened from. `onChanged` tells the page to read again.
 *
 * `payment` is one row of GET /api/franchise/payments/pending, or the same
 * shape built from an order's invoice.
 */

// What credit could pay: all that is available, up to what is due, never
// leaving Razorpay between 1 and 99 paise. The server's rule is
// fofo.begin_invoice_payment (migration 19); this is only the preview.
function previewCredit(available, due) {
  let credit = Math.max(0, Math.min(available, due))
  const remainder = Math.round((due - credit) * 100) / 100
  if (remainder > 0 && remainder < 1) credit = Math.max(0, due - 1)
  return Math.round(credit * 100) / 100
}

// After the popup reports a payment, how long to keep asking before saying the
// bank has not confirmed yet. The same patience as the cart's checkout.
const CONFIRM_ATTEMPTS = 5
const CONFIRM_INTERVAL_MS = 2000
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const BUSY_LABEL = {
  starting: 'Starting payment…',
  paying: 'Finish paying in the Razorpay window',
  confirming: 'Confirming your payment…',
}

export default function PaySheet({ payment, creditAvailable, onClose, onChanged }) {
  const [useCredit, setUseCredit] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [message, setMessage] = useState(null)
  // The server's last word on this invoice, once it has been asked.
  const [server, setServer] = useState(null)
  const [creditUsed, setCreditUsed] = useState(0)
  const [started, setStarted] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  if (!payment) return null

  const invoiceId = payment.invoice.id || payment.id
  const due = server ? server.amountDue : payment.amountDue
  const credit = useCredit && !creditUsed ? previewCredit(creditAvailable, due) : 0
  const toPay = Math.round((due - credit) * 100) / 100
  const settled = Math.round((payment.total - due) * 100) / 100
  const busy = phase !== 'idle' && phase !== 'paid'

  // Everything after an await: the sheet may have been closed meanwhile.
  const heard = (result) => {
    if (!mounted.current) return
    setServer(result.invoice)
    if (result.creditApplied) setCreditUsed((used) => Math.round((used + result.creditApplied) * 100) / 100)
    onChanged?.()
  }
  const stop = (tone, text) => { if (mounted.current) { setPhase('idle'); setMessage({ tone, text }) } }
  const finish = (result) => { heard(result); if (mounted.current) { setPhase('paid'); setMessage(null) } }

  const confirm = async (how) => {
    if (mounted.current) setPhase('confirming')
    const attempts = how === 'completed' ? CONFIRM_ATTEMPTS : 1
    for (let i = 0; i < attempts; i += 1) {
      try {
        const result = await api('franchise/invoices/pay/confirm', { method: 'POST', body: { invoice_id: invoiceId } })
        if (result.status === 'paid') return finish(result)
        heard(result)
      } catch (err) {
        if (i === attempts - 1) return stop('error', err.message)
      }
      if (i < attempts - 1) await wait(CONFIRM_INTERVAL_MS)
    }
    return stop('info', how === 'completed'
      ? 'Your bank has not confirmed the payment yet. This usually takes a minute. If you have paid, do not pay again: press Check payment shortly.'
      : 'The payment was not finished, so nothing was charged.')
  }

  const pay = async () => {
    setPhase('starting')
    setMessage(null)
    let result
    try {
      result = await api('franchise/invoices/pay', { method: 'POST', body: { invoice_id: invoiceId, redeem_store_credit: credit > 0 } })
    } catch (err) {
      return stop('error', err.message)
    }
    if (result.status === 'paid') return finish(result)
    heard(result)
    if (mounted.current) { setStarted(true); setPhase('paying') }
    let how
    try {
      how = await openPaymentPopup(result.razorpay)
    } catch {
      return stop('error', 'The payment window could not be opened. Check your connection and try again.')
    }
    return confirm(how)
  }

  const subtitle = `${payment.invoice.invoiceNumber} · ${payment.order.outlet.name}`

  if (phase === 'paid') {
    const footer = (
      <button type="button" onClick={onClose} className="inline-flex w-full items-center justify-center rounded-xl border-3 border-accent bg-accent px-5 py-3 text-base font-black text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 active:scale-[0.99]">
        Done
      </button>
    )
    return (
      <Sheet open onClose={onClose} title="Payment confirmed" subtitle={subtitle} footer={footer}>
        <div className="flex flex-col items-center py-6 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
            <Icon name="check" className="h-7 w-7" strokeWidth={3} />
          </span>
          <p className="mt-4 text-lg font-bold text-foreground">{payment.invoice.invoiceNumber} is paid</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {payment.title} for order {payment.order.orderNumber}. Nothing more is due on it.
          </p>
          <dl className="mt-5 w-full max-w-xs space-y-2 text-left text-sm">
            <Row label="Invoice total" value={formatINR(payment.total)} />
            {creditUsed > 0 && <Row label="Store credit used" value={formatINR(creditUsed)} tone="credit" />}
            <Row label="Still due" value={formatINR(0)} strong />
          </dl>
          <div className="mt-5">
            <InvoicePdfButton invoiceId={invoiceId} label="Download invoice (PDF)" className="text-sm font-semibold text-accent-text hover:underline disabled:opacity-60" />
          </div>
        </div>
      </Sheet>
    )
  }

  const footer = (
    <div className="space-y-3">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-3 border-accent bg-accent px-5 py-3 text-base font-black text-accent-foreground shadow-button transition-all hover:shadow-button-hover hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? BUSY_LABEL[phase] : (
          <>
            <Icon name="check" className="h-4 w-4" />
            {toPay === 0 ? 'Pay with store credit' : `Pay ${formatINR(toPay)}`}
          </>
        )}
      </button>
      {started && !busy && (
        <button type="button" onClick={() => confirm('check')} className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:border-accent/60">
          Check payment
        </button>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        {toPay === 0 ? 'Store credit covers all of it. Nothing goes to Razorpay.' : 'You will pay securely through Razorpay.'}
      </p>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={`Pay ${payment.title.toLowerCase()}`} subtitle={subtitle} footer={footer}>
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-background/40 p-3 text-sm">
          <p className="font-semibold text-foreground">{payment.invoice.description || `${payment.title} for ${payment.order.orderNumber}`}</p>
          <p className="text-xs text-muted-foreground">
            Issued {formatDate(payment.invoice.issuedAt)} · <InvoicePdfButton invoiceId={invoiceId} label="Download PDF" />
          </p>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Invoice total" value={formatINR(payment.total)} />
          {settled > 0 && <Row label="Already paid" value={`− ${formatINR(settled)}`} />}
          <Row label="Due" value={formatINR(due)} strong />
        </dl>

        {creditUsed > 0 ? (
          <Alert tone="info">
            {formatINR(creditUsed)} of store credit has been used on this invoice. {formatINR(due)} is left to pay.
          </Alert>
        ) : creditAvailable > 0 && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-border bg-background/40 p-3 transition-colors hover:border-accent/50">
            <input type="checkbox" checked={useCredit} disabled={busy} onChange={(e) => { setUseCredit(e.target.checked); setMessage(null) }} className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]" />
            <span className="text-sm">
              <span className="block font-semibold text-foreground">Use store credit</span>
              <span className="text-xs text-muted-foreground">{formatINR(creditAvailable)} available · oldest credit is used first</span>
            </span>
          </label>
        )}

        <dl className="space-y-2 border-t border-border pt-3 text-sm">
          {credit > 0 && <Row label="Store credit" value={`− ${formatINR(credit)}`} tone="credit" />}
          <Row label="To pay now" value={formatINR(toPay)} strong />
        </dl>
        {credit > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Credit is a payment, so the invoice still shows its full total and GST.
            {toPay > 0 && ' It is used as soon as you press Pay, even if you then close the payment window.'}
          </p>
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
