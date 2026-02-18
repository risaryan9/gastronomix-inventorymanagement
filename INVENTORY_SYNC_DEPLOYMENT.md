# Inventory Sync Implementation - Deployment Guide

## Overview

This implementation ensures `inventory.quantity` is always in sync with `stock_in_batches.quantity_remaining` by making batches the single source of truth. A database trigger automatically maintains inventory quantity, preventing the mismatch that caused "Insufficient stock" errors.

## Problem Solved

**Before:** 
- `inventory.quantity` and `stock_in_batches.quantity_remaining` could get out of sync
- Manual inventory adjustments only updated `inventory` table
- Stock Out showed available = 29.501 (from inventory) but FIFO only found 0.501 (from batches)
- Result: "Insufficient stock. Short by 9.499 units" error

**After:**
- Single source of truth: `stock_in_batches.quantity_remaining`
- Trigger automatically syncs `inventory.quantity` from batches
- All operations (Stock In, Stock Out, Manual Adjustment) only touch batches
- Inventory always matches batch totals

## Files Changed

### 1. Database Migration
- **`migrations/sync-inventory-from-batches-trigger.sql`**
  - Creates trigger function `sync_inventory_quantity_from_batches()`
  - Creates trigger `trigger_sync_inventory_quantity` on `stock_in_batches`
  - One-time sync of all existing inventory records from batches

### 2. Edge Function
- **`supabase/functions/adjust-inventory/index.ts`**
  - Handles manual inventory adjustments
  - For increment: creates new batch with added quantity
  - For decrement: consumes existing batches FIFO
  - Creates audit log with reason and details
  - Returns adjustment details

- **`supabase/functions/adjust-inventory/README.md`**
  - Documentation and usage examples

### 3. Frontend Changes
- **`frontend/src/pages/purchase-manager/StockIn.jsx`**
  - Removed direct `inventory.quantity` updates
  - Only inserts into `stock_in_batches`
  - Trigger handles inventory sync

- **`frontend/src/pages/purchase-manager/StockOut.jsx`**
  - Removed source inventory decrement
  - Removed destination inventory increment (for inter-cloud transfers)
  - Only updates `stock_in_batches` (FIFO)
  - Trigger handles inventory sync

- **`frontend/src/pages/purchase-manager/Inventory.jsx`**
  - Replaced direct inventory update with edge function call
  - Calls `adjust-inventory` function with reason and details
  - Refreshes inventory after adjustment to show trigger-updated quantity

## Deployment Steps

### Step 1: Run Database Migration

```bash
# Connect to your Supabase project SQL editor or psql
psql -h your-db-host -U postgres -d postgres

# Run the migration
\i migrations/sync-inventory-from-batches-trigger.sql
```

Or in Supabase Dashboard:
1. Go to SQL Editor
2. Open `migrations/sync-inventory-from-batches-trigger.sql`
3. Execute the migration

**What it does:**
- Creates trigger function
- Creates trigger on `stock_in_batches`
- Syncs all existing inventory records (one-time)

**Verify:**
```sql
-- Check trigger exists
SELECT * FROM pg_trigger WHERE tgname = 'trigger_sync_inventory_quantity';

-- Verify inventory quantities match batch totals
SELECT 
  i.raw_material_id,
  i.quantity AS inventory_qty,
  COALESCE(SUM(b.quantity_remaining), 0) AS batch_total
FROM inventory i
LEFT JOIN stock_in_batches b 
  ON i.cloud_kitchen_id = b.cloud_kitchen_id 
  AND i.raw_material_id = b.raw_material_id
GROUP BY i.id, i.raw_material_id, i.quantity
HAVING i.quantity != COALESCE(SUM(b.quantity_remaining), 0);
-- Should return 0 rows if everything is in sync
```

### Step 2: Deploy Edge Function

```bash
# Make sure you have Supabase CLI installed
# https://supabase.com/docs/guides/cli

# Login to Supabase
supabase login

# Link to your project (if not already linked)
supabase link --project-ref your-project-ref

# Deploy the function
supabase functions deploy adjust-inventory

# Verify deployment
supabase functions list
```

**Environment Variables** (should already be set, but verify):
```bash
supabase secrets list

# If needed:
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_ANON_KEY=your-anon-key
```

**Test the function:**
```bash
curl -X POST \
  'https://your-project.supabase.co/functions/v1/adjust-inventory' \
  -H 'Authorization: Bearer YOUR_USER_JWT' \
  -H 'Content-Type: application/json' \
  -d '{
    "cloud_kitchen_id": "uuid",
    "raw_material_id": "uuid",
    "new_quantity": 100,
    "reason": "Test adjustment",
    "details": "Testing edge function"
  }'
```

