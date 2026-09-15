import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import CatalogItemCard from '../../components/catalog/CatalogItemCard.jsx'
import ItemDetailSheet from '../../components/catalog/ItemDetailSheet.jsx'
import Icon from '../../components/ui/Icon.jsx'
import Sheet from '../../components/ui/Sheet.jsx'
import Alert from '../../components/Alert.jsx'
import { useCart } from '../../cart/cartContext.js'
import { MATERIAL_TYPE_LABEL } from '../../lib/catalog.js'
import { formatINR } from '../../lib/format.js'
import { useApi } from '../../lib/useApi.js'

/*
 * Order supplies, step 2: the catalogue for one outlet.
 *
 * Supplies are grouped by their catalogue category. Search matches name, code
 * and category; the filters narrow by kind of material, by what this outlet has
 * ordered before, and hide items that cannot be supplied here. On a phone the
 * filters live in a sheet behind one button, and the cart total follows along
 * the bottom of the screen.
 *
 * Prices come from the server, worked out in this outlet's serving kitchen.
 * Only final prices reach this app; cost, margin and stock never do (spec §11).
 * The cart is the server's too (CartProvider): it is loaded when the page
 * opens, and while a payment for it is in progress it cannot be changed.
 */

const SORTS = [
  { value: 'category', label: 'By category' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'priceAsc', label: 'Price: low to high' },
  { value: 'priceDesc', label: 'Price: high to low' },
  { value: 'recent', label: 'Recently ordered' },
]

const chip = (active) =>
  `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-all active:scale-95 ${
    active
      ? 'border-accent bg-accent text-accent-foreground shadow-button'
      : 'border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground'
  }`

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer select-none items-center justify-between gap-3 text-sm font-medium text-foreground">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? 'border-accent bg-accent' : 'border-border bg-input'}`}
      >
        <span className={`absolute top-[1px] h-5 w-5 rounded-full shadow transition-transform ${checked ? 'translate-x-[1.25rem] bg-accent-foreground' : 'translate-x-[1px] bg-muted-foreground'}`} />
      </button>
    </label>
  )
}

function FilterControls({ types, availableTypes, toggleType, orderedBefore, setOrderedBefore, hideUnavailable, setHideUnavailable, sort, setSort, layout }) {
  const stacked = layout === 'sheet'
  return (
    <div className={stacked ? 'space-y-6' : 'flex flex-wrap items-center gap-x-5 gap-y-3'}>
      <div className={stacked ? '' : 'flex items-center gap-2'}>
        <p className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground ${stacked ? 'mb-2' : ''}`}>Type</p>
        <div className="flex flex-wrap gap-2">
          {availableTypes.map((type) => (
            <button key={type} type="button" onClick={() => toggleType(type)} className={`${chip(types.has(type))} !py-1 !text-xs`} aria-pressed={types.has(type)}>
              {MATERIAL_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>
      <div className={stacked ? 'space-y-4 rounded-xl border border-border p-4' : 'flex items-center gap-5'}>
        <Toggle checked={orderedBefore} onChange={setOrderedBefore} label="Ordered before" />
        <Toggle checked={hideUnavailable} onChange={setHideUnavailable} label="Hide unavailable" />
      </div>
      <label className={stacked ? 'block' : 'flex items-center gap-2'}>
        <span className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground ${stacked ? 'mb-2 block' : ''}`}>Sort</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className={`rounded-lg border border-border bg-input px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${stacked ? 'w-full' : ''}`}
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
    </div>
  )
}

