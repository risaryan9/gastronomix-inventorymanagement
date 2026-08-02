// Single source of truth for the admin dashboard's two-level navigation.
//
// The sidebar and the router are both generated from this list, so adding a
// section means adding one entry here — the URL, the nav item and the route
// cannot drift apart. A section with no `Component` renders the placeholder.

import Materials from '../purchase-manager/Materials'
import AdminUsers from './AdminUsers'
import AdminOperators from './AdminOperators'
import AdminRecipes from './AdminRecipes'
import AdminOutlets from './AdminOutlets'
import AdminVendors from './AdminVendors'
import AdminBrandDispatch from './AdminBrandDispatch'
import AdminRequisitionsReports from './AdminRequisitionsReports'
import AdminFranchiseCloning from './AdminFranchiseCloning'
import AuditInventoryCatalog from './audits/AuditInventoryCatalog'
import AuditRequisitionsStockOut from './audits/AuditRequisitionsStockOut'
import AuditDispatchCheckout from './audits/AuditDispatchCheckout'
import AuditAccessOverrides from './audits/AuditAccessOverrides'

export const ADMIN_BASE_PATH = '/invmanagement/dashboard/admin'

export const ADMIN_NAV = [
  {
    id: 'overview',
    label: 'Overview',
    children: [
      { id: 'cloud-kitchen', label: 'Cloud Kitchen' },
      { id: 'outlets', label: 'Outlets', Component: AdminOutlets },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    children: [
      { id: 'materials', label: 'Materials', Component: Materials, props: { isAdminMode: true } },
      { id: 'vendors', label: 'Vendors', Component: AdminVendors },
      { id: 'recipes', label: 'Recipes', Component: AdminRecipes },
      { id: 'dispatch-brands', label: 'Dispatch Brands', Component: AdminBrandDispatch },
    ],
  },
  {
    id: 'people',
    label: 'People',
    children: [
      { id: 'users', label: 'Users', Component: AdminUsers },
      { id: 'operators', label: 'Operators', Component: AdminOperators },
    ],
  },
  {
    id: 'reports-analytics',
    label: 'Reports & Analytics',
    children: [
      {
        id: 'requisitions-reports',
        label: 'Requisitions Reports',
        Component: AdminRequisitionsReports,
      },
      { id: 'sales', label: 'Sales' },
      { id: 'performance', label: 'Performance' },
      { id: 'trends', label: 'Trends' },
    ],
  },
  {
    id: 'audits',
    label: 'Audits',
    children: [
      { id: 'inventory-catalog', label: 'Inventory & Catalog', Component: AuditInventoryCatalog },
      {
        id: 'requisitions-stock-out',
        label: 'Requisitions & Stock Out',
        Component: AuditRequisitionsStockOut,
      },
      { id: 'dispatch-checkout', label: 'Dispatch & Checkout', Component: AuditDispatchCheckout },
      { id: 'access-overrides', label: 'Access & Overrides', Component: AuditAccessOverrides },
    ],
  },
  {
    id: 'franchise',
    label: 'Franchise',
    children: [{ id: 'data-cloning', label: 'Data Cloning', Component: AdminFranchiseCloning }],
  },
]

export const adminSectionPath = (groupId, sectionId) => `${ADMIN_BASE_PATH}/${groupId}/${sectionId}`

export const adminGroupDefaultPath = (group) => adminSectionPath(group.id, group.children[0].id)

// Where the dashboard lands on /admin, and where an unknown admin URL falls back to.
export const ADMIN_DEFAULT_PATH = adminGroupDefaultPath(ADMIN_NAV[0])

// Routes are generated as static paths (not `:groupId/:sectionId`), so the
// sidebar reads the active section back out of the URL rather than from params.
export const resolveAdminSection = (pathname) => {
  if (!pathname.startsWith(ADMIN_BASE_PATH)) return { group: null, section: null }

  const [, groupId, sectionId] = pathname.slice(ADMIN_BASE_PATH.length).split('/')
  const group = ADMIN_NAV.find((candidate) => candidate.id === groupId) || null
  const section = group?.children.find((candidate) => candidate.id === sectionId) || null

  return { group, section }
}
