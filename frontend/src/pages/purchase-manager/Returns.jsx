import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSession } from '../../lib/auth'
import { lastBusinessDays } from '../../lib/businessDate'
import {
  fetchConfirmedClosings,
  buildReturnsByMaterial,
  buildClosingSheets,
} from '../../lib/checkoutReturns'
import { quantity, formatDay } from '../../lib/formatNumbers'
import { useToast } from '../../context/toastContext'
import PaginationControls from '../../components/PaginationControls'

// What the outlets sent back, for the purchase manager to record.
//
// Confirming a closing sheet does not move stock — see
// docs/decisions/0010-dispatch-and-closing-do-not-move-stock.md. This screen is
// the other half of that decision: without somewhere to read the returns, the
// figures are captured and nothing acts on them.
//
// It is read-only on purpose. The stock-in is keyed on the Stock In screen like
// any other, so there is one way to put stock on the shelf rather than two.

const RANGE_PRESETS = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
]

const SHEETS_PAGE_SIZE = 10

const Returns = () => {
  const toast = useToast()
  const [dateRange, setDateRange] = useState(() => lastBusinessDays(7))
  const [closings, setClosings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('material')
  const [search, setSearch] = useState('')
  const [sheetsPage, setSheetsPage] = useState(1)
  const [openSheet, setOpenSheet] = useState(null)

  const load = useCallback(async () => {
    const session = getSession()
    if (!session?.cloud_kitchen_id) {
      setLoading(false)
      setError('No cloud kitchen on this session.')
      return
    }

    try {
      setLoading(true)
      setError('')
      const rows = await fetchConfirmedClosings({
        cloudKitchenId: session.cloud_kitchen_id,
        ...dateRange,
      })
      setClosings(rows)
    } catch (err) {
      console.error('Error loading returns:', err)
      setError('Could not load returns. Please try again.')
      toast.error('Could not load returns', err.message)
    } finally {
      setLoading(false)
    }
  }, [dateRange, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setSheetsPage(1)
  }, [search, view, dateRange])

  const isPresetRange = (days) => {
    const preset = lastBusinessDays(days)
    return dateRange.startDate === preset.startDate && dateRange.endDate === preset.endDate
  }

  const materials = useMemo(() => buildReturnsByMaterial(closings), [closings])
  const sheets = useMemo(() => buildClosingSheets(closings), [closings])

  const filteredMaterials = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return materials
    return materials.filter((row) => `${row.name} ${row.code}`.toLowerCase().includes(term))
  }, [materials, search])

  const filteredSheets = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return sheets
    return sheets.filter((sheet) =>
      `${sheet.outletName} ${sheet.outletCode} ${sheet.supervisorName}`.toLowerCase().includes(term)
    )
  }, [sheets, search])

  const pagedSheets = useMemo(() => {
    const start = (sheetsPage - 1) * SHEETS_PAGE_SIZE
    return filteredSheets.slice(start, start + SHEETS_PAGE_SIZE)
  }, [filteredSheets, sheetsPage])

  const sheetsTotalPages = Math.ceil(filteredSheets.length / SHEETS_PAGE_SIZE)

  const totals = useMemo(
    () => ({
      returned: materials.reduce((sum, row) => sum + row.returned, 0),
      wasted: materials.reduce((sum, row) => sum + row.wasted, 0),
    }),
    [materials]
  )

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-xl font-bold text-foreground mb-2">Returns from Outlets</h2>
        <p className="text-sm text-muted-foreground mb-1">
          What outlets sent back on their confirmed closing sheets. Drafts are not shown — a
          supervisor can still change those.
        </p>
        <p className="text-sm font-semibold text-foreground mb-5">
          Confirming a closing sheet does not change stock. Record these quantities yourself on the
          Stock In screen.
        </p>

        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div>
              <label htmlFor="returns-start" className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                From
              </label>
              <input
                id="returns-start"
                type="date"
                value={dateRange.startDate}
                max={dateRange.endDate}
                onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                className="px-4 py-2 border border-border rounded-lg bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label htmlFor="returns-end" className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                To
              </label>
              <input
                id="returns-end"
                type="date"
                value={dateRange.endDate}
                min={dateRange.startDate}
                onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                className="px-4 py-2 border border-border rounded-lg bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-end gap-2">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => setDateRange(lastBusinessDays(preset.days))}
                  className={`px-3 py-2 text-sm font-semibold border rounded-lg transition-colors ${
                    isPresetRange(preset.days)
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:ml-auto text-sm text-muted-foreground">
            {loading ? (
              'Loading…'
            ) : (
              <>
                <span className="font-semibold text-foreground">{quantity(totals.returned)}</span> returned
                {totals.wasted > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-foreground">{quantity(totals.wasted)}</span> wasted
                  </>
                )}
                {' · '}
                {sheets.length} closing {sheets.length === 1 ? 'sheet' : 'sheets'}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setView('material')}
              className={`px-4 py-2 text-sm font-semibold border rounded-lg transition-colors ${
                view === 'material'
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              By Material
            </button>
            <button
              type="button"
              onClick={() => setView('sheet')}
              className={`px-4 py-2 text-sm font-semibold border rounded-lg transition-colors ${
                view === 'sheet'
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              By Closing Sheet
            </button>
          </div>
          <input
            type="text"
            placeholder={view === 'material' ? 'Search materials…' : 'Search by outlet or supervisor…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 border border-border rounded-lg bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading returns…</div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">{error}</div>
        ) : view === 'material' ? (
          filteredMaterials.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search
                ? 'No materials match that search.'
                : 'Nothing was returned or wasted in this period.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Material</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Code</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Unit</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">Dispatched</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">
                      Returned
                      <span className="block text-xs font-normal text-muted-foreground">record as stock in</span>
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">Wasted</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">Outlets</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.map((row) => (
                    <tr key={row.materialId} className="border-b border-border">
                      <td className="py-3 px-4 text-foreground font-medium">{row.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{row.code || '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground">{row.unit || '—'}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{quantity(row.dispatched)}</td>
                      <td className="py-3 px-4 text-right text-accent font-semibold">{quantity(row.returned)}</td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {row.wasted > 0 ? quantity(row.wasted) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{row.outletCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredSheets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? 'No closing sheets match that search.' : 'No confirmed closing sheets in this period.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Outlet</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Supervisor</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">Returned</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">Wasted</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSheets.map((sheet) => (
                    <tr
                      key={sheet.id}
                      onClick={() => setOpenSheet(sheet)}
                      className="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 text-foreground font-medium">{formatDay(sheet.planDate)}</td>
                      <td className="py-3 px-4 text-foreground">{sheet.outletName}</td>
                      <td className="py-3 px-4 text-muted-foreground">{sheet.supervisorName || '—'}</td>
                      <td className="py-3 px-4 text-right text-accent font-semibold">{quantity(sheet.totalReturned)}</td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {sheet.totalWasted > 0 ? quantity(sheet.totalWasted) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{sheet.lines.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sheetsTotalPages > 1 && (
              <div className="mt-4">
                <PaginationControls
                  currentPage={sheetsPage}
                  totalPages={sheetsTotalPages}
                  onPageChange={setSheetsPage}
                />
              </div>
            )}
          </>
        )}
      </div>

      {openSheet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-border flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-foreground">{openSheet.outletName}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatDay(openSheet.planDate)}
                  {openSheet.supervisorName ? ` · ${openSheet.supervisorName}` : ''}
                </p>
              </div>
              <button
                onClick={() => setOpenSheet(null)}
                className="text-muted-foreground hover:text-foreground transition-colors text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {openSheet.lines.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No lines on this sheet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-semibold text-foreground">Material</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground">Unit</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground">Dispatched</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground">Returned</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground">Wasted</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground">Wastage reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openSheet.lines.map((line) => (
                        <tr key={line.materialId} className="border-b border-border">
                          <td className="py-3 px-4 text-foreground font-medium">{line.name}</td>
                          <td className="py-3 px-4 text-muted-foreground">{line.unit || '—'}</td>
                          <td className="py-3 px-4 text-right text-muted-foreground">{quantity(line.dispatched)}</td>
                          <td className="py-3 px-4 text-right text-accent font-semibold">{quantity(line.returned)}</td>
                          <td className="py-3 px-4 text-right text-foreground">
                            {line.wasted > 0 ? quantity(line.wasted) : '—'}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">{line.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Returns
