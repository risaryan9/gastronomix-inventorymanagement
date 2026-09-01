// One purchase invoice, in full: the receipt's own fields, the scanned document,
// the lines it created, and the audit trail behind it.
//
// The lines are already in hand — the tab fetched them with the invoices, in one
// query — so unlike the kitchen ledgers this modal opens with its items already
// populated and never shows a loading state for them.

import KitchenRecordModal, {
  DetailTd,
  DetailTh,
} from '../kitchen/KitchenRecordModal'
import InvoiceFileViewer from './InvoiceFileViewer'
import { formatDay, money, quantity } from '../../../lib/formatNumbers'

const VendorInvoiceModal = ({ invoice, onClose }) => {
  const linesTotal = invoice.lines.reduce((sum, line) => sum + line.lineTotal, 0)

  return (
    <KitchenRecordModal
      glyph="₹"
      title={`Invoice ${invoice.invoiceNumber || '—'}`}
      subtitle={`${invoice.vendorName} · ${formatDay(invoice.receiptDate)}`}
      maxWidthClass="max-w-5xl"
      headline={[
        { label: 'Invoice total', value: money(invoice.amount) },
        { label: 'Net', value: money(invoice.netAmount) },
        { label: 'GST', value: money(invoice.gstAmount) },
        { label: 'Lines', value: invoice.itemCount },
      ]}
      fields={[
        { label: 'Vendor', value: invoice.vendorName },
        { label: 'Invoice number', value: invoice.invoiceNumber || '—' },
        { label: 'Received on', value: formatDay(invoice.receiptDate) },
        { label: 'Cloud kitchen', value: invoice.kitchenName },
        { label: 'Received by', value: invoice.receivedByName },
        ...(invoice.linked
          ? []
          : [
              {
                label: 'Vendor link',
                value: (
                  <span className="text-yellow-500">
                    This supplier name does not match any vendor record
                  </span>
                ),
              },
            ]),
      ]}
      notes={invoice.notes}
      mediaTitle="Invoice document"
      media={<InvoiceFileViewer url={invoice.invoiceUrl} />}
      linesTitle="Items on this invoice"
      linesHint={`${invoice.itemCount} material${invoice.itemCount === 1 ? '' : 's'}`}
      linesEmpty={invoice.lines.length === 0}
      linesEmptyText="No items were recorded against this invoice."
      auditEntityType="stock_in"
      auditEntityId={invoice.id}
      onClose={onClose}
    >
      <table className="w-full text-sm min-w-[44rem]">
        <thead className="bg-muted/50">
          <tr>
            <DetailTh>Material</DetailTh>
            <DetailTh align="right">Purchased</DetailTh>
            <DetailTh align="right">Still unused</DetailTh>
            <DetailTh align="right">Unit cost</DetailTh>
            <DetailTh align="right">GST</DetailTh>
            <DetailTh align="right">Line total</DetailTh>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-t border-border">
              <DetailTd>
                <div className="font-medium text-foreground">{line.name}</div>
                {line.code && <div className="text-xs text-muted-foreground">{line.code}</div>}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-foreground whitespace-nowrap">
                {quantity(line.quantity)}
                <span className="text-muted-foreground"> {line.unit}</span>
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-muted-foreground">
                {quantity(line.remaining)}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-foreground whitespace-nowrap">
                {money(line.unitCost)}
              </DetailTd>
              <DetailTd align="right" className="tabular-nums text-muted-foreground">
                {line.gstPercent ? `${line.gstPercent}%` : '—'}
              </DetailTd>
              <DetailTd
                align="right"
                className="tabular-nums font-semibold text-foreground whitespace-nowrap"
              >
                {money(line.lineTotal)}
              </DetailTd>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30">
          <tr className="border-t border-border">
            <DetailTd colSpan={5} className="text-xs uppercase tracking-wide text-muted-foreground">
              {/* The recorded invoice total is the figure of record; if the lines
                  do not add up to it, that discrepancy is worth seeing rather
                  than hiding behind whichever number we chose to print. */}
              {Math.abs(linesTotal - invoice.amount) > 1
                ? `Lines total ${money(linesTotal)} · recorded invoice total ${money(invoice.amount)}`
                : `${invoice.lines.length} item${invoice.lines.length === 1 ? '' : 's'}`}
            </DetailTd>
            <DetailTd
              align="right"
              className="tabular-nums font-bold text-accent whitespace-nowrap"
            >
              {money(invoice.amount)}
            </DetailTd>
          </tr>
        </tfoot>
      </table>
    </KitchenRecordModal>
  )
}

export default VendorInvoiceModal
