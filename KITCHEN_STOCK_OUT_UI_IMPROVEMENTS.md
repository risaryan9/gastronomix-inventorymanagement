# Kitchen Stock Out UI Improvements

## Overview
Enhanced the Kitchen Stock Out feature with improved UI/UX matching the Stock In design pattern and added "Today's Total" tracking for better inventory visibility.

## Changes Made

### 1. **Reason Field - Dropdown with Predefined Options**
- Changed from free-text textarea to a dropdown with 3 predefined options:
  - **Wastage** (stored as `wastage`)
  - **Staff Food** (stored as `staff-food`)
  - **Internal Production** (stored as `internal-production`)
- Ensures consistent data entry and easier reporting

### 2. **Additional Notes Field**
- Added optional "Additional Notes" textarea below the reason dropdown
- Allows users to provide extra context when needed
- Not required - defaults to empty/null
- Stored in the existing `notes` column of the `stock_out` table

### 3. **Unified Table Design**
The Kitchen Stock Out table now matches the Stock In design:

#### Table Structure:
- **Checkbox column**: Multi-select rows for bulk deletion
- **Name**: Material dropdown with search functionality
- **Current Stock**: Shows available inventory with color coding:
  - Red background: Out of stock (0)
  - Yellow background: Low stock (< 10)
  - Gray background: Normal stock
- **Today's Total**: NEW - Shows total quantity stocked out today for each material
- **Quantity**: Input field for stock out quantity
- **Actions**: Delete row button

#### Features:
- Checkbox selection for bulk row removal
- "Remove Selected (N)" button appears when rows are selected
- "+ Add Row" button to add new rows
- 3 default empty rows on modal open
- Consistent styling with Stock In table (borders, padding, colors)

### 4. **Today's Total Column**
- Displays the total quantity from **unpacked allocation requests** for today for each material
- Same logic as the "Today's Total" in the Allocate Stock modal
- Fetched from `allocation_requests` and `allocation_request_items` tables when material is selected
- Shows the sum of all requested quantities for that material from today's unpacked requests
- Helps prevent over-allocation and provides visibility into daily demand
- Format: `{quantity} {unit}` (e.g., "5.000 kg")

### 5. **Default Rows**
- Changed from 0 to **3 empty rows** when opening the Kitchen Stock Out modal
- Matches Stock In behavior for consistent UX
- Rows have unique IDs for proper React key management

### 6. **Improved Validation**
- Only validates items with material selected AND quantity > 0
- Empty rows are ignored (no validation errors)
- Allows flexible workflow - users can add multiple rows and fill them as needed
- Clear error messages for specific validation failures

### 7. **Display Improvements**
- Reason displayed with proper capitalization in details modal (e.g., "Staff Food" instead of "staff-food")
- Additional notes shown separately for Kitchen Stock Out records
- Regular stock out notes remain unchanged

## Technical Implementation

### State Management
```javascript
const [selfStockOutReason, setSelfStockOutReason] = useState('')
const [selfStockOutNotes, setSelfStockOutNotes] = useState('')
const [selectedStockOutRows, setSelectedStockOutRows] = useState(new Set())
```

### Item Structure
```javascript
{
  id: 'row-{timestamp}-{random}',
  raw_material_id: null,
  name: null,
  code: null,
  unit: null,
  current_inventory: 0,
  todays_total: 0,
  allocated_quantity: ''
}
```

### Today's Total Fetch
```javascript
// Fetch today's total allocation requests for this material (same as Allocate Stock modal)
const today = new Date().toISOString().split('T')[0]
const { data: todayRequests } = await supabase
  .from('allocation_requests')
  .select(`
    allocation_request_items!inner (
      raw_material_id,
      quantity
    )
  `)
  .eq('cloud_kitchen_id', session.cloud_kitchen_id)
  .eq('request_date', today)
  .eq('is_packed', false)

let todaysTotal = 0
if (todayRequests) {
  todayRequests.forEach(req => {
    req.allocation_request_items.forEach(item => {
      if (item.raw_material_id === materialId) {
        todaysTotal += parseFloat(item.quantity || 0)
      }
    })
  })
}
```

### Validation Logic
```javascript
// Filter only valid items (with material and quantity > 0)
if (isSelfStockOut) {
  itemsToProcess = itemsToProcess.filter(item => 
    item.raw_material_id && parseFloat(item.allocated_quantity) > 0
  )
}
```

## Database Schema
No database changes required - uses existing columns:
- `stock_out.reason` - Stores predefined reason values
- `stock_out.notes` - Stores additional notes (optional)
- `allocation_requests` + `allocation_request_items` - Used to calculate today's total (unpacked requests)

## Benefits

1. **Consistency**: Unified design across Stock In and Kitchen Stock Out
2. **Better UX**: Predefined reasons ensure data consistency
3. **Visibility**: Today's Total helps track daily usage patterns
4. **Flexibility**: Additional notes field for edge cases
5. **Efficiency**: Bulk row selection and deletion
6. **User-Friendly**: 3 default rows reduce clicks for common operations
7. **Data Quality**: Validation only on filled rows prevents unnecessary errors

## Testing Checklist

- [ ] Open Kitchen Stock Out modal - verify 3 empty rows appear
- [ ] Select material - verify Current Stock and Today's Total populate
- [ ] Select reason from dropdown - verify all 3 options available
- [ ] Add optional notes - verify saves correctly
- [ ] Add multiple rows - verify checkbox selection works
- [ ] Remove selected rows - verify bulk deletion works
- [ ] Submit with empty rows - verify only filled rows are processed
- [ ] View details modal - verify reason displays with proper capitalization
- [ ] Verify Today's Total updates after stock out
- [ ] Test color coding for Current Stock (red/yellow/gray)
