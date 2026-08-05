// Toast context, kept separate from the provider component so the provider
// file exports only a component — Fast Refresh stops working for a file that
// mixes component and non-component exports.

import { createContext, useContext } from 'react'

export const ToastContext = createContext(null)

/**
 * Brief, non-blocking feedback.
 *
 *   const toast = useToast()
 *   toast.success('Purchase slip created', 'Inventory has been updated.')
 *   toast.error('Could not save', err.message)
 *
 * Use this for the result of an action. For something the user must answer
 * before anything happens, use useConfirm instead.
 */
export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return context
}
