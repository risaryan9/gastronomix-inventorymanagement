// Money for jsPDF documents, which cannot print a rupee sign.
//
// The built-in PDF fonts (Helvetica and friends) are WinAnsi-encoded. jsPDF
// maps what it can into cp1252 — em dash, bullet, curly quotes and × all come
// out right — but U+20B9 has no WinAnsi slot, so it is written as its two raw
// UTF-16 bytes, 0x20 0xB9. A reader decodes that as space + "¹", which is why
// an unfixed total prints as a small raised 1 in front of the amount.
//
// "Rs." is plain ASCII and survives every font. Screen and CSV/Excel output are
// not affected by any of this and keep using ₹ — see formatNumbers.js.

export const PDF_CURRENCY = 'Rs.'

// Mirrors the `₹${n.toFixed(2)}` shape the exports used before.
export const pdfMoney = (value) => `${PDF_CURRENCY} ${(parseFloat(value) || 0).toFixed(2)}`
