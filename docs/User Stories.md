# User Stories & User Flows
## Gastronomix Inventory Management System

This document contains detailed user stories and user flows for each role in the system.

---

## User Story Format

Each user story follows the format:
- **As a** [role]
- **I want to** [action/goal]
- **So that** [benefit/value]

---

## Supervisor User Stories

### US-SUP-001: Allocate Inventory to Outlet
**As a** Supervisor  
**I want to** allocate raw materials from main inventory to an outlet (after reviewing paper request slips)  
**So that** the outlet receives the allocated materials and inventory is properly tracked

**Acceptance Criteria:**
- Supervisor can create a new allocation directly
- Can select an outlet (filtered by their cloud kitchen)
- Can add multiple raw materials with quantities
- Can see available inventory quantities for each material
- System validates sufficient stock before allocation
- Allocation reduces main inventory automatically
- Allocation record is created with timestamp and user
- Can add notes to allocation

**User Flow:**
1. Supervisor reviews paper request slips from outlets
2. Supervisor navigates to "Allocations" → "Create New Allocation"
3. Selects outlet from dropdown (filtered by cloud kitchen)
4. Adds raw materials (search/select from catalog)
5. Enters quantity for each material (system shows available stock)
6. Optionally adds notes
7. Clicks "Confirm Allocation"
8. System validates stock availability
9. If sufficient: Creates allocation, updates inventory
10. If insufficient: Shows error message with available quantity
11. Supervisor sees confirmation message

---

### US-SUP-002: View Allocation History
**As a** Supervisor  
**I want to** view history of all allocations I've made  
**So that** I can track what has been allocated and when

**Acceptance Criteria:**
- Supervisor sees all allocations for their cloud kitchen outlets
- Allocations are sortable by date, outlet
- Can filter by outlet, date range, raw material
- Shows allocation details (outlet, items, quantities, date, notes)

**User Flow:**
1. Supervisor navigates to "Allocations" → "History"
2. Views list of allocations (sorted by date, newest first)
3. Can click on allocation to see full details
4. Can filter/sort as needed

---

### US-SUP-003: View Consumption Analytics
**As a** Supervisor  
**I want to** view which outlets are consuming more/less resources  
**So that** I can make informed allocation decisions

**Acceptance Criteria:**
- Supervisor sees consumption reports for outlets in their cloud kitchen
- Can filter by date range, raw material, outlet
- Data presented in charts/graphs
- Shows comparative consumption across outlets
- Can export report data

**User Flow:**
1. Supervisor navigates to "Analytics" → "Consumption"
2. Selects date range (default: last 30 days)
3. Optionally filters by raw material or outlet
4. Views consumption chart/table
5. Identifies high/low consuming outlets
6. Uses insights for future allocations

---

### US-SUP-004: View Inventory Levels
**As a** Supervisor  
**I want to** view current inventory levels in the main stock  
**So that** I know what's available for allocation

**Acceptance Criteria:**
- Supervisor sees inventory levels for their cloud kitchen
- Can search/filter by raw material
- Shows quantities, units, last updated timestamp
- Highlights low stock items

**User Flow:**
1. Supervisor navigates to "Inventory" → "Main Stock"
2. Views inventory table/list
3. Can search for specific materials
4. Sees quantities and identifies low stock items

---

## Purchase Manager User Stories

### US-PM-001: All Supervisor Features (Inherited)
**As a** Purchase Manager  
**I want to** have access to all supervisor features  
**So that** I can perform supervisor duties when needed

**Acceptance Criteria:**
- Purchase Manager has access to all supervisor features
- Can log requests, allocate inventory, view analytics
- Same permissions and workflows as supervisor

---

### US-PM-002: Record Stock-In
**As a** Purchase Manager  
**I want to** record incoming stock and update inventory levels  
**So that** inventory levels are accurate and up-to-date

**Acceptance Criteria:**
- Purchase Manager can create stock-in entry
- Can add multiple raw materials with quantities
- Can enter supplier information, invoice number
- Can set unit costs for items
- System updates inventory automatically
- Stock-in record is saved with timestamp

**User Flow:**
1. Purchase Manager navigates to "Inventory" → "Stock-In"
2. Clicks "Add Stock-In"
3. Selects receipt date
4. Optionally enters supplier name, invoice number
5. Adds raw materials (search/select)
6. Enters quantity and unit cost for each
7. System calculates total cost
8. Optionally adds notes
9. Clicks "Save Stock-In"
10. System updates inventory levels
11. Confirmation message shown

