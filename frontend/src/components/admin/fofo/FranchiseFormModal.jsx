// Create or edit a FOFO franchise's details.
//
// Validation here is only a courtesy for the two required fields. The real
// rules — email shape, GSTIN format, trimming and lowercasing — live in the
// database (migration 12), and its message is shown if it refuses.

import { useState } from 'react'
import { fofoAdminApi } from '../../../lib/partnerApi'

const FRANCHISE_FIELDS = [
  'name',
  'gst_number',
  'address',
  'city',
  'contact_person',
  'contact_phone',
  'contact_email',
]

const inputClass =
  'w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all'

const toForm = (franchise) =>
  Object.fromEntries(FRANCHISE_FIELDS.map((field) => [field, franchise?.[field] || '']))

// Every field is sent, blanks as null: an edit replaces all seven.
const toPayload = (form) =>
  Object.fromEntries(FRANCHISE_FIELDS.map((field) => [field, form[field].trim() || null]))

const Field = ({ label, required, hint, children }) => (
  <div>
    <label className="block text-sm font-semibold text-foreground mb-1">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
)

const FranchiseFormModal = ({ franchise, onClose, onSaved }) => {
  const editing = Boolean(franchise)
  const [form, setForm] = useState(() => toForm(franchise))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Franchise name is required.')
    if (!form.contact_email.trim()) {
      return setFormError('Contact email is required — every onboarding email is sent to it.')
    }

    try {
      setSaving(true)
      const saved = editing
        ? (await fofoAdminApi.updateFranchise(franchise.id, toPayload(form))).franchise
        : await fofoAdminApi.createFranchise(toPayload(form))
      onSaved(saved, { created: !editing })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const close = () => !saving && onClose()

  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 lg:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl lg:text-2xl font-bold text-foreground">
              {editing ? 'Edit Franchise' : 'Add Franchise'}
            </h2>
            <button
              onClick={close}
              className="text-muted-foreground hover:text-foreground transition-colors"
              disabled={saving}
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {editing && (
            <p className="mb-4 text-xs text-muted-foreground">
              Changes apply to documents issued from now on. Invoices and emails already sent keep
              the details they were sent with.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Franchise name" required hint="The business we invoice — printed on its invoices.">
              <input type="text" value={form.name} onChange={set('name')} className={inputClass} placeholder="e.g. Test Foods Pvt Ltd" disabled={saving} />
            </Field>

            <Field
              label="Main contact email"
              required
              hint="Welcome and registration emails all go here, never to individuals."
            >
              <input type="email" value={form.contact_email} onChange={set('contact_email')} className={inputClass} placeholder="owner@example.com" disabled={saving} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact person">
                <input type="text" value={form.contact_person} onChange={set('contact_person')} className={inputClass} disabled={saving} />
              </Field>
              <Field label="Contact phone">
                <input type="tel" value={form.contact_phone} onChange={set('contact_phone')} className={inputClass} disabled={saving} />
              </Field>
            </div>

            <Field label="GSTIN" hint="Optional — leave blank if the franchise is not GST-registered.">
              <input type="text" value={form.gst_number} onChange={set('gst_number')} className={`${inputClass} font-mono uppercase`} placeholder="29ABCDE1234F1Z5" disabled={saving} />
            </Field>

            <Field label="Address">
              <textarea value={form.address} onChange={set('address')} rows={2} className={inputClass} disabled={saving} />
            </Field>

            <Field label="City">
              <input type="text" value={form.city} onChange={set('city')} className={inputClass} disabled={saving} />
            </Field>

            {formError && (
              <div className="bg-destructive/15 border border-destructive rounded-lg px-4 py-3 text-sm text-destructive-foreground">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={saving}
                className="px-5 py-2.5 bg-muted text-foreground border border-border rounded-lg hover:bg-muted/80 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-accent text-background font-black rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Franchise'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default FranchiseFormModal
