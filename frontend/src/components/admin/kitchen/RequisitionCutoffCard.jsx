// The one control on the admin side of the requisition cutoff.
//
// Sits above the KPI tiles on Kitchen Wise Overview because it is a setting for
// the kitchen, not a measurement of it — everything below this card reports
// what happened, this card changes what is allowed to happen tomorrow.
//
// Times are stated in IST throughout, in and out. The conversion to UTC that
// the trigger compares against happens in the database, and nobody using this
// screen should have to think about it. See docs/REQUISITION_CUTOFF.md.

import { useEffect, useState } from 'react'
import {
  CUTOFF_BRANDS,
  WINDOW_OPENS_IST,
  fetchKitchenCutoff,
  formatIstTime,
  updateKitchenCutoff,
} from '../../../lib/requisitionCutoff'
import { useToast } from '../../../context/toastContext'

const BRAND_NAMES = { NK: 'Nippu Kodi', EC: 'El Chaapo' }

const RequisitionCutoffCard = ({ kitchenId, kitchenName }) => {
  const toast = useToast()
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!kitchenId) return undefined
    let cancelled = false
    setLoading(true)

    fetchKitchenCutoff(kitchenId)
      .then((value) => {
        if (cancelled) return
        // A `time` column arrives as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'.
        const trimmed = String(value).slice(0, 5)
        setSaved(trimmed)
        setDraft(trimmed)
      })
      .catch((err) => {
        console.error('Error loading requisition cutoff:', err)
        if (!cancelled) setSaved(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [kitchenId])

  const dirty = draft && saved && draft !== saved

  const handleSave = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await updateKitchenCutoff(kitchenId, draft)
      setSaved(draft)
      toast.success(
        'Requisition cutoff updated',
        `${kitchenName || 'This kitchen'} now closes at ${formatIstTime(draft)} IST.`
      )
    } catch (err) {
      console.error('Error saving requisition cutoff:', err)
      toast.error('Could not update the cutoff', err.message)
      setDraft(saved)
    } finally {
      setSaving(false)
    }
  }

  const brands = CUTOFF_BRANDS.map((code) => BRAND_NAMES[code] || code).join(' and ')

  return (
    <div className="bg-card border border-border border-l-2 border-l-accent/40 rounded-xl p-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Requisition cutoff
          </p>
          <p className="text-xl font-bold text-foreground mt-1">
            {loading ? '…' : saved ? `${formatIstTime(saved)} IST` : 'Not set'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {brands} supervisors can raise requisitions between{' '}
            {formatIstTime(WINDOW_OPENS_IST)} and {loading || !saved ? 'the cutoff' : formatIstTime(saved)} IST.
            Boom Pizza is not affected, and the purchase manager can still raise one at any time.
          </p>
        </div>

        <div className="flex items-end gap-2 shrink-0">
          <div>
            <label
              htmlFor="requisition-cutoff"
              className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1"
            >
              New cutoff (IST)
            </label>
            <input
              id="requisition-cutoff"
              type="time"
              value={draft}
              min="05:31"
              disabled={loading || saving}
              onChange={(e) => setDraft(e.target.value)}
              className="px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-background border-2 border-accent hover:opacity-90 transition-all disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {dirty && (
        <p className="text-[11px] text-amber-500 mt-2">
          Unsaved: {formatIstTime(draft)} IST. This takes effect immediately once saved — a
          supervisor mid-form will be refused on submit if the new time has already passed.
        </p>
      )}
    </div>
  )
}

export default RequisitionCutoffCard
