// Downloads.
//
// Every report here is built from what is on screen — the period, the kitchen
// scope, and the filters set on the Invoices and Materials tabs. A register
// downloaded while a vendor filter is on contains that vendor and says so on its
// summary sheet, because the alternative (silently exporting everything) hands
// somebody a spreadsheet that does not match the screen they were reading.
//
// Each card therefore states its own row count before you click, so an empty
// download is visible as empty beforehand rather than discovered in Excel.

import { useState } from 'react'
import { useToast } from '../../../context/toastContext'
import { count, money } from '../../../lib/formatNumbers'
import {
  exportInvoiceRegisterExcel,
  exportInvoiceRegisterPdf,
  exportVendorMaterialsExcel,
  exportVendorMaterialsPdf,
  exportVendorStatementExcel,
  exportVendorStatementPdf,
  exportVendorSummaryExcel,
  exportVendorSummaryPdf,
} from '../../../lib/vendorReportExports'

const ReportCard = ({ title, description, scope, stats, disabled, onExcel, onPdf, busy }) => (
  <div className="bg-card border-2 border-border rounded-xl p-5 flex flex-col gap-4">
    <div>
      <h3 className="text-base font-bold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>

    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="text-base font-bold text-foreground tabular-nums">{stat.value}</dd>
        </div>
      ))}
    </dl>

    {scope && (
      <p className="text-xs text-muted-foreground border-l-2 border-accent/50 pl-2.5">{scope}</p>
    )}

    <div className="flex flex-wrap gap-2 mt-auto pt-1">
      <button
        type="button"
        onClick={onExcel}
        disabled={disabled || busy}
        className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-bold hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy === 'excel' ? 'Preparing…' : 'Excel'}
      </button>
      <button
        type="button"
        onClick={onPdf}
        disabled={disabled || busy}
        className="px-4 py-2 rounded-lg border border-border bg-muted/40 text-sm font-bold text-foreground hover:border-accent/60 hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy === 'pdf' ? 'Preparing…' : 'PDF'}
      </button>
      {disabled && (
        <span className="self-center text-xs text-muted-foreground">Nothing to export</span>
      )}
    </div>
  </div>
)