---

### US-PM-003: View Low Stock Alerts
**As a** Purchase Manager  
**I want to** be alerted when inventory levels are running low  
**So that** I can reorder stock in time

**Acceptance Criteria:**
- Purchase Manager receives alerts when stock falls below threshold
- Alerts appear in dashboard/notifications
- Can view list of all low stock items
- Alerts include material name, current quantity, threshold
- Can navigate to inventory from alert

**User Flow:**
1. Purchase Manager logs into dashboard
2. Sees low stock alerts section/banner
3. Views list of materials below threshold
4. Clicks on alert to see details
5. Can navigate to stock-in to reorder

---

### US-PM-004: Configure Low Stock Thresholds
**As a** Purchase Manager  
**I want to** set low stock thresholds for raw materials  
**So that** I receive alerts at appropriate stock levels

**Acceptance Criteria:**
- Purchase Manager can set threshold per raw material
- Threshold is saved in inventory record
- Alerts trigger when stock <= threshold
- Can update threshold anytime

**User Flow:**
1. Purchase Manager navigates to "Inventory" → "Main Stock"
2. Selects a raw material
3. Clicks "Edit Threshold" or "Configure Alert"
4. Enters threshold quantity
5. Clicks "Save"
6. Threshold is updated

---

### US-PM-005: Add New Raw Material
**As a** Purchase Manager  
**I want to** add a new raw material to the catalog  
**So that** I can track new types of inventory

**Acceptance Criteria:**
- Purchase Manager can access "Raw Materials" → "Add New"
- Can enter material name, code, unit, category
- Material is added to catalog
- Can immediately use in stock-in and requests

**User Flow:**
1. Purchase Manager navigates to "Catalog" → "Raw Materials"
2. Clicks "Add New Material"
3. Enters name, code, unit (kg, liter, piece, etc.)
4. Optionally selects category, adds description
5. Clicks "Save"
6. Material appears in catalog

---

### US-PM-006: Update Raw Material Cost
**As a** Purchase Manager  
**I want to** update the per-unit cost of raw materials  
**So that** cost tracking is accurate

**Acceptance Criteria:**
- Purchase Manager can view current cost per material
- Can update cost with effective date
- Cost history is maintained
- New cost applies to future stock-in transactions

**User Flow:**
1. Purchase Manager navigates to "Catalog" → "Raw Materials"
2. Selects a material
3. Views current cost
4. Clicks "Update Cost"
5. Enters new cost per unit
6. Optionally sets effective date
7. Clicks "Save"
8. Cost is updated, history maintained

---

### US-PM-007: View Stock-In History
**As a** Purchase Manager  
**I want to** view history of all stock-in transactions  
**So that** I can track purchases and receipts

**Acceptance Criteria:**
- Purchase Manager sees list of all stock-in transactions
- Can filter by date range, supplier, raw material
- Shows details: date, items, quantities, costs, total
- Can view individual transaction details

**User Flow:**
1. Purchase Manager navigates to "Inventory" → "Stock-In History"
2. Views list of transactions (sorted by date, newest first)
3. Can filter by date range
4. Clicks on transaction to see full details
5. Can export data if needed

---

## Admin User Stories

### US-ADM-001: All Purchase Manager Features (Inherited)
**As an** Admin  
**I want to** have access to all purchase manager and supervisor features  
**So that** I can perform any operation when needed

**Acceptance Criteria:**
- Admin has access to all features from other roles
- Can switch between cloud kitchens (or see all)

---

### US-ADM-002: View Cross-Cloud Kitchen Analytics
**As an** Admin  
**I want to** view analytics across all cloud kitchens  
**So that** I can compare performance and identify trends

**Acceptance Criteria:**
- Admin sees aggregated data from all cloud kitchens
- Can compare cloud kitchens side-by-side
- Shows metrics: consumption, inventory levels, allocations
- Can drill down to specific cloud kitchen

**User Flow:**
1. Admin navigates to "Analytics" → "Overview"
2. Views dashboard with key metrics
3. Sees data aggregated across all cloud kitchens
4. Can filter by date range
5. Can click on cloud kitchen to drill down

---

### US-ADM-003: View Detailed Outlet Analytics
**As an** Admin  
**I want to** view detailed consumption and performance data for each outlet  
**So that** I can identify patterns and optimize operations

