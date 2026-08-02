// Admin URL builders.
//
// Deliberately free of imports. adminNavigation.js pulls in every admin screen,
// and those screens need to build links — so if the builders lived there, a page
// importing one would close a cycle: adminNavigation → page → adminNavigation.
// Module-level constants in the page would then evaluate against a
// half-initialised module and throw at import time. Keeping the builders leaf
// makes that impossible rather than merely unlikely.

export const ADMIN_BASE_PATH = '/invmanagement/dashboard/admin'

export const adminSectionPath = (groupId, sectionId) =>
  `${ADMIN_BASE_PATH}/${groupId}/${sectionId}`

export const CLOUD_KITCHEN_OVERVIEW_PATH = adminSectionPath('overview', 'cloud-kitchen')

const KITCHEN_WISE_PATH = adminSectionPath('overview', 'kitchen-wise')

/** Kitchen Wise Overview for one kitchen; without an id it self-redirects to the first. */
export const kitchenWisePath = (kitchenId) =>
  kitchenId ? `${KITCHEN_WISE_PATH}/${kitchenId}` : KITCHEN_WISE_PATH
