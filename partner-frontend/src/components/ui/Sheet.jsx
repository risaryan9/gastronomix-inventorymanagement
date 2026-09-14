import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'

/*
 * A panel over the page: slides up from the bottom on a phone, in from the
 * right on a larger screen. Escape, the backdrop and the close button all
 * dismiss it; the page behind does not scroll while it is open.
 */
export default function Sheet({ open, onClose, title, subtitle, children, footer, width = 'sm:max-w-lg' }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 animate-backdrop-in bg-black/60 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`absolute inset-x-0 bottom-0 flex max-h-[92vh] animate-sheet-up flex-col rounded-t-2xl border-t-2 border-border bg-card shadow-card outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full ${width} sm:animate-sheet-left sm:rounded-none sm:border-l-2 sm:border-t-0`}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden="true" />
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            {typeof title === 'string' ? <h2 className="text-lg font-bold text-foreground">{title}</h2> : title}
            {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        {footer && <div className="border-t border-border bg-card px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
