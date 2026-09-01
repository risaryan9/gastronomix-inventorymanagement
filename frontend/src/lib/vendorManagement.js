// Vendor Management — the data layer behind Operations → Vendor Management.
//
// HOW A VENDOR IS TIED TO AN INVOICE
//
// stock_in has no vendor_id. The supplier is recorded as free text in
// stock_in.supplier_name — but it is written from a <select> of vendor names in
// the purchase manager's Stock In screen, so that text is a soft foreign key,
// not typed prose. Matching therefore happens on a *normalised* name: case,
// surrounding space and runs of inner whitespace folded away.
//
// A supplier name that matches no vendor row is never dropped. It is kept as an
// "unlinked supplier" pseudo-vendor, so the spend totalled on this screen always
// reconciles with the stock-in ledger it is derived from. Silently discarding an
// unmatched name would make this screen quietly under-report — the one failure
// mode a finance screen must not have. The same goes for a receipt with no
// supplier at all, which lands under "No supplier recorded".
//
// WHAT AN INVOICE IS WORTH
//
// stock_in.total_cost is GST-inclusive and agrees with the GST-inclusive sum of
// its batches, so it is used as the invoice amount directly: it is the figure
// that was recorded against the paper. Net and GST are derived from the batches
// for the breakdown, and a line total follows inventoryValuation.js so a rupee
// means the same thing here as it does on every other screen.
//
// WHAT COUNTS AS A PURCHASE
//
// Only stock_in_type = 'purchase'. Inter-kitchen transfers and manual inventory
// adjustments also write stock_in rows, but no vendor was paid for them and they
// carry no invoice — including them would inflate vendor spend with internal
// movements.

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'
import { gstInclusiveUnitCost } from './inventoryValuation'

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The only kind of stock_in a vendor was ever paid for. */
export const PURCHASE_TYPE = 'purchase'

/** Bucket for supplier names present on receipts but absent from the vendors table. */
export const UNLINKED_PREFIX = 'unlinked:'

/** Bucket for purchase receipts that recorded no supplier at all. */
export const NO_SUPPLIER_ID = 'unlinked:__none__'

/**
 * Case, edge space and inner whitespace runs folded — "  Priya   Foods " and
 * "priya foods" are the same vendor, because a human typed one of them once.
 */
export const normalizeVendorName = (name) =>
  String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export const fetchVendors = () =>
  fetchAllRows(() =>
    supabase
      .from('vendors')
      .select('id, name, is_active, created_at, updated_at, deleted_at')
      .order('name')
  )

export const fetchKitchens = () =>
  fetchAllRows(() =>
    supabase
      .from('cloud_kitchens')
      .select('id, name, code')
      .is('deleted_at', null)
      .order('name')
  )

const fetchUserNames = async () => {
  const users = await fetchAllRows(() => supabase.from('users').select('id, full_name'))
  return new Map(users.map((user) => [user.id, user.full_name]))
}

/**
 * Every material the catalogue assigns to a vendor, whether or not it was bought
 * in the period. The Materials tab needs the ones with no purchases just as much
 * as the ones with — a material assigned to a vendor and never ordered is a
 * finding, not an empty row to hide.
 *
 * Admins can see deactivated materials (the manage-all policy on raw_materials
 * is OR'd with the active-only read policy), so `is_active` is carried through
 * as data rather than being filtered away in the query.
 */
export const fetchVendorMaterialCatalogue = () =>
  fetchAllRows(() =>
    supabase
      .from('raw_materials')
      .select('id, name, code, unit, category, material_type, vendor_id, is_active, deleted_at')
      .not('vendor_id', 'is', null)
      .order('name')
  )

/**
 * Purchase receipts in a date range, with their lines.
 *
 * The lines are fetched by filtering on the embedded parent rather than by
 * passing a list of receipt ids, so the request stays one round trip and one
 * short URL no matter how many receipts the range holds.
 */
