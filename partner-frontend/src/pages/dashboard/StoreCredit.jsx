import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/ui/Icon.jsx'
import { brandClass } from '../../lib/catalog.js'
import { formatDate, formatINR } from '../../lib/format.js'
import { storeCreditStatement } from '../../dummy/ordersAndMoney.js'

/*
 * Store credit, shown as a statement rather than a number (decision 0013).
 *
 * Credit is earned when less could be supplied than was paid for — each credit
 * note becomes one credit — and spent in parts against invoices, oldest credit
 * first. Nothing stores a balance: the balance is everything earned less
 * everything spent, and each credit shows exactly which invoices used it, so a
 * disputed balance can be settled line by line.
 *
 * Available is the balance less what checkouts in progress are holding
 * (decision 0020). The hold itself is not called out here; it shows on the
 * order waiting for payment.
 *
 * DUMMY DATA: src/dummy/ordersAndMoney.js until GET /api/franchise/credit/statement exists.
 */

const RULES = [
  { icon: 'check', text: 'Refunds always come back as store credit, never to a bank account.' },
  { icon: 'clock', text: 'Credit never expires, and cannot be cashed out.' },
  { icon: 'history', text: 'It can be spent in parts, on any order or invoice. The oldest credit is used first.' },
  { icon: 'info', text: 'Credit is a payment, not a discount: invoices keep their full value and GST.' },
]

function CreditCard({ credit, index }) {
  const [open, setOpen] = useState(index === 0)
  const usedPct = credit.amount ? Math.round((credit.amountApplied / credit.amount) * 100) : 0
  const { order } = credit

  return (
    <li className="animate-rise-in rounded-2xl border-2 border-border bg-card shadow-card" style={{ animationDelay: `${index * 50}ms` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full p-4 text-left sm:p-5" aria-expanded={open}>
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black ${brandClass(order.outlet.brand)}`}>{order.outlet.brand}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-foreground">{credit.creditNoteNumber}</p>
              {credit.amountRemaining === 0 ? (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Used up</span>
              ) : credit.amountApplied > 0 ? (
                <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-text">Partly used</span>
              ) : (
                <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">Unused</span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Earned {formatDate(credit.issuedAt)} · {order.orderNumber} · {order.outlet.name}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-success">{formatINR(credit.amountRemaining)}</p>
            <p className="text-[11px] text-muted-foreground">left of {formatINR(credit.amount)}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${usedPct}%` }} />
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 sm:px-5">
          <p className="text-sm text-foreground">{credit.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Credit note against invoice {credit.invoiceNumber} ·{' '}
            <Link to={`/orders/${order.id}`} className="font-semibold text-accent-text hover:underline">View order</Link>
          </p>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Spent on</h3>
          {credit.applications.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Not spent yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
              {credit.applications.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 bg-background/30 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {a.invoiceType === 'logistics' ? 'Logistics invoice' : 'Goods invoice'} {a.invoiceNumber}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(a.at)} · <Link to={`/orders/${a.orderId}`} className="hover:underline">{a.orderNumber}</Link>{a.appliedBy ? ` · by ${a.appliedBy}` : ''}
                    </p>
                  </div>
                  <p className="font-bold text-foreground">− {formatINR(a.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export default function StoreCredit() {
  const statement = useMemo(() => storeCreditStatement(), [])
  const [filter, setFilter] = useState('all')
  const credits = statement.credits.filter((c) => filter === 'all' || c.amountRemaining > 0)

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Store credit</h1>
      <p className="mt-1 text-sm text-muted-foreground">What came back to you, and exactly where each rupee of it went.</p>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="animate-rise-in rounded-2xl border-2 border-accent bg-card p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available to spend</p>
          <p className="mt-1 text-4xl font-black text-success">{formatINR(statement.available)}</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm">
            <div><dt className="text-[11px] text-muted-foreground">Earned</dt><dd className="font-bold text-foreground">{formatINR(statement.earnedTotal)}</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Spent</dt><dd className="font-bold text-foreground">{formatINR(statement.spentTotal)}</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Balance</dt><dd className="font-bold text-foreground">{formatINR(statement.balance)}</dd></div>
          </dl>
        </div>
        <ul className="grid gap-2 rounded-2xl border-2 border-border bg-card p-4 text-sm">
          {RULES.map((r) => (
            <li key={r.text} className="flex items-start gap-2 text-muted-foreground">
              <Icon name={r.icon} className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
              {r.text}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-foreground">Credits</h2>
        <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Which credits">
          {[['all', 'All'], ['left', 'With credit left']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filter === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {credits.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
          <Icon name="sparkle" className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No store credit yet</p>
          <p className="mt-1 text-sm text-muted-foreground">If we ever supply less than you paid for, the difference appears here.</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {credits.map((c, i) => <CreditCard key={c.id} credit={c} index={i} />)}
        </ul>
      )}
    </div>
  )
}