export default function OutletCatalog() {
  const { outletId } = useParams()
  const navigate = useNavigate()
  const { data: catalogData, error: catalogError, loading, reload } = useApi(`franchise/catalog?outlet_id=${encodeURIComponent(outletId)}`)
  const { data: outletsData } = useApi('franchise/outlets')
  const outlet = catalogData?.outlet || null
  const outlets = outletsData || []
  const catalog = useMemo(() => catalogData?.items || [], [catalogData])
  const { quantityOf, setQuantity, carts, loadCart, error: cartError, clearError } = useCart()
  const outletCart = carts[outletId]
  const locked = Boolean(outletCart?.lock)

  useEffect(() => { loadCart(outletId) }, [outletId, loadCart])

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [category, setCategory] = useState('all')
  const [types, setTypes] = useState(() => new Set())
  const [orderedBefore, setOrderedBefore] = useState(false)
  const [hideUnavailable, setHideUnavailable] = useState(false)
  const [sort, setSort] = useState('category')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [openItemId, setOpenItemId] = useState(null)
  const searchRef = useRef(null)

  // "/" jumps to search, as on most catalogue sites.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleType = useCallback((type) => {
    setTypes((current) => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const availableTypes = useMemo(
    () => Object.keys(MATERIAL_TYPE_LABEL).filter((t) => catalog.some((i) => i.type === t)),
    [catalog]
  )

  // Everything except the category choice, so each category chip can show how
  // many results it would give.
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return catalog.filter((item) =>
      (!q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)) &&
      (types.size === 0 || types.has(item.type)) &&
      (!orderedBefore || item.lastOrdered) &&
      (!hideUnavailable || item.available)
    )
  }, [catalog, deferredQuery, types, orderedBefore, hideUnavailable])

  const categories = useMemo(() => {
    const counts = new Map()
    for (const item of catalog) counts.set(item.category, 0)
    for (const item of filtered) counts.set(item.category, (counts.get(item.category) || 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog, filtered])

  const results = useMemo(() => {
    const inCategory = category === 'all' ? filtered : filtered.filter((i) => i.category === category)
    const byAvailability = (a, b) => Number(b.available) - Number(a.available)
    const sorters = {
      category: (a, b) => a.category.localeCompare(b.category) || byAvailability(a, b) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      priceAsc: (a, b) => byAvailability(a, b) || a.priceIncGst - b.priceIncGst,
      priceDesc: (a, b) => byAvailability(a, b) || b.priceIncGst - a.priceIncGst,
      recent: (a, b) => (b.lastOrdered?.at || '').localeCompare(a.lastOrdered?.at || '') || a.name.localeCompare(b.name),
    }
    return [...inCategory].sort(sorters[sort])
  }, [filtered, category, sort])

  const sections = useMemo(() => {
    if (sort !== 'category') return [{ name: null, items: results }]
    const groups = new Map()
    for (const item of results) {
      if (!groups.has(item.category)) groups.set(item.category, [])
      groups.get(item.category).push(item)
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items }))
  }, [results, sort])

  const activeFilterCount = types.size + Number(orderedBefore) + Number(hideUnavailable) + Number(sort !== 'category')
  const clearAll = () => {
    setQuery(''); setCategory('all'); setTypes(new Set()); setOrderedBefore(false); setHideUnavailable(false); setSort('category')
  }

  const handleSetQuantity = useCallback((item, qty) => setQuantity(outletId, item, qty), [setQuantity, outletId])
  const openItem = catalog.find((i) => i.id === openItemId) || null
  const cart = { lines: outletCart?.lines.length || 0, total: outletCart?.totals.total || 0 }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-card" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-52 animate-pulse rounded-2xl border-2 border-border bg-card/60" />)}
        </div>
      </div>
    )
  }

  if (!outlet) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground">{catalogError?.status === 404 ? 'Outlet not found' : 'Could not load the catalogue'}</h1>
        {catalogError && catalogError.status !== 404 && (
          <div className="mt-4"><Alert>{catalogError.message} <button type="button" onClick={reload} className="font-semibold text-accent-text hover:underline">Try again</button></Alert></div>
        )}
        <Link to="/order" className="mt-4 inline-block text-sm font-semibold text-accent-text hover:underline">Back to your outlets</Link>
      </div>
    )
  }

  const filterProps = { types, availableTypes, toggleType, orderedBefore, setOrderedBefore, hideUnavailable, setHideUnavailable, sort, setSort }

  return (
    <div className={cart.lines ? 'pb-24' : ''}>
      {/* Heading */}
      <div className="animate-rise-in">
        <Link to="/order" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <Icon name="chevronLeft" /> All outlets
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-foreground sm:text-3xl">{outlet.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {catalog.length} supplies · supplied by {outlet.kitchenName} · prices include GST
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Outlet</span>
            <select
              value={outlet.id}
              onChange={(e) => navigate(`/order/${e.target.value}`)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-input px-3 py-2 font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:flex-none"
            >
              {(outlets.length ? outlets : [outlet]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>
        {locked && (
          <div className="mt-4">
            <Alert tone="info">
              A payment for this outlet's cart is in progress (order {outletCart.lock.orderNumber}), so the cart cannot be changed until it finishes or expires.
            </Alert>
          </div>
        )}
        {cartError && (
          <div className="mt-4">
            <Alert>
              {cartError} <button type="button" onClick={clearError} className="font-semibold text-accent-text hover:underline">Dismiss</button>
            </Alert>
          </div>
        )}
        {catalog.length === 0 && (
          <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
            <Icon name="box" className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold text-foreground">No supplies listed for this outlet yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Gastronomix has not opened any supplies to {outlet.brandName} outlets. Contact us to ask.</p>
          </div>
        )}
      </div>

      {/* Search, categories and filters — pinned under the top bar */}
      <div className="sticky top-[calc(4rem+1px)] z-10 -mx-4 mt-5 border-b border-border bg-background/90 px-4 pb-3 pt-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search supplies by name or code"
              className="h-11 w-full rounded-xl border border-border bg-input pl-9 pr-9 text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring [&::-webkit-search-cancel-button]:hidden"
              aria-label="Search supplies"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <Icon name="close" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] font-semibold text-muted-foreground sm:block">/</kbd>
            )}
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="relative inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-accent/60 lg:hidden"
          >
            <Icon name="filter" /> Filters
            {activeFilterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-black text-accent-foreground">{activeFilterCount}</span>
            )}
          </button>
        </div>

        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={category === 'all'} onClick={() => setCategory('all')} className={chip(category === 'all')}>
            All <span className="opacity-70">{filtered.length}</span>
          </button>
          {categories.map(([name, count]) => (
            <button key={name} type="button" role="tab" aria-selected={category === name} onClick={(e) => { setCategory(name); e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }) }} className={`${chip(category === name)} ${count === 0 && category !== name ? 'opacity-50' : ''}`}>
              {name} <span className="opacity-70">{count}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 hidden lg:block">
          <FilterControls {...filterProps} layout="inline" />
        </div>
      </div>

      {/* Results */}
      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground" aria-live="polite">
          {results.length} {results.length === 1 ? 'supply' : 'supplies'}
          {category !== 'all' && <> in <span className="font-semibold text-foreground">{category}</span></>}
        </p>
        {(activeFilterCount > 0 || query || category !== 'all') && (
          <button type="button" onClick={clearAll} className="font-semibold text-accent-text hover:underline">Clear all</button>
        )}
      </div>

      {catalog.length === 0 ? null : results.length === 0 ? (
        <div className="mt-6 flex animate-rise-in flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
          <Icon name="search" className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No supplies match</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different search, or clear the filters.</p>
          <button type="button" onClick={clearAll} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-accent/60">Clear all</button>
        </div>
      ) : (
        <div className="mt-4 space-y-8">
          {sections.map((section) => (
            <section key={section.name || 'all'} aria-label={section.name || 'Supplies'}>
              {section.name && (
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-foreground">
                  {section.name}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{section.items.length}</span>
                </h2>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {section.items.map((item, i) => (
                  <div key={item.id} className="animate-rise-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <CatalogItemCard
                      item={item}
                      quantityInCart={quantityOf(outletId, item.id)}
                      locked={locked}
                      onOpen={(it) => setOpenItemId(it.id)}
                      onSetQuantity={handleSetQuantity}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Cart bar */}
      {cart.lines > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 animate-sheet-up px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-64">
          <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border-2 border-accent bg-card/95 p-3 pl-4 shadow-card backdrop-blur-md">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Icon name="cart" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-foreground">
                {cart.lines} item{cart.lines === 1 ? '' : 's'} · {formatINR(cart.total)}
              </p>
              <p className="truncate text-xs text-muted-foreground">For {outlet.name}</p>
            </div>
            <Link to={`/cart?outlet=${outlet.id}`} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl bg-accent px-4 text-sm font-black text-accent-foreground transition hover:brightness-110 active:scale-95">
              View cart <Icon name="chevronRight" />
            </Link>
          </div>
        </div>
      )}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={clearAll} className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground">Clear all</button>
            <button type="button" onClick={() => setFiltersOpen(false)} className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-black text-accent-foreground">
              Show {results.length} {results.length === 1 ? 'supply' : 'supplies'}
            </button>
          </div>
        }
      >
        <FilterControls {...filterProps} layout="sheet" />
      </Sheet>

      <ItemDetailSheet
        item={openItem}
        outlet={outlet}
        quantityInCart={openItem ? quantityOf(outletId, openItem.id) : 0}
        locked={locked}
        onSetQuantity={handleSetQuantity}
        onClose={() => setOpenItemId(null)}
      />
    </div>
  )
}
