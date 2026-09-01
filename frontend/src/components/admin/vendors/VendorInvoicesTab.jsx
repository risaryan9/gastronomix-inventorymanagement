// Every purchase invoice in the period, filterable, with the document attached.
//
// The filters are the ones a buyer actually reaches for: which vendor, which
// kitchen, how big, and — the one no other screen offers — whether the invoice
// was ever uploaded at all. A missing scan is the single most common problem
// with this data, so it gets a filter rather than a column you have to scan for.

import { useMemo, useState } from 'react'
import {
  KitchenPanel,
  PAGE_SIZE,
  Pill,
  RowChevron,
  SortableTh,
  Td,
  Th,
  clickableRowClass,
  searchInputClass,
  theadClass,
} from '../kitchen/KitchenPanel'
import MultiSelectFilter from '../../MultiSelectFilter'
import VendorInvoiceModal from './VendorInvoiceModal'
import { useTableSort } from '../../../hooks/useTableSort'
import { count, formatDay, money } from '../../../lib/formatNumbers'
import { EMPTY_INVOICE_FILTERS, filterInvoices } from '../../../lib/vendorManagement'

const SORT_ACCESSORS = {
  date: (row) => row.receiptDate,
  vendor: (row) => row.vendorName,
  invoice: (row) => row.invoiceNumber,
  kitchen: (row) => row.kitchenName,
  receiver: (row) => row.receivedByName,
  items: (row) => row.itemCount,
  amount: (row) => row.amount,
}

const FILE_OPTIONS = [
  { value: 'attached', label: 'File attached' },
  { value: 'missing', label: 'File missing' },
]

