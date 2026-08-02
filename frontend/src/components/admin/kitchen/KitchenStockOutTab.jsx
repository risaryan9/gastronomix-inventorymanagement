// Stock Out ledger for one kitchen.
//
// A stock-out is one of four different events — an outlet allocation, internal
// consumption with a reason, a transfer to another kitchen, or a brand dispatch
// — so the ledger leads with what kind it was and where it went. Clicking a row
// opens the movement in full, with the materials it moved and its audit trail.

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
import { fetchStockOutLines } from '../../../lib/adminKitchenDetail'
import { count, formatDay, quantity } from '../../../lib/formatNumbers'

const KIND_FILTERS = [
  { value: 'all', label: 'All movements' },
  { value: 'outlet', label: 'To outlets' },
  { value: 'internal', label: 'Internal use' },
]

const SORT_ACCESSORS = {
  date: (row) => row.date,
  kind: (row) => row.kind,
  destination: (row) => row.destination,
  brand: (row) => row.dispatchBrand,
  source: (row) => (row.fromRequisition ? 'Requisition' : 'Direct'),
  actor: (row) => row.allocatedByName,
}

const StockOutDetail = ({ record, onClose }) => {
  const [lines, setLines] = useState([])
  // Mounted fresh per record, so the first render is already the loading one —
  // no need to set that flag from inside the effect.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchStockOutLines(record.id)
      .then((rows) => {
        if (!cancelled) setLines(rows)
      })
      .catch((err) => {
        console.error('Error loading stock-out items:', err)
        if (!cancelled) setError('Could not load the items for this movement.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [record.id])

  return (
    <KitchenRecordModal
      glyph="↑"
      title={`${record.kind} · ${formatDay(record.date)}`}
      subtitle={record.destination}
      headline={[
        { label: 'Destination', value: record.destination },
        { label: 'Materials moved', value: loading ? '—' : count(lines.length) },
      ]}
      fields={[
        { label: 'Date', value: formatDay(record.date) },
        { label: 'Kind', value: record.kind },
        { label: 'Destination', value: record.destination },
        { label: 'Dispatch brand', value: record.dispatchBrand || '—' },
        { label: 'Source', value: record.fromRequisition ? 'Requisition' : 'Direct' },
        { label: 'Actioned by', value: record.allocatedByName },
      ]}
      notes={record.notes}
      linesTitle="Materials moved"
      linesHint={loading ? undefined : `${lines.length} material${lines.length === 1 ? '' : 's'}`}
      linesLoading={loading}
      linesError={error}
      linesEmpty={lines.length === 0}
      linesEmptyText="No items recorded against this movement."
      auditEntityType="stock_out"
      auditEntityId={record.id}
      onClose={onClose}
    >
      <table className="w-full text-sm min-w-[28rem]">
        <thead className="bg-muted/50">
          <tr>
            <DetailTh>Material</DetailTh>
            <DetailTh align="right">Quantity</DetailTh>
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
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30">
          <tr className="border-t border-border">
            <DetailTd className="text-xs uppercase tracking-wide text-muted-foreground">
              {lines.length} item{lines.length === 1 ? '' : 's'}
            </DetailTd>
            <DetailTd align="right" className="tabular-nums font-bold text-accent whitespace-nowrap">
              {quantity(lines.reduce((sum, line) => sum + line.quantity, 0))}
            </DetailTd>
          </tr>
        </tfoot>
      </table>
    </KitchenRecordModal>
  )
}

const KitchenStockOutTab = ({ rows, loading, error }) => {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  // Newest first: a ledger is read from the most recent entry backwards.
  const sort = useTableSort('date', 'desc')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matched = rows.filter((row) => {
      if (kind === 'outlet' && row.isSelf) return false
      if (kind === 'internal' && !row.isSelf) return false
      if (!term) return true
      return (
        row.kind.toLowerCase().includes(term) ||
        row.destination.toLowerCase().includes(term) ||
        (row.dispatchBrand ?? '').toLowerCase().includes(term) ||
        (row.allocatedByName ?? '').toLowerCase().includes(term) ||
        (row.date ?? '').includes(term)
      )
    })
    return sort.sortRows(matched, SORT_ACCESSORS)
  }, [rows, search, kind, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

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
              placeholder="Search destination, kind, brand, person or date…"
              aria-label="Search stock-out records"
              className={searchInputClass}
            />
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value)
                setPage(1)
              }}
              aria-label="Filter by movement kind"
              className={selectClass}
            >
              {KIND_FILTERS.map((option) => (
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
        emptyTitle={rows.length === 0 ? 'No stock moved out' : 'No movements found'}
        emptyText={
          rows.length === 0
            ? 'Nothing left this kitchen in the selected range.'
            : 'No movements match your current filters.'
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
              <SortableTh sortKey="kind" sort={sort}>
                Kind
              </SortableTh>
              <SortableTh sortKey="destination" sort={sort}>
                Destination
              </SortableTh>
              <SortableTh sortKey="brand" sort={sort}>
                Brand
              </SortableTh>
              <SortableTh sortKey="source" sort={sort}>
                Source
              </SortableTh>
              <SortableTh sortKey="actor" sort={sort}>
                By
              </SortableTh>
              <Th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row)} className={clickableRowClass}>
                <Td className="whitespace-nowrap font-medium">{formatDay(row.date)}</Td>
                <Td>
                  {/* Internal consumption is the exception worth spotting in a
                      column that is otherwise all outlet allocations. */}
                  <Pill tone={row.isSelf ? 'accent' : 'neutral'}>{row.kind}</Pill>
                </Td>
                <Td>{row.destination}</Td>
                <Td className="text-muted-foreground">{row.dispatchBrand || '—'}</Td>
                <Td className="text-muted-foreground">
                  {row.fromRequisition ? 'Requisition' : 'Direct'}
                </Td>
                <Td className="text-muted-foreground">{row.allocatedByName}</Td>
                <Td align="right">
                  <RowChevron />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </KitchenPanel>

      {selected && <StockOutDetail record={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

export default KitchenStockOutTab
