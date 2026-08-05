// App-wide confirmation dialog, replacing window.confirm.
//
// Kept promise-based so call sites read almost exactly as they did before:
//
//   if (!(await confirm({ … }))) return
//
// One provider means one dialog, so the styling, the keyboard behaviour and the
// accessibility work are done once instead of per screen.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmContext } from '../../context/confirmContext'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

const ConfirmProvider = ({ children }) => {
  const [request, setRequest] = useState(null)
  const cancelRef = useRef(null)
  const confirmRef = useRef(null)
  // The pending promise's settler lives in a ref rather than in state: React
  // may run a state updater twice in development, and settling a promise is a
  // side effect that has no business happening inside one.
  const resolverRef = useRef(null)

  const isOpen = !!request
  useBodyScrollLock(isOpen)

  const confirm = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        resolverRef.current = resolve
        setRequest({ options })
      }),
    []
  )

  const settle = useCallback((result) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(result)
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') settle(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, settle])

  // Destructive actions open with Cancel focused, so a stray Enter backs out
  // rather than confirming.
  useEffect(() => {
    if (!isOpen) return
    const target = request.options.tone === 'danger' ? cancelRef.current : confirmRef.current
    target?.focus()
  }, [isOpen, request])

  const options = request?.options ?? {}
  const {
    title = 'Are you sure?',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'default',
  } = options

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4"
          onClick={() => settle(false)}
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={message ? 'confirm-dialog-message' : undefined}
            onClick={(event) => event.stopPropagation()}
            className="bg-card border-2 border-border rounded-xl p-6 max-w-md w-full shadow-xl"
          >
            <h2 id="confirm-dialog-title" className="text-xl font-bold text-foreground mb-2">
              {title}
            </h2>
            {message && (
              <p id="confirm-dialog-message" className="text-sm text-muted-foreground mb-5">
                {message}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => settle(false)}
                className="px-4 py-2.5 rounded-lg border-2 border-border font-semibold text-foreground hover:bg-accent/10 transition-all focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => settle(true)}
                className={`px-4 py-2.5 rounded-xl font-bold transition-all shadow-button hover:shadow-button-hover focus:outline-none focus:ring-2 focus:ring-accent ${
                  tone === 'danger'
                    ? 'bg-destructive text-destructive-foreground border-3 border-destructive'
                    : 'bg-accent text-background border-3 border-accent'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export default ConfirmProvider
