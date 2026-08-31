// Every requisition an outlet has ever sent, in a right-hand drawer.
//
// The packing modal shows one number per material — what went out last time.
// That number is the tail of a history the purchase manager cannot otherwise
// see without leaving the modal and losing the packing in progress, so the
// history opens over it instead.

import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { supabase } from '../../lib/supabase'
import PaginationControls from '../PaginationControls'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'

const PER_PAGE = 10

const formatQty = (value) => (parseFloat(value) || 0).toFixed(2)

const OutletRequestHistoryDrawer = ({ outlet, highlightMaterial = null, onClose }) => {
  const [requests, setRequests] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // A page at a time off the server: an outlet that has requested daily for a
  // year has more rows than the modal behind this one ever loads.
  const outletId = outlet?.id
  const fetchPage = useCallback(async (targetPage) => {
    if (!outletId) return
    setLoading(true)
    setError('')
    try {
      const from = (targetPage - 1) * PER_PAGE
      const { data, error: fetchError, count } = await supabase
        .from('allocation_requests')
        .select(
          `
          id,
          request_date,
          created_at,
          is_packed,
          notes,
          supervisor_name,
          users:requested_by (full_name),
          allocation_request_items (
            id,
            quantity,
            raw_materials:raw_material_id (id, name, code, unit)
          )
        `,
          { count: 'exact' }
        )
        .eq('outlet_id', outletId)
        .order('request_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + PER_PAGE - 1)

      if (fetchError) throw fetchError
      setRequests(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching outlet request history:', err)
      setError('Failed to load the request history for this outlet.')
      setRequests([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [outletId])

  useEffect(() => {
    setExpandedId(null)
    fetchPage(page)
  }, [fetchPage, page])

  useEffect(() => {
    setPage(1)
  }, [outletId])

  if (!outlet) return null

  const totalPages = Math.ceil(totalCount / PER_PAGE) || 1

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Allocation request history for ${outlet.name || 'outlet'}`}
        className="relative w-full max-w-xl bg-card border-l-2 border-border h-full flex flex-col shadow-2xl"
      >
        <header className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-foreground">Requisition History</h2>
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {outlet.name || 'N/A'}
                {outlet.code && <span className="font-mono"> • {outlet.code}</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close request history"
              className="shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {loading && !requests.length
                ? 'Loading…'
                : `${totalCount} request${totalCount === 1 ? '' : 's'} in total`}
            </span>
            {highlightMaterial && (
              <span className="text-accent font-semibold">
                Quantities shown for {highlightMaterial.name}
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="border-2 border-destructive/60 bg-destructive/10 rounded-lg p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {loading && (
            <p className="text-sm text-muted-foreground text-center py-6">Loading requests…</p>
          )}

          {!loading && !error && requests.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              This outlet has not sent any allocation requests yet.
            </p>
          )}

          {!loading &&
            requests.map((request) => {
              const items = request.allocation_request_items || []
              const highlightItem = highlightMaterial
                ? items.find((i) => i.raw_materials?.id === highlightMaterial.id)
                : null
              const isExpanded = expandedId === request.id

              return (
                <div
                  key={request.id}
                  className={`border rounded-lg transition-colors ${
                    request.is_packed
                      ? 'border-border bg-accent/5'
                      : 'border-border bg-background/30'
                  }`}
                >
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">
                          {new Date(request.request_date).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {request.supervisor_name || request.users?.full_name || 'N/A'}
                          {' • '}
                          {items.length} item{items.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded ${
                          request.is_packed
                            ? 'bg-accent/15 text-accent'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {request.is_packed ? 'Packed' : 'Pending'}
                      </span>
                    </div>

                    {highlightMaterial && (
                      <p className="text-xs mt-2">
                        {highlightItem ? (
                          <span className="text-foreground">
                            <span className="text-muted-foreground">
                              {highlightMaterial.name}:{' '}
                            </span>
                            <span className="font-semibold">
                              {formatQty(highlightItem.quantity)}{' '}
                              {highlightItem.raw_materials?.unit || highlightMaterial.unit || ''}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            {highlightMaterial.name} not requested
                          </span>
                        )}
                      </p>
                    )}

                    {request.notes && (
                      <p className="text-xs text-muted-foreground mt-2 italic">{request.notes}</p>
                    )}

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : request.id)}
                      className="mt-2 text-xs font-semibold text-accent hover:underline"
                    >
                      {isExpanded ? 'Hide items' : 'View all items'}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border px-3 py-2">
                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-1">No items on this request.</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {items.map((item) => (
                            <li
                              key={item.id}
                              className={`flex items-center justify-between gap-3 py-1.5 text-xs ${
                                highlightMaterial &&
                                item.raw_materials?.id === highlightMaterial.id
                                  ? 'text-accent font-semibold'
                                  : 'text-foreground'
                              }`}
                            >
                              <span className="min-w-0 truncate">
                                {item.raw_materials?.name || 'N/A'}
                                {item.raw_materials?.code && (
                                  <span className="text-muted-foreground font-mono">
                                    {' '}
                                    {item.raw_materials.code}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0">
                                {formatQty(item.quantity)} {item.raw_materials?.unit || ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
        </div>

        {totalPages > 1 && (
          <footer className="border-t border-border p-3">
            <PaginationControls
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              variant="compact"
            />
          </footer>
        )}
      </aside>
    </div>,
    document.body
  )
}

export default OutletRequestHistoryDrawer
