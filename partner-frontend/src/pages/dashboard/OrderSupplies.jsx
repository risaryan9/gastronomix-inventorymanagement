import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/ui/Icon.jsx'
import { useCart } from '../../cart/cartContext.js'
import { formatINRWhole, formatRelativeDay } from '../../lib/format.js'
import { listOutlets } from '../../dummy/orderSupplies.js'

/*
 * Order supplies, step 1: choose the outlet.
 *
 * An order is always for one outlet, because the outlet decides the serving
 * kitchen, and the kitchen decides the price (spec §6). Each outlet's card counts
 * its in-process and completed orders, so a franchise can see something is
 * already on the way before ordering more; the orders themselves live in Orders.
 *
 * DESIGN STAGE: data comes from src/dummy/orderSupplies.js.
 */

const BRAND_STYLE = {
  EC: { label: 'El Chaapo', className: 'bg-accent text-accent-foreground' },
  NK: { label: 'Nippu Kodi', className: 'bg-destructive text-destructive-foreground' },
  BP: { label: 'Boom Pizza', className: 'bg-success text-background' },
}

function OutletCard({ outlet, index }) {
  const { summaryFor } = useCart()
  const cart = summaryFor(outlet.id)
  const brand = BRAND_STYLE[outlet.brand] || { label: outlet.brand, className: 'bg-muted text-foreground' }

  return (
    <article
      className="flex animate-rise-in flex-col rounded-2xl border-2 border-border bg-card p-5 shadow-card transition-colors hover:border-accent/50"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <header className="flex items-start gap-3">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black ${brand.className}`}>
          {outlet.brand}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-foreground">{outlet.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {brand.label} · {outlet.code} · {outlet.area}
          </p>
        </div>
        {cart.lines > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
            <Icon name="cart" className="h-3 w-3" /> {cart.lines}
          </span>
        )}
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'In process', value: outlet.inProcessOrders.length },
          { label: 'Completed', value: outlet.completedOrders.length },
          { label: 'Last order', value: outlet.lastOrderAt ? formatRelativeDay(outlet.lastOrderAt) : '—' },
          { label: 'Last 30 days', value: formatINRWhole(outlet.spendLast30Days) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-background/50 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
            <dd className="mt-0.5 truncate text-sm font-bold text-foreground">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="truck" className="h-3.5 w-3.5" /> Supplied by {outlet.kitchenName}
      </p>

      <Link
        to={`/order/${outlet.id}`}
        className="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border-3 border-accent bg-accent px-5 py-3 text-base font-black text-accent-foreground shadow-button transition-all hover:-translate-x-[0.05em] hover:-translate-y-[0.05em] hover:shadow-button-hover hover:brightness-110 active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-button-active"
      >
        {cart.lines > 0 ? 'Continue ordering' : 'Order for this outlet'}
        <Icon name="chevronRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </article>
  )
}

export default function OrderSupplies() {
  const outlets = useMemo(() => listOutlets(), [])

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Order supplies</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose the outlet you are ordering for. Prices depend on the kitchen that supplies it.</p>
        </div>
        <p className="text-xs text-muted-foreground">{outlets.length} outlet{outlets.length === 1 ? '' : 's'}</p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {outlets.map((outlet, index) => <OutletCard key={outlet.id} outlet={outlet} index={index} />)}
      </div>
    </div>
  )
}
