// The vendor directory: who they are, and what each one cost in the period.
//
// This is the old Vendors screen's create / edit / deactivate, kept intact, with
// the period's money folded in beside each name — a vendor list that cannot tell
// you what a vendor is worth is a list of names, not a management screen.
//
// Two rows here are not vendor records and are marked as such:
//
//   · An "unlinked supplier" is a name found on a receipt that matches no vendor
//     row. It is shown with its spend and a one-click Add, because the fix is to
//     create the vendor, and the spend is what tells you whether it is worth it.
//   · A vendor with no purchases in the period still gets a row at zero. That
//     absence is the finding.
//
// Confirmation goes through the app's useConfirm rather than a bespoke dialog,
// so deactivating a vendor asks the same way deactivating a user does.

import { useMemo, useState } from 'react'
import {
  KitchenPanel,
  PAGE_SIZE,
  Pill,
  SortableTh,
  Td,
  Th,
  searchInputClass,
  theadClass,
} from '../kitchen/KitchenPanel'
import MultiSelectFilter from '../../MultiSelectFilter'
import { useTableSort } from '../../../hooks/useTableSort'
import { useConfirm } from '../../../context/confirmContext'
import { useToast } from '../../../context/toastContext'
import { supabase } from '../../../lib/supabase'
import { count, formatDay, money } from '../../../lib/formatNumbers'

const SORT_ACCESSORS = {
  name: (row) => row.name,
  status: (row) => (row.linked ? (row.isActive ? 'Active' : 'Inactive') : 'Unlinked'),
  materials: (row) => row.materialCount,
  invoices: (row) => row.invoiceCount,
  spend: (row) => row.spend,
  last: (row) => row.lastInvoiceDate,
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'unlinked', label: 'Unlinked suppliers' },
]

const ACTIVITY_OPTIONS = [
  { value: 'with-spend', label: 'Bought from in period' },
  { value: 'no-spend', label: 'No purchases in period' },
]

const statusOf = (row) => (row.linked ? (row.isActive ? 'active' : 'inactive') : 'unlinked')

