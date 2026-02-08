# Self Stock Out Migration Guide

## Overview

This guide covers the implementation of the **Self Stock Out** feature, which allows purchase managers to allocate inventory for internal cloud kitchen use (R&D, testing, quality checks, etc.) without requiring an outlet or allocation request.

## What's New

### Database Changes

1. **New Columns in `stock_out` table:**
   - `self_stock_out` (BOOLEAN): Indicates if this is a self stock out (default: false)
   - `reason` (TEXT): Mandatory reason for self stock outs (nullable for regular stock outs)

2. **Modified Constraints:**
   - `allocation_request_id` is now nullable (required only for regular stock outs)
   - `outlet_id` is now nullable (required only for regular stock outs)
   - New check constraint ensures data integrity between self and regular stock outs

3. **Updated RLS Policies:**
   - Policies now handle both self stock outs and regular stock outs
   - Self stock outs don't require allocation request or outlet validation

### Frontend Changes

1. **New UI Components:**
   - Self Stock Out card at the top of the Stock Out page
   - Self Stock Out modal with material selection and reason field
   - Material picker with search/filter capability

2. **Enhanced Logic:**
   - Unified allocation handler for both regular and self stock outs
   - FIFO allocation works the same for both types
   - Audit log creation for self stock outs
   - Inventory decrement logic unchanged

## Migration Steps

### Step 1: Run Database Migrations

Execute the following SQL files in order:

```bash
# 1. Add new columns and modify constraints
psql -h <host> -U <user> -d <database> -f migrations/add-self-stock-out-support.sql

# 2. Update RLS policies
psql -h <host> -U <user> -d <database> -f migrations/update-stock-out-rls-for-self-stock-out.sql
```

Or using Supabase SQL Editor:

1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `add-self-stock-out-support.sql`
3. Click "Run"
4. Copy and paste the contents of `update-stock-out-rls-for-self-stock-out.sql`
5. Click "Run"

### Step 2: Verify Database Changes

```sql
-- Check if new columns exist
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'stock_out' 
AND column_name IN ('self_stock_out', 'reason');

-- Check if constraints are updated
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'stock_out';

-- Verify existing data is intact
SELECT COUNT(*) as total_stock_outs, 
       COUNT(CASE WHEN self_stock_out = true THEN 1 END) as self_stock_outs,
       COUNT(CASE WHEN self_stock_out = false THEN 1 END) as regular_stock_outs
FROM stock_out;
```

### Step 3: Deploy Frontend Changes

The frontend changes are already implemented in `frontend/src/pages/purchase-manager/StockOut.jsx`. Just deploy the updated code.

```bash
cd frontend
npm run build
# Deploy to your hosting platform
```

## Testing Guide

### Test 1: Verify Database Schema

```sql
-- Test 1: Try to insert a self stock out with missing reason (should fail)
INSERT INTO stock_out (
  cloud_kitchen_id, 
  allocated_by, 
  self_stock_out
) VALUES (
  '<cloud_kitchen_id>', 
  '<user_id>', 
  true
);
-- Expected: ERROR - violates check constraint "stock_out_self_stock_out_check"

-- Test 2: Try to insert a self stock out with allocation_request_id (should fail)
INSERT INTO stock_out (
  cloud_kitchen_id, 
  allocated_by, 
  self_stock_out, 
  reason,
  allocation_request_id
) VALUES (
  '<cloud_kitchen_id>', 
  '<user_id>', 
  true,
  'Testing',
  '<allocation_request_id>'
);
-- Expected: ERROR - violates check constraint "stock_out_self_stock_out_check"

-- Test 3: Insert a valid self stock out (should succeed)
INSERT INTO stock_out (
  cloud_kitchen_id, 
  allocated_by, 
  self_stock_out, 
  reason
) VALUES (
  '<cloud_kitchen_id>', 
  '<user_id>', 
  true,
  'R&D testing for new recipe'
);
-- Expected: SUCCESS

-- Test 4: Verify existing regular stock outs still work
SELECT * FROM stock_out WHERE self_stock_out = false LIMIT 5;
-- Expected: Should return existing records without errors
```

### Test 2: Frontend Testing

1. **Access the Stock Out Page:**
   - Log in as a purchase manager
   - Navigate to Stock Out page
   - Verify the "Self Stock Out" card appears at the top

2. **Open Self Stock Out Modal:**
   - Click "+ Self Stock Out" button
   - Verify modal opens with:
     - Reason textarea (required)
     - Materials table with "+ Add Row" button
     - Empty state message

3. **Add Materials:**
   - Click "+ Add Row" button 2-3 times
   - Select different materials from the dropdown in each row
   - Verify "Current Stock" column updates automatically for each selected material
   - Try selecting the same material in another row (should be disabled)
   - Verify stock levels are color-coded (red for 0, yellow for low, normal otherwise)

4. **Enter Quantities:**
   - Enter quantities for each selected material
   - Try entering 0 or negative values (should show validation error)
   - Enter quantities greater than available inventory (should show error)
   - Verify quantity input is disabled until material is selected

