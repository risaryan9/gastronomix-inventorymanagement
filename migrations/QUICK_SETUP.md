# Quick Setup for Self Stock Out Feature

## Step 1: Run Database Migrations

Copy and paste the following SQL into your Supabase SQL Editor (or run via psql):

### Migration 1: Add Columns and Constraints

```sql
-- Add new columns to stock_out table
ALTER TABLE public.stock_out 
ADD COLUMN IF NOT EXISTS self_stock_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.stock_out 
ADD COLUMN IF NOT EXISTS reason TEXT NULL;

-- Make allocation_request_id and outlet_id nullable
ALTER TABLE public.stock_out 
ALTER COLUMN allocation_request_id DROP NOT NULL;

ALTER TABLE public.stock_out 
ALTER COLUMN outlet_id DROP NOT NULL;

-- Add check constraint for data integrity
ALTER TABLE public.stock_out 
ADD CONSTRAINT stock_out_self_stock_out_check 
CHECK (
  (
    self_stock_out = true 
    AND reason IS NOT NULL 
    AND reason != ''
    AND allocation_request_id IS NULL 
    AND outlet_id IS NULL
  )
  OR
  (
    self_stock_out = false 
    AND allocation_request_id IS NOT NULL 
    AND outlet_id IS NOT NULL
  )
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_stock_out_self_stock_out 
ON public.stock_out USING btree (self_stock_out, cloud_kitchen_id, allocation_date);
```

### Migration 2: Update RLS Policies

```sql
-- Drop existing policies
DROP POLICY IF EXISTS "Purchase managers and supervisors view stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Purchase managers create stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Purchase managers update stock out for own kitchen" ON stock_out;
DROP POLICY IF EXISTS "Admin can delete stock out" ON stock_out;

-- Recreate SELECT policy
CREATE POLICY "Purchase managers and supervisors view stock out for own kitchen" ON stock_out
  FOR SELECT
  TO public
  USING (
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('purchase_manager', 'admin', 'supervisor')
      AND is_active = true
      AND cloud_kitchen_id = stock_out.cloud_kitchen_id
    ))
    OR
    (auth.uid() IS NULL)
  );

-- Recreate INSERT policy (updated for self stock outs)
CREATE POLICY "Purchase managers create stock out for own kitchen" ON stock_out
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND cloud_kitchen_id IS NOT NULL
    AND allocated_by IS NOT NULL
    AND allocation_date IS NOT NULL
    AND (
      self_stock_out = true
      OR
      (
        self_stock_out = false
        AND allocation_request_id IS NOT NULL
        AND outlet_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM allocation_requests
          WHERE allocation_requests.id = stock_out.allocation_request_id
          AND (
            auth.uid() IS NULL
            OR EXISTS (
              SELECT 1 FROM users 
              WHERE id = auth.uid() 
              AND cloud_kitchen_id = allocation_requests.cloud_kitchen_id
              AND allocation_requests.cloud_kitchen_id = stock_out.cloud_kitchen_id
            )
          )
        )
        AND EXISTS (
          SELECT 1 FROM outlets
          WHERE outlets.id = stock_out.outlet_id
          AND outlets.cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
      )
    )
  );

-- Recreate UPDATE policy
CREATE POLICY "Purchase managers update stock out for own kitchen" ON stock_out
  FOR UPDATE
  TO public
  USING (
    is_purchase_manager_or_admin()
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND cloud_kitchen_id = stock_out.cloud_kitchen_id
      )
    )
  )
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND cloud_kitchen_id IS NOT NULL
    AND allocated_by IS NOT NULL
    AND allocation_date IS NOT NULL
  );

-- Recreate DELETE policy
CREATE POLICY "Admin can delete stock out" ON stock_out
  FOR DELETE
  TO authenticated
  USING (is_admin());
```

## Step 2: Verify Migration

Run this query to verify the changes:

```sql
-- Check columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'stock_out' 
AND column_name IN ('self_stock_out', 'reason', 'allocation_request_id', 'outlet_id');

-- Expected output:
-- self_stock_out       | boolean | NO
-- reason               | text    | YES
-- allocation_request_id| uuid    | YES
-- outlet_id            | uuid    | YES

-- Check existing data
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN self_stock_out = true THEN 1 END) as self_stock_outs,
  COUNT(CASE WHEN self_stock_out = false THEN 1 END) as regular_stock_outs
FROM stock_out;

-- All existing records should have self_stock_out = false
```

## Step 3: Deploy Frontend

The frontend code has already been updated in:
- `frontend/src/pages/purchase-manager/StockOut.jsx`

Just build and deploy:

```bash
cd frontend
npm run build
# Deploy to your hosting
```

## Step 4: Test

1. Log in as a purchase manager
2. Go to Stock Out page
3. You should see a "Self Stock Out" card at the top
4. Click "+ Self Stock Out" button
5. Enter a reason and select materials
6. Enter quantities and submit
7. Verify inventory is decremented

## Troubleshooting

**Error: "violates check constraint"**
- Make sure you're providing a reason for self stock outs
- Make sure allocation_request_id and outlet_id are NULL for self stock outs

**Error: "function is_purchase_manager_or_admin does not exist"**
- Run the audit-logs-rls-policies.sql first to create the helper functions

**UI doesn't show Self Stock Out card**
- Clear browser cache
- Check browser console for errors
- Verify you're logged in as purchase_manager

**Can't submit self stock out**
- Check that reason field is not empty
- Check that at least one material is selected
- Check that all quantities are > 0
- Check that you have sufficient inventory

## Done!

You're all set! The self stock out feature is now ready to use.

For more details, see:
- `SELF_STOCK_OUT_FEATURE.md` - Feature overview
- `SELF_STOCK_OUT_MIGRATION_GUIDE.md` - Detailed migration guide
