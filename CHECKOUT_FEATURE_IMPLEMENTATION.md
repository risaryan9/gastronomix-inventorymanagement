# Supervisor Checkout Feature - Implementation Summary

## Overview
The Supervisor Checkout feature allows supervisors to create checkout forms for locked dispatch plans, tracking returned materials, wastage, and additional financial information. The feature automatically updates cloud kitchen inventory when checkout forms are confirmed.

## Database Schema

### Tables Created

#### 1. `checkout_form` (Master Table)
- **Purpose**: Stores form-level details for each checkout
- **Key Columns**:
  - `id` (UUID, Primary Key)
  - `dispatch_plan_id` (UUID, Foreign Key to dispatch_plan) - UNIQUE constraint ensures one checkout per dispatch plan
  - `cloud_kitchen_id` (UUID, Foreign Key to cloud_kitchens)
  - `plan_date` (DATE)
  - `status` (TEXT) - Values: 'draft', 'submitted', 'confirmed'
  - `supervisor_name` (TEXT) - Name entered by supervisor
  - `created_by` (UUID, Foreign Key to users)
  - `created_at`, `updated_at`, `confirmed_at` (TIMESTAMPTZ)

#### 2. `checkout_form_return_items`
- **Purpose**: Stores returned quantities per outlet and material
- **Key Columns**:
  - `id` (UUID, Primary Key)
  - `checkout_form_id` (UUID, Foreign Key to checkout_form)
  - `outlet_id` (UUID, Foreign Key to outlets)
  - `raw_material_id` (UUID, Foreign Key to raw_materials)
  - `dispatched_quantity` (NUMERIC) - Snapshot from dispatch_plan_items
  - `returned_quantity` (NUMERIC) - Quantity returned
  - `notes` (TEXT, Optional)
  - UNIQUE constraint on (checkout_form_id, outlet_id, raw_material_id)

#### 3. `checkout_form_wastage_items`
- **Purpose**: Tracks wastage quantities (for analytics only, does not affect inventory)
- **Key Columns**:
  - `id` (UUID, Primary Key)
  - `checkout_form_id` (UUID, Foreign Key to checkout_form)
  - `outlet_id` (UUID, Foreign Key to outlets)
  - `raw_material_id` (UUID, Foreign Key to raw_materials)
  - `dispatched_quantity` (NUMERIC, Optional)
  - `wasted_quantity` (NUMERIC)
  - `wastage_reason` (TEXT, Optional)
  - UNIQUE constraint on (checkout_form_id, outlet_id, raw_material_id)

#### 4. `checkout_form_additional`
- **Purpose**: Stores financial information per outlet
- **Key Columns**:
  - `id` (UUID, Primary Key)
  - `checkout_form_id` (UUID, Foreign Key to checkout_form)
  - `outlet_id` (UUID, Foreign Key to outlets)
  - `cash` (NUMERIC(12,2)) - Cash collected
  - `payment_onside` (NUMERIC(12,2)) - Payment onside amount
  - `notes` (TEXT, Optional)
  - UNIQUE constraint on (checkout_form_id, outlet_id)

### Row Level Security (RLS)
All four tables have RLS enabled with policies for:
- **Admin**: Full access to all operations
- **Supervisor & Purchase Manager**: Access to their own cloud kitchen's data

### Indexes
Created indexes on:
- Foreign key columns for efficient joins
- `status` and `plan_date` for filtering
- All unique constraint columns

## Backend Logic

### `confirm_checkout_form(p_checkout_form_id UUID)` Function

**Purpose**: Atomically confirms a checkout form and updates inventory

**Process**:
1. Validates checkout form exists and is not already confirmed
2. Validates dispatch plan is locked and within 24-hour window
3. Creates a `stock_in` record with type 'kitchen'
4. Aggregates returned quantities by material
5. For each material:
   - Fetches the last `stock_in_batches` entry to get `unit_cost`
   - Defaults to 0 if no previous batch exists
   - Creates new `stock_in_batches` with:
     - `gst_percent` = 0
     - `unit_cost` from last batch
     - `quantity_purchased` = `quantity_remaining` = total returned
6. Updates checkout_form status to 'confirmed'
7. Creates audit log entry
8. Returns JSON with success status and details

**Inventory Impact**:
- The existing inventory sync trigger on `stock_in_batches` automatically updates the `inventory` table
- Returned materials are added back to cloud kitchen inventory