const VendorReportsTab = ({
  vendors,
  invoices,
  materials,
  options,
  invoiceScopeNote,
  materialScopeNote,
}) => {
  const toast = useToast()
  const [busy, setBusy] = useState({})

  // Writing a workbook is synchronous and blocks the frame, so the button has to
  // repaint as busy before it starts — hence the deferral rather than a bare
  // call in the click handler.
  const run = (key, format, write) => {
    setBusy({ [key]: format })
    setTimeout(() => {
      try {
        write()
      } catch (err) {
        console.error(`Error exporting ${key}:`, err)
        toast.error('Could not build the report', err.message)
      } finally {
        setBusy({})
      }
    }, 0)
  }

  const spendingVendors = vendors.filter((vendor) => vendor.invoiceCount > 0)
  const totalSpend = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  const missingFiles = invoices.filter((invoice) => !invoice.hasInvoiceFile).length

  // A statement is per vendor, so it needs one chosen. Defaults to the biggest
  // spender, which is the one most likely to be asked about.
  const [statementVendorId, setStatementVendorId] = useState('')
  const statementVendor =
    vendors.find((vendor) => vendor.id === statementVendorId) ??
    [...spendingVendors].sort((a, b) => b.spend - a.spend)[0] ??
    null

  const statementInvoices = statementVendor
    ? invoices.filter((invoice) => invoice.vendorId === statementVendor.id)
    : []
  const statementMaterials = statementVendor
    ? materials.filter((material) => material.vendorId === statementVendor.id)
    : []

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReportCard
        title="Vendor spend summary"
        description="One row per vendor: invoices, net, GST, total spend and how recently they were bought from."
        scope="Covers every vendor in the table plus any unlinked supplier name found on a receipt, so the total reconciles with the stock-in ledger."
        stats={[
          { label: 'Vendors', value: count(vendors.length) },
          { label: 'With spend', value: count(spendingVendors.length) },
          { label: 'Total', value: money(vendors.reduce((sum, v) => sum + v.spend, 0)) },
        ]}
        disabled={vendors.length === 0}
        busy={busy.summary}
        onExcel={() => run('summary', 'excel', () => exportVendorSummaryExcel(vendors, options))}
        onPdf={() => run('summary', 'pdf', () => exportVendorSummaryPdf(vendors, options))}
      />

      <ReportCard
        title="Invoice register"
        description="Every invoice with its vendor, kitchen, receiver, amounts and file link — plus a sheet of individual invoice lines."
        scope={invoiceScopeNote}
        stats={[
          { label: 'Invoices', value: count(invoices.length) },
          { label: 'Total', value: money(totalSpend) },
          { label: 'Missing files', value: count(missingFiles) },
        ]}
        disabled={invoices.length === 0}
        busy={busy.register}
        onExcel={() =>
          run('register', 'excel', () => exportInvoiceRegisterExcel(invoices, options))
        }
        onPdf={() => run('register', 'pdf', () => exportInvoiceRegisterPdf(invoices, options))}
      />

      <ReportCard
        title="Vendor material detail"
        description="Vendor by material: quantity bought, average and last unit cost, and total spend. Flags materials whose catalogue vendor disagrees with who they were bought from."
        scope={materialScopeNote}
        stats={[
          { label: 'Pairs', value: count(materials.length) },
          {
            label: 'Purchased',
            value: count(materials.filter((material) => material.purchaseCount > 0).length),
          },
          {
            label: 'Mismatches',
            value: count(materials.filter((material) => material.catalogueMismatch).length),
          },
        ]}
        disabled={materials.length === 0}
        busy={busy.materials}
        onExcel={() =>
          run('materials', 'excel', () => exportVendorMaterialsExcel(materials, options))
        }
        onPdf={() => run('materials', 'pdf', () => exportVendorMaterialsPdf(materials, options))}
      />

      <div className="bg-card border-2 border-border rounded-xl p-5 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-foreground">Single vendor statement</h3>
          <p className="text-sm text-muted-foreground mt-1">
            One vendor’s whole period — totals, every invoice, and every material bought. The one to
            send when a payment is queried.
          </p>
        </div>

        <div>
          <label
            htmlFor="statement-vendor"
            className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5"
          >
            Vendor
          </label>
          <select
            id="statement-vendor"
            value={statementVendor?.id ?? ''}
            onChange={(event) => setStatementVendorId(event.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {vendors.length === 0 && <option value="">No vendors</option>}
            {[...vendors]
              .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
              .map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name} — {money(vendor.spend)}
                </option>
              ))}
          </select>
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Invoices</dt>
            <dd className="text-base font-bold text-foreground tabular-nums">
              {count(statementInvoices.length)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Materials</dt>
            <dd className="text-base font-bold text-foreground tabular-nums">
              {count(statementMaterials.length)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Spend</dt>
            <dd className="text-base font-bold text-foreground tabular-nums">
              {money(statementVendor?.spend ?? 0)}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground border-l-2 border-accent/50 pl-2.5">
          Always the vendor’s full period, ignoring the filters on the other tabs — a statement with
          invoices quietly removed from it is worse than no statement.
        </p>

        <div className="flex flex-wrap gap-2 mt-auto pt-1">
          <button
            type="button"
            onClick={() =>
              run('statement', 'excel', () =>
                exportVendorStatementExcel(
                  statementVendor,
                  statementInvoices,
                  statementMaterials,
                  options
                )
              )
            }
            disabled={!statementVendor || !!busy.statement}
            className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-bold hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy.statement === 'excel' ? 'Preparing…' : 'Excel'}
          </button>
          <button
            type="button"
            onClick={() =>
              run('statement', 'pdf', () =>
                exportVendorStatementPdf(
                  statementVendor,
                  statementInvoices,
                  statementMaterials,
                  options
                )
              )
            }
            disabled={!statementVendor || !!busy.statement}
            className="px-4 py-2 rounded-lg border border-border bg-muted/40 text-sm font-bold text-foreground hover:border-accent/60 hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy.statement === 'pdf' ? 'Preparing…' : 'PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default VendorReportsTab