export const fetchPurchaseData = async ({ from, to }, kitchenId = '') => {
  const receiptQuery = () => {
    const query = supabase
      .from('stock_in')
      .select(
        'id, receipt_date, supplier_name, invoice_number, total_cost, notes, received_by, created_at, invoice_image_url, cloud_kitchen_id'
      )
      .eq('stock_in_type', PURCHASE_TYPE)
      .gte('receipt_date', from)
      .lte('receipt_date', to)
      .order('receipt_date', { ascending: false })
      .order('created_at', { ascending: false })

    return kitchenId ? query.eq('cloud_kitchen_id', kitchenId) : query
  }

  const lineQuery = () => {
    // stock_in is declared !inner so the parent filters actually drop batches; a
    // plain embed would null the embedded object and keep every row. Ordering by
    // id gives fetchAllRows a stable sort to page through — without one,
    // Postgres may repeat or skip rows across ranges.
    const query = supabase
      .from('stock_in_batches')
      .select(
        'id, stock_in_id, cloud_kitchen_id, quantity_purchased, quantity_remaining, unit_cost, gst_percent, raw_material_id, raw_materials(id, name, code, unit, category, vendor_id), stock_in!inner(receipt_date, stock_in_type)'
      )
      .eq('stock_in.stock_in_type', PURCHASE_TYPE)
      .gte('stock_in.receipt_date', from)
      .lte('stock_in.receipt_date', to)
      .order('id')

    return kitchenId ? query.eq('cloud_kitchen_id', kitchenId) : query
  }

  const [receipts, lines, userNames, kitchens] = await Promise.all([
    fetchAllRows(receiptQuery),
    fetchAllRows(lineQuery),
    fetchUserNames(),
    fetchKitchens(),
  ])

  const kitchenNames = new Map(kitchens.map((kitchen) => [kitchen.id, kitchen.name]))

  // Lines are folded onto their receipt once, so nothing downstream has to scan
  // the whole line array per invoice.
  const linesByReceipt = new Map()
  lines.forEach((line) => {
    const shaped = {
      id: line.id,
      stockInId: line.stock_in_id,
      materialId: line.raw_material_id,
      name: line.raw_materials?.name ?? 'Unknown material',
      code: line.raw_materials?.code ?? '',
      unit: line.raw_materials?.unit ?? '',
      category: line.raw_materials?.category ?? '',
      catalogueVendorId: line.raw_materials?.vendor_id ?? null,
      quantity: num(line.quantity_purchased),
      remaining: num(line.quantity_remaining),
      unitCost: num(line.unit_cost),
      gstPercent: num(line.gst_percent),
      netTotal: num(line.quantity_purchased) * num(line.unit_cost),
      lineTotal: num(line.quantity_purchased) * gstInclusiveUnitCost(line),
    }

    const bucket = linesByReceipt.get(shaped.stockInId)
    if (bucket) bucket.push(shaped)
    else linesByReceipt.set(shaped.stockInId, [shaped])
  })

  const invoices = receipts.map((receipt) => {
    const receiptLines = linesByReceipt.get(receipt.id) ?? []
    const netAmount = receiptLines.reduce((sum, line) => sum + line.netTotal, 0)
    const grossAmount = receiptLines.reduce((sum, line) => sum + line.lineTotal, 0)

    return {
      id: receipt.id,
      receiptDate: receipt.receipt_date,
      createdAt: receipt.created_at,
      supplierName: receipt.supplier_name ?? '',
      supplierKey: normalizeVendorName(receipt.supplier_name),
      invoiceNumber: receipt.invoice_number ?? '',
      notes: receipt.notes ?? '',
      invoiceUrl: receipt.invoice_image_url ?? '',
      hasInvoiceFile: !!receipt.invoice_image_url,
      kitchenId: receipt.cloud_kitchen_id,
      kitchenName: kitchenNames.get(receipt.cloud_kitchen_id) ?? 'Unknown kitchen',
      receivedByName: userNames.get(receipt.received_by) ?? '—',
      // The recorded figure is the invoice amount; net and GST are the
      // breakdown of it, derived from the lines.
      amount: num(receipt.total_cost),
      netAmount,
      gstAmount: grossAmount - netAmount,
      itemCount: receiptLines.length,
      lines: receiptLines,
    }
  })

  return { invoices, kitchens }
}

/* ------------------------------------------------------------------ *
 * Folds
 * ------------------------------------------------------------------ */

const emptyStats = () => ({
  invoiceCount: 0,
  spend: 0,
  netSpend: 0,
  gstPaid: 0,
  itemCount: 0,
  missingFileCount: 0,
  firstInvoiceDate: null,
  lastInvoiceDate: null,
})

const addInvoice = (stats, invoice) => {
  stats.invoiceCount += 1
  stats.spend += invoice.amount
  stats.netSpend += invoice.netAmount
  stats.gstPaid += invoice.gstAmount
  stats.itemCount += invoice.itemCount
  if (!invoice.hasInvoiceFile) stats.missingFileCount += 1
  if (!stats.firstInvoiceDate || invoice.receiptDate < stats.firstInvoiceDate) {
    stats.firstInvoiceDate = invoice.receiptDate
  }
  if (!stats.lastInvoiceDate || invoice.receiptDate > stats.lastInvoiceDate) {
    stats.lastInvoiceDate = invoice.receiptDate
  }
  return stats
}

/**
 * Resolves each invoice to a vendor and rolls the period up per vendor.
 *
 * Returns every vendor in the table — including ones with no spend in the
 * period, which is exactly the row a buyer wants to see — plus a synthetic row
 * for each supplier name found on a receipt that no vendor matches.
 *
 * The resolved invoices come back as new objects rather than the inputs being
 * tagged in place. Everything downstream reads invoice.vendorId, so mutating
 * would make those consumers silently depend on this having run first — a
 * correctness bug waiting for someone to reorder two useMemo calls.
 *
 * @returns {{ rows, byVendorId, unlinkedNames, invoices }}
 */