**Acceptance Criteria:**
- Admin sees detailed analytics per outlet
- Can compare outlets across cloud kitchens
- Shows consumption trends, patterns
- Can filter by multiple dimensions
- Can export detailed reports

**User Flow:**
1. Admin navigates to "Analytics" → "Outlets"
2. Views list/grid of outlets
3. Selects outlet to see detailed analytics
4. Views consumption charts, trends
5. Can compare with other outlets
6. Can export report

---

### US-ADM-004: View Staff Activity Reports
**As an** Admin  
**I want to** view activity reports for supervisors and purchase managers  
**So that** I can monitor productivity and operations

**Acceptance Criteria:**
- Admin sees activity summary per user
- Shows requests logged, allocations made, stock-in entries
- Can filter by user, date range
- Shows timeline of activities

**User Flow:**
1. Admin navigates to "Analytics" → "Staff Activity"
2. Views list of users (supervisors, purchase managers)
3. Selects user to see activity details
4. Views activities: requests, allocations, stock-in
5. Can see activity timeline

---

### US-ADM-005: Manage Users
**As an** Admin  
**I want to** create, edit, and manage user accounts  
**So that** I can onboard new staff and maintain access control

**Acceptance Criteria:**
- Admin can create new users (supervisor, purchase manager)
- Can assign users to cloud kitchens
- Can edit user details, deactivate users
- Can view list of all users
- User roles are enforced

**User Flow:**
1. Admin navigates to "Settings" → "Users"
2. Views list of all users
3. Clicks "Add User"
4. Enters user details (name, email, role)
5. Selects cloud kitchen (if not admin)
6. Clicks "Create User"
7. User receives invitation email (if applicable)
8. Can edit/deactivate users from list

---

### US-ADM-006: Configure System Settings
**As an** Admin  
**I want to** configure system-wide settings  
**So that** the system operates according to business requirements

**Acceptance Criteria:**
- Admin can access system settings
- Can configure defaults, preferences
- Settings are saved and applied system-wide

**User Flow:**
1. Admin navigates to "Settings" → "System"
2. Views system configuration options
3. Updates settings as needed
4. Clicks "Save"
5. Changes are applied

---

### US-ADM-007: Export Reports
**As an** Admin  
**I want to** export analytics and reports to various formats  
**So that** I can share data with stakeholders

**Acceptance Criteria:**
- Admin can export reports to PDF, CSV, Excel
- Exported data matches on-screen data
- Export includes selected filters/parameters
- Files are properly formatted

**User Flow:**
1. Admin views any analytics/report page
2. Applies desired filters
3. Clicks "Export" button
4. Selects format (PDF, CSV, Excel)
5. File downloads
6. Opens file to verify

---

## Common User Flows

### Authentication Flow
1. User navigates to login page
2. Enters email and password
3. System authenticates via Supabase Auth
4. System fetches user role and cloud_kitchen_id
5. User redirected to role-appropriate dashboard
6. Session maintained with JWT token

### Navigation Flow
1. User logs in
2. Sees dashboard with role-specific widgets
3. Can navigate via sidebar/menu:
   - Requests
   - Inventory
   - Allocations
   - Analytics
   - Settings (if applicable)
4. Breadcrumbs show current location

### Error Handling Flow
1. User action triggers error
2. System catches error
3. User-friendly error message displayed
4. Error logged (for debugging)
5. User can retry or navigate away

---

## User Experience Considerations

### Responsive Design
- Desktop-first design (primary use case)
- Mobile-responsive for on-the-go access
- Tables scroll horizontally on small screens

### Loading States
- Show loading spinners for async operations
- Skeleton screens for initial page loads
- Progress indicators for bulk operations

### Feedback & Confirmation
- Success messages after successful operations
- Confirmation dialogs for destructive actions
- Inline validation for form inputs
- Clear error messages

### Accessibility
- Keyboard navigation support
- Screen reader friendly
- High contrast mode
- Clear labels and instructions

---

## Edge Cases & Error Scenarios

### Insufficient Stock
- User tries to allocate more than available
- System shows error with available quantity
- User can adjust allocation or cancel

### Concurrent Updates
- Multiple users update same inventory
- System uses database transactions/locks
- Last write wins or conflict resolution

### Network Errors
- User loses connection during operation
- System shows retry option
- Data saved locally if possible (optional)

### Invalid Data
- User enters invalid quantities (negative, zero)
- Form validation prevents submission
- Clear error messages shown