## Frontend Implementation

### Navigation
- Added "Check Out" tab to Supervisor Dashboard navbar
- Route: `/invmanagement/dashboard/supervisor/checkout`

### Main Checkout Page (`/frontend/src/pages/supervisor/Checkout.jsx`)

**Features**:
1. **Available Dispatch Plans Section**:
   - Shows locked dispatch plans from last 24 hours
   - Indicates if checkout already exists
   - "Create Checkout" button for eligible plans

2. **Previous Checkouts Section**:
   - Lists all previous checkout forms
   - Shows status (draft/submitted/confirmed)
   - Displays supervisor name and dates

3. **Multi-Step Checkout Modal** (3 steps):
   
   **Step 1: Return Quantities**
   - Table showing all dispatched items
   - Columns: Outlet, Material, Dispatched Qty (read-only), Returned Qty (input)
   - Only shows items that were actually dispatched
   
   **Step 2: Wastage Quantities**
   - Similar table structure for wastage tracking
   - Columns: Outlet, Material, Dispatched Qty (read-only), Wasted Qty (input)
   
   **Step 3: Additional Information**
   - Card for each outlet with:
     - Cash input field
     - Payment Onside input field
   - Supervisor Name text input (required)

4. **Review Modal**:
   - Read-only summary of all entered data
   - Grouped by: Return Items, Wastage Items, Additional Info
   - Shows only non-zero entries
   - "Back to Edit" and "Confirm" buttons

5. **Final Confirmation Modal**:
   - Warning message about inventory alteration
   - Final confirmation before submitting

### User Flow
1. Supervisor navigates to "Check Out" tab
2. Sees available locked dispatch plans
3. Clicks "Create Checkout" on a plan
4. Fills out 3-step form:
   - Enter return quantities
   - Enter wastage quantities
   - Enter financial info and supervisor name
5. Reviews all data in summary modal
6. Confirms with final warning
7. System creates checkout form and calls `confirm_checkout_form` RPC
8. Inventory is automatically updated
9. Success message displayed

## Files Created/Modified

### Database Migrations
- `/migrations/create-checkout-tables.sql` - Creates all 4 tables with RLS and indexes
- `/migrations/create-confirm-checkout-function.sql` - Creates the confirmation function

### Frontend Files
- **Modified**:
  - `/frontend/src/pages/SupervisorDashboard.jsx` - Added navigation tabs
  - `/frontend/src/App.jsx` - Added checkout route and import
  
- **Created**:
  - `/frontend/src/pages/supervisor/Checkout.jsx` - Main checkout component (700+ lines)

## Key Features

### Data Validation
- Checkout can only be created for locked dispatch plans
- Dispatch plan must be locked within last 24 hours
- Supervisor name is required
- All quantities must be non-negative
- Idempotency: Cannot confirm same checkout twice

### Inventory Management
- Returns automatically create `stock_in` batches
- Unit cost derived from last batch for same material
- GST percent always 0 for returns
- Inventory sync happens automatically via existing trigger

### Analytics Support
- Wastage tracking (doesn't affect inventory)
- Financial data (cash, payment onside) per outlet
- Audit logs for all confirmations
- Historical checkout data preserved

## Testing Checklist

- [ ] Create checkout form for locked dispatch plan
- [ ] Verify 24-hour window validation
- [ ] Test return quantity entry and validation
- [ ] Test wastage quantity entry
- [ ] Test additional info (cash, payment onside)
- [ ] Verify review modal shows correct data
- [ ] Test final confirmation
- [ ] Verify inventory is updated correctly
- [ ] Check unit_cost is fetched from last batch
- [ ] Verify GST is 0 for return batches
- [ ] Test RLS policies (supervisor can only see own kitchen)
- [ ] Verify audit log creation
- [ ] Test idempotency (cannot confirm twice)
- [ ] Test UI responsiveness on mobile

## Future Enhancements

1. Add ability to edit draft checkouts
2. Add checkout form detail view
3. Add wastage analytics dashboard
4. Add export functionality for checkout data
5. Add notifications for pending checkouts
6. Add bulk checkout operations

## Notes

- Wastage data is for tracking only and does not affect inventory
- Additional financial info is stored for future analytics features
- The feature maintains consistency with existing dispatch plan UI/UX
- All database operations are atomic and use transactions
- RLS ensures data isolation between cloud kitchens
