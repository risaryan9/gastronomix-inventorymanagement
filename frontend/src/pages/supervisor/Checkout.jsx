import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

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

const Checkout = () => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cloudKitchenId, setCloudKitchenId] = useState(null)
  const [userId, setUserId] = useState(null)

  const [dispatchPlans, setDispatchPlans] = useState([])
  const [checkoutForms, setCheckoutForms] = useState([])
  const [alert, setAlert] = useState(null)
  const [validationError, setValidationError] = useState(null)

  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false)
  const [selectedDispatchPlan, setSelectedDispatchPlan] = useState(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [supervisorName, setSupervisorName] = useState('')
  
  const [dispatchItems, setDispatchItems] = useState([])
  const [outlets, setOutlets] = useState([])
  const [materials, setMaterials] = useState([])
  
  const [returnQuantities, setReturnQuantities] = useState({})
  const [wastageQuantities, setWastageQuantities] = useState({})
  const [additionalInfo, setAdditionalInfo] = useState({})
  
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [isMaterialSearchOpen, setIsMaterialSearchOpen] = useState(false)
  const [materialSearchTerm, setMaterialSearchTerm] = useState('')
  const [highlightMaterialId, setHighlightMaterialId] = useState(null)
  const [isOutletSearchOpen, setIsOutletSearchOpen] = useState(false)
  const [outletSearchTerm, setOutletSearchTerm] = useState('')
  const [highlightOutletId, setHighlightOutletId] = useState(null)

  const navigate = useNavigate()

  // Auto-clear highlight after a short blink
  useEffect(() => {
    if (!highlightMaterialId) return
    const timeout = setTimeout(() => setHighlightMaterialId(null), 1000)
    return () => clearTimeout(timeout)
  }, [highlightMaterialId])

  useEffect(() => {
    if (!highlightOutletId) return
    const timeout = setTimeout(() => setHighlightOutletId(null), 1000)
    return () => clearTimeout(timeout)
  }, [highlightOutletId])

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
    if (cloudKitchenId) {
      fetchDispatchPlansAndCheckouts()
    }
  }, [cloudKitchenId])

  const fetchDispatchPlansAndCheckouts = async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      
      const { data: plans, error: plansError } = await supabase
        .from('dispatch_plan')
        .select('*')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .eq('status', 'locked')
        .gte('locked_at', twentyFourHoursAgo)
        .order('plan_date', { ascending: false })

      if (plansError) throw plansError

      const { data: checkouts, error: checkoutsError } = await supabase
        .from('checkout_form')
        .select('*')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .order('created_at', { ascending: false })

      if (checkoutsError) throw checkoutsError

      setDispatchPlans(plans || [])
      setCheckoutForms(checkouts || [])
    } catch (error) {
      console.error('Error fetching data:', error)
      setAlert({ type: 'error', message: 'Failed to load dispatch plans and checkouts' })
    } finally {
      setLoading(false)
    }
  }

  const openCheckoutModal = async (dispatchPlan) => {
    try {
      setSelectedDispatchPlan(dispatchPlan)
      
      const { data: items, error: itemsError } = await supabase
        .from('dispatch_plan_items')
        .select('*, outlets(*), raw_materials(*)')
        .eq('dispatch_plan_id', dispatchPlan.id)

      if (itemsError) throw itemsError

      const uniqueOutlets = [...new Map(items.map(item => [item.outlet_id, item.outlets])).values()]
      const uniqueMaterials = [...new Map(items.map(item => [item.raw_material_id, item.raw_materials])).values()]

      setDispatchItems(items || [])
      setOutlets(uniqueOutlets)
      setMaterials(uniqueMaterials)
      
      const initialReturn = {}
      const initialWastage = {}
      const initialAdditional = {}
      
      items.forEach(item => {
        const key = `${item.outlet_id}_${item.raw_material_id}`
        initialReturn[key] = ''
        initialWastage[key] = ''
      })
      
      uniqueOutlets.forEach(outlet => {
        initialAdditional[outlet.id] = { cash: '', payment_onside: '' }
      })
      
      setReturnQuantities(initialReturn)
      setWastageQuantities(initialWastage)
      setAdditionalInfo(initialAdditional)
      setSupervisorName('')
      setCurrentStep(1)
      setIsCheckoutModalOpen(true)
    } catch (error) {
      console.error('Error loading dispatch plan items:', error)
      setAlert({ type: 'error', message: 'Failed to load dispatch plan details' })
    }
  }

  const closeCheckoutModal = () => {
    setIsCheckoutModalOpen(false)
    setSelectedDispatchPlan(null)
    setCurrentStep(1)
    setDispatchItems([])
    setOutlets([])
    setMaterials([])
    setReturnQuantities({})
    setWastageQuantities({})
    setAdditionalInfo({})
    setSupervisorName('')
    setIsMaterialSearchOpen(false)
    setMaterialSearchTerm('')
    setHighlightMaterialId(null)
    setIsOutletSearchOpen(false)
    setOutletSearchTerm('')
    setHighlightOutletId(null)
  }

  const handleNext = () => {
    if (currentStep === 1) {
      // Validate return quantities don't exceed dispatched quantities
      let hasError = false
      let errorMessage = ''
      
      for (const outlet of outlets) {
        for (const material of materials) {
          const dispatchedQty = getDispatchedQuantity(outlet.id, material.id)
          if (dispatchedQty === 0) continue
          
          const key = `${outlet.id}_${material.id}`
          const returnQty = parseFloat(returnQuantities[key]) || 0
          
          if (returnQty > dispatchedQty) {
            hasError = true
            errorMessage = `Return quantity for ${material.name} at ${outlet.name} (${returnQty}) cannot exceed dispatched quantity (${dispatchedQty})`
            break
          }
        }
        if (hasError) break
      }
      
      if (hasError) {
        setValidationError(errorMessage)
        return
      }
      
      setCurrentStep(2)
    } else if (currentStep === 2) {
      // Validate wastage quantities don't exceed dispatched, and return + wastage don't exceed dispatched
      let hasError = false
      let errorMessage = ''
      
      for (const outlet of outlets) {
        for (const material of materials) {
          const dispatchedQty = getDispatchedQuantity(outlet.id, material.id)
          if (dispatchedQty === 0) continue
          
          const key = `${outlet.id}_${material.id}`
          const returnQty = parseFloat(returnQuantities[key]) || 0
          const wastageQty = parseFloat(wastageQuantities[key]) || 0
          
          if (wastageQty > dispatchedQty) {
            hasError = true
            errorMessage = `Wastage quantity for ${material.name} at ${outlet.name} (${wastageQty}) cannot exceed dispatched quantity (${dispatchedQty})`
            break
          }
          if (returnQty + wastageQty > dispatchedQty) {
            hasError = true
            errorMessage = `Return (${returnQty}) + wastage (${wastageQty}) for ${material.name} at ${outlet.name} cannot exceed dispatched quantity (${dispatchedQty})`
            break
          }
        }
        if (hasError) break
      }
      
      if (hasError) {
        setValidationError(errorMessage)
        return
      }
      
      setCurrentStep(3)
    } else if (currentStep === 3) {
      if (!supervisorName.trim()) {
        setValidationError('Please enter supervisor name')
        return
      }
      setIsReviewModalOpen(true)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleReturnQuantityChange = (outletId, materialId, value) => {
    const key = `${outletId}_${materialId}`
    setReturnQuantities(prev => ({ ...prev, [key]: value }))
  }

  const handleWastageQuantityChange = (outletId, materialId, value) => {
    const key = `${outletId}_${materialId}`
    setWastageQuantities(prev => ({ ...prev, [key]: value }))
  }

  const handleAdditionalInfoChange = (outletId, field, value) => {
    setAdditionalInfo(prev => ({
      ...prev,
      [outletId]: { ...prev[outletId], [field]: value }
    }))
  }

  const handleReviewConfirm = () => {
    setIsReviewModalOpen(false)
    setIsConfirmModalOpen(true)
  }

  const handleFinalConfirm = async () => {
    setSubmitting(true)
    try {
      const { data: checkoutForm, error: formError } = await supabase
        .from('checkout_form')
        .insert({
          dispatch_plan_id: selectedDispatchPlan.id,
          cloud_kitchen_id: cloudKitchenId,
          plan_date: selectedDispatchPlan.plan_date,
          status: 'draft',
          supervisor_name: supervisorName,
          created_by: userId
        })
        .select()
        .single()

      if (formError) throw formError

      const returnItems = []
      const wastageItems = []
      const additionalItems = []

      dispatchItems.forEach(item => {
        const returnKey = `${item.outlet_id}_${item.raw_material_id}`
        const returnQty = parseFloat(returnQuantities[returnKey]) || 0
        
        if (returnQty > 0) {
          returnItems.push({
            checkout_form_id: checkoutForm.id,
            outlet_id: item.outlet_id,
            raw_material_id: item.raw_material_id,
            dispatched_quantity: item.quantity,
            returned_quantity: returnQty
          })
        }
        
        const wastageQty = parseFloat(wastageQuantities[returnKey]) || 0
        if (wastageQty > 0) {
          wastageItems.push({
            checkout_form_id: checkoutForm.id,
            outlet_id: item.outlet_id,
            raw_material_id: item.raw_material_id,
            dispatched_quantity: item.quantity,
            wasted_quantity: wastageQty
          })
        }
      })

      outlets.forEach(outlet => {
        const info = additionalInfo[outlet.id]
        const cash = parseFloat(info?.cash) || 0
        const paymentOnside = parseFloat(info?.payment_onside) || 0
        
        if (cash > 0 || paymentOnside > 0) {
          additionalItems.push({
            checkout_form_id: checkoutForm.id,
            outlet_id: outlet.id,
            cash: cash,
            payment_onside: paymentOnside
          })
        }
      })

      if (returnItems.length > 0) {
        const { error: returnError } = await supabase
          .from('checkout_form_return_items')
          .insert(returnItems)
        if (returnError) throw returnError
      }

      if (wastageItems.length > 0) {
        const { error: wastageError } = await supabase
          .from('checkout_form_wastage_items')
          .insert(wastageItems)
        if (wastageError) throw wastageError
      }

      if (additionalItems.length > 0) {
        const { error: additionalError } = await supabase
          .from('checkout_form_additional')
          .insert(additionalItems)
        if (additionalError) throw additionalError
      }

      const { data: result, error: confirmError } = await supabase
        .rpc('confirm_checkout_form', { p_checkout_form_id: checkoutForm.id })

      if (confirmError) throw confirmError

      setAlert({ type: 'success', message: 'Checkout confirmed successfully! Inventory has been updated.' })
      setIsConfirmModalOpen(false)
      closeCheckoutModal()
      fetchDispatchPlansAndCheckouts()
    } catch (error) {
      console.error('Error confirming checkout:', error)
      setAlert({ type: 'error', message: error.message || 'Failed to confirm checkout' })
    } finally {
      setSubmitting(false)
    }
  }

  const getDispatchedQuantity = (outletId, materialId) => {
    const item = dispatchItems.find(
      i => i.outlet_id === outletId && i.raw_material_id === materialId
    )
    return item?.quantity || 0
  }

  const orderedMaterials = [...materials].sort((a, b) => {
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
    const rowId = currentStep === 1
      ? `checkout-return-material-row-${materialId}`
      : `checkout-wastage-material-row-${materialId}`
    setTimeout(() => {
      const rowEl = document.getElementById(rowId)
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightMaterialId(materialId)
      }
    }, 100)
  }

  const handleScrollToOutlet = (outletId) => {
    setIsOutletSearchOpen(false)
    setOutletSearchTerm('')
    const prefix = currentStep === 1 ? 'checkout-return-outlet-column' : 'checkout-wastage-outlet-column'
    setTimeout(() => {
      const colEl = document.getElementById(`${prefix}-${outletId}`)
      if (colEl) {
        colEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
        setHighlightOutletId(outletId)
      }
    }, 100)
  }

  const renderStepContent = () => {
    if (currentStep === 1) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Step 1: Return Quantities</h3>
          <p className="text-sm text-muted-foreground">
            Enter the quantities returned from each outlet for each material in the grid below.
          </p>

          <div className="flex items-center justify-between mb-3">
            <p className="text-xs lg:text-sm text-muted-foreground">
              Materials in this dispatch plan
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
              <table className="w-full border-collapse min-w-[480px] lg:min-w-[720px]">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm font-semibold text-muted-foreground text-left">
                      Materials
                    </th>
                    {outlets.map(outlet => (
                      <th
                        key={outlet.id}
                        id={`checkout-return-outlet-column-${outlet.id}`}
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

                    return [
                      sectionLabel ? (
                        <tr key={`section-${material.material_type}-${index}`}>
                          <td
                            colSpan={1 + outlets.length}
                            className="bg-background/80 border-t border-border px-3 lg:px-4 py-1.5 text-[11px] lg:text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                          >
                            {sectionLabel}
                          </td>
                        </tr>
                      ) : null,
                      <tr
                        key={material.id}
                        id={`checkout-return-material-row-${material.id}`}
                      >
                        <td
                          className={`border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 align-top text-xs lg:text-sm bg-muted/40 transition-colors ${
                            highlightMaterialId === material.id ? 'bg-yellow-100/70' : ''
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
                        {outlets.map(outlet => {
                          const dispatchedQty = getDispatchedQuantity(outlet.id, material.id)
                          const key = `${outlet.id}_${material.id}`
                          const value = returnQuantities[key] ?? ''

                          if (!dispatchedQty) {
                            return (
                              <td
                                key={outlet.id}
                                className={`border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle bg-muted/40 text-center text-[11px] text-muted-foreground transition-colors ${
                                  highlightOutletId === outlet.id ? 'bg-yellow-100/70' : ''
                                }`}
                              >
                                —
                              </td>
                            )
                          }

                          return (
                            <td
                              key={outlet.id}
                              className={`border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle transition-colors ${
                                highlightOutletId === outlet.id ? 'bg-yellow-100/70' : ''
                              }`}
                            >
                              <div className="flex flex-col gap-1">
                                <div className="text-[11px] text-muted-foreground">
                                  Dispatched:{' '}
                                  <span className="font-semibold text-foreground">
                                    {dispatchedQty} {material.unit}
                                  </span>
                                </div>
                                <input
                                  type="number"
                                  min="0"
                                  max={dispatchedQty}
                                  step="0.001"
                                  inputMode="decimal"
                                  value={value}
                                  onChange={(e) =>
                                    handleReturnQuantityChange(outlet.id, material.id, e.target.value)
                                  }
                                  className="w-full bg-input border border-border rounded-md px-1.5 py-1 text-[11px] lg:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  placeholder="Returned"
                                />
                              </div>
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
        </div>
      )
    }

    if (currentStep === 2) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Step 2: Wastage Quantities</h3>
          <p className="text-sm text-muted-foreground">
            Enter the quantities wasted by each outlet for each material (for tracking only).
          </p>

          <div className="flex items-center justify-between mb-3">
            <p className="text-xs lg:text-sm text-muted-foreground">
              Materials in this dispatch plan
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
              <table className="w-full border-collapse min-w-[480px] lg:min-w-[720px]">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm font-semibold text-muted-foreground text-left">
                      Materials
                    </th>
                    {outlets.map(outlet => (
                      <th
                        key={outlet.id}
                        id={`checkout-wastage-outlet-column-${outlet.id}`}
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

                    return [
                      sectionLabel ? (
                        <tr key={`section-wastage-${material.material_type}-${index}`}>
                          <td
                            colSpan={1 + outlets.length}
                            className="bg-background/80 border-t border-border px-3 lg:px-4 py-1.5 text-[11px] lg:text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                          >
                            {sectionLabel}
                          </td>
                        </tr>
                      ) : null,
                      <tr
                        key={material.id}
                        id={`checkout-wastage-material-row-${material.id}`}
                      >
                        <td
                          className={`border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 align-top text-xs lg:text-sm bg-muted/40 transition-colors ${
                            highlightMaterialId === material.id ? 'bg-yellow-100/70' : ''
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
                        {outlets.map(outlet => {
                          const dispatchedQty = getDispatchedQuantity(outlet.id, material.id)
                          const key = `${outlet.id}_${material.id}`
                          const value = wastageQuantities[key] ?? ''

                          if (!dispatchedQty) {
                            return (
                              <td
                                key={outlet.id}
                                className={`border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle bg-muted/40 text-center text-[11px] text-muted-foreground transition-colors ${
                                  highlightOutletId === outlet.id ? 'bg-yellow-100/70' : ''
                                }`}
                              >
                                —
                              </td>
                            )
                          }

                          return (
                            <td
                              key={outlet.id}
                              className={`border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle transition-colors ${
                                highlightOutletId === outlet.id ? 'bg-yellow-100/70' : ''
                              }`}
                            >
                              <div className="flex flex-col gap-1">
                                <div className="text-[11px] text-muted-foreground">
                                  Dispatched:{' '}
                                  <span className="font-semibold text-foreground">
                                    {dispatchedQty} {material.unit}
                                  </span>
                                </div>
                                <input
                                  type="number"
                                  min="0"
                                  max={dispatchedQty}
                                  step="0.001"
                                  inputMode="decimal"
                                  value={value}
                                  onChange={(e) =>
                                    handleWastageQuantityChange(outlet.id, material.id, e.target.value)
                                  }
                                  className="w-full bg-input border border-border rounded-md px-1.5 py-1 text-[11px] lg:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  placeholder="Wasted"
                                />
                              </div>
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
        </div>
      )
    }

    if (currentStep === 3) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Step 3: Additional Information</h3>
          <p className="text-sm text-muted-foreground">
            Enter cash and payment onside details for each outlet.
          </p>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[480px] lg:min-w-[720px]">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm font-semibold text-muted-foreground text-left">
                      Metric
                    </th>
                    {outlets.map(outlet => (
                      <th
                        key={outlet.id}
                        className="border-b border-l border-border px-2 lg:px-3 py-2 text-[11px] lg:text-xs font-semibold text-muted-foreground text-center whitespace-nowrap"
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
                  <tr>
                    <td className="border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm bg-muted/40 font-medium text-foreground">
                      Cash (₹)
                    </td>
                    {outlets.map(outlet => {
                      const info = additionalInfo[outlet.id] || {}
                      const value = info.cash ?? ''
                      return (
                        <td
                          key={outlet.id}
                          className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle"
                        >
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) => handleAdditionalInfoChange(outlet.id, 'cash', e.target.value)}
                            className="w-full bg-input border border-border rounded-md px-1.5 py-1 text-[11px] lg:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="0.00"
                          />
                        </td>
                      )
                    })}
                  </tr>
                  <tr>
                    <td className="border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm bg-muted/40 font-medium text-foreground">
                      Payment Onside (₹)
                    </td>
                    {outlets.map(outlet => {
                      const info = additionalInfo[outlet.id] || {}
                      const value = info.payment_onside ?? ''
                      return (
                        <td
                          key={outlet.id}
                          className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle"
                        >
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) => handleAdditionalInfoChange(outlet.id, 'payment_onside', e.target.value)}
                            className="w-full bg-input border border-border rounded-md px-1.5 py-1 text-[11px] lg:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="0.00"
                          />
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium text-foreground mb-1">
              Supervisor Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={supervisorName}
              onChange={(e) => setSupervisorName(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded bg-background"
              placeholder="Enter your name"
              required
            />
          </div>
        </div>
      )
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {alert && (
          <div className={`mb-4 p-4 rounded-lg ${
            alert.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            <div className="flex justify-between items-center">
              <span>{alert.message}</span>
              <button onClick={() => setAlert(null)} className="text-xl font-bold">&times;</button>
            </div>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">Check Out</h2>
          <p className="text-muted-foreground">
            Create checkout forms for locked dispatch plans and view previous checkouts.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Available Dispatch Plans (Last 24 Hours)
            </h3>
            {(() => {
              const availablePlans = dispatchPlans.filter(
                plan => !checkoutForms.some(c => c.dispatch_plan_id === plan.id)
              )
              return availablePlans.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No locked dispatch plans available for checkout. Plans that are already checked out are not shown here.
                </p>
              ) : (
                <div className="space-y-3">
                  {availablePlans.map(plan => (
                    <div
                      key={plan.id}
                      className="border border-border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-foreground">
                            {plan.brand?.replace('_', ' ').toUpperCase() || 'N/A'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Date: {new Date(plan.plan_date).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Locked: {new Date(plan.locked_at).toLocaleString()}
                          </p>
                        </div>
                        <button
                          onClick={() => openCheckoutModal(plan)}
                          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors text-sm font-semibold"
                        >
                          Create Checkout
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Previous Checkouts</h3>
            {checkoutForms.length === 0 ? (
              <p className="text-muted-foreground text-sm">No previous checkouts found.</p>
            ) : (
              <div className="space-y-3">
                {checkoutForms.map(checkout => (
                  <div
                    key={checkout.id}
                    className="border border-border rounded-lg p-4"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-foreground">
                          {checkout.supervisor_name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Date: {new Date(checkout.plan_date).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created: {new Date(checkout.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className={`px-3 py-1 text-xs font-semibold rounded ${
                        checkout.status === 'confirmed'
                          ? 'bg-green-100 text-green-800'
                          : checkout.status === 'submitted'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {checkout.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {isCheckoutModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="relative bg-card rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              {validationError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
                  <div className="bg-card border border-destructive/40 rounded-lg max-w-md w-full p-5 shadow-xl mx-4">
                    <h2 className="text-lg font-semibold text-destructive mb-2">Validation Error</h2>
                    <p className="text-sm text-foreground mb-4">{validationError}</p>
                    <div className="flex justify-end">
                      <button
                        onClick={() => setValidationError(null)}
                        className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors text-sm font-semibold"
                      >
                        OK
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {isMaterialSearchOpen && (currentStep === 1 || currentStep === 2) && (
                <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/40">
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
              {isOutletSearchOpen && (currentStep === 1 || currentStep === 2) && (
                <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/40">
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
                      {outlets
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
                      {outlets.length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          No outlets available.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="sticky top-0 bg-card border-b border-border p-4 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-foreground">
                    Add New Check Out Form ({currentStep}/3)
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedDispatchPlan?.brand?.replace('_', ' ').toUpperCase()} - {' '}
                    {new Date(selectedDispatchPlan?.plan_date).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={closeCheckoutModal}
                  className="text-2xl font-bold text-muted-foreground hover:text-foreground"
                >
                  &times;
                </button>
              </div>

              <div className="p-6">
                {renderStepContent()}
              </div>

              <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-between">
                <button
                  onClick={handleBack}
                  disabled={currentStep === 1}
                  className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  className="px-6 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-semibold"
                >
                  {currentStep === 3 ? 'Review Checkout' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isReviewModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-card border-b border-border p-4 flex justify-between items-center">
                <h2 className="text-xl font-bold text-foreground">Review Checkout</h2>
                <button
                  onClick={() => setIsReviewModalOpen(false)}
                  className="text-2xl font-bold text-muted-foreground hover:text-foreground"
                >
                  &times;
                </button>
              </div>

              <div className="p-6 space-y-8">
                {/* Return items - grid view */}
                <div className="pb-4 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Return Items</h3>
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs lg:text-sm min-w-[480px] lg:min-w-[720px]">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-left font-semibold text-muted-foreground">
                              Materials
                            </th>
                            {outlets.map(outlet => (
                              <th
                                key={outlet.id}
                                className="border-b border-l border-border px-2 lg:px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap"
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

                            return [
                              sectionLabel ? (
                                <tr key={`review-return-section-${material.material_type}-${index}`}>
                                  <td
                                    colSpan={1 + outlets.length}
                                    className="bg-background/80 border-t border-border px-3 lg:px-4 py-1.5 text-[11px] lg:text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                                  >
                                    {sectionLabel}
                                  </td>
                                </tr>
                              ) : null,
                              <tr key={`review-return-${material.id}`}>
                                <td className="border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 align-top bg-muted/40">
                                  <div className="font-medium text-foreground truncate">
                                    {material.name}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                                    {material.code} · {material.unit}
                                  </div>
                                </td>
                                {outlets.map(outlet => {
                                  const dispatchedQty = getDispatchedQuantity(outlet.id, material.id)
                                  const key = `${outlet.id}_${material.id}`
                                  const returnQty = parseFloat(returnQuantities[key]) || 0

                                  if (!dispatchedQty || returnQty === 0) {
                                    return (
                                      <td
                                        key={outlet.id}
                                        className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 text-center text-[11px] text-muted-foreground bg-muted/30"
                                      >
                                        —
                                      </td>
                                    )
                                  }

                                  return (
                                    <td
                                      key={outlet.id}
                                      className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle"
                                    >
                                      <div className="flex flex-col gap-0.5 text-[11px] lg:text-xs">
                                        <div className="text-muted-foreground">
                                          Dispatched:{' '}
                                          <span className="font-semibold text-foreground">
                                            {dispatchedQty} {material.unit}
                                          </span>
                                        </div>
                                        <div className="text-foreground">
                                          Returned:{' '}
                                          <span className="font-semibold">
                                            {returnQty} {material.unit}
                                          </span>
                                        </div>
                                      </div>
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
                </div>

                {/* Wastage items - grid view */}
                <div className="pt-4 pb-4 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Wastage Items</h3>
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs lg:text-sm min-w-[480px] lg:min-w-[720px]">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-left font-semibold text-muted-foreground">
                              Materials
                            </th>
                            {outlets.map(outlet => (
                              <th
                                key={outlet.id}
                                className="border-b border-l border-border px-2 lg:px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap"
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

                            return [
                              sectionLabel ? (
                                <tr key={`review-waste-section-${material.material_type}-${index}`}>
                                  <td
                                    colSpan={1 + outlets.length}
                                    className="bg-background/80 border-t border-border px-3 lg:px-4 py-1.5 text-[11px] lg:text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                                  >
                                    {sectionLabel}
                                  </td>
                                </tr>
                              ) : null,
                              <tr key={`review-waste-${material.id}`}>
                                <td className="border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 align-top bg-muted/40">
                                  <div className="font-medium text-foreground truncate">
                                    {material.name}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                                    {material.code} · {material.unit}
                                  </div>
                                </td>
                                {outlets.map(outlet => {
                                  const dispatchedQty = getDispatchedQuantity(outlet.id, material.id)
                                  const key = `${outlet.id}_${material.id}`
                                  const wastageQty = parseFloat(wastageQuantities[key]) || 0

                                  if (!dispatchedQty || wastageQty === 0) {
                                    return (
                                      <td
                                        key={outlet.id}
                                        className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 text-center text-[11px] text-muted-foreground bg-muted/30"
                                      >
                                        —
                                      </td>
                                    )
                                  }

                                  return (
                                    <td
                                      key={outlet.id}
                                      className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 align-middle"
                                    >
                                      <div className="flex flex-col gap-0.5 text-[11px] lg:text-xs">
                                        <div className="text-muted-foreground">
                                          Dispatched:{' '}
                                          <span className="font-semibold text-foreground">
                                            {dispatchedQty} {material.unit}
                                          </span>
                                        </div>
                                        <div className="text-foreground">
                                          Wasted:{' '}
                                          <span className="font-semibold">
                                            {wastageQty} {material.unit}
                                          </span>
                                        </div>
                                      </div>
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
                </div>

                {/* Additional info - grid view */}
                <div className="pt-2">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Additional Information</h3>
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs lg:text-sm min-w-[480px] lg:min-w-[720px]">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border-b border-border px-3 lg:px-4 py-2 lg:py-2.5 text-left font-semibold text-muted-foreground">
                              Metric
                            </th>
                            {outlets.map(outlet => (
                              <th
                                key={outlet.id}
                                className="border-b border-l border-border px-2 lg:px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap"
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
                          <tr>
                            <td className="border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 bg-muted/40 font-medium text-foreground">
                              Cash (₹)
                            </td>
                            {outlets.map(outlet => {
                              const info = additionalInfo[outlet.id]
                              const cash = parseFloat(info?.cash) || 0
                              if (cash === 0) {
                                return (
                                  <td
                                    key={outlet.id}
                                    className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 text-center text-[11px] text-muted-foreground bg-muted/30"
                                  >
                                    —
                                  </td>
                                )
                              }
                              return (
                                <td
                                  key={outlet.id}
                                  className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 text-right text-[11px] lg:text-xs text-foreground"
                                >
                                  ₹{cash.toFixed(2)}
                                </td>
                              )
                            })}
                          </tr>
                          <tr>
                            <td className="border-t border-border px-3 lg:px-4 py-2 lg:py-2.5 bg-muted/40 font-medium text-foreground">
                              Payment Onside (₹)
                            </td>
                            {outlets.map(outlet => {
                              const info = additionalInfo[outlet.id]
                              const paymentOnside = parseFloat(info?.payment_onside) || 0
                              if (paymentOnside === 0) {
                                return (
                                  <td
                                    key={outlet.id}
                                    className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 text-center text-[11px] text-muted-foreground bg-muted/30"
                                  >
                                    —
                                  </td>
                                )
                              }
                              return (
                                <td
                                  key={outlet.id}
                                  className="border-t border-l border-border px-1.5 lg:px-2 py-1.5 lg:py-2 text-right text-[11px] lg:text-xs text-foreground"
                                >
                                  ₹{paymentOnside.toFixed(2)}
                                </td>
                              )
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-border/70 pt-3">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">Supervisor:</span> {supervisorName}
                    </p>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-between">
                <button
                  onClick={() => setIsReviewModalOpen(false)}
                  className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Back to Edit
                </button>
                <button
                  onClick={handleReviewConfirm}
                  className="px-6 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-semibold"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {isConfirmModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg max-w-md w-full p-6">
              <h2 className="text-xl font-bold text-foreground mb-4">Confirm Checkout</h2>
              <p className="text-muted-foreground mb-6">
                This will alter the cloud kitchen inventory by adding the returned items back to stock. 
                Please recheck all details before confirming.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsConfirmModalOpen(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalConfirm}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Checkout
