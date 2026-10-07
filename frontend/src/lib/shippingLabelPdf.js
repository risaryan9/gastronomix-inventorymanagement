// The shipping label for a FOFO order: the sheet stuck on the parcel.
//
// WHAT IS ON IT, top to bottom, following the label the business already
// prints from its billing software. (That sample is not kept in the repo: it
// carries a real customer's address and phone number.)
//
//   SHIPPING TO     the franchise, its phone, the outlet, the address
//   INVOICE         the goods invoice's number and date, and the number again
//                   as a Code 128 barcode on the right
//   SENDER DETAILS  the seller's legal name, address and GSTIN
//   the line asking for an undelivered parcel to come back
//
// Everything is printed in capitals, as the sample is.
//
// WHERE THE WORDS COME FROM. GET /api/staff/orders/label on the partner server
// (lib/fofoStaffApi.js). This file decides nothing about who the parcel goes
// to or who sent it; it only lays out what it is given. The sender in
// particular is the same seller configuration the invoice prints, so the label
// and the invoice in one box cannot disagree.
//
// ONE A4 PAGE, LABEL IN THE TOP HALF, as the sample. Printed on plain paper and
// cut, or on an A4 label sheet.
//
// THE DATE IS THE INVOICE'S BUSINESS DAY, which is its UTC date (decision
// 0002), so the label shows the same date as the invoice it travels with.
//
// PURE. buildShippingLabelPdf takes jsPDF as an argument and touches no
// browser API, so it can be run under Node to check a layout. The two things
// that need a browser, printing and saving, are at the bottom.

import { code128ModuleCount, code128Widths } from './code128'
import { formatDay } from './formatNumbers'

const MARGIN = 14 // mm, left and right
const TEXT_SIZE = 13 // pt
const LINE = 7.6 // mm between baselines
const BARCODE_WIDTH = 54 // mm
const BARCODE_HEIGHT = 16 // mm
const INK = [0, 0, 0]
const RULE = [150, 150, 150]

const upper = (value) => String(value ?? '').trim().toUpperCase()

export const shippingLabelFileName = (label) =>
  `Label-${label.orderNumber}-${label.invoice.number}`.replace(/[^A-Za-z0-9-]+/g, '-') + '.pdf'

/**
 * Draws the label and returns the jsPDF document.
 * `label` is the response of GET /api/staff/orders/label?id=.
 */
export function buildShippingLabelPdf(label, { jsPDF }) {
  const doc = new jsPDF('p', 'mm', 'a4')
  const right = doc.internal.pageSize.getWidth() - MARGIN
  const { shipTo, invoice, sender } = label

  // Writes one or more lines in capitals and returns the y of the next line.
  const write = (value, y, { size = TEXT_SIZE, maxWidth = right - MARGIN } = {}) => {
    const text = upper(value)
    if (!text) return y
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...INK)
    // Line by line, so a wrapped address is spaced like every other line.
    const step = LINE * (size / TEXT_SIZE)
    const lines = doc.splitTextToSize(text, maxWidth)
    lines.forEach((line, index) => doc.text(line, MARGIN, y + index * step))
    return y + lines.length * step
  }
  const rule = (y) => {
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.25)
    doc.line(MARGIN, y, right, y)
  }

  let y = 18
  y = write('Shipping to:', y)
  y = write(shipTo.name, y)
  if (shipTo.phone) y = write(`Phone: ${shipTo.phone}`, y)
  y = write(shipTo.outletName, y)
  y = write(shipTo.address, y, { maxWidth: 135 })
  y = write(shipTo.city, y)

  // The invoice on the left, its number as a barcode on the right.
  y += 4
  const invoiceTop = y
  y = write(`Invoice #: ${invoice.number}`, y, { maxWidth: right - MARGIN - BARCODE_WIDTH - 8 })
  y = write(`Invoice date: ${formatDay(invoice.issuedAt)}`, y)

  const barcodeLeft = right - BARCODE_WIDTH
  const barcodeTop = invoiceTop - 5
  const module = BARCODE_WIDTH / code128ModuleCount(invoice.number)
  doc.setFillColor(...INK)
  let x = barcodeLeft
  code128Widths(invoice.number).forEach((width, index) => {
    // Even positions are bars, odd ones the spaces between them.
    if (index % 2 === 0) doc.rect(x, barcodeTop, width * module, BARCODE_HEIGHT, 'F')
    x += width * module
  })
  doc.setFont('courier', 'normal')
  doc.setFontSize(8)
  doc.text(invoice.number, barcodeLeft + BARCODE_WIDTH / 2, barcodeTop + BARCODE_HEIGHT + 3.5, { align: 'center' })

  y = Math.max(y, barcodeTop + BARCODE_HEIGHT + 6) - 2
  rule(y)

  y += 7
  y = write('Sender details:', y)
  y = write(sender.name, y, { size: 12 })
  y = write(sender.address, y, { maxWidth: 88 })
  if (sender.gstin) y = write(`GSTIN: ${sender.gstin}`, y + 1)

  y -= 3
  rule(y)
  write('If undelivered, please return it to the sender.', y + 4.5, { size: 8 })

  return doc
}

/**
 * Opens the browser's print dialog on a PDF, without leaving the page: the PDF
 * is loaded into a hidden frame and that frame is printed.
 *
 * If the browser will not print a framed PDF (some block it), the PDF is opened
 * in a new tab instead, where its own print button works. The frame is removed
 * the next time something is printed, not straight away: removing it while the
 * dialog is open cancels the print in some browsers.
 */
export function printPdf(doc) {
  const url = URL.createObjectURL(doc.output('blob'))
  document.getElementById('pdf-print-frame')?.remove()
  const frame = document.createElement('iframe')
  frame.id = 'pdf-print-frame'
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  frame.src = url
  frame.onload = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch {
      window.open(url, '_blank', 'noopener')
    }
  }
  document.body.appendChild(frame)
}
