// Full detail for a single audit event, in a right-hand drawer.
//
// The list answers "what happened"; this answers "what exactly, by whom, and
// from where". Only the facts a reviewer can act on — no stored-payload dumps,
// and a before/after table only where there genuinely is a before.

import { useEffect } from 'react'
import {
  DemoBadge,
  DiffTable,
  ItemsTable,
  KeyValueList,
  SectionTitle,
  SeverityPill,
} from './AuditPrimitives'
import {
  actorName,
  displayValue,
  eventKey,
  formatCurrency,
  formatIstDateTime,
  formatQtyWithUnit,
  formatRelative,
  metaFor,
  resolveMaterial,
  roleLabel,
} from '../../lib/auditEvents'

const Section = ({ title, hint, children }) => (
  <section>
    <SectionTitle hint={hint}>{title}</SectionTitle>
    {children}
  </section>
)

const Note = ({ tone = 'info', children }) => (
  <p
    className={`text-xs rounded-lg border px-3 py-2 ${
      tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        : 'border-border bg-muted/40 text-muted-foreground'
    }`}
  >
    {children}
  </p>
)

/* ----------------------- action-specific detail bodies ---------------------- */

const StockInBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Receipt">
        <KeyValueList
          rows={[
            { label: 'Type', value: displayValue(values.stock_in_type) },
            { label: 'Receipt date', value: displayValue(values.receipt_date) },
            { label: 'Supplier', value: displayValue(values.supplier_name) },
            { label: 'Invoice number', value: displayValue(values.invoice_number) },
            {
              label: 'Invoice image',
              value: values.invoice_image_url ? (
                <a
                  href={values.invoice_image_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline break-all"
                >
                  Open uploaded invoice
                </a>
              ) : (
                'None uploaded'
              ),
            },
            {
              label: 'Total cost',
              value: <span className="text-accent font-bold">{formatCurrency(values.total_cost)}</span>,
            },
          ]}
        />
      </Section>

      <Section title="Items received" hint="Line totals include GST where charged">
        <ItemsTable rows={description.items} />
      </Section>
    </>
  )
}

const InterCloudBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Transfer">
        <KeyValueList
          rows={[
            { label: 'Source kitchen', value: displayValue(values.source_cloud_kitchen_name) },
            { label: 'Destination kitchen', value: description.kitchen || '—' },
            {
              label: 'Value transferred',
              value: <span className="text-accent font-bold">{formatCurrency(values.total_cost)}</span>,
            },
          ]}
        />
      </Section>

      <Section title="Items received">
        <ItemsTable rows={description.items} />
      </Section>
    </>
  )
}

