// Admin ▸ Franchise ▸ FOFO Franchises
//
// FOFO franchises — franchise owned, franchise operated — buy supplies from us
// through the partner app (docs/fofo-dashboard-spec.md). This screen is step 1
// of onboarding one: create the franchise, give it its outlets, and later send
// its welcome and registration emails.
//
// Its neighbour Franchise ▸ Data Cloning belongs to the FOCO dashboard, a
// different programme.
//
// Everything here goes through the partner app's server (lib/partnerApi.js),
// because the fofo schema is not reachable with this app's Supabase key.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fofoAdminApi } from '../../lib/partnerApi'
import { useToast } from '../../context/toastContext'
import FranchiseFormModal from '../../components/admin/fofo/FranchiseFormModal'
import FranchiseDetailModal from '../../components/admin/fofo/FranchiseDetailModal'

const thClass = 'px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground'

const AdminFofoFranchises = () => {
  const toast = useToast()

  const [franchises, setFranchises] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [openFranchiseId, setOpenFranchiseId] = useState(null)

  const fetchFranchises = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true)
      setError('')
      setFranchises(await fofoAdminApi.listFranchises())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFranchises()
  }, [fetchFranchises])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return franchises
    return franchises.filter((f) =>
      [f.name, f.city, f.contact_email, f.contact_person, f.gst_number, ...f.outlets.map((o) => o.code)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(q))
    )
  }, [franchises, search])

  const handleCreated = (franchise) => {
    setCreating(false)
    fetchFranchises({ quiet: true })
    toast.success('Franchise created', `Next, add ${franchise.name}'s outlets.`)
    setOpenFranchiseId(franchise.id)
  }

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">FOFO Franchises</h1>
            <p className="text-sm text-muted-foreground">
              Franchise-operated businesses that buy supplies through the partner app.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="bg-accent text-background font-black px-5 py-3 text-lg rounded-xl border-3 border-accent shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)] hover:shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)] hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] active:translate-x-[0.05em] active:translate-y-[0.05em] active:shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)] transition-all duration-300"
          >
            + Add Franchise
          </button>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, city, email, GSTIN or outlet code..."
            className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>

        {error && (
          <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              onClick={() => fetchFranchises()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted text-foreground border border-border"
            >
              Retry
            </button>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading franchises…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {franchises.length === 0
                ? 'No FOFO franchises yet. Add one to start onboarding.'
                : 'No franchises match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/60 border-b border-border">
                  <tr>
                    <th className={thClass}>Franchise</th>
                    <th className={thClass}>Contact</th>
                    <th className={thClass}>Outlets</th>
                    <th className={thClass}>Users</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} className="border-b border-border/70 hover:bg-background/50 transition-colors">
                      <td className="px-4 py-3 text-sm">
                        <p className="font-semibold text-foreground">{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[f.city, f.gst_number || 'No GSTIN'].filter(Boolean).join(' · ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <p className="text-foreground break-all">{f.contact_email}</p>
                        {f.contact_person && <p className="text-xs text-muted-foreground">{f.contact_person}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {f.outlets.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None yet</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {f.outlets.map((o) => (
                              <span
                                key={o.id}
                                title={o.name}
                                className="px-2 py-0.5 text-xs font-mono rounded-md bg-background border border-border text-foreground"
                              >
                                {o.code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{f.user_count}</td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-md border ${
                            f.is_active
                              ? 'bg-green-500/15 text-green-400 border-green-500/40'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {f.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          onClick={() => setOpenFranchiseId(f.id)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/10 text-accent border border-accent/40 hover:bg-accent/20 hover:border-accent/60 transition-colors"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {creating && <FranchiseFormModal onClose={() => setCreating(false)} onSaved={handleCreated} />}

        {openFranchiseId && (
          <FranchiseDetailModal
            franchiseId={openFranchiseId}
            onClose={() => setOpenFranchiseId(null)}
            onChanged={() => fetchFranchises({ quiet: true })}
          />
        )}
      </div>
    </div>
  )
}

export default AdminFofoFranchises
