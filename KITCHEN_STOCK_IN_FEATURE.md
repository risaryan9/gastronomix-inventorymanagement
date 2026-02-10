# Kitchen Stock-In Feature Implementation

## Overview

This feature introduces a dual stock-in system to support both:
1. **Purchase Stock-In** - For raw materials purchased from external vendors
2. **Kitchen Stock-In** - For semi-finished and finished materials produced in-house

## Database Changes

### Migration File: `add-stock-in-type-column.sql`

**New Column Added:**
- `stock_in_type` TEXT NOT NULL DEFAULT 'purchase'
- CHECK constraint: `stock_in_type IN ('purchase', 'kitchen')`
- Index created: `idx_stock_in_type`

**Data Migration:**
- All existing stock_in records initialized to `stock_in_type = 'purchase'`
- No data loss or breaking changes

## Frontend Changes

### File Modified: `/frontend/src/pages/purchase-manager/StockIn.jsx`

#### 1. New State Variable
```javascript
const [stockInType, setStockInType] = useState('purchase')
```

#### 2. Updated Header Section

**Before:**
```
┌─────────────────────────────────────────────────┐
│ Stock In                  [+ Add New Purchase Slip] │
└─────────────────────────────────────────────────┘
```

**After:**
```
┌──────────────────────────────────────────────────────────────┐
│ Stock In                                                     │
│ Manage purchase and kitchen stock-in records                │
│                    [+ Create Stock-In Invoice]              │
│                    [+ Create Kitchen Stock-In]              │
└──────────────────────────────────────────────────────────────┘
```

#### 3. Two Action Buttons

**Create Stock-In Invoice** (Yellow/Accent)
- Opens modal for purchase stock-in
- For raw materials from vendors
- Requires supplier and invoice number

**Create Kitchen Stock-In** (Green)
- Opens modal for kitchen stock-in
- For semi-finished and finished materials
- No supplier or invoice required

#### 4. Updated Table Structure

**New Column: Type**
- First column in the table
- Color-coded badges:
  - 🔵 Blue: "Purchase" (purchase stock-in)
  - 🟢 Green: "Kitchen" (kitchen stock-in)

**Table Columns:**
1. Type (new)
2. Date (renamed from "Receipt Date")
3. Supplier
4. Invoice #
5. Items
6. Total Cost
7. Actions

#### 5. Conditional Modal Title

- **Purchase Stock-In**: "New Purchase Slip"
- **Kitchen Stock-In**: "New Kitchen Stock-In"

#### 6. Conditional Form Fields

**Purchase Stock-In Form:**
- Supplier (required)
- Invoice Number (required)
- Receipt Date (required)
- Notes (optional)

**Kitchen Stock-In Form:**
- Date (required) - label changed from "Receipt Date"
- Notes (optional)
- No supplier field
- No invoice number field

#### 7. Material Filtering

**Purchase Stock-In:**
- Shows only `raw_material` type materials
- Filters: `material_type IN ['raw_material']`

**Kitchen Stock-In:**
- Shows only `semi_finished` and `finished` type materials
- Filters: `material_type IN ['semi_finished', 'finished']`

#### 8. Updated Database Query

```javascript
.select(`
  *,
  stock_in_batches (
    id,
    quantity_purchased,
    quantity_remaining,
    unit_cost,
    raw_materials:raw_material_id (
      id,
      name,
      code,
      unit,
      material_type  // ← Added
    )
  )
`)
```

#### 9. Validation Logic

**Purchase Stock-In:**
- Validates supplier is selected
- Validates invoice number is entered
- Validates date is selected
- Validates at least one item added

**Kitchen Stock-In:**
- Validates date is selected
- Validates at least one item added
- No supplier/invoice validation

#### 10. Insert Logic

```javascript
.insert({
  cloud_kitchen_id: session.cloud_kitchen_id,
  received_by: session.id,
  receipt_date: purchaseSlip.receipt_date,
  supplier_name: stockInType === 'purchase' ? (purchaseSlip.supplier_name.trim() || null) : null,
  invoice_number: stockInType === 'purchase' ? (purchaseSlip.invoice_number.trim() || null) : null,
  total_cost: totalCost,
  notes: purchaseSlip.notes.trim() || null,
  stock_in_type: stockInType  // ← Added
})
```

