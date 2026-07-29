// Full detail for a single audit event, in a right-hand drawer.
//
// The list answers "what happened"; this answers "what exactly, by whom, and
// from where". The per-event body lives in AuditEventBodies.jsx.

import { useEffect } from 'react'
import { KeyValueList, SectionTitle, SeverityPill } from './AuditPrimitives'
import EventBody, { Note } from './AuditEventBodies'
import {
  actorName,
  displayValue,
  formatIstDateTime,
  formatRelative,
  metaFor,
  roleLabel,
} from '../../lib/auditEvents'

const Section = ({ title, children }) => (
  <section>
    <SectionTitle>{title}</SectionTitle>
    {children}
  </section>
)

const AuditDetailDrawer = ({ event, description, correlated = [], correlatedLoading, onClose }) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!event) return null

  const meta = metaFor(event)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="presentation" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${description.title} audit event detail`}
        className="relative w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto shadow-2xl"
      >
        <header className="sticky top-0 z-10 bg-card border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{description.title}</h2>
                <SeverityPill severity={event.severity} />
              </div>
              {description.contextLine && (
                <p className="text-sm text-muted-foreground mt-1">{description.contextLine}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail"
              className="shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="text-foreground font-semibold">{formatIstDateTime(event.created_at)}</span>
            <span>{formatRelative(event.created_at)}</span>
          </div>
        </header>

        <div className="p-5 space-y-6">
          {meta.why && (
            <Section title="Why this is audited">
              <p className="text-sm text-muted-foreground">{meta.why}</p>
            </Section>
          )}

          <Section title="Who and from where">
            <KeyValueList
              rows={[
                { label: 'Person', value: <span className="font-semibold text-foreground">{actorName(event)}</span> },
                { label: 'Role', value: roleLabel(event.actor_role) },
                {
                  label: 'Cloud kitchen',
                  value:
                    event.category === 'catalog' ? (
                      <span className="text-accent">Applies to every kitchen</span>
                    ) : (
                      description.kitchen || '—'
                    ),
                },
                {
                  label: 'IP address',
                  value: event.ip_address ? (
                    <span className="font-mono">{event.ip_address}</span>
                  ) : (
                    <span className="text-muted-foreground">Not captured</span>
                  ),
                },
                { label: 'Device', value: <span className="text-xs break-all">{displayValue(event.user_agent)}</span> },
              ]}
            />
          </Section>

          <EventBody event={event} description={description} />

          {event.correlation_id && (
            <Section title="Related activity">
              {correlatedLoading ? (
                <p className="text-sm text-muted-foreground">Looking for related events…</p>
              ) : correlated.length ? (
                <ul className="space-y-2">
                  {correlated.map((related) => (
                    <li
                      key={related.id}
                      className="rounded-lg border border-border bg-muted/20 px-3 py-2 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{metaFor(related).label}</div>
                        <div className="text-xs text-muted-foreground">
                          {actorName(related)} · {formatIstDateTime(related.created_at)}
                        </div>
                      </div>
                      <SeverityPill severity={related.severity} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No other event is linked to this one.</p>
              )}
            </Section>
          )}
        </div>
      </aside>
    </div>
  )
}

export default AuditDetailDrawer
