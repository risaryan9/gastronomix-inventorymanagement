// Kept apart from CartProvider.jsx so that file exports only a component.

import { createContext, useContext } from 'react'

export const CartContext = createContext(null)

/**
 * The franchise's carts, one per outlet, held by the server.
 *
 *   const { summary, carts, totalItems, loadCart, quantityOf, setQuantity,
 *           keepPrice, clearCart, checkout, error } = useCart()
 *
 * carts[outletId] is the server's view of that outlet's cart once loadCart has
 * run: { outlet, lines, totals, storeCredit, lock, needsAnswer, canCheckout }.
 */
export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used inside <CartProvider>')
  return context
}
