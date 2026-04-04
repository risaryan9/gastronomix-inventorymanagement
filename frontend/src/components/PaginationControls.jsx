import { getVisiblePaginationItems } from '../utils/pagination'

/**
 * Previous / windowed page numbers (with ellipsis) / Next.
 * @param {'default' | 'supervisor'} variant — supervisor uses larger touch targets on small screens
 */
export default function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
  variant = 'default'
}) {
  if (totalPages <= 1) return null

  const items = getVisiblePaginationItems(currentPage, totalPages, 1)

  const navBtn =
    variant === 'supervisor'
      ? 'px-4 py-2.5 lg:px-3 lg:py-2 bg-input border border-border rounded-lg text-foreground hover:bg-accent/10 active:bg-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm touch-manipulation'
      : 'px-3 py-2 bg-input border border-border rounded-lg text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold'

  const pageBtnBase =
    variant === 'supervisor'
      ? 'px-3 py-2 rounded-lg font-semibold transition-all text-sm touch-manipulation min-w-[2.25rem]'
      : 'px-3 py-2 rounded-lg font-semibold transition-all min-w-[2.25rem]'

  const pageBtnActive = 'bg-accent text-background'
  const pageBtnIdle =
    variant === 'supervisor'
      ? 'bg-input border border-border text-foreground hover:bg-accent/10 active:bg-accent/20'
      : 'bg-input border border-border text-foreground hover:bg-accent/10'

  return (
    <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        className={navBtn}
      >
        Previous
      </button>
      <div className="flex flex-wrap items-center justify-center gap-1 min-w-0">
        {items.map((item, idx) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${idx}`}
              className="px-1.5 py-2 text-muted-foreground font-semibold select-none"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              type="button"
              key={item}
              onClick={() => onPageChange(item)}
              className={`${pageBtnBase} ${
                currentPage === item ? pageBtnActive : pageBtnIdle
              }`}
            >
              {item}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        className={navBtn}
      >
        Next
      </button>
    </div>
  )
}
