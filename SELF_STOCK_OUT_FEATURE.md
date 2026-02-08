# Self Stock Out Feature

## Overview

The Self Stock Out feature allows purchase managers to allocate inventory for internal cloud kitchen use without requiring an outlet or allocation request. This is useful for:

- **R&D**: Testing new recipes or ingredients
- **Quality Control**: Sampling materials for quality checks
- **Training**: Using materials for staff training
- **Testing**: Product testing and development
- **Internal Consumption**: Any other internal cloud kitchen needs

## Key Features

### 1. **Mandatory Reason**
Every self stock out requires a reason to be provided. This ensures accountability and tracking of internal consumption.

### 2. **Same FIFO Logic**
Self stock outs use the same First-In-First-Out (FIFO) logic as regular stock outs, ensuring consistent inventory valuation and tracking.

### 3. **Audit Trail**
All self stock outs are logged in the audit_logs table with full details including:
- User who performed the action
- Reason for the stock out
- Materials and quantities allocated
- Timestamp

### 4. **Inventory Decrement**
Inventory is decremented the same way as regular stock outs:
- Stock is removed from `stock_in_batches` using FIFO
- Main `inventory` table is updated
- Quantity remaining is tracked

## User Interface

### Stock Out Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  Self Stock Out Card                                    │
│  [+ Self Stock Out] button                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Filters (Date Range, Status)                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Allocation Requests Table                              │
│  (Regular outlet allocations)                           │
└─────────────────────────────────────────────────────────┘
```

### Self Stock Out Modal

The modal includes:

1. **Reason Field** (Required)
   - Large textarea for entering the reason
   - Placeholder text guides the user
   - Cannot submit without a reason

2. **Materials Table with Add Row**
   - "+ Add Row" button to add new material rows
   - Each row contains:
     - **Material Dropdown**: Select from all active materials
     - **Current Stock**: Shows real-time inventory for selected material
     - **Quantity Input**: Enter quantity to allocate
     - **Remove Button**: Delete the row
   - Already selected materials are disabled in other dropdowns
   - Current stock updates automatically when material is selected
   - Color-coded stock levels (red for out of stock, yellow for low stock)

3. **Action Buttons**
   - Cancel: Close modal without saving
   - Confirm: Submit the self stock out (disabled until valid)

## Database Schema Changes

### New Columns in `stock_out` Table

```sql
-- Indicates if this is a self stock out
self_stock_out BOOLEAN NOT NULL DEFAULT false

-- Reason for self stock out (mandatory for self stock outs)
reason TEXT NULL
```

### Modified Constraints

```sql
-- allocation_request_id and outlet_id are now nullable
allocation_request_id UUID NULL  -- was NOT NULL
outlet_id UUID NULL              -- was NOT NULL

-- New check constraint ensures data integrity
CONSTRAINT stock_out_self_stock_out_check CHECK (
  (
    -- For self stock outs
    self_stock_out = true 
    AND reason IS NOT NULL 
    AND reason != ''
    AND allocation_request_id IS NULL 
    AND outlet_id IS NULL
  )
  OR
  (
    -- For regular stock outs
    self_stock_out = false 
    AND allocation_request_id IS NOT NULL 
    AND outlet_id IS NOT NULL
  )
)
```

## How It Works

### Flow Diagram

```
Purchase Manager
      ↓
Click "Self Stock Out"
      ↓
Enter Reason (Required)
      ↓
Click "+ Add Row"
      ↓
Select Material from Dropdown
      ↓
View Current Stock (auto-displayed)
      ↓
Enter Quantity
      ↓
Repeat for more materials
      ↓
Click "Confirm"
      ↓
Validation:
  - Reason not empty?
  - Materials selected?
  - Quantities valid?
  - Sufficient inventory?
      ↓
Create stock_out record
  (self_stock_out = true)
      ↓
For each material:
  - Allocate from batches (FIFO)
  - Create stock_out_item
  - Decrement inventory
      ↓
Create audit log
      ↓
Show success message
```

### Backend Logic

1. **Validation**
   - Reason must be provided and not empty
   - At least one material must be selected
   - All quantities must be > 0
   - Sufficient inventory must be available

2. **Stock Out Creation**
   ```javascript
   {
     cloud_kitchen_id: session.cloud_kitchen_id,
     allocated_by: session.id,
     allocation_date: today,
     self_stock_out: true,
     reason: reason.trim(),
     notes: `Self stock out: ${reason.trim()}`
   }
   ```

3. **FIFO Allocation**
   - Same `allocateStockFIFO()` function used for regular stock outs
   - Queries `stock_in_batches` ordered by `created_at` (oldest first)
   - Decrements `quantity_remaining` from batches
   - Ensures no batch goes negative

4. **Inventory Update**
   - Fetch current inventory quantity
   - Subtract allocated quantity
   - Update with new quantity (max 0)
   - Set `last_updated_at` and `updated_by`

5. **Audit Log**
   ```javascript
   {
     user_id: session.id,
     action: 'stock_out',
     entity_type: 'stock_out',
     entity_id: stockOutData.id,
     new_values: {
       self_stock_out: true,
       reason: reason.trim(),
       items: [...]
     }
   }
   ```

## Security & Permissions

### Row Level Security (RLS)

- Only purchase managers can create self stock outs
- Self stock outs are scoped to the user's cloud kitchen
- Cannot create self stock outs for other cloud kitchens
- Supervisors can view self stock outs for their cloud kitchen

### Data Integrity

- Check constraint prevents invalid combinations
- Cannot have self_stock_out = true with allocation_request_id
- Cannot have self_stock_out = false without allocation_request_id
- Reason is mandatory for self stock outs

## Reporting & Analytics

### Useful Queries

**Daily Self Stock Out Summary:**
```sql
SELECT 
  DATE(allocation_date) as date,
  COUNT(*) as total_self_stock_outs,
  SUM((
    SELECT SUM(quantity) 
    FROM stock_out_items 
    WHERE stock_out_id = stock_out.id
  )) as total_items_quantity
