// Operations → Vendor Management.
//
// Everything about who stock is bought from: the vendor directory, every
// purchase invoice with its scanned document, what each vendor supplies and at
// what price, and the downloads built from all of it.
//
// ONE LOAD, FOUR VIEWS
//
// Unlike the kitchen ledgers, this loads once per period rather than per tab.
// Every tab reads the same invoices — the directory rolls them up, the register
// lists them, the materials tab explodes their lines, and the reports write them
// out — so fetching per tab would fetch the same rows four times and let the
// four disagree while some of them were stale. A period is a few hundred
// invoices; the whole thing is one round trip.
//
// The period, the kitchen scope and the open tab all live in the URL, so any
// view of this screen is linkable and survives a refresh.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import VendorsTab from '../../components/admin/vendors/VendorsTab'
import VendorInvoicesTab from '../../components/admin/vendors/VendorInvoicesTab'
import VendorReportsTab from '../../components/admin/vendors/VendorReportsTab'
import { RANGE_OPTIONS, resolveRange } from '../../lib/adminOverview'
import { compactMoney, count, formatDay, money } from '../../lib/formatNumbers'
import {
  EMPTY_INVOICE_FILTERS,
  buildVendorMaterials,
  buildVendorRollups,
  fetchPurchaseData,
  fetchVendorMaterialCatalogue,
  fetchVendors,
  filterInvoices,
} from '../../lib/vendorManagement'

const TABS = [
  { id: 'vendors', label: 'Vendors' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'reports', label: 'Reports' },
]

const Stat = ({ label, value, caption }) => (
  <div className="bg-card border border-border border-l-2 border-l-accent/40 rounded-xl p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-xl font-bold text-foreground mt-1">{value}</p>
    <p className="text-[11px] text-muted-foreground">{caption}</p>
  </div>
)

