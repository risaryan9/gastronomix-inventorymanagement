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

  const [brands, setBrands] = useState([])
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [todayPlan, setTodayPlan] = useState(null)
  const [outletsForToday, setOutletsForToday] = useState([])
  const [checkoutFormsMap, setCheckoutFormsMap] = useState({})
  
  const [alert, setAlert] = useState(null)
  const [validationError, setValidationError] = useState(null)

  const [isOutletFormOpen, setIsOutletFormOpen] = useState(false)
  const [selectedOutlet, setSelectedOutlet] = useState(null)
  const [formMaterials, setFormMaterials] = useState([])
  const [formData, setFormData] = useState({})
  const [supervisorName, setSupervisorName] = useState('')
  const [operatorId, setOperatorId] = useState('')
  const [outletOperators, setOutletOperators] = useState([])
  const [cash, setCash] = useState('')
  const [paymentOnside, setPaymentOnside] = useState('')
  
  const [isDraftSaving, setIsDraftSaving] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

  const [isPreviousFormsOpen, setIsPreviousFormsOpen] = useState(false)
  const [previousForms, setPreviousForms] = useState([])
  const [previousFormsLoading, setPreviousFormsLoading] = useState(false)

  const [outletSearchTerm, setOutletSearchTerm] = useState('')

  const navigate = useNavigate()

  const outletMatchesSearch = (outlet) => {
    if (!outletSearchTerm.trim()) return true
    const term = outletSearchTerm.trim().toLowerCase()
    const code = (outlet.code || '').toLowerCase()
    const name = (outlet.name || '').toLowerCase()
    return code.includes(term) || name.includes(term)
  }

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
      fetchTodayPlans()
    }
  }, [cloudKitchenId])

  const fetchTodayPlans = async () => {
    try {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]
      
      const { data: plans, error: plansError } = await supabase
        .from('dispatch_plan')
        .select('*')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .eq('status', 'locked')
        .eq('plan_date', today)
        .order('brand', { ascending: true })

      if (plansError) throw plansError

      const uniqueBrands = [...new Set(plans.map(p => p.brand))]
      setBrands(uniqueBrands)
      
      if (uniqueBrands.length === 1) {
        setSelectedBrand(uniqueBrands[0])
        await loadOutletsForBrand(uniqueBrands[0], plans)
      } else if (uniqueBrands.length > 1) {
        setSelectedBrand(uniqueBrands[0])
        await loadOutletsForBrand(uniqueBrands[0], plans)
      }
    } catch (error) {
      console.error('Error fetching today plans:', error)
      setAlert({ type: 'error', message: 'Failed to load today\'s dispatch plans' })
    } finally {
      setLoading(false)
    }
  }

  const loadOutletsForBrand = async (brand, plans = null) => {
    try {
      if (!plans) {
        const today = new Date().toISOString().split('T')[0]
        const { data: fetchedPlans, error: plansError } = await supabase
          .from('dispatch_plan')
          .select('*')
          .eq('cloud_kitchen_id', cloudKitchenId)
          .eq('status', 'locked')
          .eq('plan_date', today)
          .eq('brand', brand)

        if (plansError) throw plansError
        plans = fetchedPlans
      }

      const plan = plans.find(p => p.brand === brand)
      if (!plan) {
        setTodayPlan(null)
        setOutletsForToday([])
        setCheckoutFormsMap({})
        return
      }

      setTodayPlan(plan)

      const { data: items, error: itemsError } = await supabase
        .from('dispatch_plan_items')
        .select('*, outlets(*)')
        .eq('dispatch_plan_id', plan.id)
        .gt('quantity', 0)

      if (itemsError) throw itemsError

      const outletMap = new Map()
      items.forEach(item => {
        if (item.outlets && !outletMap.has(item.outlet_id)) {
          outletMap.set(item.outlet_id, item.outlets)
        }
      })
      const outlets = Array.from(outletMap.values())
      setOutletsForToday(outlets)

      const { data: forms, error: formsError } = await supabase
        .from('checkout_form')
        .select('*')
        .eq('dispatch_plan_id', plan.id)

      if (formsError) throw formsError

      const formsMap = {}
      forms.forEach(form => {
        formsMap[form.outlet_id] = form
      })
      setCheckoutFormsMap(formsMap)
    } catch (error) {
      console.error('Error loading outlets for brand:', error)
      setAlert({ type: 'error', message: 'Failed to load outlets for selected brand' })
    }
  }

  const handleBrandChange = async (brand) => {
    setSelectedBrand(brand)
    await loadOutletsForBrand(brand)
  }

  const openOutletForm = async (outlet) => {
    try {
      setSelectedOutlet(outlet)

      const [itemsRes, operatorsRes] = await Promise.all([
        supabase
          .from('dispatch_plan_items')
          .select('*, raw_materials(*)')
          .eq('dispatch_plan_id', todayPlan.id)
          .eq('outlet_id', outlet.id)
          .gt('quantity', 0),
        supabase
          .from('operators')
          .select('id, name, phone')
          .order('name')
      ])

      const itemsError = itemsRes.error
      if (itemsError) throw itemsError
      setFormMaterials(itemsRes.data || [])
      setOutletOperators(operatorsRes.data || [])
      if (operatorsRes.error) console.warn('Operators fetch:', operatorsRes.error)

      const existingForm = checkoutFormsMap[outlet.id]
      if (existingForm) {
        const [returnData, wastageData, additionalData] = await Promise.all([
          supabase
            .from('checkout_form_return_items')
            .select('*')
            .eq('checkout_form_id', existingForm.id),
          supabase
            .from('checkout_form_wastage_items')
            .select('*')
            .eq('checkout_form_id', existingForm.id),
          supabase
            .from('checkout_form_additional')
            .select('*')
            .eq('checkout_form_id', existingForm.id)
            .single()
        ])

        if (returnData.error) throw returnData.error
        if (wastageData.error) throw wastageData.error

        const initialData = {}
        itemsRes.data.forEach(item => {
          const returnItem = returnData.data.find(r => r.raw_material_id === item.raw_material_id)
          const wastageItem = wastageData.data.find(w => w.raw_material_id === item.raw_material_id)
          initialData[item.raw_material_id] = {
            returned: returnItem?.returned_quantity || '',
            wasted: wastageItem?.wasted_quantity || ''
          }
        })

        setFormData(initialData)
        setSupervisorName(existingForm.supervisor_name || '')
        setOperatorId(existingForm.operator_id || '')
        setCash(additionalData.data?.cash || '')
        setPaymentOnside(additionalData.data?.payment_onside || '')
      } else {
        const initialData = {}
        itemsRes.data.forEach(item => {
          initialData[item.raw_material_id] = { returned: '', wasted: '' }
        })
        setFormData(initialData)
        setSupervisorName('')
        setOperatorId('')
        setCash('')
        setPaymentOnside('')
      }

      setIsOutletFormOpen(true)
    } catch (error) {
      console.error('Error opening outlet form:', error)
      setAlert({ type: 'error', message: 'Failed to load outlet form data' })
    }
  }

  const closeOutletForm = () => {
    setIsOutletFormOpen(false)
    setSelectedOutlet(null)
    setFormMaterials([])
    setFormData({})
    setSupervisorName('')
    setOperatorId('')
    setOutletOperators([])
    setCash('')
    setPaymentOnside('')
    setValidationError(null)
  }

  const handleFormDataChange = (materialId, field, value) => {
    setFormData(prev => ({
      ...prev,
      [materialId]: {
        ...prev[materialId],
        [field]: value
      }
    }))
  }

  const validateForm = () => {
    if (!supervisorName.trim()) {
      setValidationError('Please enter supervisor name')
      return false
    }

    for (const item of formMaterials) {
      const data = formData[item.raw_material_id]
      const returned = parseFloat(data?.returned) || 0
      const wasted = parseFloat(data?.wasted) || 0
      const dispatched = item.quantity

      if (returned > dispatched) {
        setValidationError(`Return quantity for ${item.raw_materials.name} (${returned}) cannot exceed dispatched quantity (${dispatched})`)
        return false
      }

      if (wasted > dispatched) {
        setValidationError(`Wastage quantity for ${item.raw_materials.name} (${wasted}) cannot exceed dispatched quantity (${dispatched})`)
        return false
      }

      if (returned + wasted > dispatched) {
        setValidationError(`Return (${returned}) + wastage (${wasted}) for ${item.raw_materials.name} cannot exceed dispatched quantity (${dispatched})`)
        return false
      }
    }

    setValidationError(null)
    return true
  }

  const handleSaveDraft = async () => {
    if (!validateForm()) return

    setIsDraftSaving(true)
    try {
      const existingForm = checkoutFormsMap[selectedOutlet.id]
      let checkoutFormId = existingForm?.id

      if (existingForm) {
        const { error: updateError } = await supabase
          .from('checkout_form')
          .update({
            supervisor_name: supervisorName,
            operator_id: operatorId || null,
            status: 'draft'
          })
          .eq('id', existingForm.id)

        if (updateError) throw updateError

        await supabase
          .from('checkout_form_return_items')
          .delete()
          .eq('checkout_form_id', existingForm.id)

        await supabase
          .from('checkout_form_wastage_items')
          .delete()
          .eq('checkout_form_id', existingForm.id)

        await supabase
          .from('checkout_form_additional')
          .delete()
          .eq('checkout_form_id', existingForm.id)
      } else {
        const { data: newForm, error: insertError } = await supabase
          .from('checkout_form')
          .insert({
            dispatch_plan_id: todayPlan.id,
            cloud_kitchen_id: cloudKitchenId,
            plan_date: todayPlan.plan_date,
            outlet_id: selectedOutlet.id,
            status: 'draft',
            supervisor_name: supervisorName,
            operator_id: operatorId || null,
            created_by: userId
          })
          .select()
          .single()

        if (insertError) throw insertError
        checkoutFormId = newForm.id
      }

      const returnItems = []
      const wastageItems = []

      formMaterials.forEach(item => {
        const data = formData[item.raw_material_id]
        const returned = parseFloat(data?.returned) || 0
        const wasted = parseFloat(data?.wasted) || 0

        if (returned > 0) {
          returnItems.push({
            checkout_form_id: checkoutFormId,
            outlet_id: selectedOutlet.id,
            raw_material_id: item.raw_material_id,
            dispatched_quantity: item.quantity,
            returned_quantity: returned
          })
        }

        if (wasted > 0) {
          wastageItems.push({
            checkout_form_id: checkoutFormId,
            outlet_id: selectedOutlet.id,
            raw_material_id: item.raw_material_id,
            dispatched_quantity: item.quantity,
            wasted_quantity: wasted
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

      const cashVal = parseFloat(cash) || 0
      const paymentOnsideVal = parseFloat(paymentOnside) || 0

      if (cashVal > 0 || paymentOnsideVal > 0) {
        const { error: additionalError } = await supabase
          .from('checkout_form_additional')
          .insert({
            checkout_form_id: checkoutFormId,
            outlet_id: selectedOutlet.id,
            cash: cashVal,
            payment_onside: paymentOnsideVal
          })
        if (additionalError) throw additionalError
      }

      setAlert({ type: 'success', message: 'Draft saved successfully!' })
      closeOutletForm()
      await loadOutletsForBrand(selectedBrand)
    } catch (error) {
      console.error('Error saving draft:', error)
      setAlert({ type: 'error', message: error.message || 'Failed to save draft' })
    } finally {
      setIsDraftSaving(false)
    }
  }

  const handleConfirmClick = () => {
    if (!validateForm()) return
    setIsConfirmModalOpen(true)
  }

  const handleFinalConfirm = async () => {
    setIsConfirming(true)
    try {
      const existingForm = checkoutFormsMap[selectedOutlet.id]
      if (!existingForm || existingForm.status !== 'draft') {
        await handleSaveDraft()
        const { data: forms } = await supabase
          .from('checkout_form')
          .select('*')
          .eq('dispatch_plan_id', todayPlan.id)
          .eq('outlet_id', selectedOutlet.id)
          .single()
        
        if (!forms) throw new Error('Failed to create draft before confirming')
        
        const { data: result, error: confirmError } = await supabase
          .rpc('confirm_checkout_form', { p_checkout_form_id: forms.id })

        if (confirmError) throw confirmError
      } else {
        const { data: result, error: confirmError } = await supabase
          .rpc('confirm_checkout_form', { p_checkout_form_id: existingForm.id })

        if (confirmError) throw confirmError
      }

      setAlert({ type: 'success', message: 'Closing form confirmed successfully! Inventory has been updated.' })
      setIsConfirmModalOpen(false)
      closeOutletForm()
      await loadOutletsForBrand(selectedBrand)
    } catch (error) {
      console.error('Error confirming checkout:', error)
      setAlert({ type: 'error', message: error.message || 'Failed to confirm closing' })
    } finally {
      setIsConfirming(false)
    }
  }

  const openPreviousForms = async () => {
    setPreviousFormsLoading(true)
    setIsPreviousFormsOpen(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      
      const { data: forms, error: formsError } = await supabase
        .from('checkout_form')
        .select('*, outlets(*), dispatch_plan(*)')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .lt('plan_date', today)
        .order('plan_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (formsError) throw formsError

      setPreviousForms(forms || [])
    } catch (error) {
      console.error('Error loading previous forms:', error)
      setAlert({ type: 'error', message: 'Failed to load previous closing forms' })
    } finally {
      setPreviousFormsLoading(false)
    }
  }

  const closePreviousForms = () => {
    setIsPreviousFormsOpen(false)
    setPreviousForms([])
  }

  const groupFormsByDate = (forms) => {
    const grouped = {}
    forms.forEach(form => {
      const date = form.plan_date
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(form)
    })
    return grouped
  }

  const orderedMaterials = [...formMaterials].sort((a, b) => {
    const orderA = MATERIAL_TYPE_ORDER[a.raw_materials?.material_type] ?? 99
    const orderB = MATERIAL_TYPE_ORDER[b.raw_materials?.material_type] ?? 99
    if (orderA !== orderB) return orderA - orderB
    const nameA = (a.raw_materials?.name || '').toLowerCase()
    const nameB = (b.raw_materials?.name || '').toLowerCase()
    return nameA.localeCompare(nameB)
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Please log in to access this page.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {alert && (
          <div
            className={`mb-4 p-4 rounded-lg ${
              alert.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
          >
            <div className="flex justify-between items-center">
              <span>{alert.message}</span>
              <button onClick={() => setAlert(null)} className="text-xl font-bold">
                &times;
              </button>
            </div>
          </div>
        )}

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">Closing Form</h1>
          <p className="text-muted-foreground">
            Fill closing forms for each outlet from today's dispatch plan
          </p>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={openPreviousForms}
            className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors font-medium"
          >
            View all closing forms from previous days
          </button>
        </div>

        {brands.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground">No locked dispatch plan found for today.</p>
          </div>
        )}

        {brands.length > 1 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-foreground mb-2">Select Brand</label>
            <select
              value={selectedBrand || ''}
              onChange={(e) => handleBrandChange(e.target.value)}
              className="w-full max-w-xs bg-input border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {brands.map(brand => (
                <option key={brand} value={brand}>
                  {brand.replace('_', ' ').toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedBrand && todayPlan && (
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Today's Outlets - {selectedBrand.replace('_', ' ').toUpperCase()}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Plan Date: {new Date(todayPlan.plan_date).toLocaleDateString()}
            </p>

            {outletsForToday.length > 0 && (
              <div className="mb-4">
                <input
                  type="text"
                  value={outletSearchTerm}
                  onChange={(e) => setOutletSearchTerm(e.target.value)}
                  placeholder="Search outlets by code or name..."
                  className="w-full max-w-md bg-input border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground"
                />
              </div>
            )}

            {outletsForToday.length === 0 && (
              <p className="text-muted-foreground text-center py-8">
                No outlets with dispatched items for today.
              </p>
            )}

            {outletsForToday.length > 0 && (() => {
              const filtered = outletsForToday.filter(outletMatchesSearch)
              const pendingOutlets = filtered.filter(outlet => {
                const form = checkoutFormsMap[outlet.id]
                return !form || form.status === 'draft'
              })
              const confirmedOutlets = filtered.filter(outlet => {
                const form = checkoutFormsMap[outlet.id]
                return form?.status === 'confirmed'
              })

              return (
                <div className="space-y-6">
                  <div className="space-y-3">
                    {pendingOutlets.length > 0 && (
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        Pending
                      </h3>
                    )}
                    {pendingOutlets.map(outlet => {
                      const form = checkoutFormsMap[outlet.id]
                      const status = !form ? 'No form' : 'Draft'
                      const statusColor = !form
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-yellow-100 text-yellow-800'

                      return (
                        <div
                          key={outlet.id}
                          className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-foreground">
                              {outlet.code} - {outlet.name}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Status: <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>{status}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => openOutletForm(outlet)}
                            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-medium"
                          >
                            {!form ? 'Fill Form' : 'Edit Draft'}
                          </button>
                        </div>
                      )
                    })}
                    {filtered.length > 0 && pendingOutlets.length === 0 && confirmedOutlets.length === 0 && (
                      <p className="text-muted-foreground text-center py-4">
                        No outlets match your search.
                      </p>
                    )}
                  </div>

                  {confirmedOutlets.length > 0 && (
                    <div className="space-y-3 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        Confirmed
                      </h3>
                      {confirmedOutlets.map(outlet => {
                        const form = checkoutFormsMap[outlet.id]
                        return (
                          <div
                            key={outlet.id}
                            className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/30"
                          >
                            <div>
                              <div className="font-semibold text-foreground">
                                {outlet.code} - {outlet.name}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Status: <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Confirmed</span>
                                {form?.supervisor_name && (
                                  <span className="ml-2"> · {form.supervisor_name}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => openOutletForm(outlet)}
                              className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors font-medium"
                            >
                              View
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {isOutletFormOpen && selectedOutlet && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-card border-b border-border p-4 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-foreground">
                    Closing Form - {selectedOutlet.code}
                  </h2>
                  <p className="text-sm text-muted-foreground">{selectedOutlet.name}</p>
                </div>
                <button
                  onClick={closeOutletForm}
                  className="text-2xl font-bold text-muted-foreground hover:text-foreground"
                >
                  &times;
                </button>
              </div>

              <div className="p-6">
                {validationError && (
                  <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-lg text-sm">
                    {validationError}
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Materials</h3>
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border-b border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground text-left">
                              Material
                            </th>
                            <th className="border-b border-l border-border px-3 py-2.5 text-sm font-semibold text-muted-foreground text-center">
                              Dispatched
                            </th>
                            <th className="border-b border-l border-border px-3 py-2.5 text-sm font-semibold text-muted-foreground text-center">
                              Return
                            </th>
                            <th className="border-b border-l border-border px-3 py-2.5 text-sm font-semibold text-muted-foreground text-center">
                              Wasted
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderedMaterials.map((item, index) => {
                            const prevType =
                              index > 0 ? orderedMaterials[index - 1].raw_materials?.material_type : null
                            const sectionChanged = item.raw_materials?.material_type !== prevType
                            const sectionLabel =
                              sectionChanged && MATERIAL_TYPE_LABELS[item.raw_materials?.material_type]
                                ? MATERIAL_TYPE_LABELS[item.raw_materials?.material_type]
                                : null

                            return [
                              sectionLabel ? (
                                <tr key={`section-${item.raw_materials?.material_type}-${index}`}>
                                  <td
                                    colSpan={4}
                                    className="bg-background/80 border-t border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                                  >
                                    {sectionLabel}
                                  </td>
                                </tr>
                              ) : null,
                              <tr key={item.raw_material_id}>
                                <td className="border-t border-border px-4 py-2.5 bg-muted/40">
                                  <div className="font-medium text-foreground">
                                    {item.raw_materials?.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    {item.raw_materials?.code} · {item.raw_materials?.unit}
                                  </div>
                                </td>
                                <td className="border-t border-l border-border px-3 py-2.5 text-center">
                                  <span className="font-semibold text-foreground">
                                    {item.quantity} {item.raw_materials?.unit}
                                  </span>
                                </td>
                                <td className="border-t border-l border-border px-3 py-2.5">
                                  <input
                                    type="number"
                                    min="0"
                                    max={item.quantity}
                                    step="0.001"
                                    inputMode="decimal"
                                    value={formData[item.raw_material_id]?.returned || ''}
                                    onChange={(e) =>
                                      handleFormDataChange(item.raw_material_id, 'returned', e.target.value)
                                    }
                                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                   
                                  />
                                </td>
                                <td className="border-t border-l border-border px-3 py-2.5">
                                  <input
                                    type="number"
                                    min="0"
                                    max={item.quantity}
                                    step="0.001"
                                    inputMode="decimal"
                                    value={formData[item.raw_material_id]?.wasted || ''}
                                    onChange={(e) =>
                                      handleFormDataChange(item.raw_material_id, 'wasted', e.target.value)
                                    }
                                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                   
                                  />
                                </td>
                              </tr>
                            ]
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Cash (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                     
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Payment Onside (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentOnside}
                      onChange={(e) => setPaymentOnside(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                     
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Supervisor Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={supervisorName}
                      onChange={(e) => setSupervisorName(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      placeholder="Enter supervisor name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Operator
                    </label>
                    <select
                      value={operatorId}
                      onChange={(e) => setOperatorId(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="">Select operator (optional)</option>
                      {outletOperators.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.name}
                          {op.phone ? ` — ${op.phone}` : ''}
                        </option>
                      ))}
                    </select>
                    {outletOperators.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        No operators available. Add them in Admin → Settings → Operators.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {checkoutFormsMap[selectedOutlet.id]?.status !== 'confirmed' && (
                <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-between">
                  <button
                    onClick={closeOutletForm}
                    className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={handleSaveDraft}
                      disabled={isDraftSaving}
                      className="px-6 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDraftSaving ? 'Saving...' : 'Save as Draft'}
                    </button>
                    <button
                      onClick={handleConfirmClick}
                      disabled={isConfirming}
                      className="px-6 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {isConfirmModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg max-w-md w-full p-6">
              <h2 className="text-xl font-bold text-foreground mb-4">Confirm Closing</h2>
              <p className="text-muted-foreground mb-6">
                This will alter the cloud kitchen inventory by adding the returned items back to stock.
                Please recheck all details before confirming.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsConfirmModalOpen(false)}
                  disabled={isConfirming}
                  className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalConfirm}
                  disabled={isConfirming}
                  className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-semibold disabled:opacity-50"
                >
                  {isConfirming ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isPreviousFormsOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-card border-b border-border p-4 flex justify-between items-center">
                <h2 className="text-xl font-bold text-foreground">Previous Closing Forms</h2>
                <button
                  onClick={closePreviousForms}
                  className="text-2xl font-bold text-muted-foreground hover:text-foreground"
                >
                  &times;
                </button>
              </div>

              <div className="p-6">
                {previousFormsLoading && (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-2"></div>
                    <p className="text-muted-foreground text-sm">Loading...</p>
                  </div>
                )}

                {!previousFormsLoading && previousForms.length === 0 && (
                  <p className="text-muted-foreground text-center py-8">
                    No previous closing forms found.
                  </p>
                )}

                {!previousFormsLoading && previousForms.length > 0 && (
                  <div className="space-y-6">
                    {Object.entries(groupFormsByDate(previousForms)).map(([date, forms]) => (
                      <div key={date} className="border border-border rounded-lg p-4">
                        <h3 className="text-lg font-semibold text-foreground mb-3">
                          {new Date(date).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </h3>
                        <div className="space-y-2">
                          {forms.map(form => (
                            <div
                              key={form.id}
                              className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                            >
                              <div>
                                <div className="font-medium text-foreground">
                                  {form.outlets?.code} - {form.outlets?.name}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Brand: {form.dispatch_plan?.brand?.replace('_', ' ').toUpperCase()} | 
                                  Supervisor: {form.supervisor_name} | 
                                  Status: <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                    form.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                  }`}>{form.status === 'confirmed' ? 'Confirmed' : 'Draft'}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Checkout
