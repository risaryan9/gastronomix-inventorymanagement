// Downloads for the Vendor Management reports — one Excel writer and one PDF
// writer per report.
//
// The two formats are not the same document in different clothes and are not
// written as if they were. Excel opens on a Summary sheet stating the period,
// the scope and what the numbers mean, then gives the detail as one flat table
// per sheet — flat because these get pivoted, and a sectioned layout with a
// vendor heading every few rows cannot be filtered. The PDF is the version that
// gets printed and filed: a header block, a totals line, and a table that fits
// the page.
//
// Money in PDFs goes through pdfMoney. The built-in PDF fonts cannot encode ₹
// and print a stray superscript 1 in its place — see pdfCurrency.js.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { pdfMoney, PDF_CURRENCY } from './pdfCurrency'

const round = (value) => Number((value || 0).toFixed(2))

const formatDay = (value) => {
  if (!value) return ''
  const [y, m, d] = String(value).slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : String(value)
}

const scopeLabel = (kitchenName) => kitchenName || 'All cloud kitchens'

const withColumnWidths = (sheet, widths) => {
  sheet['!cols'] = widths.map((width) => ({ wch: width }))
  return sheet
}

const meta = (title, { from, to, kitchenName }) => [
  ['Gastronomix Inventory Management'],
  [title],
  [],
  ['Period:', `${formatDay(from)} to ${formatDay(to)}`],
  ['Cloud kitchen:', scopeLabel(kitchenName)],
  ['Generated:', new Date().toLocaleString()],
]

// Repeated on every sheet that reports money, because every one of these
// numbers is GST-inclusive and a reader who assumes otherwise is out by the
// blended tax rate.
const MONEY_NOTE = [
  ['How the money is counted'],
  ['Spend:', 'The invoice total recorded against the receipt, GST inclusive.'],
  ['Net:', 'The same purchases before GST, summed from the individual lines.'],
  ['GST:', 'The difference between the two.'],
  ['Scope:', 'Purchase receipts only. Inter-kitchen transfers and manual inventory'],
  ['', 'adjustments are excluded — no vendor was paid for them.'],
]

const UNLINKED_NOTE = [
  ['Unlinked suppliers'],
  ['', 'A receipt records its supplier as a name, not as a link to the vendor table.'],
  ['', 'A name matching no vendor is reported under that name and flagged "Unlinked",'],
  ['', 'so these totals always reconcile with the stock-in ledger.'],
]

const fileStamp = ({ from, to }) => `${from}_to_${to}`

const saveWorkbook = (workbook, name) => XLSX.writeFile(workbook, `${name}.xlsx`)

/* ------------------------------------------------------------------ *
 * PDF chrome
 * ------------------------------------------------------------------ */

const ACCENT = [225, 187, 7]

const pdfHeader = (doc, title, { from, to, kitchenName }) => {
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 16)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90)
  doc.text(`Period: ${formatDay(from)} to ${formatDay(to)}`, 14, 23)
  doc.text(`Cloud kitchen: ${scopeLabel(kitchenName)}`, 14, 28)
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 33)
  doc.setTextColor(0)

  return 40
}

const pdfTotals = (doc, y, entries) => {
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(entries.map(([label, value]) => `${label}: ${value}`).join('    |    '), 14, y)
  doc.setFont('helvetica', 'normal')
  return y + 6
}

const pdfTable = (doc, startY, head, body, columnStyles) =>
  autoTable(doc, {
    startY,
    head: [head],
    body,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: ACCENT, textColor: 20, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    columnStyles,
    // Every page of a filed report has to say what it is.
    didDrawPage: () => {
      const { pageSize } = doc.internal
      doc.setFontSize(7)
      doc.setTextColor(130)
      doc.text(
        `Gastronomix Inventory Management  ·  amounts in ${PDF_CURRENCY}, GST inclusive`,
        14,
        pageSize.getHeight() - 8
      )
      doc.setTextColor(0)
    },
  })

/* ------------------------------------------------------------------ *
 * Report 1 — Vendor spend summary
 * ------------------------------------------------------------------ */

const vendorSummaryRow = (vendor) => [
  vendor.name,
  vendor.linked ? (vendor.isActive ? 'Active' : 'Inactive') : 'Unlinked',
  vendor.invoiceCount,
  vendor.itemCount,
  round(vendor.netSpend),
  round(vendor.gstPaid),
  round(vendor.spend),
  formatDay(vendor.firstInvoiceDate),
  formatDay(vendor.lastInvoiceDate),
  vendor.missingFileCount,
]

const VENDOR_SUMMARY_HEAD = [
  'Vendor',
  'Status',
  'Invoices',
  'Lines',
  'Net',
  'GST',
  'Total spend',
  'First invoice',
  'Last invoice',
  'Missing files',
]