export const buildVendorRollups = (vendors, invoices, materials = []) => {
  const byKey = new Map(vendors.map((vendor) => [normalizeVendorName(vendor.name), vendor]))

  const materialCounts = new Map()
  materials.forEach((material) => {
    if (!material.vendor_id) return
    materialCounts.set(material.vendor_id, (materialCounts.get(material.vendor_id) ?? 0) + 1)
  })

  const stats = new Map()
  const unlinked = new Map()

  const resolved = invoices.map((invoice) => {
    const matched = invoice.supplierKey ? byKey.get(invoice.supplierKey) : null

    let identity
    if (matched) {
      identity = { vendorId: matched.id, vendorName: matched.name, linked: true }
    } else if (!invoice.supplierKey) {
      identity = { vendorId: NO_SUPPLIER_ID, vendorName: 'No supplier recorded', linked: false }
      unlinked.set(NO_SUPPLIER_ID, 'No supplier recorded')
    } else {
      const vendorId = `${UNLINKED_PREFIX}${invoice.supplierKey}`
      identity = { vendorId, vendorName: invoice.supplierName, linked: false }
      unlinked.set(vendorId, invoice.supplierName)
    }

    const tagged = { ...invoice, ...identity }
    if (!stats.has(tagged.vendorId)) stats.set(tagged.vendorId, emptyStats())
    addInvoice(stats.get(tagged.vendorId), tagged)
    return tagged
  })

  const vendorRows = vendors.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    isActive: vendor.is_active,
    createdAt: vendor.created_at,
    updatedAt: vendor.updated_at,
    linked: true,
    materialCount: materialCounts.get(vendor.id) ?? 0,
    ...(stats.get(vendor.id) ?? emptyStats()),
  }))

  const unlinkedRows = [...unlinked.entries()].map(([id, name]) => ({
    id,
    name,
    isActive: null,
    createdAt: null,
    updatedAt: null,
    linked: false,
    materialCount: 0,
    ...(stats.get(id) ?? emptyStats()),
  }))

  const rows = [...vendorRows, ...unlinkedRows]

  return {
    rows,
    byVendorId: new Map(rows.map((row) => [row.id, row])),
    unlinkedNames: [...unlinked.values()],
    invoices: resolved,
  }
}

/**
 * Vendor × material purchase history for the period.
 *
 * A material belongs to a vendor in two different ways and they do not always
 * agree: the catalogue assigns it (raw_materials.vendor_id), and a receipt
 * records who it was actually bought from. This folds by *who it was bought
 * from*, because that is what the money followed, and flags rows where the
 * catalogue names someone else — a genuine data problem worth surfacing rather
 * than averaging away.
 */
export const buildVendorMaterials = (invoices, catalogue, vendorsById) => {
  const rows = new Map()

  const keyOf = (vendorId, materialId) => `${vendorId}::${materialId}`

  invoices.forEach((invoice) => {
    invoice.lines.forEach((line) => {
      const key = keyOf(invoice.vendorId, line.materialId)
      let row = rows.get(key)

      if (!row) {
        row = {
          key,
          vendorId: invoice.vendorId,
          vendorName: invoice.vendorName,
          materialId: line.materialId,
          name: line.name,
          code: line.code,
          unit: line.unit,
          category: line.category,
          catalogueVendorId: line.catalogueVendorId,
          purchaseCount: 0,
          quantity: 0,
          remaining: 0,
          spend: 0,
          netSpend: 0,
          lastPurchaseDate: null,
          lastUnitCost: 0,
          lastGstPercent: 0,
        }
        rows.set(key, row)
      }

      row.purchaseCount += 1
      row.quantity += line.quantity
      row.remaining += line.remaining
      row.spend += line.lineTotal
      row.netSpend += line.netTotal

      // Invoices arrive newest-first, so the first line seen for a material is
      // its most recent price. Compared on date anyway — a caller that reorders
      // the invoices should not silently change what "last price" means.
      if (!row.lastPurchaseDate || invoice.receiptDate > row.lastPurchaseDate) {
        row.lastPurchaseDate = invoice.receiptDate
        row.lastUnitCost = line.unitCost
        row.lastGstPercent = line.gstPercent
      }
    })
  })

  // Catalogue entries with no purchase in the period still get a row, at zero.
  catalogue.forEach((material) => {
    const key = keyOf(material.vendor_id, material.id)
    if (rows.has(key)) return

    rows.set(key, {
      key,
      vendorId: material.vendor_id,
      vendorName: vendorsById.get(material.vendor_id)?.name ?? 'Unknown vendor',
      materialId: material.id,
      name: material.name,
      code: material.code ?? '',
      unit: material.unit ?? '',
      category: material.category ?? '',
      catalogueVendorId: material.vendor_id,
      purchaseCount: 0,
      quantity: 0,
      remaining: 0,
      spend: 0,
      netSpend: 0,
      lastPurchaseDate: null,
      lastUnitCost: 0,
      lastGstPercent: 0,
    })
  })

  return [...rows.values()].map((row) => ({
    ...row,
    // Net, not gross: an average unit cost is compared against a quoted price,
    // and a quote is quoted before tax.
    averageUnitCost: row.quantity > 0 ? row.netSpend / row.quantity : 0,
    catalogueVendorName: row.catalogueVendorId
      ? (vendorsById.get(row.catalogueVendorId)?.name ?? 'Unknown vendor')
      : '',
    // Bought from one vendor while the catalogue names another.
    catalogueMismatch:
      !!row.catalogueVendorId && row.purchaseCount > 0 && row.catalogueVendorId !== row.vendorId,
  }))
}

