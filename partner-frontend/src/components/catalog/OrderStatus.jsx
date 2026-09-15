import { ORDER_STATUS, ORDER_STEPS } from '../../lib/catalog.js'

const TONE = {
  info: 'border-accent/40 bg-accent/10 text-accent-text',
  good: 'border-success/40 bg-success/10 text-success',
  warn: 'border-accent/40 bg-accent/10 text-accent-text',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
}

export function StatusBadge({ status }) {
  const meta = ORDER_STATUS[status] || { label: status, tone: 'info' }
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[meta.tone]}`}>
      {meta.label}
    </span>
  )
}

// Placed → Accepted → Packed → Ready to ship → Shipped → Delivered, as a bar.
export function OrderProgress({ status }) {
  const reached = ORDER_STEPS.indexOf(status)
  return (
    <div className="flex gap-1" aria-label={`Progress: ${ORDER_STATUS[status]?.label || status}`}>
      {ORDER_STEPS.map((step, i) => (
        <span
          key={step}
          title={ORDER_STATUS[step].label}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= reached ? 'bg-accent' : 'bg-muted'}`}
        />
      ))}
    </div>
  )
}
