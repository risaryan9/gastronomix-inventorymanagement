// The dashboard's sections. The sidebar and the router are both built from this
// list, so a section's path, its nav entry and its route cannot drift apart —
// the same arrangement as the internal app's adminNavigation.js.
//
// `path` is relative to the dashboard root. Sections are placeholders until
// each is built (docs/fofo-dashboard-spec.md §12–13).
//
// Invoices have no section of their own: they belong to the order they bill
// and are shown with it. The cart is not in the sidebar either — it is the
// highlighted icon in the top bar (CART_ROUTE), always one click away.

import OrderSupplies from '../pages/dashboard/OrderSupplies.jsx'
import OutletCatalog from '../pages/dashboard/OutletCatalog.jsx'
import Cart from '../pages/dashboard/Cart.jsx'
import Orders from '../pages/dashboard/Orders.jsx'
import OrderDetail from '../pages/dashboard/OrderDetail.jsx'
import PendingPayments from '../pages/dashboard/PendingPayments.jsx'
import StoreCredit from '../pages/dashboard/StoreCredit.jsx'
import Account from '../pages/dashboard/Account.jsx'

export const DASHBOARD_NAV = [
  { path: 'order', label: 'Order supplies', icon: 'catalog', Component: OrderSupplies },
  { path: 'orders', label: 'Orders', icon: 'orders', Component: Orders },
  { path: 'payments', label: 'Pending payments', icon: 'payments', Component: PendingPayments },
  { path: 'store-credit', label: 'Store credit', icon: 'credit', Component: StoreCredit },
]

export const CART_ROUTE = { path: 'cart', label: 'Cart', Component: Cart }

export const ACCOUNT_NAV = { path: 'account', label: 'Account', icon: 'account', Component: Account }

// Routes with no nav entry of their own.
export const DASHBOARD_EXTRA_ROUTES = [
  { path: 'order/:outletId', Component: OutletCatalog },
  { path: 'orders/:orderId', Component: OrderDetail },
]