const Chip = ({ active, children, ...props }) => (
  <button
    type="button"
    aria-pressed={active}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
      active
        ? 'bg-accent text-background'
        : 'bg-input border border-border text-muted-foreground hover:text-foreground'
    }`}
    {...props}
  >
    {children}
  </button>
)

const AdminVendorManagement = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : TABS[0].id

  const [range, setRange] = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [kitchenId, setKitchenId] = useState('')

  const [vendorRecords, setVendorRecords] = useState([])
  const [catalogue, setCatalogue] = useState([])
  const [invoices, setInvoices] = useState([])
  const [kitchens, setKitchens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [invoiceFilters, setInvoiceFilters] = useState(EMPTY_INVOICE_FILTERS)

  const resolved = useMemo(
    () => resolveRange(range, customFrom, customTo),
    [range, customFrom, customTo]
  )
  // resolveRange returns a fresh object each render; this is its stable identity,
  // so the load effect fires when the dates change and not on every render.
  const rangeKey = `${resolved.from}:${resolved.to}`

  const load = useCallback(async () => {
    const [from, to] = rangeKey.split(':')

    try {
      setLoading(true)
      setError('')

      const [vendorRows, catalogueRows, purchases] = await Promise.all([
        fetchVendors(),
        fetchVendorMaterialCatalogue(),
        fetchPurchaseData({ from, to }, kitchenId),
      ])

      setVendorRecords(vendorRows)
      setCatalogue(catalogueRows)
      setInvoices(purchases.invoices)
      setKitchens(purchases.kitchens)
    } catch (err) {
      console.error('Error loading vendor management data:', err)
      setError('Failed to load vendor data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [rangeKey, kitchenId])

  useEffect(() => {
    load()
  }, [load])

  /* -------------------------------------------------------------- *
   * Folds
   * -------------------------------------------------------------- */

  const vendorsById = useMemo(
    () => new Map(vendorRecords.map((vendor) => [vendor.id, vendor])),
    [vendorRecords]
  )

  // buildVendorRollups resolves each invoice to a vendor and hands back the
  // tagged copies. Everything below reads those, never `invoices` — the raw rows
  // have no vendorId on them, so a consumer that reached for the wrong one would
  // fail loudly rather than quietly bucketing everything as undefined.
  const rollup = useMemo(
    () => buildVendorRollups(vendorRecords, invoices, catalogue),
    [vendorRecords, invoices, catalogue]
  )
  const resolvedInvoices = rollup.invoices

  // Kept for the vendor-material report on the Reports tab; there is no longer a
  // Materials tab reading it.
  const vendorMaterials = useMemo(
    () => buildVendorMaterials(resolvedInvoices, catalogue, vendorsById),
    [resolvedInvoices, catalogue, vendorsById]
  )

  const vendorOptions = useMemo(
    () =>
      [...rollup.rows]
        .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
        .map((vendor) => ({ value: vendor.id, label: vendor.name })),
    [rollup.rows]
  )

  const kitchenOptions = useMemo(
    () => kitchens.map((kitchen) => ({ value: kitchen.id, label: kitchen.name })),
    [kitchens]
  )

  // The reports export exactly what the other tabs are showing, so the filtering
  // is done once here and shared rather than duplicated in the reports tab.
  const filteredInvoices = useMemo(
    () => filterInvoices(resolvedInvoices, invoiceFilters),
    [resolvedInvoices, invoiceFilters]
  )

  const totals = useMemo(() => {
    const spend = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
    const gst = invoices.reduce((sum, invoice) => sum + invoice.gstAmount, 0)
    const missing = invoices.filter((invoice) => !invoice.hasInvoiceFile).length
    const active = rollup.rows.filter((vendor) => vendor.invoiceCount > 0).length

    return {
      spend,
      gst,
      missing,
      active,
      averageInvoice: invoices.length > 0 ? spend / invoices.length : 0,
    }
  }, [invoices, rollup.rows])


  const selectedKitchenName = kitchens.find((kitchen) => kitchen.id === kitchenId)?.name ?? ''
  const exportOptions = {
    from: resolved.from,
    to: resolved.to,
    kitchenName: selectedKitchenName,
  }

  const selectTab = (tabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tabId)
    setSearchParams(next, { replace: true })
  }

  // Clicking a vendor's invoice count on the directory jumps here with that
  // vendor already filtered, which is the whole reason the count is a link.
  const showVendorInvoices = (vendorId) => {
    setInvoiceFilters({ ...EMPTY_INVOICE_FILTERS, vendorIds: [vendorId] })
    selectTab('invoices')
  }

  const scopeNote = (shown, total, noun) =>
    shown === total
      ? `Every ${noun} in the period.`
      : `Filtered: ${count(shown)} of ${count(total)} ${noun}s, matching the filters set on that tab.`

  return (
    <div className="space-y-6">
      {/* Header: what this is, over what period, for which kitchen */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">Vendor Management</h2>
            <p className="text-sm text-muted-foreground">
              Vendors, their purchase invoices and what each one supplies.
            </p>
          </div>

          <div
            role="group"
            aria-label="Date range"
            className="inline-flex rounded-lg border border-border bg-input p-0.5 h-fit"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  range === option.value
                    ? 'bg-accent text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="range-from">
              From
            </label>
            <input
              id="range-from"
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="px-3 py-1.5 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <label className="text-xs text-muted-foreground" htmlFor="range-to">
              To
            </label>
            <input
              id="range-to"
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="px-3 py-1.5 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {(!customFrom || !customTo) && (
              <span className="text-xs text-yellow-500">
                Pick both dates — showing today until you do.
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Kitchen</span>
          <Chip active={kitchenId === ''} onClick={() => setKitchenId('')}>
            All kitchens
          </Chip>
          {kitchens.map((kitchen) => (
            <Chip
              key={kitchen.id}
              active={kitchen.id === kitchenId}
              onClick={() => setKitchenId(kitchen.id)}
            >
              {kitchen.name}
            </Chip>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDay(resolved.from)} – {formatDay(resolved.to)}
          </span>
        </div>
      </div>

      {error ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-destructive">
          {error}
        </div>
      ) : (
        <div
          aria-busy={loading}
          className={`space-y-6 transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}
        >
          <section aria-label="Vendor spend summary">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Spend"
                value={money(totals.spend)}
                caption={`GST inclusive · ${compactMoney(totals.gst)} of it GST`}
              />
              <Stat
                label="Invoices"
                value={count(invoices.length)}
                caption={`${money(totals.averageInvoice)} average`}
              />
              <Stat
                label="Vendors bought from"
                value={count(totals.active)}
                caption={`${count(rollup.rows.length)} on record`}
              />
              <Stat
                label="Missing invoice files"
                value={count(totals.missing)}
                caption={
                  totals.missing === 0
                    ? 'Every invoice has a scan attached'
                    : 'Receipts recorded with no document'
                }
              />
            </div>
          </section>

          {rollup.unlinkedNames.length > 0 && (
            <p className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl px-4 py-3 text-sm text-yellow-500">
              <span className="font-semibold">
                {count(rollup.unlinkedNames.length)} supplier name
                {rollup.unlinkedNames.length === 1 ? '' : 's'} on receipts in this period
              </span>{' '}
              {rollup.unlinkedNames.length === 1 ? 'does' : 'do'} not match a vendor record:{' '}
              {rollup.unlinkedNames.join(', ')}. Their spend is still counted here — add them on the
              Vendors tab to link them up.
            </p>
          )}

          <section aria-label="Vendor records">
            <div
              role="tablist"
              aria-label="Vendor records"
              className="flex flex-wrap gap-1 border-b border-border mb-4"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => selectTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    activeTab === tab.id
                      ? 'border-accent text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'vendors' && (
              <VendorsTab
                vendors={rollup.rows}
                loading={loading}
                error={error}
                onRefresh={load}
                onViewInvoices={showVendorInvoices}
              />
            )}

            {activeTab === 'invoices' && (
              <VendorInvoicesTab
                invoices={resolvedInvoices}
                vendorOptions={vendorOptions}
                kitchenOptions={kitchenOptions}
                filters={invoiceFilters}
                onFiltersChange={setInvoiceFilters}
                loading={loading}
                error={error}
              />
            )}

            {activeTab === 'reports' && (
              <VendorReportsTab
                vendors={rollup.rows}
                invoices={filteredInvoices}
                materials={vendorMaterials}
                options={exportOptions}
                invoiceScopeNote={scopeNote(filteredInvoices.length, invoices.length, 'invoice')}
                materialScopeNote="Every vendor–material pair in the period. Unlike the register, no on-screen filter narrows this one."
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default AdminVendorManagement
