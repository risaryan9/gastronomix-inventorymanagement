// The middle of the detail drawer: what actually happened, per kind of event.
//
// One file so that adding a subsection means adding a branch here rather than
// touching the drawer. Everything shown is a business fact an administrator can
// act on — no record ids, no stored payloads.

import {
  DiffTable,
  ItemsTable,
  KeyValueList,
  QuantityDiffTable,
  SectionTitle,
} from './AuditPrimitives'
import {
  displayValue,
  eventKey,
  formatCurrency,
  formatQty,
  formatQtyWithUnit,
  resolveMaterial,
} from '../../lib/auditEvents'

const Section = ({ title, hint, children }) => (
  <section>
    <SectionTitle hint={hint}>{title}</SectionTitle>
    {children}
  </section>
)

export const Note = ({ tone = 'info', children }) => (
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

/* ------------------------------ inventory in ------------------------------ */

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
          The recorded new quantity and the amount that could actually be taken out of stock disagree
          ({formatQtyWithUnit(change.to, material.unit)} vs {formatQtyWithUnit(change.actual, material.unit)}).
          A decrement can only take what the remaining stock holds, so the on-hand figure settled at the applied
          amount.
        </Note>
      )}
    </>
  )
}

/* --------------------------------- catalog -------------------------------- */

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

/* ---------------------------- requisitions -------------------------------- */

const RequisitionCreatedBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Requisition">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Requested by', value: displayValue(values.supervisor_name) },
            { label: 'For date', value: displayValue(values.request_date) },
          ]}
        />
      </Section>

      <Section title="Items requested">
        <ItemsTable rows={description.items} showCost={false} />
      </Section>
    </>
  )
}

const RequisitionUpdatedBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Requisition">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Requested by', value: displayValue(values.supervisor_name) },
            {
              label: 'What changed',
              value: [
                values.items_inserted ? `${values.items_inserted} added` : null,
                values.items_updated ? `${values.items_updated} quantity change${values.items_updated === 1 ? '' : 's'}` : null,
                values.items_deleted ? `${values.items_deleted} removed` : null,
              ]
                .filter(Boolean)
                .join(', ') || 'Only the requested-by name',
            },
          ]}
        />
      </Section>

      <Section title="Items before and after">
        <QuantityDiffTable before={description.itemsBefore || []} after={description.items || []} />
      </Section>
    </>
  )
}

const ItemsRemovedBody = ({ event, description }) => {
  const values = event.new_values || {}
  const remaining = Array.isArray(values.items_after) ? values.items_after.length : null
  return (
    <>
      <Section title="Requisition">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Lines removed', value: String(values.deleted_count ?? description.items.length) },
            { label: 'Lines remaining', value: remaining === null ? '—' : String(remaining) },
          ]}
        />
      </Section>

      <Section title="Lines removed" hint="Recorded before they were deleted">
        <ItemsTable rows={description.items} showCost={false} />
      </Section>

      <Note tone="warn">
        These lines were part of what the outlet originally asked for and are no longer on the requisition.
      </Note>
    </>
  )
}

const ItemsAddedByPmBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Requisition">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Originally raised by', value: displayValue(values.supervisor_name) },
            { label: 'Lines added', value: String(values.added_count ?? description.items.length) },
          ]}
        />
      </Section>

      <Section title="Lines added">
        <ItemsTable rows={description.items} showCost={false} />
      </Section>
    </>
  )
}

/* ------------------------------- stock out -------------------------------- */

const PackedBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Dispatched to outlet">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            {
              label: 'Cost of stock sent',
              value: <span className="text-accent font-bold">{formatCurrency(values.total_cost)}</span>,
            },
          ]}
        />
      </Section>

      <Section title="Items packed" hint="Costed against the stock it was taken from">
        <ItemsTable rows={description.items} showCost={false} />
      </Section>
    </>
  )
}

const SelfStockOutBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Stock booked out">
        <KeyValueList
          rows={[
            { label: 'Reason', value: <span className="font-semibold text-foreground">{description.reason}</span> },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Receiving outlet', value: description.outlet || 'None — stock did not go to an outlet' },
            { label: 'Notes', value: displayValue(values.notes) },
          ]}
        />
      </Section>

      <Section title="Items taken out">
        <ItemsTable rows={description.items} showCost={false} />
      </Section>
    </>
  )
}

const PackingCancelledBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="What was reversed">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Quantity put back', value: formatQty(values.restored_qty) },
            { label: 'Requisition', value: 'Reopened for packing' },
          ]}
        />
      </Section>

      <Section title="Items that had been packed" hint="Recorded before the pack was deleted">
        <ItemsTable rows={description.items} showCost={false} />
      </Section>

      <Note tone="warn">
        The stock was returned and the outlet’s requisition is open again. Watch for a cancellation followed by a
        re-pack with different quantities.
      </Note>
    </>
  )
}

/* -------------------------------- dispatch -------------------------------- */

const BODIES = {
  'inventory_in:stock_in_received': StockInBody,
  'inventory_in:inter_cloud_transfer_received': InterCloudBody,
  'inventory_in:inventory_increment': AdjustmentBody,
  'inventory_out:inventory_decrement': AdjustmentBody,
  'catalog:create': CatalogBody,
  'catalog:update': CatalogBody,
  'catalog:deactivate': CatalogBody,
  'catalog:reactivate': CatalogBody,
  'requisition:requisition_created': RequisitionCreatedBody,
  'requisition:requisition_updated': RequisitionUpdatedBody,
  'reversal:requisition_items_deleted': ItemsRemovedBody,
  'requisition:requisition_items_added_by_pm': ItemsAddedByPmBody,
  'inventory_out:requisition_packed': PackedBody,
  'inventory_out:stock_out': SelfStockOutBody,
  'reversal:requisition_packing_cancelled': PackingCancelledBody,
}

const EventBody = ({ event, description }) => {
  const Body = BODIES[eventKey(event)]
  if (!Body) return null
  return <Body event={event} description={description} />
}

export default EventBody
