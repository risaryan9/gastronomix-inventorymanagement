// One FOFO franchise: its details, its outlets, and onboarding.
//
// Outlets are linked and unlinked here. The server refuses an outlet owned by
// another franchise or one with an active FOCO dashboard code; the picker shows
// those as disabled with the reason, so the refusal is seldom needed.
//
// ONBOARDING EMAILS go to the franchise's main contact address, never to a
// person (spec §8.1). The welcome email has no link and can be resent. Each
// registration email carries one single-use link, numbered per franchise; an
// open link can be cancelled here. If a registration email fails to send, the
// server cancels its link itself, so it never shows as open
// (partner-frontend/api/_lib/onboarding.js).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fofoAdminApi } from '../../../lib/partnerApi'
import { formatIstDate, formatIstDateTime } from '../../../lib/auditEvents'
import { useToast } from '../../../context/toastContext'
import { useConfirm } from '../../../context/confirmContext'
import FranchiseFormModal from './FranchiseFormModal'

const sectionClass = 'bg-background/40 border border-border rounded-xl p-4'
const headingClass = 'text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3'
const smallButton =
  'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

const INVITATION_STATE = {
  open: { label: 'Open', className: 'bg-accent/15 text-accent border-accent/40' },
  used: { label: 'Used', className: 'bg-green-500/15 text-green-400 border-green-500/40' },
  expired: { label: 'Expired', className: 'bg-muted text-muted-foreground border-border' },
  revoked: { label: 'Cancelled', className: 'bg-destructive/10 text-destructive border-destructive/40' },
}

