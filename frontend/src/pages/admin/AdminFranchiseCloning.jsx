import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// Franchise Data Cloning (admin)
//
// Copy one outlet's REAL confirmed day onto other (non-operating) outlets so the
// franchise portal has something to show them. Cloned data lives ONLY in the
// franchise_daily_snapshot* tables — operational data is never touched. Admins
// can also go back and hand-edit any *cloned* day (never the real data).
//
// All writes go through SECURITY DEFINER RPCs (migrations 0004) that re-verify
// the admin server-side. Reads are direct anon-key queries. See
// gastronomix-franchise-portal/docs/cloning-feature.md.
// ─────────────────────────────────────────────────────────────────────────────

const istToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // YYYY-MM-DD

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const qty = (v) => {
  const n = num(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
const money = (v) => `₹${num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const soldOf = (r) => Math.max(0, num(r.sent_quantity) - num(r.returned_quantity) - num(r.wasted_quantity))

// Small status pill for an outlet on the selected date.
function StatusPill({ status, sourceName }) {
  if (status === 'real') {
    return <span className="inline-flex items-center rounded-full bg-accent/15 text-accent px-2.5 py-0.5 text-xs font-semibold">Real data</span>
  }
  if (status === 'cloned') {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-500/15 text-sky-400 px-2.5 py-0.5 text-xs font-semibold">
        Cloned{sourceName ? ` ← ${sourceName}` : ''}
      </span>
    )
  }
  return <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-semibold">No data</span>
}

const AdminFranchiseCloning = () => {
  const session = useMemo(() => getSession(), [])
  const adminId = session?.id

  const [planDate, setPlanDate] = useState(istToday())
  const [outlets, setOutlets] = useState([])
  const [realSet, setRealSet] = useState(new Set())     // outlet_id -> has confirmed real data
  const [cloneMap, setCloneMap] = useState(new Map())   // outlet_id -> snapshot header row
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [sourceId, setSourceId] = useState('')
  const [targetIds, setTargetIds] = useState(new Set())
  const [busy, setBusy] = useState(false)

  const [confirmTargets, setConfirmTargets] = useState(null) // array of outlet ids pending overwrite confirm
  const [editOutletId, setEditOutletId] = useState(null)

  const outletsById = useMemo(() => {
    const m = new Map()
    for (const o of outlets) m.set(o.id, o)
    return m
  }, [outlets])

  const nameOf = useCallback((id) => outletsById.get(id)?.name ?? '—', [outletsById])
  const statusOf = useCallback(
    (id) => (realSet.has(id) ? 'real' : cloneMap.has(id) ? 'cloned' : 'none'),
    [realSet, cloneMap]
  )

  const loadCoverage = useCallback(async (date) => {
    setLoading(true)
    setError('')
    try {
      const [outletsRes, realRes, cloneRes] = await Promise.all([
        supabase.from('outlets').select('id, name, code').eq('is_active', true).is('deleted_at', null).order('name'),
        supabase.from('checkout_form').select('outlet_id').eq('plan_date', date).eq('status', 'confirmed'),
        supabase.from('franchise_daily_snapshot').select('outlet_id, source_outlet_id, cash, payment_onside').eq('plan_date', date),
      ])
      if (outletsRes.error) throw outletsRes.error
      if (realRes.error) throw realRes.error
      if (cloneRes.error) throw cloneRes.error

      setOutlets(outletsRes.data || [])
      setRealSet(new Set((realRes.data || []).map((r) => r.outlet_id)))
      const m = new Map()
      for (const c of cloneRes.data || []) m.set(c.outlet_id, c)
      setCloneMap(m)
    } catch (e) {
      setError(e?.message || 'Failed to load outlet coverage')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCoverage(planDate)
    // reset the builder when the date changes
    setSourceId('')
    setTargetIds(new Set())
    setNotice('')
  }, [planDate, loadCoverage])

  const sourceOptions = useMemo(() => outlets.filter((o) => realSet.has(o.id)), [outlets, realSet])
  const targetOptions = useMemo(() => outlets.filter((o) => o.id !== sourceId), [outlets, sourceId])

  const toggleTarget = (id) => {
    setTargetIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setNotice('')
  }

  const conflictsInSelection = useMemo(
    () => [...targetIds].filter((id) => statusOf(id) !== 'none'),
    [targetIds, statusOf]
  )

  const runClone = async (targets) => {
    if (!adminId) {
      setError('Your session is missing a user id — please log in again.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error: rpcErr } = await supabase.rpc('franchise_clone', {
        p_source_outlet_id: sourceId,
        p_target_outlet_ids: targets,
        p_plan_date: planDate,
        p_admin_user_id: adminId,
      })
      if (rpcErr) throw rpcErr
      const cloned = data?.cloned?.length ?? 0
      const skipped = data?.skipped?.length ?? 0
      setNotice(
        `Cloned ${nameOf(sourceId)} → ${cloned} outlet${cloned === 1 ? '' : 's'} for ${planDate}` +
          (skipped ? ` (${skipped} skipped)` : '') +
          `. Money: ${money(data?.cash)} cash + ${money(data?.payment_onside)} onside, ${data?.item_count ?? 0} products.`
      )
      setTargetIds(new Set())
      await loadCoverage(planDate)
    } catch (e) {
      setError(e?.message || 'Clone failed')
    } finally {
      setBusy(false)
      setConfirmTargets(null)
    }
  }

  const onCloneClick = () => {
    if (!sourceId || targetIds.size === 0) return
    if (conflictsInSelection.length > 0) {
      setConfirmTargets([...targetIds])
      return
    }
    runClone([...targetIds])
  }

  const revert = async (outletId) => {
    if (!adminId) return
    setBusy(true)
    setError('')
    try {
      const { error: rpcErr } = await supabase.rpc('franchise_snapshot_delete', {
        p_outlet_id: outletId,
        p_plan_date: planDate,
        p_admin_user_id: adminId,
      })
      if (rpcErr) throw rpcErr
      setNotice(`Reverted ${nameOf(outletId)} for ${planDate} — it now falls back to live data.`)
      await loadCoverage(planDate)
    } catch (e) {
      setError(e?.message || 'Revert failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Heading + date */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Franchise Data Cloning</h2>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">
              Copy a real operating outlet's day onto outlets that weren't operating, so the franchise
              portal has data to show them. Operational data is never modified — only franchise clones.
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operational date</span>
            <input
              type="date"
              value={planDate}
              max={istToday()}
              onChange={(e) => setPlanDate(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          The portal shows each day on the <span className="text-foreground font-medium">following</span> calendar day (T−1 rule),
          so a clone made for {planDate} appears in the portal the next day.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/40 text-destructive rounded-lg px-4 py-3 text-sm">{error}</div>
      )}
      {notice && (
        <div className="bg-accent/10 border border-accent/40 text-accent rounded-lg px-4 py-3 text-sm">{notice}</div>
      )}

      {loading ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">Loading coverage…</div>
      ) : (
        <>
          {/* ── Create a clone ─────────────────────────────────────────── */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="text-lg font-bold text-foreground">Create a clone</h3>

            {/* Step 1 — source */}
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">
                <span className="text-accent">1.</span> Choose a source outlet <span className="text-muted-foreground font-normal">(only outlets with real data for {planDate})</span>
              </p>
              {sourceOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No outlet has confirmed real data for this date. Pick another date.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {sourceOptions.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setSourceId(o.id)
                        setTargetIds((prev) => {
                          const next = new Set(prev)
                          next.delete(o.id)
                          return next
                        })
                        setNotice('')
                      }}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        sourceId === o.id
                          ? 'bg-accent text-black border-accent'
                          : 'bg-background text-foreground border-border hover:border-accent/60'
                      }`}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2 — targets */}
            <div className={sourceId ? '' : 'opacity-50 pointer-events-none select-none'}>
              <p className="text-sm font-semibold text-foreground mb-1">
                <span className="text-accent">2.</span> Choose target outlets <span className="text-muted-foreground font-normal">(one or more)</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                {targetOptions.map((o) => {
                  const st = statusOf(o.id)
                  const checked = targetIds.has(o.id)
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleTarget(o.id)}
                      className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        checked ? 'bg-accent/10 border-accent' : 'bg-background border-border hover:border-accent/40'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] font-bold ${
                            checked ? 'bg-accent border-accent text-black' : 'border-muted-foreground/50'
                          }`}
                          aria-hidden="true"
                        >
                          {checked ? '✓' : ''}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground">{o.name}</span>
                      </span>
                      <StatusPill status={st} sourceName={st === 'cloned' ? nameOf(cloneMap.get(o.id)?.source_outlet_id) : ''} />
                    </button>
                  )
                })}
              </div>

              {conflictsInSelection.length > 0 && (
                <p className="text-xs text-amber-400/90 mt-2">
                  ⚠ {conflictsInSelection.length} selected outlet{conflictsInSelection.length === 1 ? '' : 's'} already
                  {' '}has data — you'll be asked to confirm before overwriting.
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!sourceId || targetIds.size === 0 || busy}
                onClick={onCloneClick}
                className="bg-accent text-black font-semibold px-5 py-2.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Working…' : `Clone → ${targetIds.size || 0} outlet${targetIds.size === 1 ? '' : 's'}`}
              </button>
              {sourceId && (
                <span className="text-sm text-muted-foreground">
                  from <span className="font-semibold text-foreground">{nameOf(sourceId)}</span> for {planDate}
                </span>
              )}
            </div>
          </div>

          {/* ── Existing coverage / edit cloned data ───────────────────── */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground">Coverage for {planDate}</h3>
              <button
                type="button"
                onClick={() => loadCoverage(planDate)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ↻ Refresh
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-semibold">Outlet</th>
                    <th className="py-2 pr-4 font-semibold">Status</th>
                    <th className="py-2 pr-4 font-semibold text-right">Money (cloned)</th>
                    <th className="py-2 pr-0 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outlets.map((o) => {
                    const st = statusOf(o.id)
                    const snap = cloneMap.get(o.id)
                    return (
                      <tr key={o.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-4">
                          <span className="font-medium text-foreground">{o.name}</span>
                          <span className="text-muted-foreground ml-2 text-xs">{o.code}</span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusPill status={st} sourceName={st === 'cloned' ? nameOf(snap?.source_outlet_id) : ''} />
                        </td>
                        <td className="py-2.5 pr-4 text-right text-muted-foreground">
                          {st === 'cloned' ? money(num(snap?.cash) + num(snap?.payment_onside)) : '—'}
                        </td>
                        <td className="py-2.5 pr-0 text-right">
                          {st === 'cloned' ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditOutletId(o.id)}
                                className="text-accent hover:underline font-medium"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => revert(o.id)}
                                className="text-destructive hover:underline font-medium disabled:opacity-40"
                              >
                                Revert
                              </button>
                            </div>
                          ) : st === 'real' ? (
                            <span className="text-xs text-muted-foreground italic">real data — not editable</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {outlets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">No active outlets found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Overwrite confirmation modal */}
      {confirmTargets && (
        <OverwriteConfirmModal
          targets={confirmTargets}
          statusOf={statusOf}
          nameOf={nameOf}
          cloneMap={cloneMap}
          sourceName={nameOf(sourceId)}
          planDate={planDate}
          busy={busy}
          onCancel={() => setConfirmTargets(null)}
          onConfirm={() => runClone(confirmTargets)}
        />
      )}

      {/* Edit cloned data modal */}
      {editOutletId && (
        <EditCloneModal
          outletId={editOutletId}
          outletName={nameOf(editOutletId)}
          planDate={planDate}
          adminId={adminId}
          onClose={() => setEditOutletId(null)}
          onSaved={async () => {
            setEditOutletId(null)
            setNotice(`Updated cloned data for ${nameOf(editOutletId)} (${planDate}).`)
            await loadCoverage(planDate)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overwrite confirmation — lists which targets already have data and what kind.
// ─────────────────────────────────────────────────────────────────────────────
function OverwriteConfirmModal({ targets, statusOf, nameOf, cloneMap, sourceName, planDate, busy, onCancel, onConfirm }) {
  const rows = targets.map((id) => ({ id, status: statusOf(id) }))
  const conflicts = rows.filter((r) => r.status !== 'none')
  const fresh = rows.filter((r) => r.status === 'none')

  return (
    <Modal onClose={onCancel} title="Confirm overwrite">
      <p className="text-sm text-muted-foreground">
        Cloning <span className="font-semibold text-foreground">{sourceName}</span> for{' '}
        <span className="font-semibold text-foreground">{planDate}</span> onto {targets.length} outlet
        {targets.length === 1 ? '' : 's'}. The following already have data:
      </p>

      <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto">
        {conflicts.map(({ id, status }) => (
          <li key={id} className="flex items-center justify-between gap-3 bg-background border border-border rounded-lg px-3 py-2">
            <span className="font-medium text-foreground">{nameOf(id)}</span>
            {status === 'real' ? (
              <span className="text-xs text-amber-400">
                has its own real data — clone will hide it in the portal
              </span>
            ) : (
              <span className="text-xs text-sky-400">
                already cloned from {nameOf(cloneMap.get(id)?.source_outlet_id)} — will be replaced
              </span>
            )}
          </li>
        ))}
      </ul>

      {fresh.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {fresh.length} other selected outlet{fresh.length === 1 ? '' : 's'} ha{fresh.length === 1 ? 's' : 've'} no data and will be created fresh.
        </p>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-accent text-black font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Overwrite & clone'}
        </button>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit cloned data — per-item quantities + outlet money for one cloned day.
// ─────────────────────────────────────────────────────────────────────────────
function EditCloneModal({ outletId, outletName, planDate, adminId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([]) // {raw_material_id, name, unit, sent, returned, wasted}
  const [cash, setCash] = useState('0')
  const [payment, setPayment] = useState('0')
  const [sourceOutletId, setSourceOutletId] = useState(null)
  const [materials, setMaterials] = useState([]) // finished materials for the add-product picker
  const [addId, setAddId] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const [snapRes, matRes] = await Promise.all([
          supabase
            .from('franchise_daily_snapshot')
            .select(
              'id, cash, payment_onside, source_outlet_id, franchise_daily_snapshot_items(raw_material_id, sent_quantity, returned_quantity, wasted_quantity, raw_materials(name, unit))'
            )
            .eq('outlet_id', outletId)
            .eq('plan_date', planDate)
            .maybeSingle(),
          supabase.from('raw_materials').select('id, name, unit').eq('material_type', 'finished').order('name'),
        ])
        if (snapRes.error) throw snapRes.error
        if (matRes.error) throw matRes.error
        if (!alive) return

        const snap = snapRes.data
        setCash(String(num(snap?.cash)))
        setPayment(String(num(snap?.payment_onside)))
        setSourceOutletId(snap?.source_outlet_id ?? null)
        setMaterials(matRes.data || [])
        setRows(
          (snap?.franchise_daily_snapshot_items || [])
            .map((it) => ({
              raw_material_id: it.raw_material_id,
              name: it.raw_materials?.name ?? '—',
              unit: it.raw_materials?.unit ?? '',
              sent: String(num(it.sent_quantity)),
              returned: String(num(it.returned_quantity)),
              wasted: String(num(it.wasted_quantity)),
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load cloned data')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [outletId, planDate])

  const setCell = (idx, field, value) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  const removeRow = (idx) => setRows((prev) => prev.filter((_, i) => i !== idx))

  const usedIds = useMemo(() => new Set(rows.map((r) => r.raw_material_id)), [rows])
  const addableMaterials = useMemo(() => materials.filter((m) => !usedIds.has(m.id)), [materials, usedIds])

  const addRow = () => {
    const m = materials.find((x) => x.id === addId)
    if (!m) return
    setRows((prev) => [...prev, { raw_material_id: m.id, name: m.name, unit: m.unit || '', sent: '0', returned: '0', wasted: '0' }])
    setAddId('')
  }

  const save = async () => {
    if (!adminId) {
      setError('Your session is missing a user id — please log in again.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const items = rows.map((r) => ({
        raw_material_id: r.raw_material_id,
        sent_quantity: num(r.sent),
        returned_quantity: num(r.returned),
        wasted_quantity: num(r.wasted),
      }))
      const { error: rpcErr } = await supabase.rpc('franchise_snapshot_update', {
        p_outlet_id: outletId,
        p_plan_date: planDate,
        p_cash: num(cash),
        p_payment_onside: num(payment),
        p_items: items,
        p_admin_user_id: adminId,
        p_source_outlet_id: sourceOutletId,
      })
      if (rpcErr) throw rpcErr
      await onSaved()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} title={`Edit cloned data — ${outletName}`} subtitle={planDate} wide>
      {loading ? (
        <div className="py-10 text-center text-muted-foreground">Loading…</div>
      ) : (
        <>
          {error && (
            <div className="bg-destructive/10 border border-destructive/40 text-destructive rounded-lg px-3 py-2 text-sm mb-3">{error}</div>
          )}

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Product</th>
                  <th className="py-2 px-2 font-semibold text-right">Sent</th>
                  <th className="py-2 px-2 font-semibold text-right">Returned</th>
                  <th className="py-2 px-2 font-semibold text-right">Wasted</th>
                  <th className="py-2 px-2 font-semibold text-right">Sold</th>
                  <th className="py-2 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.raw_material_id} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span className="font-medium text-foreground">{r.name}</span>
                      {r.unit ? <span className="text-muted-foreground text-xs ml-1">({r.unit})</span> : null}
                    </td>
                    <td className="py-1.5 px-2"><QtyInput value={r.sent} onChange={(v) => setCell(i, 'sent', v)} /></td>
                    <td className="py-1.5 px-2"><QtyInput value={r.returned} onChange={(v) => setCell(i, 'returned', v)} /></td>
                    <td className="py-1.5 px-2"><QtyInput value={r.wasted} onChange={(v) => setCell(i, 'wasted', v)} /></td>
                    <td className="py-1.5 px-2 text-right font-semibold text-foreground">
                      {qty(soldOf({ sent_quantity: r.sent, returned_quantity: r.returned, wasted_quantity: r.wasted }))}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <button type="button" onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive" title="Remove product">✕</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No products. Add one below.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Add product */}
          {addableMaterials.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <select
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">+ Add a product…</option>
                {addableMaterials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={addRow}
                disabled={!addId}
                className="px-3 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}

          {/* Money */}
          <div className="grid grid-cols-2 gap-4 mt-5 max-w-md">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash (₹)</span>
              <MoneyInput value={cash} onChange={setCash} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment onside (₹)</span>
              <MoneyInput value={payment} onChange={setPayment} />
            </label>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent text-black font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function QtyInput({ value, onChange }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="0.001"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 bg-background border border-border rounded-md px-2 py-1 text-right text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
    />
  )
}
function MoneyInput({ value, onChange }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
    />
  )
}

// Generic centered modal shell.
function Modal({ title, subtitle, wide, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className={`relative bg-card border border-border rounded-2xl shadow-card p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">{title}</h3>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default AdminFranchiseCloning
