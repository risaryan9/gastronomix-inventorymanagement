import { useCallback, useMemo, useState } from 'react'
import { CartContext } from './cartContext.js'

/*
 * DESIGN STAGE: the cart lives in this browser tab only.
 *
 * The real cart is a database row per outlet (fofo.carts), shared by everyone
 * at the franchise and priced live on every read. Each line keeps the price it
 * was agreed at, used only to flag a price change, never charged (spec §8.2,
 * decision 0020). This keeps a snapshot of each item's price only so the
 * design can show totals; when the cart API exists, this provider becomes a
 * thin wrapper around the cart endpoints and the snapshot goes.
 */

// Round to the item's order step's precision, so 0.1 + 0.2 stays 0.3.
const tidy = (qty) => Math.round(qty * 1000) / 1000

export default function CartProvider({ children }) {
  // { [outletId]: { [itemId]: { item, quantity } } }
  const [carts, setCarts] = useState({})

  const quantityOf = useCallback((outletId, itemId) => carts[outletId]?.[itemId]?.quantity || 0, [carts])

  const setQuantity = useCallback((outletId, item, quantity) => {
    setCarts((current) => {
      const outletCart = { ...(current[outletId] || {}) }
      const next = tidy(Math.max(0, quantity))
      if (next === 0) delete outletCart[item.id]
      else outletCart[item.id] = { item, quantity: next }
      return { ...current, [outletId]: outletCart }
    })
  }, [])

  const linesFor = useCallback((outletId) => Object.values(carts[outletId] || {}), [carts])

  const summaryFor = useCallback((outletId) => {
    const lines = Object.values(carts[outletId] || {})
    return {
      lines: lines.length,
      total: lines.reduce((sum, { item, quantity }) => sum + item.priceIncGst * quantity, 0),
    }
  }, [carts])

  const totalItems = useMemo(
    () => Object.values(carts).reduce((sum, outletCart) => sum + Object.keys(outletCart).length, 0),
    [carts]
  )

  const value = useMemo(
    () => ({ quantityOf, setQuantity, linesFor, summaryFor, totalItems }),
    [quantityOf, setQuantity, linesFor, summaryFor, totalItems]
  )
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
