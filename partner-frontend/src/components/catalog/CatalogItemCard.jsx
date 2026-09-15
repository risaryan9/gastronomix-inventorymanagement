import { memo, useState } from 'react'
import Icon from '../ui/Icon.jsx'
import QuantityStepper from '../ui/QuantityStepper.jsx'
import { formatINR, formatQty, formatRelativeDay, unitLabel } from '../../lib/format.js'
import { MATERIAL_TYPE_LABEL } from '../../lib/catalog.js'

/*
 * One supply in the catalogue. The card opens the item's details; the cart
 * controls at the bottom work without opening it. Once an item is in the cart
 * the card turns gold-edged and the stepper edits the cart directly. While a
 * payment for this outlet's cart is in progress (`locked`) the controls are off.
 */
function CatalogItemCard({ item, quantityInCart, locked = false, onOpen, onSetQuantity }) {
  const [draftQty, setDraftQty] = useState(item.orderStep)
  const [bumped, setBumped] = useState(false)
  const inCart = quantityInCart > 0

  const add = () => {
    onSetQuantity(item, draftQty)
    setBumped(true)
  }

  return (
    <article
      className={`group relative flex flex-col rounded-2xl border-2 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card ${
        inCart ? 'border-accent' : 'border-border hover:border-accent/40'
      } ${item.available ? '' : 'opacity-70'}`}
    >
      <button type="button" onClick={() => onOpen(item)} className="flex-1 text-left focus:outline-none" aria-label={`${item.name} — details`}>
        <span className="absolute inset-0 rounded-2xl focus-visible:ring-2" aria-hidden="true" />
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.code}</p>
          {item.type !== 'raw_material' && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {MATERIAL_TYPE_LABEL[item.type]}
            </span>
          )}
        </div>
        <h3 className="mt-1 line-clamp-2 text-base font-bold leading-snug text-foreground group-hover:text-accent-text">{item.name}</h3>

        <div className="mt-3 flex items-baseline gap-1">
          {item.available ? (
            <>
              <span className="text-xl font-black text-foreground">{formatINR(item.priceIncGst)}</span>
              <span className="text-xs text-muted-foreground">/ {unitLabel(item.unit)}</span>
            </>
          ) : (
            <span className="text-base font-bold text-muted-foreground">Price unavailable</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {item.gstPercent ? `Includes ${item.gstPercent}% GST` : 'No GST'}
          {item.orderStep !== 1 && ` · sold in ${formatQty(item.orderStep, item.unit)}`}
        </p>

        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          {item.lastOrdered ? (
            <>
              <Icon name="history" className="h-3.5 w-3.5" />
              Last ordered {formatRelativeDay(item.lastOrdered.at)} · {formatQty(item.lastOrdered.quantity, item.unit)}
            </>
          ) : (
            <>
              <Icon name="sparkle" className="h-3.5 w-3.5" /> Not ordered here yet
            </>
          )}
        </p>
      </button>

      <div className="relative mt-4 border-t border-border pt-3">
        {!item.available ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Not available for this outlet right now. Contact Gastronomix.
          </p>
        ) : inCart ? (
          <div className="flex items-center justify-between gap-2">
            <QuantityStepper value={quantityInCart} step={item.orderStep} unit={item.unit} onChange={(q) => onSetQuantity(item, q)} disabled={locked} label={`${item.name} in cart`} />
            <span className="text-right text-xs">
              <span className="block font-semibold text-accent-text">In cart</span>
              <span className="text-muted-foreground">{formatINR(item.priceIncGst * quantityInCart)}</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <QuantityStepper value={draftQty} step={item.orderStep} unit={item.unit} onChange={(q) => setDraftQty(q || item.orderStep)} disabled={locked} label={`${item.name} quantity`} />
            <button
              type="button"
              onClick={add}
              disabled={locked}
              onAnimationEnd={() => setBumped(false)}
              className={`inline-flex h-9 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-bold text-accent-foreground transition hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${bumped ? 'animate-pop' : ''}`}
            >
              <Icon name="plus" className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export default memo(CatalogItemCard)
