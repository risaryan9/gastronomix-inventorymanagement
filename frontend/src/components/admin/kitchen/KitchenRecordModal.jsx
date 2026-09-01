// The detail view for one record in a Kitchen Wise Overview ledger.
//
// LAYOUT
//
// Four bands, in the order you read them: the headline figure, the record's own
// fields, the line items, then the audit trail. Each band is titled and boxed so
// the eye can skip one whole band at a time — an undifferentiated stack of rows
// is what made the first version of this hard to read.
//
// The brand accent is used sparingly and only where it means something: the
// record glyph, the headline figure, section markers, and totals. It is not
// decoration sprinkled on borders.
//
// AUDIT
//
// The audit trail renders through the same describeEvent + EventBody pipeline as
// the Audits section, so a stock-in event here looks exactly like the same event
// there — a proper items table, a proper field diff — instead of the raw jsonb
// this used to dump on screen. Action-specific knowledge stays in
// lib/auditEvents.js, which is where the rest of the app already keeps it.
//
// The trail is folded shut by default: it is the least-read and longest part of
// the record. Whether one EXISTS is not hidden though — events load with the
// modal, so a record with none says so instead of offering an empty disclosure.

import { useEffect, useState } from 'react'
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock'
import EventBody from '../../audits/AuditEventBodies'
import { KeyValueList, SeverityPill } from '../../audits/AuditPrimitives'
import {
  actorName,
  describeEvent,
  fetchAuditLookups,
  fetchEntityAuditEvents,
  formatIstDateTime,
  formatRelative,
  metaFor,
  roleLabel,
} from '../../../lib/auditEvents'

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */

