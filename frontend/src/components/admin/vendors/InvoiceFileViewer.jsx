// The scanned invoice, shown inline.
//
// WHY THIS EXISTS
//
// The purchase manager's stock-in screens render `<img src={invoice_image_url}>`
// and, when the file is a PDF, fall back to a bare "Open PDF" button. Almost
// every invoice in this system is a PDF, so in practice opening a receipt's
// details showed no invoice at all — you had to leave the page to see the one
// document you opened the record for. This renders both kinds in place.
//
// A PDF goes in an <iframe>. Supabase serves the invoices bucket publicly with
// no frame-ancestors restriction, so the browser's built-in PDF viewer handles
// it. An iframe cannot report a load failure the way an <img> can — no error
// event fires for an HTTP error inside it — so the escape hatch is not hidden
// behind a failure state: the open and download actions are always on screen.
//
// Expanding uses a real overlay rather than the browser's fullscreen API, which
// is blocked inside the modal this usually renders in.

import { useEffect, useState } from 'react'
import { invoiceFileKind, invoiceFileName } from '../../../lib/vendorManagement'

// Supabase storage honours ?download=<name>, which turns a cross-origin URL the
// browser would otherwise just navigate to into an actual save. A plain
// <a download> cannot do this across origins.
const downloadHref = (url, fileName) =>
  `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName || 'invoice')}`

// FitH so a portrait invoice fills the width it is given rather than opening at
// some arbitrary zoom the reader has to correct every single time.
const pdfHref = (url) => `${url}#view=FitH&navpanes=0`

const ActionButton = ({ children, ...rest }) => (
  <a
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/30 text-xs font-semibold text-foreground hover:border-accent/60 hover:text-accent transition-colors"
    {...rest}
  >
    {children}
  </a>
)

const Frame = ({ children, className = '' }) => (
  <div
    className={`rounded-lg border border-border bg-muted/20 overflow-hidden ${className}`}
  >
    {children}
  </div>
)

const Placeholder = ({ title, detail }) => (
  <Frame className="px-4 py-8 text-center">
    <p className="text-sm font-semibold text-foreground">{title}</p>
    {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
  </Frame>
)

/* ------------------------------------------------------------------ *
 * Expanded overlay
 * ------------------------------------------------------------------ */

const ExpandedOverlay = ({ url, kind, fileName, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      // z-60 so it sits above the record modal that opened it, which is z-50.
      className="fixed inset-0 z-[60] bg-black/85 flex flex-col p-3 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex items-center justify-between gap-3 mb-3 shrink-0"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-semibold text-white truncate">{fileName}</p>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/25 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
          >
            Open in new tab
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invoice preview"
            className="w-8 h-8 rounded-lg border border-white/25 bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 rounded-lg overflow-hidden bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {kind === 'pdf' ? (
          <iframe src={pdfHref(url)} title={fileName} className="w-full h-full border-0" />
        ) : (
          <div className="w-full h-full overflow-auto flex items-center justify-center bg-neutral-900">
            <img src={url} alt={fileName} className="max-w-full max-h-full object-contain" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Viewer
 * ------------------------------------------------------------------ */

const InvoiceFileViewer = ({ url, height = 'h-[26rem]' }) => {
  const [expanded, setExpanded] = useState(false)
  // The failure is stored as the URL that failed rather than as a boolean, so
  // moving to the next invoice clears it for free. A boolean would need resetting
  // on every url change, and a missed reset makes a perfectly good invoice
  // inherit the previous one's error.
  const [failedUrl, setFailedUrl] = useState('')

  const kind = invoiceFileKind(url)
  const fileName = invoiceFileName(url)
  const imageFailed = !!url && failedUrl === url

  if (!url) {
    return (
      <Placeholder
        title="No invoice file attached"
        detail="This receipt was recorded without an uploaded invoice."
      />
    )
  }

  return (
    <div className="space-y-2">
      {kind === 'pdf' && (
        <Frame>
          <iframe
            src={pdfHref(url)}
            title={`Invoice ${fileName}`}
            className={`w-full ${height} border-0 bg-white`}
          />
        </Frame>
      )}

      {kind === 'image' &&
        (imageFailed ? (
          <Placeholder
            title="The invoice image could not be loaded"
            detail="The file may have been moved or removed from storage. Try opening it directly."
          />
        ) : (
          <Frame>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="block w-full cursor-zoom-in"
              aria-label="Expand invoice image"
            >
              <img
                src={url}
                alt={`Invoice ${fileName}`}
                onError={() => setFailedUrl(url)}
                className={`w-full ${height} object-contain bg-white`}
              />
            </button>
          </Frame>
        ))}

      {kind === 'unknown' && (
        <Placeholder
          title="Preview not available for this file type"
          detail={fileName || 'The attached file is neither a PDF nor an image.'}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(kind === 'pdf' || (kind === 'image' && !imageFailed)) && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/30 text-xs font-semibold text-foreground hover:border-accent/60 hover:text-accent transition-colors"
          >
            Expand
          </button>
        )}
        <ActionButton href={url}>Open in new tab</ActionButton>
        <ActionButton href={downloadHref(url, fileName)} download={fileName}>
          Download
        </ActionButton>
        {fileName && (
          <span className="text-[11px] text-muted-foreground truncate ml-auto max-w-[14rem]">
            {fileName}
          </span>
        )}
      </div>

      {expanded && (
        <ExpandedOverlay
          url={url}
          kind={kind}
          fileName={fileName}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  )
}

export default InvoiceFileViewer