/** Spend per day across the period, for the trend chart. Zero-filled. */
export const buildSpendSeries = (invoices, { from, to }) => {
  const totals = new Map()
  invoices.forEach((invoice) => {
    totals.set(invoice.receiptDate, (totals.get(invoice.receiptDate) ?? 0) + invoice.amount)
  })

  const series = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)

  // A long range would produce an unreadable number of points; the caller
  // decides what to do with that, this just refuses to loop forever.
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    const day = cursor.toISOString().slice(0, 10)
    series.push({ day, spend: totals.get(day) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return series
}

/* ------------------------------------------------------------------ *
 * Invoice files
 * ------------------------------------------------------------------ */

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic']

/**
 * What kind of file an invoice URL points at.
 *
 * Nearly every invoice in this system is a PDF and a handful are photos, so the
 * viewer has to handle both — showing a PDF as a bare "open in a new tab" link
 * is what made invoices feel like they did not load at all.
 *
 * The query string is stripped first: a signed or cache-busted URL ends in
 * `?token=…`, and testing the raw string would classify every one of them as
 * unknown.
 */
export const invoiceFileKind = (url) => {
  if (!url) return 'none'

  const path = String(url).split(/[?#]/)[0].toLowerCase()
  if (path.endsWith('.pdf')) return 'pdf'
  if (IMAGE_EXTENSIONS.some((extension) => path.endsWith(extension))) return 'image'
  return 'unknown'
}

/** The trailing filename, for the download link and the file caption. */
export const invoiceFileName = (url) => {
  if (!url) return ''
  const path = String(url).split(/[?#]/)[0]
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
}

/* ------------------------------------------------------------------ *
 * Screen filters
 * ------------------------------------------------------------------ *
 *
 * This lives here rather than in the tab component for two reasons: the Reports
 * tab exports exactly what the Invoices tab is showing, so both need to apply
 * the same predicate to the same rows; and a file that exports a component
 * alongside a plain function loses Fast Refresh.
 */

export const EMPTY_INVOICE_FILTERS = {
  search: '',
  vendorIds: ['all'],
  kitchenIds: ['all'],
  fileState: ['all'],
  minAmount: '',
  maxAmount: '',
}

// An empty box means "no bound", not zero — a blank Min must not filter out the
// free samples.
const bound = (value) => {
  if (value === '' || value === null || value === undefined) return null
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const filterInvoices = (
  invoices,
  { search, vendorIds, kitchenIds, fileState, minAmount, maxAmount }
) => {
  const term = search.trim().toLowerCase()
  const min = bound(minAmount)
  const max = bound(maxAmount)

  return invoices.filter((invoice) => {
    if (!vendorIds.includes('all') && !vendorIds.includes(invoice.vendorId)) return false
    if (!kitchenIds.includes('all') && !kitchenIds.includes(invoice.kitchenId)) return false

    if (!fileState.includes('all')) {
      if (!fileState.includes(invoice.hasInvoiceFile ? 'attached' : 'missing')) return false
    }

    if (min !== null && invoice.amount < min) return false
    if (max !== null && invoice.amount > max) return false

    if (!term) return true

    return (
      invoice.invoiceNumber.toLowerCase().includes(term) ||
      invoice.vendorName.toLowerCase().includes(term) ||
      invoice.kitchenName.toLowerCase().includes(term) ||
      invoice.receivedByName.toLowerCase().includes(term) ||
      invoice.receiptDate.includes(term) ||
      // Searching a material finds the invoices that bought it, which is how a
      // price question usually starts: "what did we last pay for paneer".
      invoice.lines.some(
        (line) => line.name.toLowerCase().includes(term) || line.code.toLowerCase().includes(term)
      )
    )
  })
}
