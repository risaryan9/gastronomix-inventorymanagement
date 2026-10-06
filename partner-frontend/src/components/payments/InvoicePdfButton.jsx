import { useState } from 'react'
import { downloadInvoicePdf } from '../../lib/invoicePdf.js'

/*
 * Downloads one invoice as a PDF (src/lib/invoicePdf.js). The PDF library is
 * fetched on the first press, so the button says it is working. A failure is
 * said next to the button, not in a browser alert (decision 0008).
 */
export default function InvoicePdfButton({ invoiceId, label = 'Download PDF', className = 'text-xs font-semibold text-accent-text hover:underline disabled:opacity-60' }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const download = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await downloadInvoicePdf(invoiceId)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <button type="button" onClick={download} disabled={busy} className={className}>
        {busy ? 'Preparing PDF…' : label}
      </button>
      {failed && <span role="alert" className="text-xs text-destructive">Could not make the PDF. Try again.</span>}
    </span>
  )
}