// The accent rule is the section marker — enough to separate bands without
// putting a colour on every border.
const SectionHeading = ({ children, hint }) => (
  <div className="flex items-baseline justify-between gap-3 mb-2">
    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-l-2 border-accent pl-2">
      {children}
    </h4>
    {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
  </div>
)

const Section = ({ title, hint, children }) => (
  <section>
    <SectionHeading hint={hint}>{title}</SectionHeading>
    {children}
  </section>
)

const Boxed = ({ children, className = '' }) => (
  <div className={`rounded-lg border border-border bg-muted/10 ${className}`}>{children}</div>
)

// Cells for the line-item tables the tabs pass in as children, matching the
// audit screens' tables so every table in the admin area reads the same.
export const DetailTh = ({ children, align = 'left' }) => (
  <th
    scope="col"
    className={`py-2 px-3 font-semibold text-foreground whitespace-nowrap ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
)

export const DetailTd = ({ children, align = 'left', className = '', ...rest }) => (
  <td
    className={`py-2 px-3 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    {...rest}
  >
    {children}
  </td>
)

/* ------------------------------------------------------------------ *
 * Audit trail
 * ------------------------------------------------------------------ */

const AuditEntry = ({ event, lookups }) => {
  const description = describeEvent(event, lookups)
  const meta = metaFor(event)

  return (
    <li className="rounded-lg border border-border overflow-hidden">
      <div className="bg-muted/30 border-b border-border px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span
            aria-hidden="true"
            className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold ${
              event.severity === 'critical'
                ? 'bg-destructive/15 text-red-300'
                : 'bg-accent/10 text-accent'
            }`}
          >
            {description.glyph}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{description.title}</p>
            {description.contextLine && (
              <p className="text-xs text-muted-foreground mt-0.5">{description.contextLine}</p>
            )}
          </div>
        </div>
        <SeverityPill severity={event.severity} />
      </div>

      <div className="p-4 space-y-4">
        <KeyValueList
          rows={[
            {
              label: 'Person',
              value: (
                <span className="font-semibold text-foreground">
                  {actorName(event)}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {roleLabel(event.actor_role)}
                  </span>
                </span>
              ),
            },
            {
              label: 'When',
              value: (
                <span>
                  {formatIstDateTime(event.created_at)}{' '}
                  <span className="text-muted-foreground">
                    · {formatRelative(event.created_at)}
                  </span>
                </span>
              ),
            },
          ]}
        />

        {/* Per-action body: items table, field diff, quantity change — whatever
            this particular action recorded. */}
        <EventBody event={event} description={description} />

        {meta.why && (
          <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">{meta.why}</p>
        )}
      </div>
    </li>
  )
}

const AuditTrail = ({ events, lookups, loading, error }) => {
  const [open, setOpen] = useState(false)

  if (loading) {
    return <p className="text-sm text-muted-foreground">Checking the audit trail…</p>
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (events.length === 0) {
    return (
      <Boxed className="px-4 py-3">
        <p className="text-sm text-muted-foreground">No audit log tied to this record.</p>
      </Boxed>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-2.5 text-left hover:border-accent/50 transition-colors"
      >
        <span
          aria-hidden="true"
          className={`text-accent transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <span className="text-sm font-semibold text-foreground">
          {events.length} audited {events.length === 1 ? 'action' : 'actions'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? 'Hide' : 'Show'} details
        </span>
      </button>

      {open && (
        <ul className="mt-3 space-y-3">
          {events.map((event) => (
            <AuditEntry key={event.id} event={event} lookups={lookups} />
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

const KitchenRecordModal = ({
  glyph = '•',
  title,
  subtitle,
  headline,
  fields = [],
  notes,
  // An optional band between the record's own fields and its line items, for a
  // record that has a document attached to it. Vendor Management puts the
  // scanned invoice here: it belongs with the receipt it documents, above the
  // lines it should be checked against, rather than in a separate window.
  media,
  mediaTitle = 'Attachment',
  // A record carrying a document needs more room than a plain ledger row.
  maxWidthClass = 'max-w-4xl',
  linesTitle = 'Items',
  linesHint,
  linesLoading,
  linesError,
  linesEmpty,
  linesEmptyText = 'No items recorded against this record.',
  children,
  auditEntityType,
  auditEntityId,
  onClose,
}) => {
  const [auditEvents, setAuditEvents] = useState([])
  const [lookups, setLookups] = useState(null)
  // Mounted per record, so the first render is already the loading one and the
  // effect never has to set that flag synchronously.
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState('')

  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    let cancelled = false

    Promise.all([fetchEntityAuditEvents(auditEntityType, auditEntityId), fetchAuditLookups()])
      .then(([events, referenceData]) => {
        if (cancelled) return
        setAuditEvents(events)
        setLookups(referenceData)
      })
      .catch((err) => {
        console.error('Error loading audit events:', err)
        if (!cancelled) setAuditError('Could not load the audit trail for this record.')
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [auditEntityType, auditEntityId])

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`bg-card border-2 border-border rounded-xl w-full ${maxWidthClass} max-h-[90vh] flex flex-col shadow-xl`}
      >
        <header className="shrink-0 p-5 border-b border-border flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span
              aria-hidden="true"
              className="shrink-0 w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center text-base font-bold"
            >
              {glyph}
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-foreground">{title}</h3>
              {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {headline && (
            <div className="rounded-lg bg-accent/10 border border-accent/40 px-4 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              {headline.map((item) => (
                <div key={item.label}>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="text-lg font-bold text-accent">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {fields.length > 0 && (
            <Section title="Details">
              <Boxed className="px-4">
                <KeyValueList rows={fields} />
              </Boxed>
            </Section>
          )}

          {notes && (
            <Section title="Notes">
              <Boxed className="px-4 py-3">
                <p className="text-sm text-foreground whitespace-pre-line">{notes}</p>
              </Boxed>
            </Section>
          )}

          {media && <Section title={mediaTitle}>{media}</Section>}

          <Section title={linesTitle} hint={linesHint}>
            {linesLoading ? (
              <p className="text-sm text-muted-foreground">Loading items…</p>
            ) : linesError ? (
              <p className="text-sm text-destructive">{linesError}</p>
            ) : linesEmpty ? (
              <Boxed className="px-4 py-3">
                <p className="text-sm text-muted-foreground">{linesEmptyText}</p>
              </Boxed>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">{children}</div>
            )}
          </Section>

          <Section title="Audit trail">
            <AuditTrail
              events={auditEvents}
              lookups={lookups}
              loading={auditLoading}
              error={auditError}
            />
          </Section>
        </div>
      </div>
    </div>
  )
}

export default KitchenRecordModal
