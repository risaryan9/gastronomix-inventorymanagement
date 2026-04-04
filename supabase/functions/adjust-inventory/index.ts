// Supabase Edge Function: adjust-inventory
// Purpose: Adjust inventory via manual adjustment
// - Increment: creates stock_in (type=manual_inventory) + batch with pricing from last batch
// - Decrement: creates stock_out (self_stock_out) + stock_out_items, FIFO reduces batches
// This maintains inventory.quantity sync via trigger while creating audit trail

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface AdjustInventoryRequest {
  cloud_kitchen_id: string
  raw_material_id: string
  new_quantity: number
  reason: string
  details?: string
  /** Required when the browser has no Supabase Auth session (e.g. login key). Validated server-side. */
  acting_user_id?: string
}

serve(async (req) => {
  // Handle CORS preflight (must return 200 + Allow-Methods or browsers block POST)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let body: AdjustInventoryRequest
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { cloud_kitchen_id, raw_material_id, new_quantity, reason, details, acting_user_id } = body

    // Validate inputs
    if (!cloud_kitchen_id || !raw_material_id || new_quantity == null || !reason) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: cloud_kitchen_id, raw_material_id, new_quantity, reason' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (new_quantity < 0) {
      return new Response(
        JSON.stringify({ error: 'new_quantity cannot be negative' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!reason || reason.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'reason cannot be empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim()

    let userId: string

    if (user?.id) {
      userId = user.id
    } else if (bearerToken === anonKey && serviceRoleKey) {
      if (!acting_user_id) {
        return new Response(
          JSON.stringify({
            error:
              'acting_user_id is required when using key-based login (no Supabase Auth session)',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const adminClient = createClient(supabaseUrl, serviceRoleKey)
      const { data: actor, error: actorError } = await adminClient
        .from('users')
        .select('id, role, cloud_kitchen_id, is_active')
        .eq('id', acting_user_id)
        .maybeSingle()

      if (actorError || !actor || actor.is_active === false) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (actor.role !== 'purchase_manager' && actor.role !== 'admin') {
        return new Response(
          JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (actor.cloud_kitchen_id !== cloud_kitchen_id) {
        return new Response(
          JSON.stringify({ error: 'Cloud kitchen does not match user' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userId = actor.id
    } else {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get current inventory
    const { data: currentInv, error: invError } = await supabaseClient
      .from('inventory')
      .select('id, quantity, raw_materials(name, code, unit)')
      .eq('cloud_kitchen_id', cloud_kitchen_id)
      .eq('raw_material_id', raw_material_id)
      .maybeSingle()

    if (invError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch inventory: ${invError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const oldQuantity = currentInv ? parseFloat(currentInv.quantity) : 0
    const adjustmentAmount = new_quantity - oldQuantity

    // If no change, return early
    if (adjustmentAmount === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No adjustment needed (quantity unchanged)',
          old_quantity: oldQuantity,
          new_quantity: new_quantity
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const adjustmentType = adjustmentAmount > 0 ? 'increment' : 'decrement'
    let stockInId: string | null = null
    let stockOutId: string | null = null

    if (adjustmentAmount > 0) {
      // ===== INCREMENT PATH =====
      // 1. Fetch reference batch (latest by created_at, id DESC)
      const { data: refBatch, error: refBatchError } = await supabaseClient
        .from('stock_in_batches')
        .select('unit_cost, gst_percent')
        .eq('raw_material_id', raw_material_id)
        .eq('cloud_kitchen_id', cloud_kitchen_id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (refBatchError) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch reference batch: ${refBatchError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!refBatch) {
        return new Response(
          JSON.stringify({ error: 'No prior stock_in_batch found for this material. Cannot infer unit cost and GST for increment.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const unitCost = parseFloat(refBatch.unit_cost)
      const gstPercent = parseFloat(refBatch.gst_percent)

      // Calculate total_cost: qty * unit_cost * (1 + gst_percent/100)
      const baseCost = adjustmentAmount * unitCost
      const totalCost = baseCost * (1 + gstPercent / 100)

      // 2. Insert stock_in (type = manual_inventory)
      const { data: stockInData, error: stockInError } = await supabaseClient
        .from('stock_in')
        .insert({
          cloud_kitchen_id,
          received_by: userId,
          receipt_date: new Date().toISOString().split('T')[0],
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
        return new Response(
          JSON.stringify({ error: `Failed to create stock_in: ${stockInError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      stockInId = stockInData.id

      // 3. Insert stock_in_batches
      const { error: batchError } = await supabaseClient
        .from('stock_in_batches')
        .insert({
          stock_in_id: stockInId,
          raw_material_id,
          cloud_kitchen_id,
          quantity_purchased: adjustmentAmount,
          quantity_remaining: adjustmentAmount,
          unit_cost: unitCost,
          gst_percent: gstPercent
        })

      if (batchError) {
        return new Response(
          JSON.stringify({ error: `Failed to create stock_in_batch: ${batchError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

    } else {
      // ===== DECREMENT PATH =====
      const decrementQty = Math.abs(adjustmentAmount)

      // 1. Insert stock_out (self_stock_out = true)
      const { data: stockOutData, error: stockOutError } = await supabaseClient
        .from('stock_out')
        .insert({
          cloud_kitchen_id,
          allocated_by: userId,
          allocation_date: new Date().toISOString().split('T')[0],
          self_stock_out: true,
          reason: reason,
          notes: details || null,
          allocation_request_id: null,
          outlet_id: null
        })
        .select('id')
        .single()

      if (stockOutError) {
        return new Response(
          JSON.stringify({ error: `Failed to create stock_out: ${stockOutError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      stockOutId = stockOutData.id

      // 2. Insert stock_out_items
      const { error: stockOutItemError } = await supabaseClient
        .from('stock_out_items')
        .insert({
          stock_out_id: stockOutId,
          raw_material_id,
          quantity: decrementQty
        })

      if (stockOutItemError) {
        return new Response(
          JSON.stringify({ error: `Failed to create stock_out_items: ${stockOutItemError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 3. FIFO reduce stock_in_batches
      const { data: batches, error: batchError } = await supabaseClient
        .from('stock_in_batches')
        .select('id, quantity_remaining')
        .eq('raw_material_id', raw_material_id)
        .eq('cloud_kitchen_id', cloud_kitchen_id)
        .gt('quantity_remaining', 0)
        .order('created_at', { ascending: true })

      if (batchError) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch batches: ${batchError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!batches || batches.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No batches available to decrement from' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      let remainingToDecrement = decrementQty

      for (const batch of batches) {
        if (remainingToDecrement <= 0) break

        const availableInBatch = parseFloat(batch.quantity_remaining)
        const toDecrement = Math.min(availableInBatch, remainingToDecrement)
        const newRemaining = availableInBatch - toDecrement

        const { error: updateError } = await supabaseClient
          .from('stock_in_batches')
          .update({ quantity_remaining: newRemaining })
          .eq('id', batch.id)

        if (updateError) {
          return new Response(
            JSON.stringify({ error: `Failed to update batch: ${updateError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        remainingToDecrement -= toDecrement
      }

      if (remainingToDecrement > 0) {
        return new Response(
          JSON.stringify({ error: `Insufficient stock to decrement. Short by ${remainingToDecrement.toFixed(3)} units` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Trigger will automatically update inventory.quantity
    // Wait a moment and fetch the updated inventory to confirm
    await new Promise(resolve => setTimeout(resolve, 100))

    const { data: updatedInv } = await supabaseClient
      .from('inventory')
      .select('quantity')
      .eq('cloud_kitchen_id', cloud_kitchen_id)
      .eq('raw_material_id', raw_material_id)
      .maybeSingle()

    // Create audit log
    const auditLogData = {
      user_id: userId,
      action: `inventory_${adjustmentType}`,
      entity_type: 'inventory',
      entity_id: currentInv?.id || null,
      old_values: {
        quantity: oldQuantity,
        raw_material_id,
        cloud_kitchen_id,
        reason,
        details: details || null,
        adjustment_type: adjustmentType,
        adjustment_amount: Math.abs(adjustmentAmount),
        stock_in_id: stockInId,
        stock_out_id: stockOutId
      },
      new_values: {
        quantity: new_quantity,
        raw_material_id,
        cloud_kitchen_id,
        actual_new_quantity: updatedInv ? parseFloat(updatedInv.quantity) : new_quantity,
        stock_in_id: stockInId,
        stock_out_id: stockOutId
      },
      ip_address: null,
      user_agent: req.headers.get('user-agent') || null
    }

    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert(auditLogData)

    if (auditError) {
      console.error('Failed to create audit log:', auditError)
      // Don't fail the request if audit log fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Inventory ${adjustmentType}ed successfully`,
        old_quantity: oldQuantity,
        new_quantity: updatedInv ? parseFloat(updatedInv.quantity) : new_quantity,
        adjustment_amount: adjustmentAmount,
        adjustment_type: adjustmentType,
        stock_in_id: stockInId,
        stock_out_id: stockOutId
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in adjust-inventory function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
