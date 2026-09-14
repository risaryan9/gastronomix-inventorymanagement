import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { unitLabel } from '../../lib/format.js'

/*
 * − [ 2.5 kg ] +
 *
 * Steps by the item's order step (0.5 kg, 1 L, a pack of 50). The number can
 * also be typed; it is kept to the step's multiple when the field loses focus,
 * so a cart never holds 1.37 kg of something sold in half-kilos.
 */
const snap = (value, step) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(Math.round(n / step) * step * 1000) / 1000
}

export default function QuantityStepper({ value, step, unit, onChange, size = 'md', disabled = false, label }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = (raw) => {
    const next = snap(raw, step)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  const big = size === 'lg'
  const button = `inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:border-accent hover:text-accent-text active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${big ? 'h-11 w-11' : 'h-9 w-9'}`

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label || 'Quantity'}>
      <button type="button" className={button} onClick={() => commit(value - step)} disabled={disabled || value <= 0} aria-label="Decrease">
        <Icon name="minus" />
      </button>
      <label className={`relative flex items-center rounded-lg border border-border bg-input focus-within:ring-2 focus-within:ring-ring ${big ? 'h-11' : 'h-9'}`}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={`w-14 bg-transparent pl-2 text-right font-semibold text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${big ? 'text-base' : 'text-sm'}`}
          aria-label={`Quantity in ${unitLabel(unit)}`}
        />
        <span className={`pl-1 pr-2 text-muted-foreground ${big ? 'text-sm' : 'text-xs'}`}>{unitLabel(unit)}</span>
      </label>
      <button type="button" className={button} onClick={() => commit(value + step)} disabled={disabled} aria-label="Increase">
        <Icon name="plus" />
      </button>
    </div>
  )
}
