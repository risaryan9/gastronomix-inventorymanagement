# 0007. Money in a PDF goes through `pdfCurrency`, because jsPDF cannot print ₹

Date: 2026-09-03 (recorded); decided 2026-08
Status: Accepted

## Context

Every PDF export built amounts as `` `₹${n.toFixed(2)}` `` and every one of them
printed a stray superscript 1 in front of the number — the challan total, Stock
In, and both Inventory reports.

The built-in PDF fonts (Helvetica and friends) are WinAnsi-encoded. jsPDF
transcodes what cp1252 can hold — em dash, bullet, curly quotes, `×` all come
out right — and emits anything unmappable as its two raw UTF-16 bytes. U+20B9
has no WinAnsi slot, so `₹` is written as `0x20 0xB9`, which a reader decodes as
space + `¹`.

(An earlier commit claimed jsPDF truncates to the low byte. It does not; that
explanation is wrong and is corrected here.)

## Decision

`frontend/src/lib/pdfCurrency.js` is the one place that knows this. Use
`pdfMoney(value)` — or `PDF_CURRENCY` if you are composing the string yourself —
in **every** jsPDF export. It renders `Rs.`, which is plain ASCII and survives
every font.

The same trap applies to any non-cp1252 character, not just the rupee sign. The
kitchen stock-out report printed `→` as `!'` for exactly this reason and now
uses `->`.

## Alternatives

**Embed a Unicode font.** The correct fix in the abstract, and rejected for the
weight: every export would carry a font subset for one glyph. Revisit if these
documents ever need Devanagari or a currency symbol that has no ASCII fallback.

## Consequences

- **Screen, CSV and Excel output are unaffected** and still use `₹` — see
  `lib/formatNumbers.js`. Only the jsPDF path is constrained.
- A new PDF export that formats its own money will reproduce the bug. This is
  the single most repeatable mistake in the export code.
- Non-ASCII decoration in a PDF (arrows, symbols) needs the same check.

## Where it lives

- `frontend/src/lib/pdfCurrency.js`
- Consumers: `lib/vendorReportExports.js`, `pages/purchase-manager/Inventory.jsx`,
  `pages/purchase-manager/StockIn.jsx`, `pages/purchase-manager/StockOut.jsx`,
  `pages/supervisor/Inventory.jsx`
- Commits `fabda11`, `96816c9`
