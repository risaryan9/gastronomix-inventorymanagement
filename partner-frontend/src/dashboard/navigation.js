// The dashboard's sections. The sidebar and the router are both built from this
// list, so a section's path, its nav entry and its route cannot drift apart —
// the same arrangement as the internal app's adminNavigation.js.
//
// `path` is relative to the dashboard root. Sections are placeholders until
// each is built (docs/fofo-dashboard-spec.md §12–13).

import Overview from '../pages/dashboard/Overview.jsx'
import OrderSupplies from '../pages/dashboard/OrderSupplies.jsx'
import Cart from '../pages/dashboard/Cart.jsx'
import Orders from '../pages/dashboard/Orders.jsx'
import OrderDetail from '../pages/dashboard/OrderDetail.jsx'
import Invoices from '../pages/dashboard/Invoices.jsx'
import StoreCredit from '../pages/dashboard/StoreCredit.jsx'
import Account from '../pages/dashboard/Account.jsx'

export const DASHBOARD_NAV = [
  { path: '', label: 'Overview', icon: 'home', Component: Overview },
  { path: 'order', label: 'Order supplies', icon: 'catalog', Component: OrderSupplies },
  { path: 'cart', label: 'Cart', icon: 'cart', Component: Cart },
  { path: 'orders', label: 'Orders', icon: 'orders', Component: Orders },
  { path: 'invoices', label: 'Invoices', icon: 'invoice', Component: Invoices },
  { path: 'store-credit', label: 'Store credit', icon: 'credit', Component: StoreCredit },
]

export const ACCOUNT_NAV = { path: 'account', label: 'Account', icon: 'account', Component: Account }

// Routes with no nav entry of their own.
export const DASHBOARD_EXTRA_ROUTES = [
  { path: 'orders/:orderId', Component: OrderDetail },
]
