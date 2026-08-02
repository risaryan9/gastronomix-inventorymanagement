// Stock In ledger for one kitchen: what was received, from whom, at what cost.
// Clicking a receipt opens its full detail — the batches it created, and the
// audit trail tied to it.

import { useEffect, useMemo, useState } from 'react'
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
  selectClass,
  theadClass,
} from './KitchenPanel'
import { useTableSort } from '../../../hooks/useTableSort'
import KitchenRecordModal, { DetailTd, DetailTh } from './KitchenRecordModal'
import { fetchStockInLines } from '../../../lib/adminKitchenDetail'
import { count, formatDay, money, quantity } from '../../../lib/formatNumbers'

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'kitchen', label: 'Kitchen' },
]

const TYPE_LABEL = { purchase: 'Purchase', kitchen: 'Kitchen' }

const SORT_ACCESSORS = {
  receipt_date: (row) => row.receipt_date,
  supplier: (row) => row.supplier_name,
  invoice: (row) => row.invoice_number,
  type: (row) => row.stock_in_type,
  receiver: (row) => row.receivedByName,
  total: (row) => row.totalCost,
}

const StockInDetail = ({ record, onClose }) => {
  const [lines, setLines] = useState([])
  // Mounted fresh per record, so the first render is already the loading one —
  // no need to set that flag from inside the effect.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchStockInLines(record.id)
      .then((rows) => {
        if (!cancelled) setLines(rows)
      })
      .catch((err) => {
        console.error('Error loading stock-in items:', err)
        if (!cancelled) setError('Could not load the items for this receipt.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [record.id])

  const itemsTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)

  return (
    <KitchenRecordModal
      glyph="↓"
      title={`Stock In · ${formatDay(record.receipt_date)}`}
      subtitle={record.supplier_name || 'No supplier recorded'}
      headline={[
        { label: 'Total cost', value: money(record.totalCost) },
        { label: 'Items', value: loading ? '—' : count(lines.length) },
      ]}
      fields={[
        { label: 'Received on', value: formatDay(record.receipt_date) },
        { label: 'Supplier', value: record.supplier_name || '—' },
        { label: 'Invoice', value: record.invoice_number || '—' },
        { label: 'Type', value: <span className="capitalize">{record.stock_in_type || '—'}</span> },
        { label: 'Received by', value: record.receivedByName },
      ]}
      notes={record.notes}
      linesTitle="Items received"
      linesHint={loading ? undefined : `${lines.length} material${lines.length === 1 ? '' : 's'}`}
      linesLoading={loading}
      linesError={error}
      linesEmpty={lines.length === 0}
      linesEmptyText="No items recorded against this receipt."
      auditEntityType="stock_in"
      auditEntityId={record.id}
      onClose={onClose}
    >
      <table className="w-full text-sm min-w-[38rem]">
        <thead className="bg-muted/50">
          <tr>
            <DetailTh>Material</DetailTh>
            <DetailTh align="right">Received</DetailTh>
            <DetailTh align="right">Still unused</DetailTh>
            <DetailTh align="right">Unit cost</DetailTh>
            <DetailTh align="right">GST</DetailTh>
            <DetailTh align="right">Line total</DetailTh>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-border">
              <DetailTd>
                <div className="font-medium text-foreground">{line.name}</div>
                {line.code && <div className="text-xs text-muted-foreground">{line.code}</div>}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-foreground whitespace-nowrap">
                {quantity(line.quantity)}
                <span className="text-muted-foreground"> {line.unit}</span>
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-muted-foreground">
                {quantity(line.remaining)}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-foreground whitespace-nowrap">
                {money(line.unitCost)}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-muted-foreground">
                {line.gstPercent ? `${line.gstPercent}%` : '—'}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums font-semibold text-foreground whitespace-nowrap">
                {money(line.lineTotal)}
              </DetailTd>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30">
          <tr className="border-t border-border">
            <DetailTd colSpan={5} className="text-xs uppercase tracking-wide text-muted-foreground">
              {lines.length} item{lines.length === 1 ? '' : 's'}
            </DetailTd>
            <DetailTd align="right" className="tabular-nums font-bold text-accent whitespace-nowrap">
              {money(itemsTotal)}
            </DetailTd>
          </tr>
        </tfoot>
      </table>
    </KitchenRecordModal>
  )
}

const KitchenStockInTab = ({ rows, loading, error }) => {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  // Newest first: a ledger is read from the most recent entry backwards.
  const sort = useTableSort('receipt_date', 'desc')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matched = rows.filter((row) => {
      if (type !== 'all' && row.stock_in_type !== type) return false
      if (!term) return true
      return (
        (row.supplier_name ?? '').toLowerCase().includes(term) ||
        (row.invoice_number ?? '').toLowerCase().includes(term) ||
        (row.receivedByName ?? '').toLowerCase().includes(term) ||
        (row.receipt_date ?? '').includes(term)
      )
    })
    return sort.sortRows(matched, SORT_ACCESSORS)
  }, [rows, search, type, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const rangeTotal = filtered.reduce((sum, row) => sum + row.totalCost, 0)

  return (
    <>
      <KitchenPanel
        toolbar={
          <>
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Search supplier, invoice, receiver or date…"
              aria-label="Search stock-in records"
              className={searchInputClass}
            />
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value)
                setPage(1)
              }}
              aria-label="Filter by stock-in type"
              className={selectClass}
            >
              {TYPE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        }
        loading={loading}
        error={error}
        isEmpty={filtered.length === 0}
        emptyTitle={rows.length === 0 ? 'No stock received' : 'No receipts found'}
        emptyText={
          rows.length === 0
            ? 'Nothing was received by this kitchen in the selected range.'
            : 'No receipts match your current filters.'
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
              <SortableTh sortKey="receipt_date" sort={sort}>
                Received
              </SortableTh>
              <SortableTh sortKey="supplier" sort={sort}>
                Supplier
              </SortableTh>
              <SortableTh sortKey="invoice" sort={sort}>
                Invoice
              </SortableTh>
              <SortableTh sortKey="type" sort={sort}>
                Type
              </SortableTh>
              <SortableTh sortKey="receiver" sort={sort}>
                Received by
              </SortableTh>
              <SortableTh sortKey="total" sort={sort} align="right">
                Total cost
              </SortableTh>
              <Th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row)} className={clickableRowClass}>
                <Td className="whitespace-nowrap font-medium">{formatDay(row.receipt_date)}</Td>
                <Td>{row.supplier_name || <span className="text-muted-foreground">—</span>}</Td>
                <Td className="text-muted-foreground">{row.invoice_number || '—'}</Td>
                <Td>
                  <Pill tone={row.stock_in_type === 'kitchen' ? 'accent' : 'neutral'}>
                    {TYPE_LABEL[row.stock_in_type] ?? '—'}
                  </Pill>
                </Td>
                <Td className="text-muted-foreground">{row.receivedByName}</Td>
                <Td align="right" className="tabular-nums font-semibold whitespace-nowrap">
                  {money(row.totalCost)}
                </Td>
                <Td align="right">
                  <RowChevron />
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-background border-t border-border">
            <tr>
              {/* Every matching receipt, not just the rows on this page. */}
              <Td colSpan={5} className="text-xs uppercase tracking-wide text-muted-foreground">
                Total across {filtered.length} receipt{filtered.length === 1 ? '' : 's'}
              </Td>
              <Td align="right" className="tabular-nums font-bold text-accent whitespace-nowrap">
                {money(rangeTotal)}
              </Td>
              <Td />
            </tr>
          </tfoot>
        </table>
      </KitchenPanel>

      {selected && <StockInDetail record={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

export default KitchenStockInTab
