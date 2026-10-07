/*
 * Who sells: the company that issues every FOFO invoice and sends every parcel.
 *
 * One seller, read from server configuration (.env.example):
 *
 *   SELLER_LEGAL_NAME   Delectable Gourmet Private Limited
 *   SELLER_GSTIN        29AAJCD6630M1Z5
 *   SELLER_ADDRESS      the registered address, on one line
 *
 * Printed at the top of an invoice PDF (orders.js → src/lib/invoicePdf.js) and
 * as the sender on a shipping label (staffOrders.js → the internal app's
 * lib/shippingLabelPdf.js). Both read it from here, so the two documents that
 * travel with one order cannot name different companies.
 *
 * NOT IN THE DATABASE, AND NOT FROZEN ON THE INVOICE. An invoice freezes its
 * buyer but has no seller columns, so changing these values changes how every
 * invoice already issued prints. Decision 0021 says why that is accepted for
 * now. These are not secrets: they are printed on paper that leaves the
 * building.
 *
 * UNSET, an invoice prints "Gastronomix" with no GSTIN, which is not a valid
 * tax invoice. That fallback exists so a missing variable shows on the page
 * instead of failing a download, not as a default to rely on.
 */
export const seller = () => ({
  name: process.env.SELLER_LEGAL_NAME || 'Gastronomix',
  gstin: process.env.SELLER_GSTIN || null,
  address: process.env.SELLER_ADDRESS || null,
})