const VendorInvoicesTab = ({
  invoices,
  vendorOptions,
  kitchenOptions,
  filters,
  onFiltersChange,
  loading,
  error,
}) => {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const sort = useTableSort('date', 'desc')

  const filtered = useMemo(
    () => sort.sortRows(filterInvoices(invoices, filters), SORT_ACCESSORS),
    [invoices, filters, sort]
  )

  // Resetting the page during render rather than from an effect: a filter change
  // that shortens the list must not leave you stranded on a page that no longer
  // exists, and doing it here means the new page-1 slice is what renders, not a
  // discarded frame showing the old page.
  const [filtersAtPage, setFiltersAtPage] = useState(filters)
  if (filters !== filtersAtPage) {
    setFiltersAtPage(filters)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const rangeTotal = filtered.reduce((sum, invoice) => sum + invoice.amount, 0)
  const missingFiles = filtered.filter((invoice) => !invoice.hasInvoiceFile).length

  const set = (patch) => onFiltersChange({ ...filters, ...patch })
  const isFiltered =
    filters.search.trim() !== '' ||
    !filters.vendorIds.includes('all') ||
    !filters.kitchenIds.includes('all') ||
    !filters.fileState.includes('all') ||
    filters.minAmount !== '' ||
    filters.maxAmount !== ''

  return (
    <>
      <KitchenPanel
        toolbar={
          <div className="flex flex-col gap-3 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="text"
                value={filters.search}
                onChange={(event) => set({ search: event.target.value })}
                placeholder="Search invoice no., vendor, material, receiver or date…"
                aria-label="Search invoices"
                className={searchInputClass}
              />
              <MultiSelectFilter
                label="Vendor"
                allLabel="All vendors"
                group="vendor-invoices"
                selectedValues={filters.vendorIds}
                onChange={(vendorIds) => set({ vendorIds })}
                options={vendorOptions}
                className="w-full sm:w-52"
              />
              <MultiSelectFilter
                label="Kitchen"
                allLabel="All kitchens"
                group="vendor-invoices"
                selectedValues={filters.kitchenIds}
                onChange={(kitchenIds) => set({ kitchenIds })}
                options={kitchenOptions}
                className="w-full sm:w-48"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <MultiSelectFilter
                label="Invoice file"
                allLabel="Any file state"
                group="vendor-invoices"
                selectedValues={filters.fileState}
                onChange={(fileState) => set({ fileState })}
                options={FILE_OPTIONS}
                className="w-full sm:w-44"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="min-amount">
                  Amount
                </label>
                <input
                  id="min-amount"
                  type="number"
                  inputMode="decimal"
                  value={filters.minAmount}
                  onChange={(event) => set({ minAmount: event.target.value })}
                  placeholder="Min"
                  className="w-24 px-2 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-muted-foreground text-xs">to</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={filters.maxAmount}
                  onChange={(event) => set({ maxAmount: event.target.value })}
                  placeholder="Max"
                  aria-label="Maximum invoice amount"
                  className="w-24 px-2 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {isFiltered && (
                <button
                  type="button"
                  onClick={() => onFiltersChange(EMPTY_INVOICE_FILTERS)}
                  className="px-3 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors"
                >
                  Clear filters
                </button>
              )}

              {missingFiles > 0 && (
                <span className="ml-auto text-xs text-yellow-500 font-semibold">
                  {count(missingFiles)} of {count(filtered.length)} have no invoice file
                </span>
              )}
            </div>
          </div>
        }
        loading={loading}
        error={error}
        isEmpty={filtered.length === 0}
        emptyTitle={invoices.length === 0 ? 'No purchases in this period' : 'No invoices found'}
        emptyText={
          invoices.length === 0
            ? 'Nothing was bought from a vendor in the selected date range.'
            : 'No invoices match your current filters.'
        }
        resultCount={visible.length}
        totalCount={filtered.length}
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        <table className="w-full">
          <thead className={theadClass}>
            <tr>
              <SortableTh sortKey="date" sort={sort}>
                Date
              </SortableTh>
              <SortableTh sortKey="vendor" sort={sort}>
                Vendor
              </SortableTh>
              <SortableTh sortKey="invoice" sort={sort}>
                Invoice no.
              </SortableTh>
              <SortableTh sortKey="kitchen" sort={sort}>
                Kitchen
              </SortableTh>
              <SortableTh sortKey="receiver" sort={sort}>
                Received by
              </SortableTh>
              <SortableTh sortKey="items" sort={sort} align="right">
                Lines
              </SortableTh>
              <Th align="center">File</Th>
              <SortableTh sortKey="amount" sort={sort} align="right">
                Total
              </SortableTh>
              <Th />
            </tr>
          </thead>
          <tbody>
            {visible.map((invoice) => (
              <tr
                key={invoice.id}
                onClick={() => setSelected(invoice)}
                className={clickableRowClass}
              >
                <Td className="whitespace-nowrap font-medium">{formatDay(invoice.receiptDate)}</Td>
                <Td>
                  <span className={invoice.linked ? '' : 'text-yellow-500'}>
                    {invoice.vendorName}
                  </span>
                  {!invoice.linked && (
                    <div className="text-[10px] text-muted-foreground">Unlinked supplier</div>
                  )}
                </Td>
                <Td className="text-muted-foreground font-mono text-xs">
                  {invoice.invoiceNumber || '—'}
                </Td>
                <Td className="text-muted-foreground">{invoice.kitchenName}</Td>
                <Td className="text-muted-foreground">{invoice.receivedByName}</Td>
                <Td align="right" className="tabular-nums text-muted-foreground">
                  {invoice.itemCount}
                </Td>
                <Td align="center">
                  <Pill tone={invoice.hasInvoiceFile ? 'ok' : 'low'}>
                    {invoice.hasInvoiceFile ? 'Attached' : 'Missing'}
                  </Pill>
                </Td>
                <Td align="right" className="tabular-nums font-semibold whitespace-nowrap">
                  {money(invoice.amount)}
                </Td>
                <Td align="right">
                  <RowChevron />
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-background border-t border-border">
            <tr>
              {/* Every matching invoice, not just this page's worth. */}
              <Td colSpan={7} className="text-xs uppercase tracking-wide text-muted-foreground">
                Total across {count(filtered.length)} invoice{filtered.length === 1 ? '' : 's'}
              </Td>
              <Td align="right" className="tabular-nums font-bold text-accent whitespace-nowrap">
                {money(rangeTotal)}
              </Td>
              <Td />
            </tr>
          </tfoot>
        </table>
      </KitchenPanel>

      {selected && (
        <VendorInvoiceModal invoice={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

export default VendorInvoicesTab
