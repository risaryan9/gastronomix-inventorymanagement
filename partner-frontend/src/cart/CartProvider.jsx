import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../auth/authContext.js'
import { CartContext } from './cartContext.js'

/*
 * The carts, as the server holds them: one per outlet, shared by everyone at the
 * franchise, kept in the database so they are there after closing the window
 * or signing in elsewhere (decision 0020).
 *
 * This keeps two things from /api/franchise/cart:
 *   summary   which outlets have a cart and how many lines — the top-bar count
 *   carts     each outlet's full cart, priced by the server, loaded when a screen
 *             asks for it
 * Nothing here computes a price, a total or a line status. The server does, and
 * every write answers with the outlet's whole cart, which replaces what was here.
 *
 * QUANTITY CHANGES FEEL INSTANT. The quantity is shown straight away, and the
 * writes for an outlet go to the server one after another, in the order they
 * were made. Only the answer to the last write is shown, so tapping + three
 * times never flickers back through the earlier answers. If a write fails, the
 * outlet's cart is reloaded from the server and the error is shown.
 */
export default function CartProvider({ children }) {
  const { status } = useAuth()
  const [summary, setSummary] = useState({ outlets: [], totalLines: 0, storeCreditAvailable: 0 })
  const [carts, setCarts] = useState({})
  const [error, setError] = useState(null)
  const queues = useRef({})

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await api('franchise/cart'))
    } catch (err) {
      if (err.status !== 401) setError(err.message)
    }
  }, [])

  useEffect(() => {
    if (status === 'signedIn') refreshSummary()
    if (status === 'signedOut') {
      setSummary({ outlets: [], totalLines: 0, storeCreditAvailable: 0 })
      setCarts({})
    }
  }, [status, refreshSummary])

  // A cart the server just sent: store it, and bring the summary row in line.
  const acceptCart = useCallback((view) => {
    setCarts((current) => ({ ...current, [view.outlet.id]: view }))
    setSummary((current) => {
      const others = current.outlets.filter((o) => o.id !== view.outlet.id)
      const outlets = view.lines.length
        ? [...others, { ...view.outlet, lines: view.lines.length, locked: Boolean(view.lock) }].sort((a, b) => a.code.localeCompare(b.code))
        : others
      return { ...current, outlets, totalLines: outlets.reduce((sum, o) => sum + o.lines, 0), storeCreditAvailable: view.storeCredit.available }
    })
  }, [])

  const loadCart = useCallback(async (outletId) => {
    try {
      const view = await api(`franchise/cart?outlet_id=${encodeURIComponent(outletId)}`)
      acceptCart(view)
      return view
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [acceptCart])

  // Runs writes for one outlet in order; applies only the last one's answer.
  const enqueue = useCallback((outletId, write) => {
    const queue = queues.current[outletId] || { tail: Promise.resolve(), pending: 0 }
    queues.current[outletId] = queue
    queue.pending += 1
    const run = queue.tail.then(async () => {
      try {
        const view = await write()
        if (queue.pending === 1) acceptCart(view)
        return view
      } catch (err) {
        setError(err.message)
        if (queue.pending === 1) await loadCart(outletId)
        throw err
      } finally {
        queue.pending -= 1
      }
    })
    queue.tail = run.catch(() => {})
    return run
  }, [acceptCart, loadCart])

  const setQuantity = useCallback((outletId, item, quantity) => {
    setError(null)
    // Show the new quantity now; the server's answer follows.
    setCarts((current) => {
      const view = current[outletId]
      if (!view) return current
      const exists = view.lines.some((l) => l.id === item.id)
      const lines = quantity === 0
        ? view.lines.filter((l) => l.id !== item.id)
        : exists
          ? view.lines.map((l) => (l.id === item.id ? { ...l, quantity } : l))
          : [...view.lines, { ...item, quantity, status: 'ok' }]
      return { ...current, [outletId]: { ...view, lines } }
    })
    return enqueue(outletId, () =>
      api('franchise/cart', { method: 'PUT', body: { outlet_id: outletId, material_id: item.id, quantity } })
    ).catch(() => null)
  }, [enqueue])

  const keepPrice = useCallback((outletId, materialId) => {
    setError(null)
    return enqueue(outletId, () =>
      api('franchise/cart/keep', { method: 'POST', body: { outlet_id: outletId, material_id: materialId } })
    ).catch(() => null)
  }, [enqueue])

  const clearCart = useCallback((outletId) => {
    setError(null)
    return enqueue(outletId, () =>
      api(`franchise/cart?outlet_id=${encodeURIComponent(outletId)}`, { method: 'DELETE' })
    ).catch(() => null)
  }, [enqueue])

  const checkout = useCallback(async (outletId, redeemStoreCredit) => {
    setError(null)
    const result = await api('franchise/checkout', {
      method: 'POST',
      body: { outlet_id: outletId, redeem_store_credit: redeemStoreCredit },
    })
    if (result.cart) acceptCart(result.cart)
    return result
  }, [acceptCart])

  const quantityOf = useCallback(
    (outletId, itemId) => carts[outletId]?.lines.find((l) => l.id === itemId)?.quantity || 0,
    [carts]
  )

  const value = useMemo(() => ({
    summary,
    carts,
    totalItems: summary.totalLines,
    error,
    clearError: () => setError(null),
    loadCart,
    refreshSummary,
    quantityOf,
    setQuantity,
    keepPrice,
    clearCart,
    checkout,
  }), [summary, carts, error, loadCart, refreshSummary, quantityOf, setQuantity, keepPrice, clearCart, checkout])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
