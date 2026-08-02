// The outlets one cloud kitchen serves.
//
// Deliberately a plain list for now: name, brand, status, and how much each
// outlet actually drew over the range, so the table earns its place before the
// detail view is specified. Rows are not clickable yet — there is nothing
// decided to open.

import { useMemo, useState } from 'react'
import {
  KitchenPanel,
  PAGE_SIZE,
  Pill,
  SortableTh,
  Td,
  searchInputClass,
  selectClass,
  theadClass,
} from './KitchenPanel'
import { useTableSort } from '../../../hooks/useTableSort'
import { count, formatDay } from '../../../lib/formatNumbers'

const STATUS_FILTERS = [
  { value: 'all', label: 'All outlets' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Deactivated' },
]

const SORT_ACCESSORS = {
  name: (row) => row.name,
  code: (row) => row.code,
  brand: (row) => row.brand,
  allocations: (row) => row.allocations,
  lastAllocation: (row) => row.lastAllocation,
  pending: (row) => row.pendingRequisitions,
  status: (row) => (row.isActive ? 0 : 1),
}

const KitchenOutletsTab = ({ rows, loading, error, rangeLabel }) => {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const sort = useTableSort('name')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matched = rows.filter((row) => {
      if (status === 'active' && !row.isActive) return false
      if (status === 'inactive' && row.isActive) return false
      if (!term) return true
      return (
        row.name.toLowerCase().includes(term) ||
        row.code.toLowerCase().includes(term) ||
        row.brand.toLowerCase().includes(term)
      )
    })
    return sort.sortRows(matched, SORT_ACCESSORS)
  }, [rows, search, status, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const totalAllocations = filtered.reduce((sum, row) => sum + row.allocations, 0)

  return (
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
            placeholder="Search outlet, code or brand…"
            aria-label="Search outlets"
            className={searchInputClass}
          />
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
            aria-label="Filter by outlet status"
            className={selectClass}
          >
            {STATUS_FILTERS.map((option) => (
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
      emptyTitle={rows.length === 0 ? 'No outlets' : 'No outlets found'}
      emptyText={
        rows.length === 0
          ? 'This cloud kitchen does not serve any outlets yet.'
          : 'No outlets match your current filters.'
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
            <SortableTh sortKey="name" sort={sort}>
              Outlet
            </SortableTh>
            <SortableTh sortKey="code" sort={sort}>
              Code
            </SortableTh>
            <SortableTh sortKey="brand" sort={sort}>
              Brand
            </SortableTh>
            <SortableTh sortKey="allocations" sort={sort} align="right">
              Allocations
            </SortableTh>
            <SortableTh sortKey="lastAllocation" sort={sort}>
              Last allocation
            </SortableTh>
            <SortableTh sortKey="pending" sort={sort} align="right">
              Pending
            </SortableTh>
            <SortableTh sortKey="status" sort={sort}>
              Status
            </SortableTh>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-b-0">
              <Td className="font-medium">{row.name}</Td>
              <Td className="text-muted-foreground">{row.code || '—'}</Td>
              <Td className="text-muted-foreground">{row.brand}</Td>
              <Td align="right" className="tabular-nums font-semibold">
                {count(row.allocations)}
              </Td>
              <Td className="text-muted-foreground whitespace-nowrap">
                {row.lastAllocation ? formatDay(row.lastAllocation) : '—'}
              </Td>
              <Td align="right" className="tabular-nums">
                {row.pendingRequisitions > 0 ? (
                  <Pill tone="accent">{count(row.pendingRequisitions)}</Pill>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </Td>
              <Td>
                <Pill tone={row.isActive ? 'ok' : 'neutral'}>
                  {row.isActive ? 'Active' : 'Deactivated'}
                </Pill>
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-background border-t border-border">
          <tr>
            <Td colSpan={3} className="text-xs uppercase tracking-wide text-muted-foreground">
              {filtered.length} outlet{filtered.length === 1 ? '' : 's'}
              {rangeLabel ? ` · ${rangeLabel}` : ''}
            </Td>
            <Td align="right" className="tabular-nums font-bold text-accent">
              {count(totalAllocations)}
            </Td>
            <Td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </KitchenPanel>
  )
}

export default KitchenOutletsTab