const ActionButton = ({ tone = 'accent', children, ...rest }) => {
  const tones = {
    accent: 'bg-accent/10 text-accent border-accent/40 hover:bg-accent/20 hover:border-accent/60',
    danger:
      'bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/20 hover:border-destructive/60',
    good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20 hover:border-emerald-500/60',
    quiet: 'bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:border-accent/50',
  }

  return (
    <button
      type="button"
      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${tones[tone]}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

const VendorFormModal = ({ vendor, presetName = '', onClose, onSaved }) => {
  const [name, setName] = useState(vendor?.name ?? presetName)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')

    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Vendor name is required')
      return
    }

    try {
      setSaving(true)
      const payload = { name: trimmed, updated_at: new Date().toISOString() }

      const { error } = vendor
        ? await supabase.from('vendors').update(payload).eq('id', vendor.id)
        : await supabase.from('vendors').insert(payload)

      if (error) throw error
      await onSaved()
      onClose()
    } catch (err) {
      console.error('Error saving vendor:', err)
      if (err.code === '23505') setFormError('A vendor with this name already exists.')
      else if (err.code === '42501') setFormError('Permission denied. Log in with an admin account.')
      else setFormError(err.message || 'Failed to save vendor. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={vendor ? 'Edit vendor' : 'Add vendor'}
        onClick={(event) => event.stopPropagation()}
        className="bg-card border-2 border-border rounded-xl w-full max-w-lg shadow-xl"
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground">
            {vendor ? 'Edit vendor' : 'Add vendor'}
          </h3>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            aria-label="Close"
            className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="vendor-name"
              className="block text-sm font-semibold text-foreground mb-1"
            >
              Vendor name <span className="text-destructive">*</span>
            </label>
            <input
              id="vendor-name"
              type="text"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
              placeholder="Enter vendor name"
              className="w-full px-3 py-2.5 border border-border rounded-lg bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Receipts are tied to a vendor by this name, so renaming one detaches its existing
              invoices.
            </p>
          </div>

          {formError && (
            <p className="bg-destructive/15 border border-destructive rounded-lg px-4 py-3 text-sm text-destructive-foreground">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => !saving && onClose()}
              disabled={saving}
              className="px-4 py-2.5 rounded-lg border border-border bg-muted/40 text-sm font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 rounded-lg bg-accent text-background text-sm font-bold hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : vendor ? 'Update vendor' : 'Create vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tab
 * ------------------------------------------------------------------ */

const VendorsTab = ({ vendors, loading, error, onRefresh, onViewInvoices }) => {
  const confirm = useConfirm()
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(['all'])
  const [activityFilter, setActivityFilter] = useState(['all'])
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState('')
  const [form, setForm] = useState(null)

  // Biggest spender first: the list is read to answer "where is the money
  // going", and alphabetical buries that under whoever starts with an A.
  const sort = useTableSort('spend', 'desc')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()

    const matched = vendors.filter((vendor) => {
      if (!statusFilter.includes('all') && !statusFilter.includes(statusOf(vendor))) return false

      if (!activityFilter.includes('all')) {
        const wanted = vendor.invoiceCount > 0 ? 'with-spend' : 'no-spend'
        if (!activityFilter.includes(wanted)) return false
      }

      return !term || vendor.name.toLowerCase().includes(term)
    })

    return sort.sortRows(matched, SORT_ACCESSORS)
  }, [vendors, search, statusFilter, activityFilter, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const rangeTotal = filtered.reduce((sum, vendor) => sum + vendor.spend, 0)

  const setActive = async (vendor, active) => {
    const ok = await confirm({
      title: active ? 'Reactivate vendor?' : 'Deactivate vendor?',
      message: active
        ? `"${vendor.name}" will appear in supplier dropdowns again.`
        : `"${vendor.name}" will be hidden from supplier dropdowns. Its ${count(
            vendor.invoiceCount
          )} invoice${vendor.invoiceCount === 1 ? '' : 's'} in this period are kept.`,
      confirmLabel: active ? 'Reactivate' : 'Deactivate',
      tone: active ? 'default' : 'danger',
    })
    if (!ok) return

    try {
      setBusyId(vendor.id)
      const now = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('vendors')
        .update({
          is_active: active,
          deleted_at: active ? null : now,
          updated_at: now,
        })
        .eq('id', vendor.id)

      if (updateError) throw updateError
      await onRefresh()
      toast.success(active ? 'Vendor reactivated' : 'Vendor deactivated', vendor.name)
    } catch (err) {
      console.error('Error updating vendor:', err)
      toast.error('Could not update vendor', err.message)
    } finally {
      setBusyId('')
    }
  }

  return (
    <>
      <KitchenPanel
        toolbar={
          <>
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Search vendors…"
              aria-label="Search vendors"
              className={searchInputClass}
            />
            <MultiSelectFilter
              label="Status"
              allLabel="All statuses"
              group="vendor-directory"
              selectedValues={statusFilter}
              onChange={(next) => {
                setStatusFilter(next)
                setPage(1)
              }}
              options={STATUS_OPTIONS}
              className="w-full sm:w-48"
            />
            <MultiSelectFilter
              label="Activity"
              allLabel="Any activity"
              group="vendor-directory"
              selectedValues={activityFilter}
              onChange={(next) => {
                setActivityFilter(next)
                setPage(1)
              }}
              options={ACTIVITY_OPTIONS}
              className="w-full sm:w-52"
            />
            <button
              type="button"
              onClick={() => setForm({ vendor: null })}
              className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-bold hover:bg-accent/90 transition-colors whitespace-nowrap"
            >
              + Add vendor
            </button>
          </>
        }
        loading={loading}
        error={error}
        isEmpty={filtered.length === 0}
        emptyTitle={vendors.length === 0 ? 'No vendors yet' : 'No vendors found'}
        emptyText={
          vendors.length === 0
            ? 'Add a vendor to start recording who stock is bought from.'
            : 'No vendors match your current filters.'
        }
        resultCount={visible.length}
        totalCount={filtered.length}
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
      >
        <table className="w-full">
          <thead className={theadClass}>
            <tr>
              <SortableTh sortKey="name" sort={sort}>
                Vendor
              </SortableTh>
              <SortableTh sortKey="status" sort={sort}>
                Status
              </SortableTh>
              <SortableTh sortKey="materials" sort={sort} align="right">
                Materials
              </SortableTh>
              <SortableTh sortKey="invoices" sort={sort} align="right">
                Invoices
              </SortableTh>
              <SortableTh sortKey="last" sort={sort}>
                Last invoice
              </SortableTh>
              <SortableTh sortKey="spend" sort={sort} align="right">
                Spend
              </SortableTh>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((vendor) => (
              <tr key={vendor.id} className="border-b border-border last:border-b-0">
                <Td>
                  <div className="font-semibold text-foreground">{vendor.name}</div>
                  {!vendor.linked && (
                    <div className="text-[10px] text-yellow-500">
                      On receipts, but not in the vendor table
                    </div>
                  )}
                </Td>
                <Td>
                  {vendor.linked ? (
                    <Pill tone={vendor.isActive ? 'ok' : 'neutral'}>
                      {vendor.isActive ? 'Active' : 'Inactive'}
                    </Pill>
                  ) : (
                    <Pill tone="low">Unlinked</Pill>
                  )}
                </Td>
                <Td align="right" className="tabular-nums text-muted-foreground">
                  {vendor.materialCount > 0 ? count(vendor.materialCount) : '—'}
                </Td>
                <Td align="right" className="tabular-nums text-muted-foreground">
                  {vendor.invoiceCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => onViewInvoices(vendor.id)}
                      className="hover:text-accent transition-colors underline-offset-2 hover:underline"
                    >
                      {count(vendor.invoiceCount)}
                    </button>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td className="text-muted-foreground whitespace-nowrap">
                  {vendor.lastInvoiceDate ? formatDay(vendor.lastInvoiceDate) : '—'}
                </Td>
                <Td align="right" className="tabular-nums font-semibold whitespace-nowrap">
                  {vendor.spend > 0 ? (
                    money(vendor.spend)
                  ) : (
                    <span className="text-muted-foreground font-normal">—</span>
                  )}
                </Td>
                <Td align="right">
                  <div className="flex flex-wrap gap-2 justify-end">
                    {vendor.linked ? (
                      <>
                        <ActionButton
                          tone="quiet"
                          onClick={() => setForm({ vendor })}
                          disabled={busyId === vendor.id}
                        >
                          Edit
                        </ActionButton>
                        {vendor.isActive ? (
                          <ActionButton
                            tone="danger"
                            onClick={() => setActive(vendor, false)}
                            disabled={busyId === vendor.id}
                          >
                            Deactivate
                          </ActionButton>
                        ) : (
                          <ActionButton
                            tone="good"
                            onClick={() => setActive(vendor, true)}
                            disabled={busyId === vendor.id}
                          >
                            Reactivate
                          </ActionButton>
                        )}
                      </>
                    ) : (
                      <ActionButton
                        tone="accent"
                        onClick={() => setForm({ vendor: null, presetName: vendor.name })}
                        // "No supplier recorded" is an absence, not a name that
                        // can be turned into a vendor.
                        disabled={vendor.name === 'No supplier recorded'}
                      >
                        Add as vendor
                      </ActionButton>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-background border-t border-border">
            <tr>
              <Td colSpan={5} className="text-xs uppercase tracking-wide text-muted-foreground">
                Total across {count(filtered.length)} vendor{filtered.length === 1 ? '' : 's'}
              </Td>
              <Td align="right" className="tabular-nums font-bold text-accent whitespace-nowrap">
                {money(rangeTotal)}
              </Td>
              <Td />
            </tr>
          </tfoot>
        </table>
      </KitchenPanel>

      {form && (
        <VendorFormModal
          vendor={form.vendor}
          presetName={form.presetName}
          onClose={() => setForm(null)}
          onSaved={onRefresh}
        />
      )}
    </>
  )
}

export default VendorsTab
