// Money for jsPDF documents, which cannot print a rupee sign (decision 0007).
//
// The built-in PDF fonts (Helvetica and friends) are WinAnsi-encoded, and
// U+20B9 has no WinAnsi slot: jsPDF writes it as two raw bytes that a reader
// shows as a space and a small raised 1 in front of the amount. "Rs." is plain
// ASCII and survives every font. The same goes for any character outside
// cp1252, so a PDF built here uses "x" and "-", never an arrow or a symbol.
//
// The internal app has the same module (frontend/src/lib/pdfCurrency.js). The
// two apps share no code, so the rule is written once in each. Screens keep
// using ₹ through lib/format.js.

export const PDF_CURRENCY = 'Rs.'

const grouped = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "Rs. 1,23,456.78": Indian grouping, as on screen, with an ASCII prefix. */
export const pdfMoney = (value) => `${PDF_CURRENCY} ${grouped.format(Number(value) || 0)}`

/** "1,23,456.78", for a table column whose heading already says rupees. */
export const pdfAmount = (value) => grouped.format(Number(value) || 0)