export const exportVendorSummaryExcel = (vendors, options) => {
  const totalSpend = vendors.reduce((sum, vendor) => sum + vendor.spend, 0)
  const totalInvoices = vendors.reduce((sum, vendor) => sum + vendor.invoiceCount, 0)

  const workbook = XLSX.utils.book_new()

  const summarySheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      ...meta('Vendor Spend Summary', options),
      [],
      ['Vendors reported:', vendors.length],
      ['Vendors with spend:', vendors.filter((vendor) => vendor.invoiceCount > 0).length],
      ['Invoices:', totalInvoices],
      ['Total spend:', round(totalSpend)],
      [],
      ...MONEY_NOTE,
      [],
      ...UNLINKED_NOTE,
    ]),
    [22, 62]
  )
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const detailSheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([VENDOR_SUMMARY_HEAD, ...vendors.map(vendorSummaryRow)]),
    [32, 10, 10, 8, 14, 12, 14, 14, 14, 13]
  )
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Vendors')

  saveWorkbook(workbook, `vendor-spend-summary_${fileStamp(options)}`)
}

export const exportVendorSummaryPdf = (vendors, options) => {
  const doc = new jsPDF('landscape', 'mm', 'a4')
  let y = pdfHeader(doc, 'Vendor Spend Summary', options)

  const totalSpend = vendors.reduce((sum, vendor) => sum + vendor.spend, 0)
  const totalInvoices = vendors.reduce((sum, vendor) => sum + vendor.invoiceCount, 0)

  y = pdfTotals(doc, y, [
    ['Vendors', String(vendors.length)],
    ['Invoices', String(totalInvoices)],
    ['Total spend', pdfMoney(totalSpend)],
  ])

  pdfTable(
    doc,
    y,
    VENDOR_SUMMARY_HEAD,
    vendors.map((vendor) => {
      const row = vendorSummaryRow(vendor)
      return [
        row[0],
        row[1],
        row[2],
        row[3],
        pdfMoney(row[4]),
        pdfMoney(row[5]),
        pdfMoney(row[6]),
        row[7],
        row[8],
        row[9],
      ]
    }),
    {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
      9: { halign: 'right' },
    }
  )

  doc.save(`vendor-spend-summary_${fileStamp(options)}.pdf`)
}

/* ------------------------------------------------------------------ *
 * Report 2 — Invoice register
 * ------------------------------------------------------------------ */

const INVOICE_HEAD = [
  'Date',
  'Vendor',
  'Invoice no.',
  'Cloud kitchen',
  'Received by',
  'Lines',
  'Net',
  'GST',
  'Total',
  'File',
]

const invoiceRow = (invoice) => [
  formatDay(invoice.receiptDate),
  invoice.vendorName,
  invoice.invoiceNumber || '—',
  invoice.kitchenName,
  invoice.receivedByName,
  invoice.itemCount,
  round(invoice.netAmount),
  round(invoice.gstAmount),
  round(invoice.amount),
  invoice.hasInvoiceFile ? 'Attached' : 'Missing',
]

export const exportInvoiceRegisterExcel = (invoices, options) => {
  const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  const missing = invoices.filter((invoice) => !invoice.hasInvoiceFile).length

  const workbook = XLSX.utils.book_new()

  const summarySheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      ...meta('Vendor Invoice Register', options),
      [],
      ['Invoices:', invoices.length],
      ['Total value:', round(total)],
      ['Invoices without an attached file:', missing],
      [],
      ...MONEY_NOTE,
      [],
      ['Note:', 'This register reflects the filters applied on screen when it was'],
      ['', 'downloaded, not every invoice in the period.'],
    ]),
    [34, 60]
  )
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const registerSheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      [...INVOICE_HEAD, 'Invoice file URL'],
      ...invoices.map((invoice) => [...invoiceRow(invoice), invoice.invoiceUrl || '']),
    ]),
    [12, 28, 20, 22, 20, 8, 14, 12, 14, 10, 60]
  )
  XLSX.utils.book_append_sheet(workbook, registerSheet, 'Invoices')

  // One row per invoice line, so the register can be reconciled item by item.
  const lineSheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      [
        'Date',
        'Vendor',
        'Invoice no.',
        'Cloud kitchen',
        'Material',
        'Code',
        'Category',
        'Unit',
        'Qty purchased',
        'Qty unused',
        'Unit cost',
        'GST %',
        'Net',
        'Line total',
      ],
      ...invoices.flatMap((invoice) =>
        invoice.lines.map((line) => [
          formatDay(invoice.receiptDate),
          invoice.vendorName,
          invoice.invoiceNumber || '—',
          invoice.kitchenName,
          line.name,
          line.code,
          line.category,
          line.unit,
          round(line.quantity),
          round(line.remaining),
          round(line.unitCost),
          line.gstPercent,
          round(line.netTotal),
          round(line.lineTotal),
        ])
      ),
    ]),
    [12, 26, 18, 20, 32, 12, 16, 8, 14, 13, 12, 8, 13, 13]
  )
  XLSX.utils.book_append_sheet(workbook, lineSheet, 'Invoice lines')

  saveWorkbook(workbook, `vendor-invoice-register_${fileStamp(options)}`)
}

