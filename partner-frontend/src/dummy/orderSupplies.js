// DUMMY DATA — for designing Order supplies before it is wired to the server.
//
// Nothing here comes from the API. It is shaped like the responses the real
// endpoints will return (GET /api/franchise/outlets, /catalog?outlet_id=,
// /orders), so swapping this module for API calls should not change the pages.
//
// Names, codes, categories, units, GST rates and the outlets are real, taken
// from the live catalogue on 2026-09-14. PRICES ARE NOT REAL: they sit in a
// realistic range but are deliberately shifted off the actual figures, because
// this file ships in the public JavaScript bundle and real purchase costs must
// never reach a browser (docs/fofo-dashboard-spec.md §11). The franchise name,
// order numbers and order history are invented.
//
// The real rules the catalogue will follow are modelled so the design shows
// them: only materials for the outlet's brand appear (NULL brands = all brands,
// spec §6.5), prices differ by serving kitchen (§6.3), and a product that
// cannot be priced in the outlet's kitchen shows as unavailable (§6.4). No
// stock levels appear anywhere — none reach a franchise (§11).

import data from './orderSuppliesData.json'

export const DUMMY_FRANCHISE = data.franchise

// Order statuses as the franchise sees them (spec §9), in lifecycle order.
export const ORDER_STATUS = {
  pending_payment: { label: 'Awaiting payment', step: 0, tone: 'warn' },
  paid: { label: 'Placed', step: 1, tone: 'info' },
  accepted: { label: 'Accepted', step: 2, tone: 'info' },
  packed: { label: 'Packed', step: 3, tone: 'info' },
  ready_to_ship: { label: 'Ready to ship', step: 4, tone: 'info' },
  shipped: { label: 'Shipped', step: 5, tone: 'info' },
  delivered: { label: 'Delivered', step: 6, tone: 'good' },
  cancelled: { label: 'Cancelled', step: -1, tone: 'bad' },
}
export const ORDER_STEPS = ['paid', 'accepted', 'packed', 'ready_to_ship', 'shipped', 'delivered']
export const isInProcess = (status) => !['delivered', 'cancelled', 'expired', 'payment_failed'].includes(status)

export const MATERIAL_TYPE_LABEL = {
  raw_material: 'Raw material',
  semi_finished: 'Semi-finished',
  finished: 'Finished',
  non_food: 'Packaging & non-food',
}

const byNewest = (a, b) => b.placedAt.localeCompare(a.placedAt)

export function listOutlets() {
  return data.outlets.map((outlet) => {
    const orders = data.orders.filter((o) => o.outletId === outlet.id).sort(byNewest)
    const inProcess = orders.filter((o) => isInProcess(o.status))
    const completed = orders.filter((o) => o.status === 'delivered')
    const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5).toISOString()
    return {
      ...outlet,
      inProcessOrders: inProcess,
      completedOrders: completed,
      lastOrderAt: orders[0]?.placedAt || null,
      spendLast30Days: orders
        .filter((o) => o.placedAt >= thirtyDaysAgo && o.status !== 'cancelled')
        .reduce((sum, o) => sum + o.total, 0),
    }
  })
}

export const getOutlet = (outletId) => listOutlets().find((o) => o.id === outletId) || null

/** The catalogue for one outlet: its brand's materials, priced in its serving kitchen. */
export function catalogForOutlet(outletId) {
  const outlet = data.outlets.find((o) => o.id === outletId)
  if (!outlet) return []
  const history = data.orders.filter((o) => o.outletId === outletId).sort(byNewest)
  return data.catalogByKitchen[outlet.kitchenCode]
    .filter((item) => item.brands === null || item.brands.includes(outlet.brand))
    .map((item) => {
      const last = history.find((o) => o.lines.some((l) => l.itemId === item.id))
      const lastLine = last?.lines.find((l) => l.itemId === item.id)
      return {
        ...item,
        lastOrdered: last ? { at: last.placedAt, quantity: lastLine.quantity, orderNumber: last.orderNumber } : null,
      }
    })
}

/** Every time this outlet bought this item, newest first. */
export function purchaseHistory(outletId, itemId) {
  return data.orders
    .filter((o) => o.outletId === outletId)
    .sort(byNewest)
    .flatMap((o) =>
      o.lines
        .filter((l) => l.itemId === itemId)
        .map((l) => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          placedAt: o.placedAt,
          status: o.status,
          quantity: l.quantity,
          unitPriceIncGst: l.unitPriceIncGst,
          lineTotal: l.lineTotal,
        }))
    )
}
