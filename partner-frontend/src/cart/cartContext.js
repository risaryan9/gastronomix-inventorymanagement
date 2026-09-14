// Kept apart from CartProvider.jsx so that file exports only a component.

import { createContext, useContext } from 'react'

export const CartContext = createContext(null)

/**
 * The cart, one per outlet.
 *
 *   const { quantityOf, setQuantity, linesFor, summaryFor, totalItems } = useCart()
 */
export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used inside <CartProvider>')
  return context
}