## User Flow

### Creating a Purchase Stock-In

1. Click "Create Stock-In Invoice" button
2. Modal opens: "New Purchase Slip"
3. Fill in required fields:
   - Select Supplier (dropdown)
   - Enter Invoice Number
   - Select Receipt Date
   - Add Notes (optional)
4. Add materials:
   - Click "Select Material..." dropdown
   - Only raw materials appear
   - Enter quantity and unit cost
5. Review total cost
6. Click "Confirm & Create"
7. Stock-in record created with `stock_in_type = 'purchase'`

### Creating a Kitchen Stock-In

1. Click "Create Kitchen Stock-In" button
2. Modal opens: "New Kitchen Stock-In"
3. Fill in required fields:
   - Select Date (no "Receipt" label)
   - Add Notes (optional)
   - No supplier or invoice fields
4. Add materials:
   - Click "Select Material..." dropdown
   - Only semi-finished and finished materials appear
   - Enter quantity and unit cost
5. Review total cost
6. Click "Confirm & Create"
7. Stock-in record created with `stock_in_type = 'kitchen'`

## Visual Examples

### Table Display

```
┌──────────┬────────────┬──────────┬───────────┬───────┬────────────┬─────────┐
│ Type     │ Date       │ Supplier │ Invoice # │ Items │ Total Cost │ Actions │
├──────────┼────────────┼──────────┼───────────┼───────┼────────────┼─────────┤
│ 🔵 Purch │ 02/10/2026 │ ABC Sup  │ INV-001   │ 5     │ ₹5,000.00  │ [View]  │
│ 🟢 Kitch │ 02/10/2026 │ —        │ —         │ 3     │ ₹2,500.00  │ [View]  │
│ 🔵 Purch │ 02/09/2026 │ XYZ Sup  │ INV-002   │ 8     │ ₹8,500.00  │ [View]  │
└──────────┴────────────┴──────────┴───────────┴───────┴────────────┴─────────┘
```

### Modal Comparison

**Purchase Stock-In Modal:**
```
┌────────────────────────────────────────┐
│ New Purchase Slip                  [X] │
├────────────────────────────────────────┤
│ Supplier: [Select vendor ▼]           │
│ Invoice Number: [_____________]        │
│ Receipt Date: [02/10/2026]            │
│ Notes: [___________________________]   │
│                                        │
│ Materials:                             │
│ [Select Material... ▼] (Raw only)     │
│ - Black Pepper (RM-SPCE-001)          │
│ - Basmati Rice (RM-GRNS-001)          │
│ - Chicken Breast (RM-MEAT-001)        │
└────────────────────────────────────────┘
```

**Kitchen Stock-In Modal:**
```
┌────────────────────────────────────────┐
│ New Kitchen Stock-In               [X] │
├────────────────────────────────────────┤
│ Date: [02/10/2026]                    │
│ Notes: [___________________________]   │
│                                        │
│ Materials:                             │
│ [Select Material... ▼] (Semi/Fin only)│
│ - Pizza Dough (SF-BM-001)             │
│ - Marinated Wings (SF-NK-001)         │
│ - Margherita Pizza (FF-BM-001)        │
└────────────────────────────────────────┘
```

## Use Cases

### Use Case 1: Receiving Raw Materials from Vendor

**Scenario:** Purchase Manager receives delivery of raw materials

**Steps:**
1. Click "Create Stock-In Invoice"
2. Select vendor: "ABC Suppliers"
3. Enter invoice: "INV-12345"
4. Select date: Today
5. Add materials:
   - Black Pepper: 50 kg @ ₹120/kg
   - Basmati Rice: 100 kg @ ₹80/kg
6. Total: ₹14,000
7. Confirm and create
8. Inventory updated for raw materials

### Use Case 2: Recording In-House Production

**Scenario:** Kitchen produces semi-finished pizza dough

**Steps:**
1. Click "Create Kitchen Stock-In"
2. Select date: Today
3. Add materials:
   - Pizza Dough Balls: 200 nos @ ₹15/nos
4. Total: ₹3,000
5. Confirm and create
6. Inventory updated for semi-finished material

### Use Case 3: Recording Finished Products

**Scenario:** Kitchen prepares finished pizzas for distribution