const AdjustmentBody = ({ event, description }) => {
  const oldValues = event.old_values || {}
  const change = description.change
  const material = change?.material || resolveMaterial(null, oldValues.raw_material_id)

  return (
    <>
      <Section title="Quantity override">
        <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Before</div>
            <div className="text-lg font-bold text-muted-foreground line-through">
              {formatQtyWithUnit(change?.from, material.unit)}
            </div>
          </div>
          <span aria-hidden className="text-2xl text-muted-foreground">→</span>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">After</div>
            <div className="text-lg font-bold text-foreground">
              {formatQtyWithUnit(change?.to, material.unit)}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Change</div>
            <div className={`text-lg font-bold ${change?.delta < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
              {change?.delta > 0 ? '+' : ''}
              {formatQtyWithUnit(change?.delta, material.unit)}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Stated reason">
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <p className="text-sm font-semibold text-foreground">{displayValue(oldValues.reason)}</p>
          {oldValues.details && <p className="text-sm text-muted-foreground">{oldValues.details}</p>}
        </div>
      </Section>

      <Section title="Record">
        <KeyValueList
          rows={[
            { label: 'Material', value: `${material.name} · ${material.code}` },
            { label: 'Kitchen', value: description.kitchen || '—' },
            { label: 'Adjustment type', value: displayValue(oldValues.adjustment_type) },
            { label: 'Requested amount', value: formatQtyWithUnit(oldValues.adjustment_amount, material.unit) },
            {
              label: 'Applied amount',
              value:
                change?.actual === null || change?.actual === undefined
                  ? '—'
                  : formatQtyWithUnit(change.actual, material.unit),
            },
          ]}
        />
      </Section>

      {change?.shortfall && (
        <Note tone="warn">
          The recorded new quantity and the quantity the FIFO consume could actually apply disagree
          ({formatQtyWithUnit(change.to, material.unit)} vs {formatQtyWithUnit(change.actual, material.unit)}).
          A decrement can only consume what the batches still hold, so the on-hand figure settled at the applied
          amount.
        </Note>
      )}
    </>
  )
}

const CatalogBody = ({ event, description }) => {
  const isStatusFlip = event.action === 'deactivate' || event.action === 'reactivate'
  const isCreate = event.action === 'create'
  const payload = event.new_values || event.old_values || {}

  if (isStatusFlip) {
    return (
      <>
        <Section title="Status change">
          <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-center gap-4">
            <span
              className={`px-3 py-1 rounded-md text-sm font-bold border ${
                event.action === 'deactivate'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              }`}
            >
              {event.action === 'deactivate' ? 'Active' : 'Inactive'}
            </span>
            <span aria-hidden className="text-2xl text-muted-foreground">→</span>
            <span
              className={`px-3 py-1 rounded-md text-sm font-bold border ${
                event.action === 'deactivate'
                  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {event.action === 'deactivate' ? 'Inactive' : 'Active'}
            </span>
          </div>
        </Section>

        <Section title="Material">
          <KeyValueList
            rows={[
              { label: 'Name', value: displayValue(payload.name) },
              { label: 'Code', value: displayValue(payload.code) },
              { label: 'Unit', value: displayValue(payload.unit) },
            ]}
          />
        </Section>
      </>
    )
  }

  return (
    <>
      <Section
        title={isCreate ? 'Material as created' : 'Field changes'}
        hint={isCreate ? null : 'Changed fields are highlighted'}
      >
        {isCreate ? (
          <KeyValueList
            rows={(description.fields || []).map((row) => ({
              label: row.label,
              value: displayValue(row.to),
            }))}
          />
        ) : (
          <DiffTable rows={description.fields || []} />
        )}
      </Section>

      {!isCreate && description.changes?.some((row) => row.key === 'unit' && row.changed) && (
        <Note tone="warn">
          The unit changed. Quantities already recorded against this material were entered under the old unit and
          are not restated.
        </Note>
      )}
    </>
  )
}

/* --------------------------------- drawer --------------------------------- */

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
  const key = eventKey(event)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="presentation" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${description.title} audit event detail`}
        className="relative w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto shadow-2xl"
      >
        {/* header */}
        <header className="sticky top-0 z-10 bg-card border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{description.title}</h2>
                <SeverityPill severity={event.severity} />
                {event.__demo && <DemoBadge />}
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
          {event.__demo && (
            <Note tone="warn">
              This is a placeholder entry rendered from the frontend so the layout can be reviewed before real
              events of this type exist. It was never written to <span className="font-mono">audit_events</span>.
            </Note>
          )}

          {meta.why && (
            <Section title="Why this is audited">
              <p className="text-sm text-muted-foreground">{meta.why}</p>
            </Section>
          )}

          {/* actor & request context */}
          <Section title="Who and from where">
            <KeyValueList
              rows={[
                { label: 'Actor', value: <span className="font-semibold text-foreground">{actorName(event)}</span> },
                {
                  label: 'Role at the time',
                  value: (
                    <span title="Recorded on the event, not joined live from users — roles can change afterwards">
                      {roleLabel(event.actor_role)}
                    </span>
                  ),
                },
                {
                  label: 'Cloud kitchen',
                  value:
                    event.category === 'catalog' ? (
                      <span className="text-accent">Global catalog (no kitchen)</span>
                    ) : (
                      description.kitchen || '—'
                    ),
                },
                {
                  label: 'IP address',
                  value: event.ip_address ? (
                    <span
                      className="font-mono"
                      title="Corroborating, not proof of origin — forwarded IP headers are client-supplied"
                    >
                      {event.ip_address}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not captured</span>
                  ),
                },
                {
                  label: 'User agent',
                  value: <span className="text-xs break-all">{displayValue(event.user_agent)}</span>,
                },
              ]}
            />
          </Section>

          {/* body */}
          {key === 'inventory_in:stock_in_received' && <StockInBody event={event} description={description} />}
          {key === 'inventory_in:inter_cloud_transfer_received' && (
            <InterCloudBody event={event} description={description} />
          )}
          {(key === 'inventory_in:inventory_increment' || key === 'inventory_out:inventory_decrement') && (
            <AdjustmentBody event={event} description={description} />
          )}
          {event.category === 'catalog' && <CatalogBody event={event} description={description} />}

          {/* linked events */}
          {event.correlation_id && (
            <Section title="Linked events">
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
