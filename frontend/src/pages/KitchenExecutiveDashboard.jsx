import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession, clearSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import gastronomixLogo from '../assets/gastronomix-logo.png'
import nippuKodiLogo from '../assets/nippu-kodi-logo.png'
import elChaapoLogo from '../assets/el-chaapo-logo.png'
import boomPizzaLogo from '../assets/boom-pizza-logo.png'

const BRANDS = [
  {
    id: 'NK',
    name: 'Nippu Kodi',
    color: 'bg-black',
    hoverColor: 'hover:bg-gray-900',
    logo: nippuKodiLogo,
    dbBrand: 'nippu_kodi',
    materialBrandCode: 'nk'
  },
  {
    id: 'EC',
    name: 'El Chaapo',
    color: 'bg-green-500',
    hoverColor: 'hover:bg-green-600',
    logo: elChaapoLogo,
    dbBrand: 'el_chaapo',
    materialBrandCode: 'ec'
  },
  {
    id: 'BP',
    name: 'Boom Pizza',
    color: 'bg-red-500',
    hoverColor: 'hover:bg-red-600',
    logo: boomPizzaLogo,
    dbBrand: 'boom_pizza',
    materialBrandCode: 'bp'
  }
]

const MATERIAL_TYPE_ORDER = {
  finished: 0,
  semi_finished: 1,
  raw_material: 2
}

const MATERIAL_TYPE_LABELS = {
  finished: 'Finished Materials',
  semi_finished: 'Semi-Finished Materials',
  raw_material: 'Raw Materials'
}

