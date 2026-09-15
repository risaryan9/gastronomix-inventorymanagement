import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/ui/Icon.jsx'
import { OrderProgress, StatusBadge } from '../../components/catalog/OrderStatus.jsx'
import { brandClass, ORDER_GROUPS } from '../../lib/catalog.js'
import { formatDate, formatINR } from '../../lib/format.js'
import { listOrders } from '../../dummy/ordersAndMoney.js'

/*
 * Every order the franchise has placed, newest first, across its outlets.
 *
 * Filter by where an order stands and by outlet; search by order number or
 * supply. Each row says what matters at a glance: how far along it is, what it
 * cost, and whether anything is still owed on it or came back as credit.
 *
 * DUMMY DATA: src/dummy/ordersAndMoney.js until GET /api/franchise/orders exists.
 */

const chip = (active) =>
  `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-all active:scale-95 ${
    active
      ? 'border-accent bg-accent text-accent-foreground shadow-button'
      : 'border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground'
  }`

const IN_PROGRESS_BAR = new Set(['paid', 'accepted', 'packed', 'ready_to_ship', 'shipped'])

function OrderRow({ order, index }) {
  const creditBack = order.creditNotes.reduce((s, c) => s + c.amount, 0)
  const items = order.lines.length
  return (
    <li className="animate-rise-in" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      <Link
        to={`/orders/${order.id}`}
        className="group block rounded-2xl border-2 border-border bg-card p-4 shadow-card transition-colors hover:border-accent/50 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black ${brandClass(order.outlet.brand)}`}>
            {order.outlet.brand}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-foreground group-hover:text-accent-text">{order.orderNumber}</p>
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {order.outlet.name} · {formatDate(order.placedAt)} · {items} {items === 1 ? 'supply' : 'supplies'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-black text-foreground">{formatINR(order.grandTotal)}</p>
            <Icon name="chevronRight" className="ml-auto mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>

        {IN_PROGRESS_BAR.has(order.status) && (
          <div className="mt-3">
            <OrderProgress status={order.status} />
          </div>
        )}

        {(order.amountDue > 0 || creditBack > 0 || order.status === 'pending_payment') && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {order.status === 'pending_payment' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 font-semibold text-accent-text">
                <Icon name="clock" className="h-3 w-3" /> Payment waiting · {formatINR(order.amountToPay)}
              </span>
            )}
            {order.amountDue > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
                {formatINR(order.amountDue)} due
              </span>
            )}
            {creditBack > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-semibold text-success">
                {formatINR(creditBack)} back as store credit
              </span>
            )}
          </div>
        )}
      </Link>
    </li>
  )
}

export default function Orders() {
  const orders = useMemo(() => listOrders(), [])
  const [group, setGroup] = useState('all')
  const [outletId, setOutletId] = useState('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const outlets = useMemo(() => {
    const seen = new Map()
    for (const o of orders) seen.set(o.outlet.id, o.outlet)
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [orders])

  // Everything but the status group, so each chip can count what it would show.
  const narrowed = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return orders.filter((o) =>
      (outletId === 'all' || o.outlet.id === outletId) &&
      (!q || o.orderNumber.toLowerCase().includes(q) || o.lines.some((l) => l.name.toLowerCase().includes(q)))
    )
  }, [orders, outletId, deferredQuery])

  const inGroup = (o, value) => {
    const g = ORDER_GROUPS.find((x) => x.value === value)
    return !g?.statuses || g.statuses.includes(o.status)
  }
  const shown = narrowed.filter((o) => inGroup(o, group))

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every order across your outlets, with its invoices and anything that came back as credit.</p>
        </div>
        <p className="text-xs text-muted-foreground">{orders.length} orders</p>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by order number or supply"
            className="h-11 w-full rounded-xl border border-border bg-input pl-9 pr-3 text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search orders"
          />
        </label>
        <select
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          className="h-11 rounded-xl border border-border bg-input px-3 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Outlet"
        >
          <option value="all">All outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Order status">
        {ORDER_GROUPS.map((g) => (
          <button key={g.value} type="button" role="tab" aria-selected={group === g.value} onClick={() => setGroup(g.value)} className={chip(group === g.value)}>
            {g.label} <span className="opacity-70">{narrowed.filter((o) => inGroup(o, g.value)).length}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
          <Icon name="box" className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No orders match</p>
          <p className="mt-1 text-sm text-muted-foreground">Try another status, outlet or search.</p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {shown.map((order, i) => <OrderRow key={order.id} order={order} index={i} />)}
        </ul>
      )}
    </div>
  )
}
