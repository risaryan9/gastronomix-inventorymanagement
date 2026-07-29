// Standing totals for the subsection.
//
// These are computed over every event, not the filtered view — a number that
// shifts as you narrow the list is no longer a reference point, so the strip
// stays put and the filters do the narrowing.

const TONE = {
  default: 'text-foreground',
  accent: 'text-accent',
  positive: 'text-emerald-300',
  negative: 'text-red-300',
  critical: 'text-red-300',
}

const AuditSummaryStrip = ({ tiles = [] }) => (
  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
    {tiles.map((tile) => (
      <div key={tile.id} className="bg-card border border-border rounded-xl px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</div>
        <div className={`mt-0.5 text-xl font-bold ${TONE[tile.tone] || TONE.default}`}>{tile.value}</div>
        {tile.sub && <div className="text-xs text-muted-foreground">{tile.sub}</div>}
      </div>
    ))}
  </div>
)

export default AuditSummaryStrip
