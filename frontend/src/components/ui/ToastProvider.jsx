// App-wide toasts.
//
// Every action the user takes should say whether it worked. Before this, most
// did not: a modal closed, a list refreshed, and you inferred success. The rest
// used window.alert, which freezes the page and looks nothing like the app.
//
// Tone carries meaning, so it is never colour alone — each toast has an icon
// and a written title. Errors stay put until dismissed; the rest time out,
// because a message you must dismiss to keep working is its own annoyance.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToastContext } from '../../context/toastContext'

const TONE = {
  success: {
    icon: '✓',
    rule: 'border-l-green-500',
    iconClass: 'bg-green-500/15 text-green-500',
    duration: 4000,
  },
  error: {
    icon: '!',
    rule: 'border-l-destructive',
    iconClass: 'bg-destructive/15 text-destructive',
    // Errors usually carry something worth reading, and often a reason to
    // retry — they wait to be dismissed rather than vanishing.
    duration: null,
  },
  warning: {
    icon: '!',
    rule: 'border-l-yellow-500',
    iconClass: 'bg-yellow-500/15 text-yellow-500',
    duration: 6000,
  },
  info: {
    icon: 'i',
    rule: 'border-l-accent',
    iconClass: 'bg-accent/15 text-accent',
    duration: 4000,
  },
}

const Toast = ({ toast, onDismiss }) => {
  const tone = TONE[toast.tone] ?? TONE.info

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto w-full bg-card border-2 border-border ${tone.rule} border-l-4 rounded-xl shadow-xl p-4 flex items-start gap-3 animate-fade-in`}
    >
      <span
        aria-hidden="true"
        className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-sm font-bold ${tone.iconClass}`}
      >
        {tone.icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground break-words">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-muted-foreground mt-0.5 break-words">{toast.description}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors leading-none"
      >
        ✕
      </button>
    </div>
  )
}

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (tone, title, description, options = {}) => {
      const id = nextId.current++
      const duration = options.duration !== undefined ? options.duration : TONE[tone]?.duration

      setToasts((current) => [...current, { id, tone, title, description }])

      if (duration) {
        timers.current.set(
          id,
          setTimeout(() => {
            timers.current.delete(id)
            setToasts((current) => current.filter((toast) => toast.id !== id))
          }, duration)
        )
      }

      return id
    },
    []
  )

  // Clear pending timers if the whole app unmounts, so nothing fires into a
  // component that is gone.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = useMemo(
    () => ({
      success: (title, description, options) => push('success', title, description, options),
      error: (title, description, options) => push('error', title, description, options),
      warning: (title, description, options) => push('warning', title, description, options),
      info: (title, description, options) => push('info', title, description, options),
      dismiss,
    }),
    [push, dismiss]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Bottom-right, newest on top, and never blocking clicks on the page
          behind it — only the toasts themselves take pointer events. */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export default ToastProvider
