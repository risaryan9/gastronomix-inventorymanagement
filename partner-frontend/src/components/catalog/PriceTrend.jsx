import { formatINR, formatShortDate } from '../../lib/format.js'

/*
 * What this outlet paid per unit over time, with today's price as the last
 * point. A small SVG, no chart library: it is one line on one screen.
 */
export default function PriceTrend({ history, currentPrice }) {
  const points = [...history]
    .reverse()
    .map((h) => ({ at: h.placedAt, price: h.unitPriceIncGst, label: formatShortDate(h.placedAt) }))
    .concat({ at: new Date().toISOString(), price: currentPrice, label: 'Today', current: true })

  if (points.length < 2) return null

  const W = 320, H = 110, PAD_X = 12, PAD_TOP = 14, PAD_BOTTOM = 24
  const prices = points.map((p) => p.price)
  const min = Math.min(...prices), max = Math.max(...prices)
  const span = max - min || max * 0.1 || 1
  const x = (i) => PAD_X + (i * (W - PAD_X * 2)) / (points.length - 1)
  const y = (price) => PAD_TOP + (1 - (price - (min - span * 0.15)) / (span * 1.3)) * (H - PAD_TOP - PAD_BOTTOM)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD_BOTTOM} L${x(0).toFixed(1)},${H - PAD_BOTTOM} Z`

  return (
    <figure className="rounded-xl border border-border bg-background/40 p-3">
      <figcaption className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Price per unit, what you paid</span>
        <span>{formatINR(min)} – {formatINR(max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Price trend">
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trendFill)" />
        <path d={line} fill="none" stroke="hsl(var(--accent))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={`${p.at}-${i}`}>
            <circle cx={x(i)} cy={y(p.price)} r={p.current ? 5 : 3.5} fill={p.current ? 'hsl(var(--accent))' : 'hsl(var(--card))'} stroke="hsl(var(--accent))" strokeWidth="2">
              <title>{`${p.label}: ${formatINR(p.price)}`}</title>
            </circle>
            {(i === 0 || i === points.length - 1) && (
              <text x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'} fontSize="10" fill="hsl(var(--muted-foreground))">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  )
}