### Step 3: Deploy Frontend Changes

```bash
# Build frontend
cd frontend
npm run build

# Deploy to your hosting (Vercel, Netlify, etc.)
# Example for Vercel:
vercel --prod

# Or if using custom deployment:
# Copy dist/ to your web server
```

**Environment Variables** (frontend):
Make sure `VITE_SUPABASE_URL` is set in your frontend `.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Step 4: Verify Everything Works

1. **Test Stock In:**
   - Add a new stock in with some materials
   - Check that `inventory.quantity` increases automatically
   - Verify `stock_in_batches` has the new batches

2. **Test Stock Out:**
   - Allocate some stock (regular or self stock out)
   - Check that `inventory.quantity` decreases automatically
   - Verify `stock_in_batches.quantity_remaining` decreased (FIFO)

3. **Test Manual Adjustment:**
   - Go to Inventory page
   - Edit a material's quantity
   - Provide reason and details
   - Confirm adjustment
   - Check that quantity updates correctly
   - Verify audit log was created

4. **Test Inter-Cloud Transfer:**
   - Create an inter-cloud kitchen transfer
   - Check source inventory decreases
   - Check destination inventory increases
   - Both should happen automatically via trigger

## Rollback Plan

If something goes wrong:

### Rollback Step 1: Restore old frontend code
```bash
git revert <commit-hash>
# Or manually restore:
# - StockIn.jsx: restore inventory.quantity updates
# - StockOut.jsx: restore inventory.quantity updates  
# - Inventory.jsx: restore direct inventory update
```

### Rollback Step 2: Remove trigger
```sql
DROP TRIGGER IF EXISTS trigger_sync_inventory_quantity ON stock_in_batches;
DROP FUNCTION IF EXISTS sync_inventory_quantity_from_batches();
```

### Rollback Step 3: Undeploy edge function
```bash
supabase functions delete adjust-inventory
```

## Monitoring

### Check for sync issues:
```sql
-- Find any inventory records that don't match batch totals
SELECT 
  i.id,
  rm.name,
  ck.name AS kitchen,
  i.quantity AS inventory_qty,
  COALESCE(SUM(b.quantity_remaining), 0) AS batch_total,
  i.quantity - COALESCE(SUM(b.quantity_remaining), 0) AS difference
FROM inventory i
JOIN raw_materials rm ON i.raw_material_id = rm.id
JOIN cloud_kitchens ck ON i.cloud_kitchen_id = ck.id
LEFT JOIN stock_in_batches b 
  ON i.cloud_kitchen_id = b.cloud_kitchen_id 
  AND i.raw_material_id = b.raw_material_id
GROUP BY i.id, i.raw_material_id, i.quantity, rm.name, ck.name
HAVING ABS(i.quantity - COALESCE(SUM(b.quantity_remaining), 0)) > 0.001;
```

### Check edge function logs:
```bash
supabase functions logs adjust-inventory --tail
```

### Check audit logs for adjustments:
```sql
SELECT 
  al.*,
  u.full_name
FROM audit_logs al
JOIN users u ON al.user_id = u.id
WHERE al.action IN ('inventory_increment', 'inventory_decrement')
ORDER BY al.created_at DESC
LIMIT 20;
```

## Benefits

1. **Single Source of Truth:** Batches drive inventory quantity
2. **No Sync Issues:** Trigger ensures inventory always matches batches
3. **Audit Trail:** All adjustments logged with reason and details
4. **FIFO Integrity:** Stock out always uses actual batch quantities
5. **Automatic:** No manual intervention needed to keep things in sync

## Notes

- The trigger runs on every `INSERT`, `UPDATE`, or `DELETE` on `stock_in_batches`
- For large batch operations, the trigger runs once per row (acceptable performance)
- Manual adjustments via edge function create audit logs automatically
- Old code that tried to update `inventory.quantity` directly is now removed
- The trigger uses `SECURITY DEFINER` so it has permission to update inventory

## Support

If you encounter issues:
1. Check trigger exists: `SELECT * FROM pg_trigger WHERE tgname = 'trigger_sync_inventory_quantity';`
2. Check edge function is deployed: `supabase functions list`
3. Check frontend environment variables are set
4. Review edge function logs for errors
5. Run the sync verification query above

For questions, contact the development team.