5. **Test Reason Field:**
   - Try submitting without a reason (should show error)
   - Enter a valid reason

6. **Submit Self Stock Out:**
   - Click "Confirm Self Stock Out"
   - Verify success message appears
   - Check that inventory is decremented
   - Verify FIFO batches are updated

7. **Verify Audit Log:**
   ```sql
   SELECT * FROM audit_logs 
   WHERE entity_type = 'stock_out' 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```

8. **Test Regular Stock Out Still Works:**
   - Create an allocation request from supervisor dashboard
   - Go to Stock Out page
   - Click "Allocate Stock" on a pending request
   - Verify the regular allocation modal works as before

### Test 3: Edge Cases

1. **Insufficient Inventory:**
   - Try to self stock out more than available inventory
   - Verify error message shows available quantity

2. **Empty Material List:**
   - Try to submit self stock out without adding materials
   - Verify error message

3. **Concurrent Operations:**
   - Have two purchase managers try to stock out the same material simultaneously
   - Verify FIFO logic handles this correctly

4. **Session Expiry:**
   - Let session expire and try to submit
   - Verify appropriate error message

## Rollback Plan

If you need to rollback the changes:

```sql
-- Step 1: Remove the check constraint
ALTER TABLE stock_out DROP CONSTRAINT IF EXISTS stock_out_self_stock_out_check;

-- Step 2: Make allocation_request_id and outlet_id NOT NULL again
-- (Only if no self stock outs exist)
UPDATE stock_out SET 
  allocation_request_id = '<dummy_id>',
  outlet_id = '<dummy_id>'
WHERE self_stock_out = true;

ALTER TABLE stock_out ALTER COLUMN allocation_request_id SET NOT NULL;
ALTER TABLE stock_out ALTER COLUMN outlet_id SET NOT NULL;

-- Step 3: Drop the new columns
ALTER TABLE stock_out DROP COLUMN IF EXISTS self_stock_out;
ALTER TABLE stock_out DROP COLUMN IF EXISTS reason;

-- Step 4: Restore old RLS policies
-- (Run the original stock-out-rls-policies.sql)
```

## Data Integrity

### Constraints Enforced

1. **Self Stock Out (self_stock_out = true):**
   - `reason` must be provided and not empty
   - `allocation_request_id` must be NULL
   - `outlet_id` must be NULL
   - `cloud_kitchen_id` must be provided
   - `allocated_by` must be provided

2. **Regular Stock Out (self_stock_out = false):**
   - `allocation_request_id` must be provided
   - `outlet_id` must be provided
   - `cloud_kitchen_id` must be provided
   - `allocated_by` must be provided
   - `reason` can be NULL

### Indexes

New index added for efficient querying:
```sql
idx_stock_out_self_stock_out ON (self_stock_out, cloud_kitchen_id, allocation_date)
```

## Monitoring

### Queries to Monitor Self Stock Outs

```sql
-- Daily self stock out summary
SELECT 
  DATE(allocation_date) as date,
  COUNT(*) as total_self_stock_outs,
  COUNT(DISTINCT allocated_by) as unique_users
FROM stock_out
WHERE self_stock_out = true
GROUP BY DATE(allocation_date)
ORDER BY date DESC;

-- Top reasons for self stock outs
SELECT 
  reason,
  COUNT(*) as count
FROM stock_out
WHERE self_stock_out = true
GROUP BY reason
ORDER BY count DESC
LIMIT 10;

-- Materials frequently used in self stock outs
SELECT 
  rm.name,
  rm.code,
  COUNT(DISTINCT so.id) as stock_out_count,
  SUM(soi.quantity) as total_quantity,
  rm.unit
FROM stock_out so
JOIN stock_out_items soi ON so.id = soi.stock_out_id
JOIN raw_materials rm ON soi.raw_material_id = rm.id
WHERE so.self_stock_out = true
GROUP BY rm.id, rm.name, rm.code, rm.unit
ORDER BY stock_out_count DESC
LIMIT 20;

-- Audit trail for self stock outs
SELECT 
  al.created_at,
  u.full_name,
  al.new_values->>'reason' as reason,
  al.new_values->'items' as items
FROM audit_logs al
JOIN users u ON al.user_id = u.id
WHERE al.entity_type = 'stock_out'
AND al.new_values->>'self_stock_out' = 'true'
ORDER BY al.created_at DESC;
```

## Support

If you encounter any issues:

1. Check the browser console for JavaScript errors
2. Check Supabase logs for database errors
3. Verify RLS policies are correctly applied
4. Ensure the user has the `purchase_manager` role
5. Check that the cloud_kitchen_id is correctly set in the session

## Notes

- All existing stock out functionality remains unchanged
- Self stock outs follow the same FIFO logic as regular stock outs
- Inventory decrements work identically for both types
- Audit logs are created for both types
- The feature is backward compatible with existing data