const KitchenExecutiveDashboard = () => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cloudKitchenId, setCloudKitchenId] = useState(null)
  const [userId, setUserId] = useState(null)

  const [selectedBrand, setSelectedBrand] = useState(null)
  const [dispatchPlans, setDispatchPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState(null)
  const [todayDraftPlan, setTodayDraftPlan] = useState(null)

  const [isDraftModalOpen, setIsDraftModalOpen] = useState(false)
  const [draftModalLoading, setDraftModalLoading] = useState(false)
  const [draftModalError, setDraftModalError] = useState(null)
  const [planMaterials, setPlanMaterials] = useState([])
  const [planOutlets, setPlanOutlets] = useState([])
  const [quantities, setQuantities] = useState({})
  const [inventoryByMaterial, setInventoryByMaterial] = useState({})

  const [isMaterialSearchOpen, setIsMaterialSearchOpen] = useState(false)
  const [materialSearchTerm, setMaterialSearchTerm] = useState('')
  const [highlightMaterialId, setHighlightMaterialId] = useState(null)
  const [isOutletSearchOpen, setIsOutletSearchOpen] = useState(false)
  const [outletSearchTerm, setOutletSearchTerm] = useState('')
  const [highlightOutletId, setHighlightOutletId] = useState(null)

  const [showLockConfirm, setShowLockConfirm] = useState(false)
  const [isLocking, setIsLocking] = useState(false)

  const navigate = useNavigate()

  useEffect(() => {
    const currentSession = getSession()
    setSession(currentSession)
    if (currentSession) {
      setCloudKitchenId(currentSession.cloud_kitchen_id || null)
      setUserId(currentSession.id || null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedBrand || !cloudKitchenId) {
      setDispatchPlans([])
      setTodayDraftPlan(null)
      return
    }
    fetchDispatchPlansForBrand()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrand, cloudKitchenId])

  // Auto-clear highlight after a short blink
  useEffect(() => {
    if (!highlightMaterialId) return
    const timeout = setTimeout(() => {
      setHighlightMaterialId(null)
    }, 1000)
    return () => clearTimeout(timeout)
  }, [highlightMaterialId])

  useEffect(() => {
    if (!highlightOutletId) return
    const timeout = setTimeout(() => setHighlightOutletId(null), 1000)
    return () => clearTimeout(timeout)
  }, [highlightOutletId])

  const handleLogout = () => {
    clearSession()
    navigate('/invmanagement/login')
  }

  const getBrandMeta = (brandId) => {
    return BRANDS.find(b => b.id === brandId) || null
  }

  const fetchDispatchPlansForBrand = async () => {
    if (!selectedBrand || !cloudKitchenId) return
    const brandMeta = getBrandMeta(selectedBrand)
    if (!brandMeta) return

    setPlansLoading(true)
    setPlansError(null)

    try {
      const { data, error } = await supabase
        .from('dispatch_plan')
        .select('id, plan_date, status, created_at, notes, locked_at')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .eq('brand', brandMeta.dbBrand)
        .order('plan_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      const plans = data || []
      setDispatchPlans(plans)

      const today = new Date().toISOString().split('T')[0]
      const draftToday = plans.find(
        plan => plan.plan_date === today && plan.status === 'draft'
      ) || null
      setTodayDraftPlan(draftToday)
    } catch (error) {
      console.error('Error fetching dispatch plans (kitchen):', error)
      setPlansError('Failed to load dispatch plans. Please try again.')
    } finally {
      setPlansLoading(false)
    }
  }

  const openDraftPlanModal = async () => {
    if (!todayDraftPlan || !cloudKitchenId) {
      setDraftModalError('No draft dispatch plan for today to review.')
      setIsDraftModalOpen(true)
      return
    }

    setIsDraftModalOpen(true)
    setDraftModalLoading(true)
    setDraftModalError(null)
    setPlanMaterials([])
    setPlanOutlets([])
    setQuantities({})
    setInventoryByMaterial({})
    setIsMaterialSearchOpen(false)
    setMaterialSearchTerm('')

    try {
      const { data: items, error } = await supabase
        .from('dispatch_plan_items')
        .select(`
          id,
          quantity,
          raw_materials:raw_material_id (
            id,
            name,
            code,
            unit,
            material_type,
            category
          ),
          outlets:outlet_id (
            id,
            name,
            code
          )
        `)
        .eq('dispatch_plan_id', todayDraftPlan.id)

      if (error) throw error

      const rows = items || []
      if (rows.length === 0) {
        setDraftModalError('This draft dispatch plan has no items yet.')
        return
      }

      const materialMap = new Map()
      const outletMap = new Map()
      const qtyMap = {}

      rows.forEach(row => {
        const rm = row.raw_materials
        const outlet = row.outlets
        if (!rm || !outlet) return

        if (!materialMap.has(rm.id)) {
          materialMap.set(rm.id, rm)
        }
        if (!outletMap.has(outlet.id)) {
          outletMap.set(outlet.id, outlet)
        }

        if (!qtyMap[rm.id]) qtyMap[rm.id] = {}
        qtyMap[rm.id][outlet.id] = parseFloat(row.quantity || 0)
      })

      const materialsArr = Array.from(materialMap.values())
      const outletsArr = Array.from(outletMap.values()).sort((a, b) => {
        const codeA = (a.code || '').toLowerCase()
        const codeB = (b.code || '').toLowerCase()
        return codeA.localeCompare(codeB)
      })

      setPlanMaterials(materialsArr)
      setPlanOutlets(outletsArr)
      setQuantities(qtyMap)

      // Fetch current inventory for these materials
      const materialIds = materialsArr.map(m => m.id)
      if (materialIds.length > 0) {
        const { data: invData, error: invError } = await supabase
          .from('inventory')
          .select('raw_material_id, quantity')
          .eq('cloud_kitchen_id', cloudKitchenId)
          .in('raw_material_id', materialIds)

        if (invError) throw invError

        const invMap = {}
        ;(invData || []).forEach(row => {
          invMap[row.raw_material_id] = parseFloat(row.quantity || 0)
        })
        setInventoryByMaterial(invMap)
      }
    } catch (error) {
      console.error('Error preparing draft dispatch plan modal:', error)
      setDraftModalError('Failed to load draft dispatch plan. Please try again.')
    } finally {
      setDraftModalLoading(false)
    }
  }

  const handleQuantityChange = (rawMaterialId, outletId, value) => {
    setQuantities(prev => {
      const materialRow = prev[rawMaterialId] || {}
      return {
        ...prev,
        [rawMaterialId]: {
          ...materialRow,
          [outletId]: value
        }
      }
    })
  }

  // FIFO allocation: decrement stock from batches (and let triggers update inventory)
  const allocateStockFIFO = async (rawMaterialId, quantity) => {
    const qty = parseFloat(quantity)
    if (!cloudKitchenId || isNaN(qty) || qty <= 0) return

    const { data: batches, error: batchError } = await supabase
      .from('stock_in_batches')
      .select('id, quantity_remaining, unit_cost, created_at')
      .eq('raw_material_id', rawMaterialId)
      .eq('cloud_kitchen_id', cloudKitchenId)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: true })

    if (batchError) throw batchError

    if (!batches || batches.length === 0) {
      throw new Error('No batches available for this material')
    }

    let remaining = qty
    const updates = []

    for (const batch of batches) {
      if (remaining <= 0) break
      const available = parseFloat(batch.quantity_remaining)
      const toAllocate = Math.min(available, remaining)

      updates.push({
        id: batch.id,
        newQuantityRemaining: available - toAllocate
      })

      remaining -= toAllocate
    }

    if (remaining > 0) {
      throw new Error(`Insufficient stock. Short by ${remaining.toFixed(3)} units`)
    }

    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('stock_in_batches')
        .update({ quantity_remaining: update.newQuantityRemaining })
        .eq('id', update.id)

      if (updateError) throw updateError
    }
  }

  // Order materials for UI: Finished → Semi-Finished → Raw, then by name
  const orderedMaterials = [...planMaterials].sort((a, b) => {
    const orderA = MATERIAL_TYPE_ORDER[a.material_type] ?? 99
    const orderB = MATERIAL_TYPE_ORDER[b.material_type] ?? 99
    if (orderA !== orderB) return orderA - orderB
    const nameA = (a.name || '').toLowerCase()
    const nameB = (b.name || '').toLowerCase()
    return nameA.localeCompare(nameB)
  })

  const handleScrollToMaterial = (materialId) => {
    setIsMaterialSearchOpen(false)
    setMaterialSearchTerm('')

    setTimeout(() => {
      const rowElement = document.getElementById(`kitchen-material-row-${materialId}`)
      if (rowElement) {
        rowElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
        setHighlightMaterialId(materialId)
      }
    }, 100)
  }

  const handleScrollToOutlet = (outletId) => {
    setIsOutletSearchOpen(false)
    setOutletSearchTerm('')
    setTimeout(() => {
      const colEl = document.getElementById(`kitchen-outlet-column-${outletId}`)
      if (colEl) {
        colEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
        setHighlightOutletId(outletId)
      }
    }, 100)
  }

  const handleStartLock = () => {
    if (!todayDraftPlan) return
    setShowLockConfirm(true)
  }

  const handleConfirmLock = async () => {
    if (!todayDraftPlan || !cloudKitchenId || !userId) return

    try {
      setIsLocking(true)
      setDraftModalError(null)

      // Build final items from current grid
      const items = []
      Object.entries(quantities).forEach(([rawMaterialId, outletMap]) => {
        Object.entries(outletMap || {}).forEach(([outletId, value]) => {
          const qty = parseFloat(value)
          if (!isNaN(qty) && qty > 0) {
            items.push({
              raw_material_id: rawMaterialId,
              outlet_id: outletId,
              quantity: qty
            })
          }
        })
      })

      if (items.length === 0) {
        setDraftModalError('Please keep at least one item with a positive quantity before locking.')
        setShowLockConfirm(false)
        return
      }

      // Validate inventory for each material (sum of quantities across outlets)
      const totalsByMaterial = {}
      items.forEach(item => {
        const id = item.raw_material_id
        if (!totalsByMaterial[id]) totalsByMaterial[id] = 0
        totalsByMaterial[id] += item.quantity
      })

      for (const [materialId, totalQty] of Object.entries(totalsByMaterial)) {
        const available = inventoryByMaterial[materialId] ?? 0
        if (totalQty > available + 1e-6) {
          const material = planMaterials.find(m => m.id === materialId)
          const name = material?.name || 'Material'
          const unit = material?.unit || ''
          setDraftModalError(
            `Insufficient stock for ${name}. Available: ${available.toFixed(3)} ${unit}, planned: ${totalQty.toFixed(3)} ${unit}.`
          )
          setShowLockConfirm(false)
          setIsLocking(false)
          return
        }
      }

      // Re-check current inventory just before locking (to reduce race risk)
      const materialIds = planMaterials.map(m => m.id)
      if (materialIds.length > 0) {
        const { data: invData, error: invError } = await supabase
          .from('inventory')
          .select('raw_material_id, quantity')
          .eq('cloud_kitchen_id', cloudKitchenId)
          .in('raw_material_id', materialIds)

        if (invError) throw invError

        const invMap = {}
        ;(invData || []).forEach(row => {
          invMap[row.raw_material_id] = parseFloat(row.quantity || 0)
        })
        setInventoryByMaterial(invMap)

        for (const [materialId, totalQty] of Object.entries(totalsByMaterial)) {
          const available = invMap[materialId] ?? 0
          if (totalQty > available + 1e-6) {
            const material = planMaterials.find(m => m.id === materialId)
            const name = material?.name || 'Material'
            const unit = material?.unit || ''
            setDraftModalError(
              `Insufficient stock for ${name}. Available: ${available.toFixed(3)} ${unit}, planned: ${totalQty.toFixed(3)} ${unit}.`
            )
            setShowLockConfirm(false)
            setIsLocking(false)
            return
          }
        }
      }

      // Decrement stock from batches using FIFO for each material
      for (const [materialId, totalQty] of Object.entries(totalsByMaterial)) {
        await allocateStockFIFO(materialId, totalQty)
      }

      // Replace dispatch_plan_items with final items
      const { error: deleteError } = await supabase
        .from('dispatch_plan_items')
        .delete()
        .eq('dispatch_plan_id', todayDraftPlan.id)

      if (deleteError) throw deleteError

      const payload = items.map(item => ({
        dispatch_plan_id: todayDraftPlan.id,
        raw_material_id: item.raw_material_id,
        outlet_id: item.outlet_id,
        quantity: item.quantity
      }))

      const { error: insertError } = await supabase
        .from('dispatch_plan_items')
        .insert(payload)

      if (insertError) throw insertError

      // Lock the plan
      const { error: updateError } = await supabase
        .from('dispatch_plan')
        .update({
          status: 'locked',
          locked_by: userId,
          locked_at: new Date().toISOString()
        })
        .eq('id', todayDraftPlan.id)

      if (updateError) throw updateError

      // Refresh plans and close modal
      await fetchDispatchPlansForBrand()
      setIsDraftModalOpen(false)
      setShowLockConfirm(false)
    } catch (error) {
      console.error('Error locking dispatch plan:', error)
      setDraftModalError(error.message || 'Failed to lock dispatch plan. Please try again.')
      setShowLockConfirm(false)
    } finally {
      setIsLocking(false)
    }
  }

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    )
  }

  const firstName = session.full_name?.split(' ')[0] || 'User'
  const cloudKitchenName = session.cloud_kitchen_name

  const today = new Date().toISOString().split('T')[0]
  const previousPlans = dispatchPlans.filter(
    (plan) => !(todayDraftPlan && plan.id === todayDraftPlan.id)
  )

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar with branding and context */}
      <header className="bg-card border-b border-border px-4 lg:px-8 py-3 lg:py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <img
              src={gastronomixLogo}
              alt="Gastronomix"
              className="h-8 lg:h-10 w-auto object-contain flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs lg:text-sm text-muted-foreground uppercase tracking-wide">
                Kitchen Executive Dashboard
              </p>
              <h1 className="text-sm lg:text-xl font-semibold text-foreground truncate">
                Welcome, {firstName}
              </h1>
              <p className="text-xs lg:text-sm text-muted-foreground truncate">
                {cloudKitchenName ? `Cloud Kitchen: ${cloudKitchenName}` : null}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="bg-destructive text-destructive-foreground font-semibold px-3 lg:px-4 py-2 rounded-lg hover:bg-destructive/90 transition-colors text-xs lg:text-sm flex-shrink-0"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 py-6 lg:py-8">
          {/* Brand selection */}
          <section className="mb-6 lg:mb-8">
            <h2 className="text-base lg:text-lg font-semibold text-foreground mb-3 lg:mb-4">
              Select Brand
            </h2>
            <div className="flex flex-row lg:grid lg:grid-cols-3 gap-2 lg:gap-4">
              {BRANDS.map((brand) => (
                <button
                  key={brand.id}
                  onClick={() => {
                    setSelectedBrand(brand.id)
                  }}
                  className={`${brand.color} ${brand.hoverColor} text-white font-bold py-2.5 lg:py-8 px-3 lg:px-6 rounded-lg lg:rounded-xl transition-all duration-200 shadow-md lg:shadow-lg hover:shadow-lg lg:hover:shadow-xl transform hover:scale-105 active:scale-95 touch-manipulation flex-1 lg:flex-none ${
                    selectedBrand === brand.id ? 'ring-2 lg:ring-4 ring-white ring-offset-1 lg:ring-offset-2' : ''
                  }`}
                >
                  <div className="text-center flex flex-col items-center">
                    <img
                      src={brand.logo}
                      alt={brand.name}
                      className="h-6 lg:h-12 w-auto mb-1 lg:mb-2 object-contain"
                    />
                    <div className="text-xs lg:text-2xl font-black mb-0.5 lg:mb-1 truncate">
                      {brand.name}
                    </div>
                    <div className="hidden lg:block text-xs lg:text-sm opacity-90">
                      Tap to review dispatch plans
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {selectedBrand ? (
            <section className="space-y-4 lg:space-y-6">
              {/* Today's draft dispatch plan */}
              <div className="bg-card border border-border rounded-2xl p-4 lg:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div>
                    <h2 className="text-base lg:text-lg font-semibold text-foreground">
                      {getBrandMeta(selectedBrand)?.name} – Today&apos;s Draft Dispatch Plan
                    </h2>
                    {todayDraftPlan ? (
                      <>
                        <p className="text-xs lg:text-sm text-muted-foreground mt-1">
                          Draft created for {todayDraftPlan.plan_date}. Review quantities, compare with
                          current inventory, and lock when ready. Once locked, it cannot be edited.
                        </p>
                        {todayDraftPlan.locked_at && (
                          <p className="text-xs lg:text-sm text-yellow-500 mt-1">
                            This plan is already locked.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs lg:text-sm text-muted-foreground mt-1">
                        No draft dispatch plan has been created for today yet. The dispatch executive
                        will create today&apos;s plan here.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-stretch gap-2 min-w-[220px]">
                    <button
                      onClick={openDraftPlanModal}
                      disabled={!todayDraftPlan || todayDraftPlan.status !== 'draft'}
                      className={`w-full font-semibold px-4 py-2.5 rounded-lg text-sm lg:text-base transition-colors ${
                        !todayDraftPlan || todayDraftPlan.status !== 'draft'
                          ? 'bg-muted text-muted-foreground cursor-not-allowed'
                          : 'bg-accent text-black hover:bg-accent/90'
                      }`}
                    >
                      {todayDraftPlan ? 'Open Draft Plan' : 'No Draft Available'}
                    </button>
                    {todayDraftPlan && todayDraftPlan.status === 'draft' && (
                      <button
                        onClick={handleStartLock}
                        disabled={!todayDraftPlan}
                        className="w-full font-semibold px-4 py-2 rounded-lg text-sm lg:text-base bg-red-500/10 text-red-500 border border-red-500/40 hover:bg-red-500/15 transition-colors"
                      >
                        Lock Dispatch Plan
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Previous dispatch plans */}
              <div className="bg-card border border-border rounded-2xl p-4 lg:p-6">
                <div className="flex items-center justify-between mb-3 lg:mb-4">
                  <h3 className="text-sm lg:text-base font-semibold text-foreground">
                    Previous Dispatch Plans
                  </h3>
                  {previousPlans.length > 0 && (
                    <span className="text-xs lg:text-sm text-muted-foreground">
                      {previousPlans.length} plan{previousPlans.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {plansError && (
                  <div className="mb-3 text-xs lg:text-sm text-destructive">
                    {plansError}
                  </div>
                )}

                {plansLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    Loading dispatch plans...
                  </div>
                ) : previousPlans.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No previous dispatch plans found yet for this brand.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs lg:text-sm border-t border-border">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-2.5 pr-4">Plan Date</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 hidden sm:table-cell">Created At</th>
                          <th className="py-2.5 px-4 hidden md:table-cell">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previousPlans.map(plan => (
                          <tr key={plan.id} className="border-t border-border/60">
                            <td className="py-2.5 pr-4">
                              <span className="font-medium text-foreground">
                                {plan.plan_date}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  plan.status === 'draft'
                                    ? 'bg-yellow-500/10 text-yellow-600'
                                    : plan.status === 'locked'
                                      ? 'bg-green-500/10 text-green-600'
                                      : 'bg-destructive/10 text-destructive'
                                }`}
                              >
                                {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 hidden sm:table-cell text-muted-foreground">
                              {plan.created_at ? new Date(plan.created_at).toLocaleString() : '-'}
                            </td>
                            <td className="py-2.5 px-4 hidden md:table-cell text-muted-foreground">
                              {plan.notes || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="bg-card border border-border rounded-2xl p-6">
              <div className="text-center">
                <h2 className="text-base lg:text-lg font-semibold text-foreground mb-2">
                  Select a brand to get started
                </h2>
                <p className="text-xs lg:text-sm text-muted-foreground">
                  Choose a brand above to review today&apos;s draft dispatch plan and see previous plans.
                </p>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Draft plan modal */}
      {isDraftModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end lg:items-center justify-center p-2 lg:p-4">
          <div className="bg-card border border-border rounded-t-2xl lg:rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="flex items-start justify-between gap-3 px-4 py-3 lg:px-6 lg:py-4 border-b border-border">
              <div className="min-w-0">
                <p className="text-xs lg:text-sm text-muted-foreground uppercase tracking-wide">
                  Review & Lock Dispatch Plan
                </p>
                <h2 className="text-sm lg:text-lg font-semibold text-foreground truncate">
                  {getBrandMeta(selectedBrand)?.name} · {today}
                </h2>
                <p className="text-[11px] lg:text-xs text-muted-foreground mt-1">
                  Adjust quantities per outlet, compare with current inventory, then lock the plan.
                  Once locked, inventory will be decremented and the plan cannot be edited.
                </p>
              </div>
              <button
                onClick={() => setIsDraftModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="Close"
                disabled={isLocking}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {draftModalError && (
              <div className="px-4 py-2 lg:px-6 lg:py-3 bg-destructive/10 text-destructive text-xs lg:text-sm border-b border-destructive/30">
                {draftModalError}
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {draftModalLoading ? (
                <div className="h-full flex items-center justify-center px-4 py-8">
                  <p className="text-sm text-muted-foreground">Loading draft dispatch plan...</p>
                </div>
              ) : planOutlets.length === 0 || orderedMaterials.length === 0 ? (
                <div className="px-4 py-6 lg:px-6 lg:py-8">
                  <p className="text-sm text-muted-foreground">
                    This draft dispatch plan has no items to review yet.
                  </p>
                </div>
              ) : (
                <div className="px-2 lg:px-4 py-3 lg:py-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs lg:text-sm text-muted-foreground">
                      Only materials with at least one outlet quantity are listed. Inventory is shown
                      for this cloud kitchen.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsMaterialSearchOpen(true)}
                        className="inline-flex items-center gap-1.5 text-[11px] lg:text-xs px-3.5 py-1.5 rounded-full border border-border text-foreground hover:bg-muted bg-background/70 shadow-sm"
                      >
                        <svg
                          className="w-3.5 h-3.5 text-yellow-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-4.35-4.35M11 5a6 6 0 100 12 6 6 0 000-12z"
                          />
                        </svg>
                        <span className="font-medium">Search material</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsOutletSearchOpen(true)}
                        className="inline-flex items-center gap-1.5 text-[11px] lg:text-xs px-3.5 py-1.5 rounded-full border border-border text-foreground hover:bg-muted bg-background/70 shadow-sm"
                      >
                        <svg
                          className="w-3.5 h-3.5 text-yellow-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-4.35-4.35M11 5a6 6 0 100 12 6 6 0 000-12z"
                          />
                        </svg>
                        <span className="font-medium">Search outlet</span>
                      </button>
                    </div>
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse min-w-[540px] lg:min-w-[780px]">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm font-semibold text-muted-foreground text-left">
                              Materials
                            </th>
                            <th className="border-b border-l border-border px-3 lg:px-4 py-2 lg:py-2.5 text-[11px] lg:text-xs font-semibold text-muted-foreground text-right whitespace-nowrap">
                              Current Inventory
                            </th>
                            {planOutlets.map(outlet => (
                              <th
                                key={outlet.id}
                                id={`kitchen-outlet-column-${outlet.id}`}
                                className={`border-b border-l border-border px-2 lg:px-3 py-2 text-[11px] lg:text-xs font-semibold text-muted-foreground text-center whitespace-nowrap transition-colors ${
                                  highlightOutletId === outlet.id ? 'bg-yellow-100/70' : ''
                                }`}
                              >
                                <div className="font-mono text-[11px] lg:text-xs">
                                  {outlet.code}
                                </div>
                                <div className="text-[10px] lg:text-[11px] truncate max-w-[96px] lg:max-w-[144px]">
                                  {outlet.name}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {orderedMaterials.map((material, index) => {
                            const prevType =
                              index > 0 ? orderedMaterials[index - 1].material_type : null
                            const sectionChanged = material.material_type !== prevType
                            const sectionLabel =
                              sectionChanged && MATERIAL_TYPE_LABELS[material.material_type]
                                ? MATERIAL_TYPE_LABELS[material.material_type]
                                : null

                            const currentInv =
                              inventoryByMaterial[material.id] !== undefined
                                ? inventoryByMaterial[material.id]
                                : 0

                            return [
                              sectionLabel ? (
                                <tr key={`section-${material.material_type}-${index}`}>
                                  <td
                                    colSpan={2 + planOutlets.length}
                                    className="bg-background/80 border-t border-border px-3 lg:px-4 py-1.5 text-[11px] lg:text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                                  >
                                    {sectionLabel}
                                  </td>
                                </tr>
                              ) : null,
                              <tr
                                key={material.id}
                                id={`kitchen-material-row-${material.id}`}
                              >
                                <td
                                  className={`border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 align-top text-xs lg:text-sm bg-muted/40 transition-colors ${
                                    highlightMaterialId === material.id
                                      ? 'bg-yellow-100/70'
                                      : ''
                                  }`}
                                >
                                  <div className="font-medium text-foreground truncate">
                                    {material.name}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                                    {material.code} · {material.unit}
                                  </div>
                                  {material.material_type && (
                                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {material.material_type.replace('_', ' ')}
                                    </div>
                                  )}
                                </td>
                                <td className="border-t border-l border-border px-3 lg:px-4 py-2 lg:py-2.5 align-middle text-right text-[11px] lg:text-xs text-foreground bg-background/40">
                                  <span className="font-mono">
                                    {currentInv.toFixed(3)} {material.unit}
                                  </span>
                                </td>
                                {planOutlets.map(outlet => {
                                  const value = quantities[material.id]?.[outlet.id] ?? ''
                                  return (
                                    <td
                                      key={outlet.id}
                                      className={`border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle transition-colors ${
                                        highlightOutletId === outlet.id ? 'bg-yellow-100/70' : ''
                                      }`}
                                    >
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        value={value}
                                        onChange={(e) =>
                                          handleQuantityChange(
                                            material.id,
                                            outlet.id,
                                            e.target.value
                                          )
                                        }
                                        className="w-full bg-input border border-border rounded-md px-1.5 py-1 text-[11px] lg:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                                      />
                                    </td>
                                  )
                                })}
                              </tr>
                            ]
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="mt-2 text-[11px] lg:text-xs text-muted-foreground">
                    Tip: Leave a cell blank or set to 0 if nothing needs to be dispatched for that
                    material and outlet.
                  </p>
                </div>
              )}
            </div>

            <div className="px-4 py-3 lg:px-6 lg:py-4 border-t border-border bg-background flex flex-col-reverse lg:flex-row lg:items-center lg:justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsDraftModalOpen(false)}
                className="w-full lg:w-auto px-4 py-2.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted/60 transition-colors"
                disabled={isLocking}
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleStartLock}
                disabled={isLocking || !todayDraftPlan || todayDraftPlan.status !== 'draft'}
                className={`w-full lg:w-auto px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  isLocking || !todayDraftPlan || todayDraftPlan.status !== 'draft'
                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                    : 'bg-red-500 text-white hover:bg-red-600'
                }`}
              >
                {isLocking ? 'Locking...' : 'Lock Dispatch Plan'}
              </button>
            </div>

            {/* Material search popup */}
            {isMaterialSearchOpen && (
              <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
                <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h3 className="text-sm lg:text-base font-semibold text-foreground">
                      Search Materials
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMaterialSearchOpen(false)
                        setMaterialSearchTerm('')
                      }}
                      className="p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="px-4 py-3 border-b border-border">
                    <input
                      type="text"
                      value={materialSearchTerm}
                      onChange={(e) => setMaterialSearchTerm(e.target.value)}
                      placeholder="Search by material name or code..."
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-64 overflow-auto px-2 py-2">
                    {orderedMaterials
                      .filter((m) => {
                        if (!materialSearchTerm.trim()) return true
                        const term = materialSearchTerm.toLowerCase()
                        return (
                          (m.name || '').toLowerCase().includes(term) ||
                          (m.code || '').toLowerCase().includes(term)
                        )
                      })
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleScrollToMaterial(m.id)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted flex flex-col gap-0.5"
                        >
                          <span className="text-xs font-semibold text-foreground truncate">
                            {m.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground font-mono truncate">
                            {m.code} · {m.unit}
                          </span>
                          {m.material_type && (
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              {m.material_type.replace('_', ' ')}
                            </span>
                          )}
                        </button>
                      ))}
                    {orderedMaterials.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No materials available.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {isOutletSearchOpen && (
              <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
                <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h3 className="text-sm lg:text-base font-semibold text-foreground">
                      Search Outlets
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setIsOutletSearchOpen(false)
                        setOutletSearchTerm('')
                      }}
                      className="p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="px-4 py-3 border-b border-border">
                    <input
                      type="text"
                      value={outletSearchTerm}
                      onChange={(e) => setOutletSearchTerm(e.target.value)}
                      placeholder="Search by outlet code..."
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-64 overflow-auto px-2 py-2">
                    {planOutlets
                      .filter((o) => {
                        if (!outletSearchTerm.trim()) return true
                        const term = (o.code || '').toLowerCase()
                        return term.includes(outletSearchTerm.trim().toLowerCase())
                      })
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => handleScrollToOutlet(o.id)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted flex flex-col gap-0.5"
                        >
                          <span className="text-xs font-semibold text-foreground font-mono">
                            {o.code}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {o.name}
                          </span>
                        </button>
                      ))}
                    {planOutlets.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No outlets available.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lock confirmation modal */}
      {showLockConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 lg:p-6 max-w-md w-full shadow-xl">
            <h3 className="text-base lg:text-lg font-semibold text-foreground mb-2">
              Lock Dispatch Plan?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Once locked, this dispatch plan cannot be edited and the quantities will be deducted
              from this cloud kitchen&apos;s inventory. Are you sure you want to lock it?
            </p>
            <div className="flex flex-col-reverse lg:flex-row gap-3 lg:justify-end">
              <button
                type="button"
                onClick={() => setShowLockConfirm(false)}
                disabled={isLocking}
                className="w-full lg:w-auto px-4 py-2.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLock}
                disabled={isLocking}
                className="w-full lg:w-auto px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLocking ? 'Locking...' : 'Yes, Lock Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default KitchenExecutiveDashboard

