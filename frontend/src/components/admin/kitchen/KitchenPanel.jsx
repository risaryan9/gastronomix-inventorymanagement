// Shared chrome for the Kitchen Wise Overview tabs.
//
// Structure and styling follow the purchase manager's inventory table, which is
// this app's reference data table: a border-2 card with the toolbar, the table
// and the pagination as three banded regions, a header on the page background
// rather than a tinted strip, and rows that light up in the brand accent on
// hover so the clickable row is obvious before you click it.

import PaginationControls from '../../PaginationControls'

export const PAGE_SIZE = 15

export const KitchenPanel = ({
  toolbar,
  loading,
  error,
  isEmpty,
  emptyTitle = 'Nothing to show',
  emptyText,
  resultCount,
  totalCount,
  page,
  totalPages,
  onPageChange,
  children,
}) => (
  <div className="bg-card border-2 border-border rounded-xl overflow-hidden">
    {toolbar && (
      <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
        {toolbar}
      </div>
    )}

    {loading ? (
      <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
    ) : error ? (
      <p className="py-16 text-center text-sm text-destructive">{error}</p>
    ) : isEmpty ? (
      <div className="text-center py-16 px-4">
        <h3 className="text-xl font-bold text-foreground mb-2">{emptyTitle}</h3>
        <p className="text-muted-foreground">{emptyText}</p>
      </div>
    ) : (
      <>
        <div className="overflow-x-auto">{children}</div>
        <div className="border-t border-border px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{resultCount}</span> of{' '}
            <span className="font-semibold text-foreground">{totalCount}</span>
          </p>
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            variant="compact"
          />
        </div>
      </>
    )}
  </div>
)

export const searchInputClass =
  'flex-1 min-w-0 px-3 py-2 border border-border rounded-lg bg-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent'

export const selectClass =
  'px-3 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent'

export const theadClass = 'bg-background border-b border-border'

// Rows are clickable — they open the record modal — so the accent wash on hover
// is doing real work, not decoration.
export const clickableRowClass =
  'border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer transition-colors'

// Spelled out rather than interpolated — Tailwind's JIT only emits classes it
// can find literally in the source, so `text-${align}` would produce nothing.
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

export const Th = ({ children, align = 'left', ...rest }) => (
  <th
    scope="col"
    className={`px-4 py-3 ${ALIGN[align]} text-sm font-bold text-foreground whitespace-nowrap`}
    {...rest}
  >
    {children}
  </th>
)

/**
 * A column header that sorts. The arrow only appears on the active column, in
 * the accent, so the sorted column is findable at a glance.
 */
export const SortableTh = ({ children, sortKey, sort, align = 'left' }) => {
  const active = sort.sortBy === sortKey

  return (
    <Th align={align} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className="inline-flex items-center gap-1 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent rounded transition-colors"
      >
        {children}
        {active && (
          <span className="text-accent" aria-hidden="true">
            {sort.direction === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>
    </Th>
  )
}

export const Td = ({ children, align = 'left', className = '', ...rest }) => (
  <td className={`px-4 py-3 ${ALIGN[align]} text-sm text-foreground ${className}`} {...rest}>
    {children}
  </td>
)

/**
 * Stock state as a pill, matching the purchase manager's inventory table so the
 * same condition looks the same to the same person in both places.
 */
const PILL_STYLE = {
  out: 'bg-destructive/20 text-destructive',
  low: 'bg-yellow-500/20 text-yellow-500',
  ok: 'bg-green-500/20 text-green-500',
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-accent/15 text-accent',
}

export const Pill = ({ tone = 'neutral', children }) => (
  <span
    className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${
      PILL_STYLE[tone] ?? PILL_STYLE.neutral
    }`}
  >
    {children}
  </span>
)

// The trailing hint that a row opens something.
export const RowChevron = () => (
  <span aria-hidden="true" className="text-muted-foreground">
    ›
  </span>
)
