// Confirm context, kept separate from the provider component for the same
// Fast Refresh reason as toastContext.js.

import { createContext, useContext } from 'react'

export const ConfirmContext = createContext(null)

/**
 * An in-app replacement for window.confirm, awaited the same way it read:
 *
 *   const confirm = useConfirm()
 *   const ok = await confirm({
 *     title: 'Deactivate user?',
 *     message: `"${user.full_name}" will no longer be able to log in.`,
 *     confirmLabel: 'Deactivate',
 *     tone: 'danger',
 *   })
 *   if (!ok) return
 *
 * Unlike window.confirm this does not freeze the page, it is styled like the
 * rest of the app, and — the reason it matters — it cannot be permanently
 * suppressed by the browser, which silently turns a suppressed confirm into an
 * action that never runs.
 */
export const useConfirm = () => {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>')
  }
  return context
}
