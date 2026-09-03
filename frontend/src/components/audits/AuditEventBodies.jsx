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
  brandLabel,
  displayValue,
  roleLabel,
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

/* ---------------------------- dispatch planning --------------------------- */

// A plan is a grid of material × outlet. Read as a flat list it is unreadable,
// so it is grouped by outlet — which is how the kitchen actually loads it out.
const PlanItemsByOutlet = ({ rows = [] }) => {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No lines on this plan.</p>

  const groups = new Map()
  rows.forEach((row) => {
    if (!groups.has(row.outlet.id)) groups.set(row.outlet.id, { outlet: row.outlet, items: [] })
    groups.get(row.outlet.id).items.push(row)
  })

  return (
    <div className="space-y-3">
      {[...groups.values()]
        .sort((a, b) => a.outlet.name.localeCompare(b.outlet.name))
        .map((group) => (
          <div key={group.outlet.id} className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">{group.outlet.name}</span>
              <span className="text-xs text-muted-foreground">
                {group.items.length} line{group.items.length === 1 ? '' : 's'}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {group.items
                  .sort((a, b) => a.material.name.localeCompare(b.material.name))
                  .map((item, index) => (
                    <tr key={`${item.material.id}-${index}`} className="border-t border-border">
                      <td className="py-1.5 px-3 text-foreground">{item.material.name}</td>
                      <td className="py-1.5 px-3 text-right whitespace-nowrap text-foreground font-medium">
                        {formatQtyWithUnit(item.quantity, item.material.unit)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  )
}

const PlanComparison = ({ before = [], after = [] }) => {
  const rows = new Map()
  const keyOf = (row) => `${row.outlet.id}|${row.material.id}`
  before.forEach((row) => rows.set(keyOf(row), { ...row, before: row.quantity, after: undefined }))
  after.forEach((row) => {
    const existing = rows.get(keyOf(row))
    if (existing) existing.after = row.quantity
    else rows.set(keyOf(row), { ...row, before: undefined, after: row.quantity })
  })

  const list = [...rows.values()].sort(
    (a, b) => a.outlet.name.localeCompare(b.outlet.name) || a.material.name.localeCompare(b.material.name)
  )
  const changed = list.filter((row) => row.before !== row.after)

  if (!changed.length) {
    return <p className="text-sm text-muted-foreground">The kitchen locked the plan exactly as it was set.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[32rem]">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Outlet</th>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Material</th>
            <th className="text-right py-2 px-3 font-semibold text-foreground">Planned</th>
            <th className="text-right py-2 px-3 font-semibold text-foreground">Locked</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((row) => (
            <tr key={`${row.outlet.id}-${row.material.id}`} className="border-t border-border bg-accent/[0.06]">
              <td className="py-2 px-3 text-foreground">{row.outlet.name}</td>
              <td className="py-2 px-3 text-foreground">{row.material.name}</td>
              <td className="py-2 px-3 text-right text-muted-foreground whitespace-nowrap">
                {row.before === undefined ? 'Not planned' : formatQty(row.before)}
              </td>
              <td className="py-2 px-3 text-right font-semibold text-foreground whitespace-nowrap">
                {row.after === undefined ? 'Dropped' : formatQty(row.after)}
                {row.material.unit ? (
                  <span className="text-muted-foreground font-normal"> {row.material.unit}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const DispatchPlanBody = ({ event, description }) => {
  const values = event.new_values || {}
  const outletCount = new Set(description.planItems.map((row) => row.outlet.id)).size
  return (
    <>
      <Section title="Plan">
        <KeyValueList
          rows={[
            { label: 'Plan date', value: displayValue(values.plan_date) },
            { label: 'Brand', value: displayValue(brandLabel(values.brand)) },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Outlets covered', value: String(outletCount) },
            { label: 'Lines', value: String(values.item_count ?? description.planItems.length) },
          ]}
        />
      </Section>

      <Section title="What the kitchen is to produce">
        <PlanItemsByOutlet rows={description.planItems} />
      </Section>
    </>
  )
}

const PlanItemsReplacedBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Replacement">
        <KeyValueList
          rows={[
            { label: 'Lines discarded', value: String(event.old_values?.replaced_count ?? 0) },
            { label: 'Lines saved instead', value: String(values.item_count ?? 0) },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
          ]}
        />
      </Section>

      <Section title="The plan that was discarded" hint="Recorded before it was overwritten">
        <PlanItemsByOutlet rows={description.planItems} />
      </Section>

      <Note tone="warn">
        Re-saving a plan throws the previous version away entirely. This is what it looked like beforehand.
      </Note>
    </>
  )
}

const PlanLockedBody = ({ event, description }) => {
  const values = event.new_values || {}
  return (
    <>
      <Section title="Lock">
        <KeyValueList
          rows={[
            { label: 'Plan date', value: displayValue(values.plan_date) },
            { label: 'Brand', value: displayValue(brandLabel(values.brand)) },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            {
              label: 'Kitchen changed quantities',
              value: description.kitchenChanged ? (
                <span className="text-red-300 font-semibold">Yes</span>
              ) : (
                <span className="text-emerald-300 font-semibold">No</span>
              ),
            },
            { label: 'Lines locked', value: String(values.item_count ?? description.planItems.length) },
          ]}
        />
      </Section>

      <Section title="Changes made at lock time" hint="Only lines that moved">
        <PlanComparison before={description.planItemsBefore} after={description.planItems} />
      </Section>

      <Section title="Final locked plan">
        <PlanItemsByOutlet rows={description.planItems} />
      </Section>
    </>
  )
}

/* ----------------------------- outlet closing ----------------------------- */

const ClosingQuantityTable = ({ rows = [], quantityLabel }) => {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing recorded.</p>

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[28rem]">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Material</th>
            <th className="text-right py-2 px-3 font-semibold text-foreground">Sent out</th>
            <th className="text-right py-2 px-3 font-semibold text-foreground">{quantityLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.material.id}-${index}`} className="border-t border-border">
              <td className="py-2 px-3">
                <div className="text-foreground">{row.material.name}</div>
                <div className="text-xs text-muted-foreground">{row.material.code}</div>
              </td>
              <td className="py-2 px-3 text-right text-muted-foreground whitespace-nowrap">
                {Number.isNaN(row.dispatched) ? '—' : formatQty(row.dispatched)}
              </td>
              <td className="py-2 px-3 text-right font-semibold text-foreground whitespace-nowrap">
                {formatQtyWithUnit(row.quantity, row.material.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ClosingDraftBody = ({ event, description }) => {
  const values = event.new_values || {}
  const isResave = !!event.old_values
  const previousWasted = (description.previousWastage || []).reduce(
    (total, row) => total + (Number(row.quantity) || 0),
    0
  )
  const wastedNow = (description.wastage || []).reduce((total, row) => total + (Number(row.quantity) || 0), 0)

  return (
    <>
      <Section title="Closing sheet">
        <KeyValueList
          rows={[
            { label: 'Outlet', value: description.outlet || '—' },
            { label: 'Cloud kitchen', value: description.kitchen || '—' },
            { label: 'Filed by', value: displayValue(values.supervisor_name) },
            { label: 'Lines returned', value: String(description.returns.length) },
            { label: 'Lines wasted', value: String(description.wastage.length) },
          ]}
        />
      </Section>

      <Section title="Returned to the kitchen">
        <ClosingQuantityTable rows={description.returns} quantityLabel="Returned" />
      </Section>

      <Section title="Declared as wastage">
        <ClosingQuantityTable rows={description.wastage} quantityLabel="Wasted" />
      </Section>

      {description.additional &&
        (Number(description.additional.cash) > 0 || Number(description.additional.payment_onside) > 0) && (
          <Section title="Extra consumption">
            <KeyValueList
              rows={[
                { label: 'Cash', value: formatCurrency(description.additional.cash) },
                { label: 'Paid on site', value: formatCurrency(description.additional.payment_onside) },
              ]}
            />
          </Section>
        )}

      {isResave && (
        <Note tone="warn">
          This save replaced figures that had already been entered — previously {previousWasted} wasted across{' '}
          {(description.previousWastage || []).length} line
          {(description.previousWastage || []).length === 1 ? '' : 's'}, now {wastedNow} across{' '}
          {description.wastage.length}. A closing sheet can be saved as often as the supervisor likes until it is
          confirmed.
        </Note>
      )}
    </>
  )
}

const ClosingConfirmedBody = ({ event, description }) => (
  <>
    <Section title="Confirmation">
      <KeyValueList
        rows={[
          { label: 'Outlet', value: description.outlet || '—' },
          { label: 'Cloud kitchen', value: description.kitchen || '—' },
          {
            label: 'Quantity returned',
            value: (
              <span className="text-accent font-bold">{formatQty(event.new_values?.total_returned_qty)}</span>
            ),
          },
          { label: 'Status', value: 'Confirmed — no longer editable' },
        ]}
      />
    </Section>

    <Note>
      Confirming records the sheet and closes it to edits. It does not move stock — the purchase manager
      records the returned quantities as a stock-in. The per-item detail behind this total is on the closing
      sheet saves that led up to it.
    </Note>
  </>
)

/* ---------------------------- access & overrides --------------------------- */

const SignInBody = ({ description }) => (
  <Section title="Sign-in">
    <KeyValueList
      rows={[
        { label: 'Role used', value: roleLabel(description.attemptedRole) },
        { label: 'Kitchen selected', value: description.attemptedKitchen || '—' },
        { label: 'Result', value: <span className="text-emerald-300 font-semibold">Signed in</span> },
      ]}
    />
  </Section>
)

const SignInRejectedBody = ({ description }) => (
  <>
    <Section title="What was attempted">
      <KeyValueList
        rows={[
          { label: 'Role selected', value: roleLabel(description.attemptedRole) },
          { label: 'Kitchen selected', value: description.attemptedKitchen || '—' },
          {
            label: 'Why it was refused',
            value: <span className="text-red-300 font-semibold">{description.contextLine}</span>,
          },
          {
            label: 'Whose key was used',
            value: description.keyOwner || 'Nobody — the key matches no account',
          },
        ]}
      />
    </Section>

    <Note tone="warn">
      {description.keyOwner
        ? `The key presented is a real one belonging to ${description.keyOwner}. Someone holding a working key was refused only because the role or kitchen selected did not match it.`
        : 'The key presented matches no account at all. Several of these from one address in a short window is what a guessing attempt looks like.'}{' '}
      Whoever was trying only ever sees a generic error, so this reason is not something they can learn from.
    </Note>
  </>
)

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
  'dispatch_plan:dispatch_plan_created': DispatchPlanBody,
  'dispatch_plan:dispatch_plan_updated': DispatchPlanBody,
  'reversal:dispatch_plan_items_replaced': PlanItemsReplacedBody,
  'dispatch_plan:dispatch_plan_locked': PlanLockedBody,
  'checkout:checkout_draft_created': ClosingDraftBody,
  'checkout:checkout_draft_updated': ClosingDraftBody,
  'checkout:checkout_confirmed': ClosingConfirmedBody,
  'auth:login_success': SignInBody,
  'auth:login_failed': SignInRejectedBody,
}

const EventBody = ({ event, description }) => {
  const Body = BODIES[eventKey(event)]
  if (!Body) return null
  return <Body event={event} description={description} />
}

export default EventBody
