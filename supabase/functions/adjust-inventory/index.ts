// Supabase Edge Function: adjust-inventory
// Purpose: Adjust inventory by creating an adjustment batch
// This maintains inventory.quantity sync via trigger while creating audit trail

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AdjustInventoryRequest {
  cloud_kitchen_id: string
  raw_material_id: string
  new_quantity: number
  reason: string
  details?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with user's auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: AdjustInventoryRequest = await req.json()
    const { cloud_kitchen_id, raw_material_id, new_quantity, reason, details } = body

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

    // Create a stock_in record for the adjustment (type = 'kitchen' for manual adjustments)
    const { data: stockInData, error: stockInError } = await supabaseClient
      .from('stock_in')
      .insert({
        cloud_kitchen_id,
        received_by: user.id,
        receipt_date: new Date().toISOString().split('T')[0],
        supplier_name: null,
        invoice_number: null,
        total_cost: 0,
        notes: `Inventory adjustment: ${reason}${details ? ` - ${details}` : ''}`,
        stock_in_type: 'kitchen',
        invoice_image_url: null
      })
      .select()
      .single()

    if (stockInError) {
      return new Response(
        JSON.stringify({ error: `Failed to create stock_in: ${stockInError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create adjustment batch with the adjustment amount
    // For increment: quantity_purchased = +X, quantity_remaining = +X
    // For decrement: we need to reduce existing batches (FIFO)
    
    if (adjustmentAmount > 0) {
      // INCREMENT: create a new batch with the added quantity
      const { error: batchError } = await supabaseClient
        .from('stock_in_batches')
        .insert({
          stock_in_id: stockInData.id,
          raw_material_id,
          cloud_kitchen_id,
          quantity_purchased: adjustmentAmount,
          quantity_remaining: adjustmentAmount,
          unit_cost: 0.01, // Nominal cost for adjustment batches
          gst_percent: 0
        })

      if (batchError) {
        return new Response(
          JSON.stringify({ error: `Failed to create adjustment batch: ${batchError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // DECREMENT: consume existing batches FIFO
      const decrementQty = Math.abs(adjustmentAmount)
      
      // Get batches in FIFO order
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
      .single()

    // Create audit log
    const auditLogData = {
      user_id: user.id,
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
        adjustment_amount: Math.abs(adjustmentAmount)
      },
      new_values: {
        quantity: new_quantity,
        raw_material_id,
        cloud_kitchen_id,
        actual_new_quantity: updatedInv ? parseFloat(updatedInv.quantity) : new_quantity
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
        stock_in_id: stockInData.id
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
