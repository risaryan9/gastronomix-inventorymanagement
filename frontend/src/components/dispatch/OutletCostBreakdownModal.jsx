import { formatRupee } from '../../lib/dispatchPlanOutletCost'

/**
 * Stacked above another modal (dispatch draft). Close only affects this overlay.
 */
const OutletCostBreakdownModal = ({
  open,
  onClose,
  outletCode,
  outletName,
  lines,
  total
}) => {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outlet-cost-breakdown-title"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h3
              id="outlet-cost-breakdown-title"
              className="text-sm lg:text-base font-semibold text-foreground"
            >
              Finished goods cost · {outletCode}
            </h3>
            {outletName ? (
              <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5 truncate">
                {outletName}
              </p>
            ) : null}
            <p className="text-[10px] lg:text-[11px] text-muted-foreground mt-1">
              Latest batch unit cost × quantity for finished materials only (recipe ingredients excluded).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label="Close cost breakdown"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No finished-material quantities for this outlet, or all unit costs are missing (shown as ₹0).
            </p>
          ) : (
            <table className="w-full border-collapse text-xs lg:text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Material</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Qty</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Unit cost</th>
                  <th className="py-2 pl-2 font-medium text-right whitespace-nowrap">Line</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((row, idx) => (
                  <tr key={`${row.materialId}-${idx}`} className="border-b border-border/60">
                    <td className="py-2 pr-2 align-top">
                      <div className="font-medium text-foreground truncate">{row.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">{row.code}</div>
                    </td>
                    <td className="py-2 px-2 align-top text-right font-mono whitespace-nowrap">
                      {row.qty.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                    </td>
                    <td className="py-2 px-2 align-top text-right font-mono whitespace-nowrap">
                      {formatRupee(row.unitCost)}
                    </td>
                    <td className="py-2 pl-2 align-top text-right font-mono whitespace-nowrap font-semibold text-foreground">
                      {formatRupee(row.lineCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 flex items-center justify-between bg-muted/30 flex-shrink-0">
          <span className="text-xs lg:text-sm font-semibold text-foreground">Total</span>
          <span className="text-sm lg:text-base font-bold font-mono text-foreground">{formatRupee(total)}</span>
        </div>
      </div>
    </div>
  )
}

export default OutletCostBreakdownModal
