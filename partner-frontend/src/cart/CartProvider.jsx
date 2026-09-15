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
 * requests for an outlet go to the server one after another, in the order they
 * were made. Only the answer to the last one is shown, so tapping + three
 * times never flickers back through the earlier answers. If a write fails, the
 * outlet's cart is reloaded from the server and the error is shown.
 *
 * READS GO THROUGH THE SAME QUEUE AS WRITES. A screen that already holds a
 * cart shows it at once and reloads it in the background. Outside the queue,
 * that reload could start before a "clear cart" and answer after it, and put
 * the cleared lines back on screen until the page was refreshed. In the queue,
 * the reload finishes first and the clear's answer is the one shown.
 */
export default function CartProvider({ children }) {
  const { status } = useAuth()
  const [summary, setSummary] = useState({ outlets: [], totalLines: 0, storeCreditAvailable: 0 })
  const [carts, setCarts] = useState({})
  const [error, setError] = useState(null)
  const queues = useRef({})
  // Outlets whose cart is on screen. Read in callbacks, so a ref, not state.
  const loaded = useRef(new Set())

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
      loaded.current.clear()
    }
  }, [status, refreshSummary])

  // A cart the server just sent: store it, and bring the summary row in line.
  const acceptCart = useCallback((view) => {
    loaded.current.add(view.outlet.id)
    setCarts((current) => ({ ...current, [view.outlet.id]: view }))
    setSummary((current) => {
      const others = current.outlets.filter((o) => o.id !== view.outlet.id)
      const outlets = view.lines.length
        ? [...others, { ...view.outlet, lines: view.lines.length, locked: Boolean(view.lock) }].sort((a, b) => a.code.localeCompare(b.code))
        : others
      return { ...current, outlets, totalLines: outlets.reduce((sum, o) => sum + o.lines, 0), storeCreditAvailable: view.storeCredit.available }
    })
  }, [])

  const fetchCart = (outletId) => api(`franchise/cart?outlet_id=${encodeURIComponent(outletId)}`)

  // Runs one outlet's requests in order; applies only the last one's answer —
  // except that a read may fill a screen that has no cart yet, since there is
  // nothing newer on it to overwrite.
  const enqueue = useCallback((outletId, request, { isRead = false } = {}) => {
    const queue = queues.current[outletId] || { tail: Promise.resolve(), pending: 0 }
    queues.current[outletId] = queue
    queue.pending += 1
    const run = queue.tail.then(async () => {
      try {
        const view = await request()
        if (queue.pending === 1 || (isRead && !loaded.current.has(outletId))) acceptCart(view)
        return view
      } catch (err) {
        setError(err.message)
        // Put the screen back to what the server holds. Called directly, not
        // through the queue: this request is still the one running.
        if (queue.pending === 1) {
          await fetchCart(outletId).then(acceptCart).catch(() => {})
        }
        throw err
      } finally {
        queue.pending -= 1
      }
    })
    queue.tail = run.catch(() => {})
    return run
  }, [acceptCart])

  const loadCart = useCallback(
    (outletId) => enqueue(outletId, () => fetchCart(outletId), { isRead: true }).catch(() => null),
    [enqueue]
  )

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
