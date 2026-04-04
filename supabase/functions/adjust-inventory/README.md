# Adjust Inventory Edge Function (optional)

## App behavior

The purchase manager **Inventory** screen uses the Supabase JS client directly: [`frontend/src/lib/manualInventoryAdjust.js`](../../../frontend/src/lib/manualInventoryAdjust.js). That matches **Stock In / Stock Out** (RLS + anon key + app session) and avoids deploying an edge function, CORS, or JWT quirks.

This folder is an **optional duplicate** of the same logic if you prefer a server-side entry point.

## Purpose

This Supabase Edge Function can perform the same manual inventory adjustments. The trigger `sync_inventory_quantity_from_batches` still updates `inventory.quantity` when using either path.

## How it works

### 1. Increment (new_quantity > old_quantity)

When increasing inventory quantity:

1. **Fetch reference batch**: Queries the latest `stock_in_batches` row for the material + cloud kitchen (ordered by `created_at DESC`, `id DESC`, limit 1) to get `unit_cost` and `gst_percent`.
   - If no prior batch exists, returns **400 error** (cannot infer pricing).
2. **Create `stock_in`**: Inserts a new row with `stock_in_type = 'manual_inventory'`, `supplier_name` / `invoice_number` / `invoice_image_url` = null, and `total_cost` = `qty * unit_cost * (1 + gst_percent/100)`.
3. **Create `stock_in_batches`**: Inserts a new batch with `quantity_purchased` = `quantity_remaining` = adjustment amount, using the reference batch's `unit_cost` and `gst_percent`.
4. **Trigger updates `inventory.quantity`** automatically.

### 2. Decrement (new_quantity < old_quantity)

When decreasing inventory quantity:

1. **Create `stock_out`**: Inserts a self stock out (`self_stock_out = true`, `allocation_request_id` / `outlet_id` = null) with the provided `reason` and optional `details` in `notes`.
2. **Create `stock_out_items`**: Inserts one row with `quantity` = absolute adjustment amount.
3. **FIFO reduce batches**: Updates `stock_in_batches.quantity_remaining` in FIFO order (oldest `created_at` first).
   - If insufficient stock, returns **400 error** with shortfall.
4. **Trigger updates `inventory.quantity`** automatically.

### 3. Audit Log

Creates an `audit_logs` entry with:
- `action`: `inventory_increment` or `inventory_decrement`
- `entity_type`: `inventory`
- `old_values` / `new_values`: includes `stock_in_id` (increment) or `stock_out_id` (decrement) for traceability

## Deployment

```bash
# Deploy the function (includes config.toml: verify_jwt = false for browser CORS preflight)
supabase functions deploy adjust-inventory

# Set environment variables (if not already set)
supabase secrets set SUPABASE_URL=your_supabase_url
supabase secrets set SUPABASE_ANON_KEY=your_anon_key
```

### CORS / “preflight doesn’t pass access control”

Browsers send an **OPTIONS** request before **POST**. If Supabase **JWT verification** is enabled for this function at the gateway, OPTIONS can return **401** before your code runs. The browser then reports a CORS error (non-OK preflight).

This repo ships [`config.toml`](./config.toml) with **`verify_jwt = false`** because auth is enforced inside the function. If you deploy only from the Dashboard, turn **off** “Verify JWT” (or equivalent) for `adjust-inventory`, or redeploy via CLI so `config.toml` is applied.

## Usage

### Request

**Email/password (Supabase Auth) callers:** send `Authorization: Bearer <access_token>` from `supabase.auth.getSession()`.

**Login-key callers** (no Supabase Auth session): send `Authorization: Bearer <SUPABASE_ANON_KEY>` and include `acting_user_id` (the app session user id). The function verifies that user with the service role: active `purchase_manager` or `admin`, and `cloud_kitchen_id` matches the request.

```typescript
POST https://your-project.supabase.co/functions/v1/adjust-inventory
Authorization: Bearer YOUR_USER_JWT_OR_ANON_KEY
apikey: YOUR_SUPABASE_ANON_KEY
Content-Type: application/json

{
  "cloud_kitchen_id": "uuid",
  "raw_material_id": "uuid",
  "new_quantity": 100.5,
  "reason": "Stock count correction",
  "details": "Physical inventory count found discrepancy",
  "acting_user_id": "uuid"
}
```

`acting_user_id` is required when using the anon key; it is ignored when a valid user JWT is provided.

### Response (Success - Increment)

```json
{
  "success": true,
  "message": "Inventory incremented successfully",
  "old_quantity": 50.0,
  "new_quantity": 100.5,
  "adjustment_amount": 50.5,
  "adjustment_type": "increment",
  "stock_in_id": "uuid",
  "stock_out_id": null
}
```

### Response (Success - Decrement)

```json
{
  "success": true,
  "message": "Inventory decremented successfully",
  "old_quantity": 100.0,
  "new_quantity": 75.0,
  "adjustment_amount": -25.0,
  "adjustment_type": "decrement",
  "stock_in_id": null,
  "stock_out_id": "uuid"
}
```

### Response (Error - No reference batch for increment)

```json
{
  "error": "No prior stock_in_batch found for this material. Cannot infer unit cost and GST for increment."
}
```

### Response (Error - Insufficient stock for decrement)

```json
{
  "error": "Insufficient stock to decrement. Short by 10.5 units"
}
```

## Frontend integration

See `frontend/src/pages/purchase-manager/Inventory.jsx` — it calls `adjustManualInventory()` from `frontend/src/lib/manualInventoryAdjust.js`, not this edge function.

## Security

- **JWT path:** `auth.getUser()` resolves the actor; RLS applies on inserts/updates.
- **Anon key path:** `acting_user_id` is checked with `SUPABASE_SERVICE_ROLE_KEY` against `users` (role + kitchen + active). This matches how the app uses key-based login without Supabase Auth.
- RLS policies on `stock_in`, `stock_in_batches`, and related tables still apply to the request-scoped Supabase client.

## Notes

- **Increment** creates a `stock_in` (type = `manual_inventory`) + batch with pricing from the latest prior batch
- **Decrement** creates a `stock_out` (self stock out) + `stock_out_items`, then FIFO-reduces batches
- For increments without a prior batch, or decrements with insufficient stock, the function returns a 400 error
- The trigger ensures `inventory.quantity` is always the sum of `stock_in_batches.quantity_remaining`
- Audit logs include `stock_in_id` or `stock_out_id` for full traceability
