// The PDF of one invoice, drawn from GET /api/franchise/invoices?id=.
//
// It prints the invoice AS ISSUED: the buyer and the lines are the copies
// frozen on the invoice (migration 07), and every amount is the one the
// database stored. Nothing is recomputed here, so the PDF cannot disagree with
// the screen or with what was charged. What has been paid against it is a
// separate block under the totals; it changes over time, the invoice above it
// does not (decision 0016).
//
// STORE CREDIT IS SHOWN AS A PAYMENT, never as a discount line: the taxable
// value and GST are the full ones, and credit sits with the other receipts
// (decision 0013).
//
// MONEY GOES THROUGH pdfCurrency (decision 0007): jsPDF cannot print a rupee
// sign. For the same reason nothing here uses a character outside cp1252.
//
// GST IS ONE FIGURE PER RATE. The CGST/SGST/IGST split and the place of supply
// are not designed yet (07), so they are not printed. Whether this layout is
// enough for a tax invoice is the accountant's call, still owed (handoff).
//
// jsPDF and its table plugin are large, so they are loaded only when someone
// downloads an invoice. buildInvoicePdf takes them as arguments and touches
// nothing else, so it can be run outside a browser to check a layout.

import { api } from './api.js'
import { PDF_CURRENCY, pdfAmount, pdfMoney } from './pdfCurrency.js'
import { SETTLEMENT_LABEL } from './catalog.js'
import { unitLabel } from './format.js'

const IST = 'Asia/Kolkata'
const date = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })

const TITLE = { goods: 'TAX INVOICE', logistics: 'TAX INVOICE' }
const KIND = { goods: 'Goods', logistics: 'Logistics' }

const MARGIN = 14
const INK = [20, 20, 20]
const MUTED = [110, 110, 110]
const RULE = [200, 200, 200]

// Trailing zeros dropped, as on screen: 2.5 kg, 30 pcs.
const quantity = (line) => `${Number(line.quantity.toFixed(3))}${line.unit ? ` ${unitLabel(line.unit)}` : ''}`

/** GST collected at each rate, in rate order: what a return is filed from. */
export function gstByRate(lines) {
  const rates = new Map()
  for (const line of lines) {
    const at = rates.get(line.gstPercent) || { gstPercent: line.gstPercent, taxable: 0, gst: 0 }
    // Paise as integers: adding rupee floats line by line drifts.
    at.taxable += Math.round(line.taxable * 100)
    at.gst += Math.round(line.gst * 100)
    rates.set(line.gstPercent, at)
  }
  return [...rates.values()]
    .sort((a, b) => a.gstPercent - b.gstPercent)
    .map((r) => ({ gstPercent: r.gstPercent, taxable: r.taxable / 100, gst: r.gst / 100 }))
}

/** INV/26-27/0001 → INV-26-27-0001.pdf: a slash cannot be in a file name. */
export const invoiceFileName = (invoice) => `${invoice.invoiceNumber.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`

/**
 * Draws the invoice and returns the jsPDF document.
 * `invoice` is the response of GET /api/franchise/invoices?id=.
 */