const Badge = ({ className, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md border ${className}`}>
    {children}
  </span>
)

const DetailRow = ({ label, value, mono }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={`text-sm text-foreground break-words ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
  </div>
)

// Why an outlet cannot be picked, or null if it can.
const outletBlocker = (outlet) => {
  if (!outlet.is_active) return 'inactive'
  if (outlet.owner_franchise_id) return `owned by ${outlet.owner_franchise_name}`
  if (outlet.has_foco_code) return 'FOCO outlet'
  return null
}

const FranchiseDetailModal = ({ franchiseId, onClose, onChanged }) => {
  const toast = useToast()
  const confirm = useConfirm()

  const [franchise, setFranchise] = useState(null)
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedOutletId, setSelectedOutletId] = useState('')
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError('')
      const [detail, allOutlets] = await Promise.all([
        fofoAdminApi.getFranchise(franchiseId),
        fofoAdminApi.listOutlets(),
      ])
      setFranchise(detail)
      setOutlets(allOutlets)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [franchiseId])

  useEffect(() => {
    load()
  }, [load])

  // Outlets not already this franchise's, linkable ones first.
  const outletOptions = useMemo(() => {
    const mine = new Set((franchise?.outlets || []).map((o) => o.id))
    return outlets
      .filter((o) => !mine.has(o.id))
      .map((o) => ({ ...o, blocker: outletBlocker(o) }))
      .sort((a, b) => Number(Boolean(a.blocker)) - Number(Boolean(b.blocker)))
  }, [outlets, franchise])

  // Runs a write, then refreshes this modal and the list behind it.
  const runWrite = async (write, successTitle, successMessage) => {
    try {
      setBusy(true)
      const result = await write()
      setFranchise(result.franchise)
      setOutlets(await fofoAdminApi.listOutlets())
      onChanged()
      if (result.changed !== false) toast.success(successTitle, successMessage)
      return true
    } catch (err) {
      toast.error('Could not save', err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleLink = async () => {
    const outlet = outlets.find((o) => o.id === selectedOutletId)
    if (!outlet) return
    const ok = await runWrite(
      () => fofoAdminApi.linkOutlet(franchise.id, outlet.id),
      'Outlet added',
      `${outlet.code} now belongs to ${franchise.name} and is marked franchise-operated.`
    )
    if (ok) setSelectedOutletId('')
  }

  const handleUnlink = async (outlet) => {
    const confirmed = await confirm({
      title: `Remove ${outlet.code} from ${franchise.name}?`,
      message:
        'The franchise will no longer be able to order for this outlet, and its cart for the outlet is emptied. Orders already placed are not affected.',
      confirmLabel: 'Remove outlet',
      tone: 'danger',
    })
    if (!confirmed) return
    await runWrite(
      () => fofoAdminApi.unlinkOutlet(franchise.id, outlet.id),
      'Outlet removed',
      `${outlet.code} no longer belongs to ${franchise.name}.`
    )
  }

  const handleToggleActive = async () => {
    const activating = !franchise.is_active
    if (!activating) {
      const confirmed = await confirm({
        title: `Deactivate ${franchise.name}?`,
        message:
          'Its users will not be able to log in or order, no onboarding emails can be sent, and open registration links stop working. Nothing is deleted, orders in progress carry on, and you can reactivate it later.',
        confirmLabel: 'Deactivate',
        tone: 'danger',
      })
      if (!confirmed) return
    }
    await runWrite(
      () => fofoAdminApi.setFranchiseActive(franchise.id, activating),
      activating ? 'Franchise reactivated' : 'Franchise deactivated',
      franchise.name
    )
  }

  const handleSendWelcome = async () => {
    const confirmed = await confirm({
      title: 'Send the welcome email?',
      message: `An informational email with no link goes to ${franchise.contact_email}.${
        franchise.welcome_email_last_sent_at
          ? ` It was last sent ${formatIstDateTime(franchise.welcome_email_last_sent_at)}.`
          : ''
      }`,
      confirmLabel: 'Send welcome email',
    })
    if (!confirmed) return
    await runWrite(
      () => fofoAdminApi.sendWelcomeEmail(franchise.id),
      'Welcome email sent',
      `Sent to ${franchise.contact_email}.`
    )
  }

  const handleSendRegistration = async () => {
    const next = (franchise.invitations[0]?.invitation_number || 0) + 1
    const confirmed = await confirm({
      title: `Send registration email #${next}?`,
      message: `It goes to ${franchise.contact_email} and carries a link that creates one login for ${franchise.name}. The link works once and expires in 7 days. Send one per person who needs a login.`,
      confirmLabel: 'Send registration email',
    })
    if (!confirmed) return
    try {
      setBusy(true)
      const result = await fofoAdminApi.sendRegistrationEmail(franchise.id)
      setFranchise(result.franchise)
      onChanged()
      toast.success(`Registration email #${result.invitation_number} sent`, `Sent to ${result.sent_to}.`)
    } catch (err) {
      toast.error('Registration email not sent', err.message)
      // A failed send can still have cancelled a link — show it.
      fofoAdminApi.getFranchise(franchise.id).then(setFranchise).catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (inv) => {
    const confirmed = await confirm({
      title: `Cancel registration link #${inv.invitation_number}?`,
      message: 'Nobody will be able to register with it. This cannot be undone — send a new registration email if a login is still needed.',
      confirmLabel: 'Cancel link',
      tone: 'danger',
    })
    if (!confirmed) return
    await runWrite(
      () => fofoAdminApi.revokeInvitation(inv.id),
      'Registration link cancelled',
      `Link #${inv.invitation_number} can no longer be used.`
    )
  }

  const handleSaved = (saved) => {
    setEditing(false)
    setFranchise(saved)
    onChanged()
    toast.success('Franchise updated', saved.name)
  }

  const close = () => !busy && onClose()

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 lg:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                {franchise?.name || 'Franchise'}
              </h2>
              {franchise && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      franchise.is_active
                        ? 'bg-green-500/15 text-green-400 border-green-500/40'
                        : 'bg-muted text-muted-foreground border-border'
                    }
                  >
                    {franchise.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Added {formatIstDate(franchise.created_at)}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={close}
              className="text-muted-foreground hover:text-foreground transition-colors"
              disabled={busy}
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading && <div className="p-8 text-center text-muted-foreground">Loading franchise…</div>}

          {!loading && loadError && (
            <div className="bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground flex items-center justify-between gap-3">
              <span>{loadError}</span>
              <button onClick={load} className={`${smallButton} bg-muted text-foreground border-border`}>
                Retry
              </button>
            </div>
          )}

          {!loading && franchise && (
            <>
              {/* Details */}
              <section className={sectionClass}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`${headingClass} mb-0`}>Details</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditing(true)}
                      disabled={busy}
                      className={`${smallButton} bg-accent/10 text-accent border-accent/40 hover:bg-accent/20`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={handleToggleActive}
                      disabled={busy}
                      className={
                        franchise.is_active
                          ? `${smallButton} bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/20`
                          : `${smallButton} bg-green-500/10 text-green-400 border-green-500/40 hover:bg-green-500/20`
                      }
                    >
                      {franchise.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <DetailRow label="Main contact email" value={franchise.contact_email} />
                  <DetailRow label="Contact person" value={franchise.contact_person} />
                  <DetailRow label="Contact phone" value={franchise.contact_phone} />
                  <DetailRow label="GSTIN" value={franchise.gst_number || 'Not registered'} mono={Boolean(franchise.gst_number)} />
                  <DetailRow label="City" value={franchise.city} />
                  <DetailRow label="Address" value={franchise.address} />
                </dl>
              </section>

              {/* Outlets */}
              <section className={sectionClass}>
                <h3 className={headingClass}>Outlets ({franchise.outlets.length})</h3>
                {franchise.outlets.length === 0 ? (
                  <p className="text-sm text-muted-foreground mb-3">
                    No outlets yet. A franchise can only order for the outlets it owns, and the
                    brands it can buy come from their codes.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/70 mb-3">
                    {franchise.outlets.map((outlet) => (
                      <li key={outlet.id} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            <span className="font-mono">{outlet.code}</span> — {outlet.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Served by {outlet.cloud_kitchen_name || 'no cloud kitchen'}
                            {!outlet.is_active && ' · outlet inactive'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleUnlink(outlet)}
                          disabled={busy}
                          className={`${smallButton} bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/20`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {franchise.is_active ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={selectedOutletId}
                      onChange={(e) => setSelectedOutletId(e.target.value)}
                      disabled={busy}
                      className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Add an outlet…</option>
                      {outletOptions.map((o) => (
                        <option key={o.id} value={o.id} disabled={Boolean(o.blocker)}>
                          {o.code} — {o.name}
                          {o.cloud_kitchen_name ? ` (${o.cloud_kitchen_name})` : ''}
                          {o.blocker ? ` · ${o.blocker}` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleLink}
                      disabled={busy || !selectedOutletId}
                      className={`${smallButton} px-4 py-2 text-sm bg-accent/10 text-accent border-accent/40 hover:bg-accent/20`}
                    >
                      Add outlet
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Reactivate the franchise to add outlets.</p>
                )}
              </section>

              {/* Onboarding */}
              <section className={sectionClass}>
                <h3 className={headingClass}>Onboarding emails</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Sent to {franchise.contact_email}. The welcome email has no link; each
                  registration email carries one single-use link that registers one login.
                </p>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button
                    onClick={handleSendWelcome}
                    disabled={busy || !franchise.is_active}
                    className={`${smallButton} bg-accent/10 text-accent border-accent/40 hover:bg-accent/20`}
                  >
                    {franchise.welcome_email_last_sent_at ? 'Resend welcome email' : 'Send welcome email'}
                  </button>
                  <button
                    onClick={handleSendRegistration}
                    disabled={busy || !franchise.is_active}
                    className={`${smallButton} bg-accent/10 text-accent border-accent/40 hover:bg-accent/20`}
                  >
                    Send registration email
                  </button>
                  {!franchise.is_active && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      Reactivate the franchise to send emails
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Welcome email last sent:{' '}
                  {franchise.welcome_email_last_sent_at
                    ? formatIstDateTime(franchise.welcome_email_last_sent_at)
                    : 'never'}
                </p>
              </section>

              {/* Users and links */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className={sectionClass}>
                  <h3 className={headingClass}>Users ({franchise.users.length})</h3>
                  {franchise.users.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nobody has registered yet. Users appear here once they use a registration link.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/70">
                      {franchise.users.map((user) => (
                        <li key={user.id} className="py-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground break-all">{user.email}</p>
                            <p className="text-xs text-muted-foreground">
                              Registered {formatIstDate(user.activated_at)}
                            </p>
                          </div>
                          {!user.is_active && (
                            <Badge className="bg-muted text-muted-foreground border-border">Inactive</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className={sectionClass}>
                  <h3 className={headingClass}>Registration links ({franchise.invitations.length})</h3>
                  {franchise.invitations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No registration emails sent yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/70">
                      {franchise.invitations.map((inv) => {
                        const state = INVITATION_STATE[inv.state] || INVITATION_STATE.expired
                        return (
                          <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm text-foreground">
                                #{inv.invitation_number}
                                {inv.registered_email && (
                                  <span className="text-muted-foreground"> · {inv.registered_email}</span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Sent {formatIstDate(inv.sent_at)} · expires {formatIstDate(inv.expires_at)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge className={state.className}>{state.label}</Badge>
                              {inv.state === 'open' && (
                                <button
                                  onClick={() => handleRevoke(inv)}
                                  disabled={busy}
                                  className={`${smallButton} bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/20`}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>

      {editing && franchise && (
        <FranchiseFormModal franchise={franchise} onClose={() => setEditing(false)} onSaved={handleSaved} />
      )}
    </div>
  )
}

export default FranchiseDetailModal
