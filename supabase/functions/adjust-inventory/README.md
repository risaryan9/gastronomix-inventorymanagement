# Adjust Inventory Edge Function

## Purpose

This Supabase Edge Function handles manual inventory adjustments by creating adjustment batches in `stock_in_batches`. The trigger `sync_inventory_quantity_from_batches` automatically updates `inventory.quantity` to keep it in sync.

## How it works

1. **Increment** (new_quantity > old_quantity):
   - Creates a new `stock_in` record (type = 'kitchen')
   - Creates a new `stock_in_batches` entry with the added quantity
   - Trigger updates `inventory.quantity` automatically

2. **Decrement** (new_quantity < old_quantity):
   - Creates a new `stock_in` record for audit trail
   - Consumes existing batches using FIFO (oldest first)
   - Trigger updates `inventory.quantity` automatically

3. **Audit Log**:
   - Creates an audit log entry with old/new values, reason, and details

## Deployment

```bash
# Deploy the function
supabase functions deploy adjust-inventory

# Set environment variables (if not already set)
supabase secrets set SUPABASE_URL=your_supabase_url
supabase secrets set SUPABASE_ANON_KEY=your_anon_key
```

## Usage

### Request

```typescript
POST https://your-project.supabase.co/functions/v1/adjust-inventory
Authorization: Bearer YOUR_USER_JWT_TOKEN
Content-Type: application/json

{
  "cloud_kitchen_id": "uuid",
  "raw_material_id": "uuid",
  "new_quantity": 100.5,
  "reason": "Stock count correction",
  "details": "Physical inventory count found discrepancy"
}
```

### Response (Success)

```json
{
  "success": true,
  "message": "Inventory incremented successfully",
  "old_quantity": 50.0,
  "new_quantity": 100.5,
  "adjustment_amount": 50.5,
  "adjustment_type": "increment",
  "stock_in_id": "uuid"
}
```

### Response (Error)

```json
{
  "error": "Insufficient stock to decrement. Short by 10.5 units"
}
```

## Frontend Integration

See `Inventory.jsx` for usage example. The frontend calls this function instead of directly updating `inventory.quantity`.

## Security

- Requires authenticated user (JWT token)
- RLS policies on `stock_in`, `stock_in_batches`, and `inventory` still apply
- Only purchase managers and admins should have permission to call this

## Notes

- The function creates a `stock_in` record for every adjustment (for audit trail)
- For decrements, if there's insufficient stock in batches, the function returns an error
- The trigger ensures `inventory.quantity` is always the sum of `stock_in_batches.quantity_remaining`
