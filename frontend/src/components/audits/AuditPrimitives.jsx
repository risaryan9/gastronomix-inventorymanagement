// Shared building blocks for the admin audit subsections.
//
// Deliberately dumb: everything here takes plain data (produced by
// lib/auditEvents.js) and renders it. Action-specific knowledge lives in that
// module, so the remaining subsections reuse these unchanged.

import { displayValue, formatCurrency, formatQty } from '../../lib/auditEvents'

/* ---------------------------------- pills --------------------------------- */

const SEVERITY_STYLE = {
  critical: 'bg-destructive/20 text-red-300 border-destructive/50',
  review: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
}

export const SeverityPill = ({ severity, className = '' }) => (
  <span
    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
      SEVERITY_STYLE[severity] || 'bg-muted text-muted-foreground border-border'
    } ${className}`}
  >
    {severity || 'unknown'}
  </span>
)

export const DemoBadge = ({ className = '' }) => (
  <span
    title="Placeholder entry rendered from the frontend — not a real audit event"
    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border border-dashed border-accent/60 bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider ${className}`}
  >
    Demo
  </span>
)

/* --------------------------------- values --------------------------------- */

export const KeyValueList = ({ rows = [] }) => (
  <dl className="divide-y divide-border/60">
    {rows.map((row) => (
      <div key={row.label} className="py-2 flex items-start gap-4">
        <dt className="w-40 shrink-0 text-xs text-muted-foreground pt-0.5">{row.label}</dt>
        <dd className="flex-1 min-w-0 text-sm text-foreground break-words">{row.value}</dd>
      </div>
    ))}
  </dl>
)

/* --------------------------------- tables --------------------------------- */

export const ItemsTable = ({ rows = [], showCost = true }) => {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No line items recorded on this event.</p>
  }

  const totalQty = rows.reduce((total, row) => total + (Number(row.quantity) || 0), 0)
  const totalValue = rows.reduce((total, row) => total + (Number(row.lineTotal) || 0), 0)
  const hasGst = rows.some((row) => row.gst !== null && row.gst !== undefined)

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[34rem]">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Material</th>
            <th className="text-right py-2 px-3 font-semibold text-foreground">Qty</th>
            {showCost && <th className="text-right py-2 px-3 font-semibold text-foreground">Unit cost</th>}
            {showCost && hasGst && <th className="text-right py-2 px-3 font-semibold text-foreground">GST</th>}
            {showCost && <th className="text-right py-2 px-3 font-semibold text-foreground">Line total</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.material.id || index}`} className="border-t border-border">
              <td className="py-2 px-3">
                <div className="font-medium text-foreground">{row.material.name}</div>
                <div className="text-xs text-muted-foreground">{row.material.code}</div>
              </td>
              <td className="py-2 px-3 text-right text-foreground whitespace-nowrap">
                {formatQty(row.quantity)}
                {row.material.unit ? <span className="text-muted-foreground"> {row.material.unit}</span> : null}
              </td>
              {showCost && (
                <td className="py-2 px-3 text-right text-foreground whitespace-nowrap">
                  {row.unitCost === null ? '—' : formatCurrency(row.unitCost)}
                </td>
              )}
              {showCost && hasGst && (
                <td className="py-2 px-3 text-right text-muted-foreground whitespace-nowrap">
                  {row.gst === null || row.gst === undefined ? '—' : `${formatQty(row.gst)}%`}
                </td>
              )}
              {showCost && (
                <td className="py-2 px-3 text-right font-semibold text-foreground whitespace-nowrap">
                  {row.lineTotal === null ? '—' : formatCurrency(row.lineTotal)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30">
          <tr className="border-t border-border">
            <td className="py-2 px-3 text-xs uppercase tracking-wide text-muted-foreground">
              {rows.length} item{rows.length === 1 ? '' : 's'}
            </td>
            <td className="py-2 px-3 text-right text-foreground font-semibold whitespace-nowrap">
              {formatQty(totalQty)}
            </td>
            {showCost && <td className="py-2 px-3" />}
            {showCost && hasGst && <td className="py-2 px-3" />}
            {showCost && (
              <td className="py-2 px-3 text-right font-bold text-accent whitespace-nowrap">
                {formatCurrency(totalValue)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export const DiffTable = ({ rows = [] }) => {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No field-level changes recorded.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[30rem]">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Field</th>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Before</th>
            <th className="text-left py-2 px-3 font-semibold text-foreground">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`border-t border-border ${row.changed ? 'bg-accent/[0.06]' : ''}`}>
              <td className="py-2 px-3 text-foreground font-medium whitespace-nowrap">{row.label}</td>
              <td
                className={`py-2 px-3 break-words ${
                  row.changed ? 'text-muted-foreground line-through' : 'text-muted-foreground'
                }`}
              >
                {row.from === undefined ? '—' : displayValue(row.from)}
              </td>
              <td
                className={`py-2 px-3 break-words ${
                  row.changed ? 'text-foreground font-semibold' : 'text-muted-foreground'
                }`}
              >
                {row.to === undefined ? '—' : displayValue(row.to)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------- utilities ------------------------------- */

export const SectionTitle = ({ children, hint }) => (
  <div className="flex items-baseline justify-between gap-3 mb-2">
    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{children}</h4>
    {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
  </div>
)
