# 0021. A FOFO invoice's PDF is drawn in the browser from the invoice as issued, and the seller on it is configuration

Date: 2026-10-06
Status: Accepted (temporary)

## Context

A franchise needs its invoices as PDFs. Three things had to be settled that the
code cannot explain from one file.

1. **Where the PDF is made.** The spec's API table listed a server endpoint
   (`GET /api/invoices/:id/pdf`). The internal app makes every PDF in the
   browser with jsPDF.
2. **What it is drawn from.** An order's lines and a franchise's details both
   change; an invoice must not (decision 0016).
3. **Who the seller is.** A tax invoice names the seller's legal name, address
   and GSTIN. Nothing in the database holds them: there is one seller, and
   `fofo.invoices` freezes the buyer but has no seller columns (migration 07).

## Decision

**The PDF is drawn in the browser** (`partner-frontend/src/lib/invoicePdf.js`),
from `GET /api/franchise/invoices?id=`. jsPDF is loaded only when someone
downloads an invoice.

**It prints the invoice as issued.** The endpoint returns the buyer and the
lines frozen on the invoice, and the amounts the database stored. The builder
recomputes nothing. What has been paid against the invoice is a separate block
under the totals, because that part does change.

**Store credit appears with the payments, never as a discount line** (decision
0013), and money goes through `pdfCurrency` (decision 0007).

**The seller comes from server configuration**: `SELLER_LEGAL_NAME`,
`SELLER_GSTIN`, `SELLER_ADDRESS` (`partner-frontend/.env.example`), returned
with each invoice.

## Alternatives

**A server endpoint that returns a PDF.** One place to change the layout, and a
file an email could attach. Rejected for now: it puts jsPDF in a serverless
function to produce what the browser already can, and nothing emails invoices
yet. If invoices are ever emailed, the builder takes its libraries as
arguments and already runs under Node.

**Seller columns on `fofo.invoices`, frozen at issue like the buyer.** The
correct design, and the reason this record is temporary. Not done here because
it means replacing `mark_order_paid` and deciding what the invoices already
issued should say.

## Consequences

- **Changing the seller configuration changes how old invoices print.** A new
  address or GSTIN appears on last year's PDFs. Until the seller is frozen on
  the invoice, do not change these values without knowing that.
- **With the configuration unset, an invoice prints "Gastronomix" and no
  GSTIN**, which is not a valid tax invoice. Set all three before a real
  franchise downloads one.
- **GST is one figure per rate.** The CGST/SGST/IGST split and the place of
  supply are not designed (migration 07), so they are not printed. Whether the
  layout is acceptable as a tax invoice is the accountant's decision and has
  not been given.
- **An invoice line has no unit of its own.** The endpoint reads it from the
  matching order line for goods invoices, and prints the bare quantity when the
  match fails (a renamed material). Freezing the unit on the line belongs with
  the seller columns.

## Where it lives

- `partner-frontend/src/lib/invoicePdf.js`, `src/lib/pdfCurrency.js`,
  `src/components/payments/InvoicePdfButton.jsx`
- `partner-frontend/api/_lib/orders.js` (`getInvoice`, `seller`)
- `partner-frontend/.env.example`
