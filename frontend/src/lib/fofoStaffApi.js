// FOFO (franchise) orders, as the kitchen's staff see them.
//
// These are not Supabase tables this app can query: FOFO data is reached only
// through the partner app's server (decision 0015), and key-login staff prove
// who they are to it with a staff pass (lib/staffPass.js, decision 0023).
//
// Every call here can throw StaffPassRequired, when the browser holds no
// working pass. A screen that calls them must catch it and show
// <StaffPassPrompt> rather than an error: see pages/purchase-manager/FranchiseOrders.jsx.
//
// The server decides whose orders these are from the pass, and which of them
// this person may see from their role: a purchase manager everything paid for,
// a kitchen executive everything accepted. There is no kitchen or role
// parameter to send, and no way to ask for another kitchen's orders.

import { staffRequest } from './staffPass'

export const fofoStaffApi = {
  // { waitingForAcceptance, oldestWaitingSince, waitingToPack, oldestToPackSince }
  // — cheap; each dashboard polls it for its notice.
  ordersSummary: () => staffRequest('GET', 'orders/summary'),
  // The kitchen's orders this role may see, newest first.
  listOrders: () => staffRequest('GET', 'orders'),
  // One order with its lines and, while it waits for acceptance, stock on hand.
  getOrder: (id) => staffRequest('GET', `orders?id=${encodeURIComponent(id)}`),
  // Accept a waiting order in full: stock leaves the kitchen in the same step.
  // Resolves with the order as it now stands. Refused, with the reason in the
  // error's message, if the kitchen is short on any line.
  acceptOrder: (id) => staffRequest('POST', 'orders/accept', { order_id: id }),
  // Kitchen executive: say an accepted order is boxed. Moves only its status.
  packOrder: (id) => staffRequest('POST', 'orders/pack', { order_id: id }),
  // What the shipping label for an accepted order says: who it goes to, the
  // goods invoice, and the sender. Drawn by lib/shippingLabelPdf.js.
  getLabel: (id) => staffRequest('GET', `orders/label?id=${encodeURIComponent(id)}`),
}

// How an order's status reads to the kitchen. The franchise sees `paid` as
// "Placed"; here it is the status that asks the purchase manager to act, as
// `accepted` asks the kitchen executive. Which one is highlighted depends on
// who is reading (FranchiseOrders.jsx, VIEWS).
export const ORDER_STATUS = {
  paid: { label: 'Waiting for acceptance', tone: 'progress' },
  accepted: { label: 'Accepted · to pack', tone: 'progress' },
  packed: { label: 'Packed', tone: 'progress' },
  ready_to_ship: { label: 'Ready to ship', tone: 'progress' },
  shipped: { label: 'Shipped', tone: 'progress' },
  delivered: { label: 'Delivered', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}