export const exportInvoiceRegisterPdf = (invoices, options) => {
  const doc = new jsPDF('landscape', 'mm', 'a4')
  let y = pdfHeader(doc, 'Vendor Invoice Register', options)

  const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  const missing = invoices.filter((invoice) => !invoice.hasInvoiceFile).length

  y = pdfTotals(doc, y, [
    ['Invoices', String(invoices.length)],
    ['Total', pdfMoney(total)],
    ['Missing files', String(missing)],
  ])

  pdfTable(
    doc,
    y,
    INVOICE_HEAD,
    invoices.map((invoice) => {
      const row = invoiceRow(invoice)
      return [
        row[0],
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        pdfMoney(row[6]),
        pdfMoney(row[7]),
        pdfMoney(row[8]),
        row[9],
      ]
    }),
    {
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right', fontStyle: 'bold' },
    }
  )

  doc.save(`vendor-invoice-register_${fileStamp(options)}.pdf`)
}

/* ------------------------------------------------------------------ *
 * Report 3 — Vendor × material purchase detail
 * ------------------------------------------------------------------ */

const MATERIAL_HEAD = [
  'Vendor',
  'Material',
  'Code',
  'Category',
  'Unit',
  'Purchases',
  'Qty purchased',
  'Avg unit cost',
  'Last unit cost',
  'Last purchased',
  'Total spend',
]

const materialRow = (material) => [
  material.vendorName,
  material.name,
  material.code || '—',
  material.category || '—',
  material.unit || '—',
  material.purchaseCount,
  round(material.quantity),
  round(material.averageUnitCost),
  round(material.lastUnitCost),
  formatDay(material.lastPurchaseDate),
  round(material.spend),
]

export const exportVendorMaterialsExcel = (materials, options) => {
  const totalSpend = materials.reduce((sum, material) => sum + material.spend, 0)
  const neverBought = materials.filter((material) => material.purchaseCount === 0).length
  const mismatched = materials.filter((material) => material.catalogueMismatch)

  const workbook = XLSX.utils.book_new()

  const summarySheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      ...meta('Vendor Material Purchase Detail', options),
      [],
      ['Vendor / material pairs:', materials.length],
      ['Not purchased in this period:', neverBought],
      ['Total spend:', round(totalSpend)],
      [],
      ...MONEY_NOTE,
      [],
      ['How a material is attributed to a vendor'],
      ['', 'By who it was actually bought from on the receipt, because that is what'],
      ['', 'the money followed. The material catalogue also names a vendor per'],
      ['', 'material; where the two disagree the pair is listed on the Mismatches'],
      ['', 'sheet rather than silently reattributed.'],
      [],
      ['Avg unit cost:', 'Total net spend divided by total quantity purchased in the period.'],
      ['', 'A pair with no purchases in the period shows zero, not a stale price.'],
    ]),
    [30, 62]
  )
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const detailSheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([MATERIAL_HEAD, ...materials.map(materialRow)]),
    [26, 32, 12, 16, 8, 11, 14, 14, 14, 14, 14]
  )
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Vendor materials')

  if (mismatched.length > 0) {
    const mismatchSheet = withColumnWidths(
      XLSX.utils.aoa_to_sheet([
        ['Material', 'Code', 'Bought from', 'Catalogue vendor', 'Purchases', 'Total spend'],
        ...mismatched.map((material) => [
          material.name,
          material.code || '—',
          material.vendorName,
          material.catalogueVendorName || '—',
          material.purchaseCount,
          round(material.spend),
        ]),
      ]),
      [32, 12, 26, 26, 11, 14]
    )
    XLSX.utils.book_append_sheet(workbook, mismatchSheet, 'Mismatches')
  }

  saveWorkbook(workbook, `vendor-material-detail_${fileStamp(options)}`)
}

