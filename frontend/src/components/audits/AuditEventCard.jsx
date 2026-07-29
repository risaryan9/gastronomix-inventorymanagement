// One audit event, as a compact row.
//
// Two lines: what happened and to what, then who did it and where. The single
// number worth seeing at a glance — the receipt total, the quantity delta, the
// count of changed fields — sits on the right. Everything else is in the drawer.

import { actorName, formatIstTime, formatRelative, roleLabel } from '../../lib/auditEvents'

const PRIMARY_TONE = {
  accent: 'text-accent',
  positive: 'text-emerald-300',
  negative: 'text-red-300',
  muted: 'text-muted-foreground',
}

const Dot = () => (
  <span className="text-muted-foreground/50" aria-hidden>
    ·
  </span>
)

const AuditEventCard = ({ event, description, onSelect, isSelected }) => (
  <button
    type="button"
    onClick={() => onSelect(event)}
    className={`w-full text-left bg-card border rounded-lg px-4 py-3 transition-colors hover:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent ${
      isSelected ? 'border-accent' : 'border-border'
    } ${event.severity === 'critical' ? 'border-l-[3px] border-l-destructive' : ''}`}
  >
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold ${
          event.severity === 'critical' ? 'bg-destructive/15 text-red-300' : 'bg-accent/10 text-accent'
        }`}
      >
        {description.glyph}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">{description.title}</span>
          {description.contextLine && (
            <>
              <Dot />
              <span className="text-sm text-muted-foreground truncate">{description.contextLine}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground mt-0.5">
          <span className="truncate">{actorName(event)}</span>
          <Dot />
          <span className="truncate">{roleLabel(event.actor_role)}</span>
          <Dot />
          <span className="truncate">
            {event.category === 'catalog' ? 'Global catalog' : description.kitchen || 'No kitchen'}
          </span>
          {description.detail && (
            <>
              <Dot />
              <span className="truncate">{description.detail}</span>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        {description.primary && (
          <div className={`text-sm font-bold ${PRIMARY_TONE[description.primary.tone] || 'text-foreground'}`}>
            {description.primary.value}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground whitespace-nowrap">
          {formatIstTime(event.created_at)} · {formatRelative(event.created_at)}
        </div>
      </div>
    </div>
  </button>
)

export default AuditEventCard