**Steps:**
1. Click "Create Kitchen Stock-In"
2. Select date: Today
3. Add materials:
   - Margherita Pizza: 50 nos @ ₹80/nos
   - Pepperoni Pizza: 30 nos @ ₹100/nos
4. Total: ₹7,000
5. Confirm and create
6. Inventory updated for finished products

## Benefits

### 1. Clear Separation
- Purchase and kitchen stock-ins are clearly distinguished
- Easy to track source of inventory

### 2. Appropriate Fields
- Purchase stock-in requires vendor and invoice
- Kitchen stock-in doesn't clutter with unnecessary fields

### 3. Material Filtering
- Users only see relevant materials for each type
- Prevents errors (e.g., adding finished goods to purchase invoice)

### 4. Better Reporting
- Can analyze purchase costs separately from production
- Track kitchen production efficiency
- Understand material flow through the system

### 5. Audit Trail
- Clear distinction between purchased and produced materials
- Better compliance and tracking

## Technical Details

### State Management
```javascript
const [stockInType, setStockInType] = useState('purchase')
```

### Material Query Filter
```javascript
const materialTypes = stockInType === 'purchase' 
  ? ['raw_material'] 
  : ['semi_finished', 'finished']

const { data: materialsData, error } = await supabase
  .from('raw_materials')
  .select('id, name, code, unit, category, material_type')
  .eq('is_active', true)
  .is('deleted_at', null)
  .in('material_type', materialTypes)
  .order('name', { ascending: true })
```

### Type Badge Component
```javascript
<span className={`inline-block px-2 py-1 rounded-md text-xs font-semibold ${
  record.stock_in_type === 'kitchen' 
    ? 'bg-green-500/20 text-green-400' 
    : 'bg-blue-500/20 text-blue-400'
}`}>
  {record.stock_in_type === 'kitchen' ? 'Kitchen' : 'Purchase'}
</span>
```

## Database Schema

### Updated stock_in Table
```sql
CREATE TABLE public.stock_in (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloud_kitchen_id UUID NOT NULL REFERENCES cloud_kitchens(id),
  received_by UUID NOT NULL REFERENCES users(id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_name TEXT NULL,  -- Required for purchase, null for kitchen
  invoice_number TEXT NULL,  -- Required for purchase, null for kitchen
  total_cost NUMERIC(10, 2) NULL,
  notes TEXT NULL,
  stock_in_type TEXT NOT NULL DEFAULT 'purchase' CHECK (stock_in_type IN ('purchase', 'kitchen')),  -- NEW
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_in_type ON stock_in(stock_in_type);
```

## Migration Steps

### 1. Run Database Migration
```bash
# Via Supabase SQL Editor
# Execute: migrations/add-stock-in-type-column.sql
```

### 2. Verify Migration
```sql
-- Check column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'stock_in' AND column_name = 'stock_in_type';

-- Verify all records have type
SELECT stock_in_type, COUNT(*) as count
FROM stock_in
GROUP BY stock_in_type;
```

### 3. Deploy Frontend
```bash
cd frontend
npm run build
# Deploy to hosting platform
```

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] All existing records have `stock_in_type = 'purchase'`
- [ ] Index created successfully
- [ ] "Create Stock-In Invoice" button works
- [ ] "Create Kitchen Stock-In" button works
- [ ] Purchase modal shows correct title
- [ ] Kitchen modal shows correct title
- [ ] Purchase modal requires supplier and invoice
- [ ] Kitchen modal doesn't show supplier/invoice fields
- [ ] Purchase modal shows only raw materials
- [ ] Kitchen modal shows only semi-finished/finished materials
- [ ] Type column appears in table
- [ ] Type badges display correct colors
- [ ] Purchase records show supplier and invoice
- [ ] Kitchen records show "—" for supplier and invoice
- [ ] Can create purchase stock-in successfully
- [ ] Can create kitchen stock-in successfully
- [ ] Inventory updates correctly for both types

## Backward Compatibility

✅ **Fully Backward Compatible**
- All existing stock-in records become "Purchase" type
- Existing functionality unchanged
- No breaking changes to API or database structure
- Existing reports and queries continue to work

---

**Updated**: 2026-02-10  
**Version**: 1.0  
**Status**: ✅ Complete