export const exportVendorMaterialsPdf = (materials, options) => {
  const doc = new jsPDF('landscape', 'mm', 'a4')
  let y = pdfHeader(doc, 'Vendor Material Purchase Detail', options)

  const totalSpend = materials.reduce((sum, material) => sum + material.spend, 0)

  y = pdfTotals(doc, y, [
    ['Pairs', String(materials.length)],
    ['Total spend', pdfMoney(totalSpend)],
  ])

  pdfTable(
    doc,
    y,
    MATERIAL_HEAD,
    materials.map((material) => {
      const row = materialRow(material)
      return [
        row[0],
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        row[6],
        pdfMoney(row[7]),
        pdfMoney(row[8]),
        row[9],
        pdfMoney(row[10]),
      ]
    }),
    {
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      10: { halign: 'right', fontStyle: 'bold' },
    }
  )

  doc.save(`vendor-material-detail_${fileStamp(options)}.pdf`)
}

/* ------------------------------------------------------------------ *
 * Report 4 — One vendor's statement
 * ------------------------------------------------------------------ */

/**
 * Everything about a single vendor in the period: the rollup, every invoice, and
 * every material bought. This is the one that gets emailed to a vendor or taken
 * into a payment conversation, so it leads with the totals.
 */
export const exportVendorStatementPdf = (vendor, invoices, materials, options) => {
  const doc = new jsPDF('portrait', 'mm', 'a4')
  let y = pdfHeader(doc, `Vendor Statement — ${vendor.name}`, options)

  y = pdfTotals(doc, y, [
    ['Invoices', String(vendor.invoiceCount)],
    ['Total', pdfMoney(vendor.spend)],
  ])
  y = pdfTotals(doc, y, [
    ['Net', pdfMoney(vendor.netSpend)],
    ['GST', pdfMoney(vendor.gstPaid)],
  ])

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Invoices', 14, y + 2)
  y += 5

  pdfTable(
    doc,
    y,
    ['Date', 'Invoice no.', 'Cloud kitchen', 'Lines', 'Net', 'GST', 'Total', 'File'],
    invoices.map((invoice) => [
      formatDay(invoice.receiptDate),
      invoice.invoiceNumber || '—',
      invoice.kitchenName,
      invoice.itemCount,
      pdfMoney(invoice.netAmount),
      pdfMoney(invoice.gstAmount),
      pdfMoney(invoice.amount),
      invoice.hasInvoiceFile ? 'Yes' : 'No',
    ]),
    {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
    }
  )

  const afterInvoices = doc.lastAutoTable.finalY + 10

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Materials purchased', 14, afterInvoices)

  pdfTable(
    doc,
    afterInvoices + 3,
    ['Material', 'Code', 'Unit', 'Qty', 'Avg cost', 'Last cost', 'Spend'],
    materials.map((material) => [
      material.name,
      material.code || '—',
      material.unit || '—',
      round(material.quantity),
      pdfMoney(material.averageUnitCost),
      pdfMoney(material.lastUnitCost),
      pdfMoney(material.spend),
    ]),
    {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
    }
  )

  const slug = vendor.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  doc.save(`vendor-statement_${slug}_${fileStamp(options)}.pdf`)
}

export const exportVendorStatementExcel = (vendor, invoices, materials, options) => {
  const workbook = XLSX.utils.book_new()

  const summarySheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      ...meta(`Vendor Statement — ${vendor.name}`, options),
      [],
      ['Status:', vendor.linked ? (vendor.isActive ? 'Active' : 'Inactive') : 'Unlinked supplier'],
      ['Invoices:', vendor.invoiceCount],
      ['Lines:', vendor.itemCount],
      ['Net:', round(vendor.netSpend)],
      ['GST:', round(vendor.gstPaid)],
      ['Total spend:', round(vendor.spend)],
      ['First invoice:', formatDay(vendor.firstInvoiceDate)],
      ['Last invoice:', formatDay(vendor.lastInvoiceDate)],
      ['Invoices without a file:', vendor.missingFileCount],
      [],
      ...MONEY_NOTE,
    ]),
    [26, 60]
  )
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const invoiceSheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([
      [...INVOICE_HEAD, 'Invoice file URL'],
      ...invoices.map((invoice) => [...invoiceRow(invoice), invoice.invoiceUrl || '']),
    ]),
    [12, 28, 20, 22, 20, 8, 14, 12, 14, 10, 60]
  )
  XLSX.utils.book_append_sheet(workbook, invoiceSheet, 'Invoices')

  const materialSheet = withColumnWidths(
    XLSX.utils.aoa_to_sheet([MATERIAL_HEAD, ...materials.map(materialRow)]),
    [26, 32, 12, 16, 8, 11, 14, 14, 14, 14, 14]
  )
  XLSX.utils.book_append_sheet(workbook, materialSheet, 'Materials')

  const slug = vendor.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  saveWorkbook(workbook, `vendor-statement_${slug}_${fileStamp(options)}`)
}