export function buildInvoicePdf(invoice, { jsPDF, autoTable }) {
  const doc = new jsPDF('p', 'mm', 'a4')
  const width = doc.internal.pageSize.getWidth()
  const right = width - MARGIN
  const { seller, buyer, order } = invoice

  const text = (value, x, y, { size = 9, bold = false, color = INK, align = 'left', maxWidth } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = maxWidth ? doc.splitTextToSize(String(value), maxWidth) : [String(value)]
    doc.text(lines, x, y, { align })
    return y + lines.length * size * 0.42
  }
  const rule = (y) => { doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(MARGIN, y, right, y) }

  // Seller on the left, the document's identity on the right.
  let left = text(seller.name, MARGIN, 18, { size: 15, bold: true })
  if (seller.address) left = text(seller.address, MARGIN, left + 1, { color: MUTED, maxWidth: 95 })
  if (seller.gstin) left = text(`GSTIN: ${seller.gstin}`, MARGIN, left + 1, { bold: true })

  text(TITLE[invoice.type] || 'INVOICE', right, 18, { size: 13, bold: true, align: 'right' })
  text(`${KIND[invoice.type] || 'Invoice'} invoice`, right, 23, { color: MUTED, align: 'right' })
  text(`Invoice no.  ${invoice.invoiceNumber}`, right, 30, { bold: true, align: 'right' })
  text(`Date  ${date(invoice.issuedAt)}`, right, 35, { align: 'right' })
  let y = text(`Order  ${order.orderNumber}`, right, 40, { align: 'right' })

  y = Math.max(left, y) + 4
  rule(y)
  y += 6

  // Who it was issued to, as frozen on the invoice, and where the goods go.
  const half = (right - MARGIN) / 2
  text('BILLED TO', MARGIN, y, { size: 7.5, bold: true, color: MUTED })
  text('FOR OUTLET', MARGIN + half, y, { size: 7.5, bold: true, color: MUTED })
  let billed = text(buyer.name, MARGIN, y + 5, { size: 10, bold: true, maxWidth: half - 6 })
  billed = text([buyer.address, buyer.city].filter(Boolean).join(', '), MARGIN, billed + 1, { maxWidth: half - 6 })
  billed = text(buyer.gstin ? `GSTIN: ${buyer.gstin}` : 'GSTIN: unregistered', MARGIN, billed + 1, { bold: Boolean(buyer.gstin) })
  let outlet = text(order.outlet.name, MARGIN + half, y + 5, { size: 10, bold: true, maxWidth: half - 6 })
  outlet = text(`Outlet code ${order.outlet.code}`, MARGIN + half, outlet + 1)
  outlet = text(`Supplied by ${order.outlet.kitchenName}`, MARGIN + half, outlet + 1)
  y = Math.max(billed, outlet) + 4

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['#', 'Description', 'HSN/SAC', 'Qty', `Rate (${PDF_CURRENCY})`, 'Taxable', 'GST %', 'GST', 'Total']],
    body: invoice.lines.map((line, i) => [
      i + 1,
      line.description,
      line.hsn || '-',
      quantity(line),
      // Unit prices are kept to four places (05); a rate is not rounded to two.
      Number(line.unitPriceExGst.toFixed(4)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      pdfAmount(line.taxable),
      `${Number(line.gstPercent.toFixed(3))}%`,
      pdfAmount(line.gst),
      pdfAmount(line.total),
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: RULE, lineWidth: 0.2 },
    headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { halign: 'right', cellWidth: 8 },
      2: { halign: 'left', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', cellWidth: 22 },
      6: { halign: 'right', cellWidth: 12 },
      7: { halign: 'right', cellWidth: 18 },
      8: { halign: 'right', cellWidth: 22 },
    },
    // A heading sits over its figures: column alignment does not reach the head.
    didParseCell: (cell) => {
      if (cell.section === 'head' && ![1, 2].includes(cell.column.index)) cell.cell.styles.halign = 'right'
    },
  })
  y = doc.lastAutoTable.finalY + 6

  // Everything below must stay together with its heading.
  const room = (needed) => {
    if (y + needed <= doc.internal.pageSize.getHeight() - 20) return
    doc.addPage()
    y = 20
  }

  // GST by rate on the left, the invoice's totals on the right.
  const rates = gstByRate(invoice.lines)
  room(16 + Math.max(rates.length, 3) * 6)
  const top = y
  autoTable(doc, {
    startY: top,
    margin: { left: MARGIN },
    tableWidth: 80,
    head: [['GST rate', 'Taxable value', 'GST']],
    body: rates.map((r) => [`${Number(r.gstPercent.toFixed(3))}%`, pdfAmount(r.taxable), pdfAmount(r.gst)]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, textColor: INK, lineColor: RULE, lineWidth: 0.2 },
    headStyles: { fillColor: [240, 240, 240], textColor: INK, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    didParseCell: (cell) => {
      if (cell.section === 'head' && cell.column.index > 0) cell.cell.styles.halign = 'right'
    },
  })
  const ratesEnd = doc.lastAutoTable.finalY

  const labelX = right - 62
  let totals = top + 4
  const totalRow = (label, value, { bold = false, size = 9 } = {}) => {
    text(label, labelX, totals, { bold, size, color: bold ? INK : MUTED })
    text(value, right, totals, { bold, size, align: 'right' })
    totals += size * 0.42 + 2.6
  }
  totalRow('Taxable value', pdfMoney(invoice.taxableValue))
  totalRow('GST', pdfMoney(invoice.gstAmount))
  doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(labelX, totals - 2.5, right, totals - 2.5)
  totals += 2
  totalRow('Invoice total', pdfMoney(invoice.total), { bold: true, size: 11 })
  y = Math.max(ratesEnd, totals) + 6

  // Receipts: what has settled the invoice so far. Not part of the invoice.
  room(14 + (invoice.settlements.length + 1) * 6)
  text('PAYMENTS RECEIVED', MARGIN, y, { size: 7.5, bold: true, color: MUTED })
  y += 2
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: [
      ...invoice.settlements.map((s) => [
        date(s.at),
        SETTLEMENT_LABEL[s.kind] || s.kind,
        s.reference || '-',
        pdfMoney(s.amount),
      ]),
      ...(invoice.settlements.length ? [] : [[{ content: 'No payment has been received yet.', colSpan: 4, styles: { textColor: MUTED } }]]),
      [
        { content: invoice.amountDue > 0 ? 'Balance due' : 'Paid in full', colSpan: 3, styles: { fontStyle: 'bold' } },
        { content: pdfMoney(invoice.amountDue), styles: { fontStyle: 'bold', halign: 'right' } },
      ],
    ],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.4, textColor: INK },
    columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 34 }, 3: { halign: 'right', cellWidth: 36 } },
    didDrawCell: (cell) => {
      if (cell.section === 'body' && cell.row.index === cell.table.body.length - 1 && cell.column.index === 0) {
        doc.setDrawColor(...RULE); doc.setLineWidth(0.2)
        doc.line(MARGIN, cell.cell.y, right, cell.cell.y)
      }
    },
  })
  y = doc.lastAutoTable.finalY + 6

  if (invoice.creditNotes.length) {
    room(12 + invoice.creditNotes.length * 6)
    text('CREDIT NOTES AGAINST THIS INVOICE', MARGIN, y, { size: 7.5, bold: true, color: MUTED })
    y += 2
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      body: invoice.creditNotes.map((cn) => [date(cn.issuedAt), cn.creditNoteNumber, cn.reason, pdfMoney(cn.amount)]),
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.4, textColor: INK },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 34 }, 3: { halign: 'right', cellWidth: 36 } },
    })
    y = doc.lastAutoTable.finalY + 2
    y = text('This invoice is not changed by a credit note. The amount comes back as store credit.', MARGIN, y + 3, { size: 7.5, color: MUTED }) + 4
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    const foot = doc.internal.pageSize.getHeight() - 10
    text('This is a computer-generated invoice and needs no signature.', MARGIN, foot, { size: 7.5, color: MUTED })
    text(`${invoice.invoiceNumber}  -  page ${page} of ${pages}`, right, foot, { size: 7.5, color: MUTED, align: 'right' })
  }

  return doc
}

/** Fetches one invoice and saves its PDF. Throws what the API throws. */
export async function downloadInvoicePdf(invoiceId) {
  const [invoice, { jsPDF }, { default: autoTable }] = await Promise.all([
    api(`franchise/invoices?id=${encodeURIComponent(invoiceId)}`),
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  buildInvoicePdf(invoice, { jsPDF, autoTable }).save(invoiceFileName(invoice))
}