FROM stock_out
WHERE self_stock_out = true
  AND cloud_kitchen_id = '<your_cloud_kitchen_id>'
GROUP BY DATE(allocation_date)
ORDER BY date DESC;
```

**Top Reasons:**
```sql
SELECT 
  reason,
  COUNT(*) as count,
  array_agg(DISTINCT allocated_by) as users
FROM stock_out
WHERE self_stock_out = true
  AND cloud_kitchen_id = '<your_cloud_kitchen_id>'
GROUP BY reason
ORDER BY count DESC;
```

**Most Used Materials:**
```sql
SELECT 
  rm.name,
  rm.code,
  COUNT(DISTINCT so.id) as times_used,
  SUM(soi.quantity) as total_quantity,
  rm.unit
FROM stock_out so
JOIN stock_out_items soi ON so.id = soi.stock_out_id
JOIN raw_materials rm ON soi.raw_material_id = rm.id
WHERE so.self_stock_out = true
  AND so.cloud_kitchen_id = '<your_cloud_kitchen_id>'
GROUP BY rm.id, rm.name, rm.code, rm.unit
ORDER BY times_used DESC;
```

## Migration & Deployment

### Files Created

1. **Database Migrations:**
   - `migrations/add-self-stock-out-support.sql`
   - `migrations/update-stock-out-rls-for-self-stock-out.sql`

2. **Documentation:**
   - `migrations/SELF_STOCK_OUT_MIGRATION_GUIDE.md`
   - `SELF_STOCK_OUT_FEATURE.md` (this file)

3. **Frontend Changes:**
   - `frontend/src/pages/purchase-manager/StockOut.jsx` (updated)

### Deployment Steps

1. **Run database migrations** (in order):
   ```bash
   psql -f migrations/add-self-stock-out-support.sql
   psql -f migrations/update-stock-out-rls-for-self-stock-out.sql
   ```

2. **Deploy frontend changes**:
   ```bash
   cd frontend
   npm run build
   # Deploy to your hosting platform
   ```

3. **Verify deployment**:
   - Log in as purchase manager
   - Check that Self Stock Out card appears
   - Test creating a self stock out
   - Verify inventory is decremented
   - Check audit logs

### Backward Compatibility

- ✅ All existing stock out records continue to work
- ✅ Regular allocation flow unchanged
- ✅ No data migration required for existing records
- ✅ New columns have sensible defaults

## Testing Checklist

- [ ] Database migrations run successfully
- [ ] RLS policies updated correctly
- [ ] Self Stock Out card appears on page
- [ ] Modal opens when clicking button
- [ ] Material selection works
- [ ] Quantity validation works
- [ ] Reason field is mandatory
- [ ] Submit creates stock_out record
- [ ] Inventory is decremented correctly
- [ ] FIFO batches are updated
- [ ] Audit log is created
- [ ] Success message appears
- [ ] Regular stock out still works
- [ ] Insufficient inventory error shows
- [ ] Session expiry handled gracefully

## Future Enhancements

Possible future improvements:

1. **Approval Workflow**: Require admin approval for large self stock outs
2. **Budget Tracking**: Track cost of self stock outs against budget
3. **Recurring Self Stock Outs**: Template for regular R&D needs
4. **Material Suggestions**: Suggest materials based on past self stock outs
5. **Analytics Dashboard**: Dedicated dashboard for self stock out analytics
6. **Export Reports**: Export self stock out data to CSV/PDF
7. **Notifications**: Notify admins of large self stock outs
8. **Categories**: Categorize self stock outs (R&D, QC, Training, etc.)

## Support

For issues or questions:

1. Check `migrations/SELF_STOCK_OUT_MIGRATION_GUIDE.md` for detailed testing steps
2. Review browser console for JavaScript errors
3. Check Supabase logs for database errors
4. Verify user has `purchase_manager` role
5. Ensure `cloud_kitchen_id` is set in session

## Conclusion

The Self Stock Out feature provides a complete solution for tracking internal inventory consumption while maintaining the same data integrity and FIFO logic as regular outlet allocations. The mandatory reason field ensures accountability, and the audit trail provides full visibility into internal usage patterns.
