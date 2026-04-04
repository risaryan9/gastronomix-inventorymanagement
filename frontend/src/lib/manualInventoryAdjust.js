/**
 * Manual inventory adjustment via Supabase client (same pattern as StockOut FIFO).
 * Increment: manual_inventory stock_in + batch from latest reference pricing.
 * Decrement: self stock_out + item + FIFO batch updates.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   cloudKitchenId: string
 *   rawMaterialId: string
 *   newQuantity: number
 *   reason: string
 *   details?: string | null
 *   userId: string
 * }} params
 */
export async function adjustManualInventory(supabase, params) {
  const {
    cloudKitchenId,
    rawMaterialId,
    newQuantity,
    reason,
    details = null,
    userId
  } = params

  if (!cloudKitchenId || !rawMaterialId || newQuantity == null || !reason?.trim()) {
    throw new Error('Missing required fields')
  }
  if (newQuantity < 0) {
    throw new Error('new_quantity cannot be negative')
  }

  const { data: currentInv, error: invError } = await supabase
    .from('inventory')
    .select('id, quantity')
    .eq('cloud_kitchen_id', cloudKitchenId)
    .eq('raw_material_id', rawMaterialId)
    .maybeSingle()

  if (invError) {
    throw new Error(`Failed to fetch inventory: ${invError.message}`)
  }

  const oldQuantity = currentInv ? parseFloat(currentInv.quantity) : 0
  const adjustmentAmount = newQuantity - oldQuantity

  if (adjustmentAmount === 0) {
    return {
      success: true,
      adjustment_type: 'none',
      adjustment_amount: 0,
      old_quantity: oldQuantity,
      new_quantity: newQuantity,
      stock_in_id: null,
      stock_out_id: null
    }
  }

  const adjustmentType = adjustmentAmount > 0 ? 'increment' : 'decrement'
  let stockInId = null
  let stockOutId = null
  const today = new Date().toISOString().split('T')[0]
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : null

  if (adjustmentAmount > 0) {
    const { data: refBatch, error: refBatchError } = await supabase
      .from('stock_in_batches')
      .select('unit_cost, gst_percent')
      .eq('raw_material_id', rawMaterialId)
      .eq('cloud_kitchen_id', cloudKitchenId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (refBatchError) {
      throw new Error(`Failed to fetch reference batch: ${refBatchError.message}`)
    }
    if (!refBatch) {
      throw new Error(
        'No prior stock_in_batch found for this material. Cannot infer unit cost and GST for increment.'
      )
    }

    const unitCost = parseFloat(refBatch.unit_cost)
    const gstPercent = parseFloat(refBatch.gst_percent)
    const baseCost = adjustmentAmount * unitCost
    const totalCost = baseCost * (1 + gstPercent / 100)

    const { data: stockInData, error: stockInError } = await supabase
      .from('stock_in')
      .insert({
        cloud_kitchen_id: cloudKitchenId,
        received_by: userId,
        receipt_date: today,
        supplier_name: null,
        invoice_number: null,
        invoice_image_url: null,
        total_cost: totalCost,
        notes: `Manual inventory adjustment: ${reason}${details ? ` - ${details}` : ''}`,
        stock_in_type: 'manual_inventory'
      })
      .select('id')
      .single()

    if (stockInError) {
      throw new Error(`Failed to create stock_in: ${stockInError.message}`)
    }

    stockInId = stockInData.id

    const { error: batchError } = await supabase.from('stock_in_batches').insert({
      stock_in_id: stockInId,
      raw_material_id: rawMaterialId,
      cloud_kitchen_id: cloudKitchenId,
      quantity_purchased: adjustmentAmount,
      quantity_remaining: adjustmentAmount,
      unit_cost: unitCost,
      gst_percent: gstPercent
    })

    if (batchError) {
      throw new Error(`Failed to create stock_in_batch: ${batchError.message}`)
    }
  } else {
    const decrementQty = Math.abs(adjustmentAmount)

    const { data: stockOutData, error: stockOutError } = await supabase
      .from('stock_out')
      .insert({
        cloud_kitchen_id: cloudKitchenId,
        allocated_by: userId,
        allocation_date: today,
        self_stock_out: true,
        reason,
        notes: details || null,
        allocation_request_id: null,
        outlet_id: null
      })
      .select('id')
      .single()

    if (stockOutError) {
      throw new Error(`Failed to create stock_out: ${stockOutError.message}`)
    }

    stockOutId = stockOutData.id

    const { error: stockOutItemError } = await supabase.from('stock_out_items').insert({
      stock_out_id: stockOutId,
      raw_material_id: rawMaterialId,
      quantity: decrementQty
    })

    if (stockOutItemError) {
      throw new Error(`Failed to create stock_out_items: ${stockOutItemError.message}`)
    }

    const { data: batches, error: batchError } = await supabase
      .from('stock_in_batches')
      .select('id, quantity_remaining')
      .eq('raw_material_id', rawMaterialId)
      .eq('cloud_kitchen_id', cloudKitchenId)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: true })

    if (batchError) {
      throw new Error(`Failed to fetch batches: ${batchError.message}`)
    }
    if (!batches?.length) {
      throw new Error('No batches available to decrement from')
    }

    let remainingToDecrement = decrementQty
    for (const batch of batches) {
      if (remainingToDecrement <= 0) break
      const availableInBatch = parseFloat(batch.quantity_remaining)
      const toDecrement = Math.min(availableInBatch, remainingToDecrement)
      const newRemaining = availableInBatch - toDecrement

      const { error: updateError } = await supabase
        .from('stock_in_batches')
        .update({ quantity_remaining: newRemaining })
        .eq('id', batch.id)

      if (updateError) {
        throw new Error(`Failed to update batch: ${updateError.message}`)
      }
      remainingToDecrement -= toDecrement
    }

    if (remainingToDecrement > 0) {
      throw new Error(
        `Insufficient stock to decrement. Short by ${remainingToDecrement.toFixed(3)} units`
      )
    }
  }

  const { data: updatedInv } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('cloud_kitchen_id', cloudKitchenId)
    .eq('raw_material_id', rawMaterialId)
    .maybeSingle()

  const actualNewQty = updatedInv ? parseFloat(updatedInv.quantity) : newQuantity

  const { error: auditError } = await supabase.from('audit_logs').insert({
    user_id: userId,
    action: `inventory_${adjustmentType}`,
    entity_type: 'inventory',
    entity_id: currentInv?.id || null,
    old_values: {
      quantity: oldQuantity,
      raw_material_id: rawMaterialId,
      cloud_kitchen_id: cloudKitchenId,
      reason,
      details: details || null,
      adjustment_type: adjustmentType,
      adjustment_amount: Math.abs(adjustmentAmount),
      stock_in_id: stockInId,
      stock_out_id: stockOutId
    },
    new_values: {
      quantity: newQuantity,
      raw_material_id: rawMaterialId,
      cloud_kitchen_id: cloudKitchenId,
      actual_new_quantity: actualNewQty,
      stock_in_id: stockInId,
      stock_out_id: stockOutId
    },
    ip_address: null,
    user_agent: userAgent
  })

  if (auditError) {
    console.error('Failed to create audit log:', auditError)
  }

  return {
    success: true,
    adjustment_type: adjustmentType,
    adjustment_amount: adjustmentAmount,
    old_quantity: oldQuantity,
    new_quantity: actualNewQty,
    stock_in_id: stockInId,
    stock_out_id: stockOutId
  }
}
