# Gastronomix Inventory Management – Comprehensive Test Cases

Detailed test cases covering every feature, screen, and edge case. Use as a manual testing checklist or reference for automation.

**How to use:** Mark items with `[x]` when passed. Note failures with environment (browser, role, cloud kitchen). Run smoke set first after deploys; run full suite for releases.

---

## Table of Contents

1. [Login & Authentication](#1-login--authentication)
2. [Dashboards & Navigation](#2-dashboards--navigation)
3. [Overview (Purchase Manager)](#3-overview-purchase-manager)
4. [Stock In (Purchase Slip)](#4-stock-in-purchase-slip)
5. [Stock Out](#5-stock-out)
6. [Self Stock Out](#6-self-stock-out)
7. [Inventory (Purchase Manager)](#7-inventory-purchase-manager)
8. [Materials (Purchase Manager)](#8-materials-purchase-manager)
9. [Outlets](#9-outlets)
10. [Outlet Details – Allocation Requests](#10-outlet-details--allocation-requests)
11. [Supervisor – Raw Materials](#11-supervisor--raw-materials)
12. [Supervisor – Inventory](#12-supervisor--inventory)
13. [Admin Dashboard](#13-admin-dashboard)
14. [Alerts, Modals & Global Behaviour](#14-alerts-modals--global-behaviour)
15. [Double-Submit & Loading States](#15-double-submit--loading-states)
16. [Edge Cases & Error Handling](#16-edge-cases--error-handling)
17. [Quick Smoke Checklist](#17-quick-smoke-checklist)

---

## 1. Login & Authentication

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 1.1 | Login type selection | Open login page. | Screen shows Gastronomix title and three options: Admin, Purchase Manager, Supervisor. | [ ] |
| 1.2 | Admin login form | Click "Admin". | Form shows email and password fields (no login key, no cloud kitchen). | [ ] |
| 1.3 | Admin login success | Enter valid admin email and password, submit. | Redirect to `/invmanagement/dashboard/admin`; session stored. | [ ] |
| 1.4 | Admin login invalid | Enter wrong email/password, submit. | Error message (e.g. "Invalid login credentials" or "Unauthorized"); stay on login. | [ ] |
| 1.5 | PM/Supervisor – cloud kitchen list | Click "Purchase Manager" or "Supervisor". | Form shows cloud kitchen dropdown and login key field; dropdown loads active cloud kitchens. | [ ] |
| 1.6 | Key login – cloud kitchen required | Select no cloud kitchen (or leave default empty if any), enter key, submit. | Error "Please select a cloud kitchen"; no redirect. | [ ] |
| 1.7 | Key login – key required | Select cloud kitchen, leave key empty, submit. | Error "Please enter your login key"; no redirect. | [ ] |
| 1.8 | Key login success (PM) | Select cloud kitchen, enter valid PM key, submit. | Redirect to `/invmanagement/dashboard/purchase_manager`; session has role and cloud_kitchen_id. | [ ] |
| 1.9 | Key login success (Supervisor) | Select cloud kitchen, enter valid Supervisor key, submit. | Redirect to `/invmanagement/dashboard/supervisor`; session has role and cloud_kitchen_id. | [ ] |
| 1.10 | Key login invalid key | Valid cloud kitchen, wrong key, submit. | Error (e.g. "Invalid login key or user not found"); stay on login. | [ ] |
| 1.11 | Back / change login type | After choosing PM or Supervisor, go back to type selection (if UI allows). | Returns to three-option screen; form resets. | [ ] |
| 1.12 | Protected route without session | Clear session/localStorage; open `/invmanagement/dashboard/purchase_manager/stock-in`. | Redirect to login (or appropriate auth). | [ ] |
| 1.13 | Root redirect when logged in | Log in as PM, then visit `/invmanagement`. | Redirect to `/invmanagement/dashboard/purchase_manager`. | [ ] |
| 1.14 | Root redirect when not logged in | Log out, visit `/`. | Redirect to `/invmanagement` then to login. | [ ] |

---

## 2. Dashboards & Navigation

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 2.1 | PM dashboard sidebar | Log in as PM. | Sidebar shows: Overview, Stock In, Stock Out, Materials, Inventory, Outlets; logo and user/role/cloud kitchen. | [ ] |
| 2.2 | PM nav links | Click each sidebar link (Overview, Stock In, Stock Out, Materials, Inventory, Outlets). | Each route loads; URL and content match. | [ ] |
| 2.3 | PM default route | Log in as PM, land on dashboard. | Default sub-route is Overview (e.g. `.../purchase_manager/overview`). | [ ] |
| 2.4 | PM logout | Click Logout. | Session cleared; redirect to `/invmanagement/login`. | [ ] |
| 2.5 | PM mobile menu | Resize to mobile; click hamburger. | Sidebar opens; can navigate and close. | [ ] |
| 2.6 | Supervisor dashboard sidebar | Log in as Supervisor. | Sidebar shows: Outlets, Raw Materials (no Stock In/Materials/Inventory). | [ ] |
| 2.7 | Supervisor nav links | Click Outlets and Raw Materials. | Each page loads correctly. | [ ] |
| 2.8 | Supervisor logout | Click Logout. | Session cleared; redirect to login. | [ ] |
| 2.9 | Admin dashboard | Log in as Admin. | Admin dashboard with session info and cards (e.g. Manage Users, View Inventory, Reports). | [ ] |
| 2.10 | Admin logout | Click Logout. | Supabase auth sign-out (if auth login); session cleared; redirect to login. | [ ] |
| 2.11 | Wrong role URL (PM route as Supervisor) | As Supervisor, open `/invmanagement/dashboard/purchase_manager/stock-in`. | Blocked or redirect (per ProtectedRoute config). | [ ] |

---

## 3. Overview (Purchase Manager)

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 3.1 | Overview loads | As PM, go to Overview. | Page loads without error. | [ ] |
| 3.2 | Stats cards | Check stat cards. | Total Materials, Stock In This Month, Low Stock Items, Total Value (and any others) show numbers or zero. | [ ] |
| 3.3 | Recent Stock In | Check "Recent Stock In" section. | Up to 5 recent stock-in records with date and total cost; or empty state. | [ ] |
| 3.4 | Recent Allocations | Check "Recent Allocations" section. | Recent stock-out/allocation entries with outlet and date; or empty state. | [ ] |
| 3.5 | Links to Stock In / Stock Out | Click "View all" or similar link to Stock In / Stock Out (if present). | Navigates to correct page. | [ ] |
| 3.6 | No cloud kitchen | If session has no cloud_kitchen_id (e.g. admin). | No crash; loading ends; may show empty or message. | [ ] |

---

## 4. Stock In (Purchase Slip)

### 4.1 Page & List

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 4.1.1 | Stock In page load | As PM, go to Stock In. | Header "Stock In", "Add New Purchase Slip" button, filters, table or empty state. | [ ] |
| 4.1.2 | Search filter | Type in "Search (Invoice # or Supplier)". | List filters by invoice number or supplier name (as you type or on apply). | [ ] |
| 4.1.3 | Item count filter | Select "1-5 items", "6-10 items", "11+ items". | List shows only records with that item count. | [ ] |
| 4.1.4 | Total cost filter | Select a cost range (e.g. ₹0–1,000). | List filters by total cost. | [ ] |
| 4.1.5 | Date range – preset | Select Today, This Week, This Month. | List filters by receipt_date. | [ ] |
| 4.1.6 | Date range – custom | Select "Custom Range", set From and To dates. | List filters by custom range. | [ ] |
| 4.1.7 | Clear filters | Apply filters, then click "Clear filters" (or equivalent). | All filters reset; full list shown. | [ ] |
| 4.1.8 | Pagination | If more than one page, click Next/Previous or page number. | Page changes; correct slice of records shown. | [ ] |
| 4.1.9 | Empty list | When no records match filters. | Message like "No stock in records found" or "Try adjusting filters". | [ ] |

### 4.2 Add Purchase Slip Modal

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 4.2.1 | Open Add modal | Click "+ Add New Purchase Slip". | Modal opens with: Supplier, Receipt Date, Invoice Number, Notes; item table with Add Row. | [ ] |
| 4.2.2 | Supplier dropdown | Open supplier/vendor dropdown. | List of vendors; selecting one sets supplier. | [ ] |
| 4.2.3 | Receipt date | Set receipt date (default today). | Date is used on submit. | [ ] |
| 4.2.4 | Invoice and notes | Enter invoice number and notes. | Values retained; saved with slip. | [ ] |
| 4.2.5 | Add Row | Click "Add Row". | New empty row with material cell, quantity, unit cost, total, remove. | [ ] |
| 4.2.6 | Material search popup | In a row, click "Select material...". | Popup with search input; list of materials; selecting one fills row (name, unit). | [ ] |
| 4.2.7 | Material search filters | In popup, type in search. | List filters by material name/code. | [ ] |
| 4.2.8 | Material popup – click outside | Open popup, click outside. | Popup closes. | [ ] |
| 4.2.9 | Quantity and unit cost | Enter quantity and unit cost for a row. | Row total and grand total update. | [ ] |
| 4.2.10 | Previous cost display | For a material that has prior batches. | "Previous cost" or similar shows last unit cost (if implemented). | [ ] |
| 4.2.11 | Remove row | Click remove (trash) on a row. | Row removed; totals recalc. | [ ] |
| 4.2.12 | Bulk remove (if present) | Select rows with checkbox, click "Remove selected" or similar. | Selected rows removed. | [ ] |
| 4.2.13 | Close Add modal | Click Cancel or X. | Modal closes; list unchanged. | [ ] |

### 4.3 Finalize & Confirm

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 4.3.1 | Finalize with valid data | Add at least one item (material + qty + unit cost), supplier, date; click "Finalize Purchase Slip". | Confirm Purchase Slip modal opens with summary (date, supplier, invoice, items list, total cost). | [ ] |
| 4.3.2 | Confirm without supplier | Leave supplier empty; add items; reach confirm (if possible) and click "Confirm & Create". | Alert "Please select a supplier"; **button returns to "Confirm & Create"** (not stuck on "Creating…"). | [ ] |
| 4.3.3 | Confirm without receipt date | Omit receipt date; trigger confirm. | Validation message; loading state reset. | [ ] |
| 4.3.4 | Confirm with no items | No valid items (or "Please add at least one item" validation). | Alert; no create; state reset. | [ ] |
| 4.3.5 | Confirm with invalid quantity | Set quantity ≤ 0 for an item. | Validation error for that item; state reset. | [ ] |
| 4.3.6 | Confirm with invalid unit cost | Set unit cost ≤ 0. | Validation error; state reset. | [ ] |
| 4.3.7 | Confirm & Create success | Valid data; click "Confirm & Create" once. | One stock_in created; batches and inventory updated; modals close; list refreshes; success message. | [ ] |
| 4.3.8 | Confirm & Create – no duplicate on double-click | Valid data; double-click "Confirm & Create". | Only one stock_in (and related batches); button shows "Creating…" then resets. | [ ] |
| 4.3.9 | Cancel confirm | In confirm modal, click Cancel. | Confirm modal closes; Add modal still open with data. | [ ] |
| 4.3.10 | Cancel disabled while creating | Click Confirm & Create; immediately try Cancel. | Cancel disabled or modal does not close until request finishes. | [ ] |

### 4.4 View Details Modal

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 4.4.1 | Open View Details | In list, click "View Details" on a record. | Modal opens with: receipt date, created at, supplier, invoice number, batches table (material, qty, unit cost). | [ ] |
| 4.4.2 | Close View Details | Click X or outside. | Modal closes. | [ ] |

---

## 5. Stock Out

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 5.1 | Stock Out page load | As PM, go to Stock Out. | "Self Stock Out" card at top; filters (Date Range, Status); table of allocation requests. | [ ] |
| 5.2 | Self Stock Out card visible | Check top section. | Card with description and "+ Self Stock Out" button. | [ ] |
| 5.3 | Date filter | Change date (Today / This Week / This Month). | Request list updates by request_date. | [ ] |
| 5.4 | Status filter | Select Unpacked (Pending) / Packed (Completed) / All. | List filters by is_packed. | [ ] |
| 5.5 | Allocation requests table | Check table columns. | Request Date, Outlet, Requested By, Items count, Status, Actions (Allocate Stock or Completed). | [ ] |
| 5.6 | Open Allocate Stock | Click "Allocate Stock" on a pending request. | Modal with header (outlet, date); table: Material, Requested, Today's Total, Current Stock, Allocate Qty. | [ ] |
| 5.7 | Allocate qty pre-filled | Open allocate modal. | Allocate qty defaults to requested (or current stock cap); can edit. | [ ] |
| 5.8 | Allocate within stock | Set allocate qty ≤ current stock for each item; click "Confirm Allocation". | One stock_out; request marked packed; inventory and batches decremented (FIFO); success; modal closes. | [ ] |
| 5.9 | Allocate over stock | Set one item above current stock; submit. | Error with available qty; no stock_out created. | [ ] |
| 5.10 | Allocate zero/negative | Set allocate qty 0 or negative; submit. | Validation error; no create. | [ ] |
| 5.11 | No duplicate allocation | Double-click "Confirm Allocation". | Only one stock_out; button shows "Allocating…" then resets. | [ ] |
| 5.12 | Cancel allocate modal | Open allocate modal; click Cancel or X. | Modal closes; list unchanged. | [ ] |
| 5.13 | Packed request – no Allocate | For a packed request. | Actions show "Completed" or similar; no Allocate button. | [ ] |
| 5.14 | Empty state | When no allocation requests (for filters). | Message like "No allocation requests found". | [ ] |

---

## 6. Self Stock Out

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 6.1 | Open Self Stock Out modal | Click "+ Self Stock Out". | Modal: title "Self Stock Out"; Reason (required) textarea; "+ Add Row"; materials table or empty state. | [ ] |
| 6.2 | Reason required | Add row and material + qty; leave Reason empty; try submit. | "Confirm Self Stock Out" disabled or validation error; no create. | [ ] |
| 6.3 | Add Row | Click "+ Add Row". | New row: Material (Select material…), Current Stock, Quantity, Actions (remove). | [ ] |
| 6.4 | Material search popup | In row, click "Select material...". | Same-style popup as Stock In; search filters materials; already-selected-in-other-rows disabled. | [ ] |
| 6.5 | Current Stock column | Select a material in a row. | Current Stock column shows that material's inventory qty (and unit); updates when material selected. | [ ] |
| 6.6 | Out of stock styling | Select material with 0 stock. | Current Stock shows 0 and warning (e.g. "Out of stock") in red or similar. | [ ] |
| 6.7 | Enter quantity | Enter quantity in row. | Accepts decimal; unit shown. | [ ] |
| 6.8 | Remove row | Click remove on a row. | Row removed. | [ ] |
| 6.9 | Submit without materials | Enter reason only; no rows or all rows empty material. | Validation or disabled submit. | [ ] |
| 6.10 | Submit with qty > stock | Reason + one material with qty greater than current stock; submit. | Error (e.g. insufficient stock with available qty); no create. | [ ] |
| 6.11 | Submit success | Reason + at least one material with valid qty ≤ stock; click "Confirm Self Stock Out". | One stock_out (self_stock_out=true, reason set); inventory and batches decremented; success; modal closes. | [ ] |
| 6.12 | No duplicate on double-click | Valid data; double-click confirm. | Only one self stock out; button shows "Processing…" then resets. | [ ] |
| 6.13 | Cancel | Click Cancel. | Modal closes; no create. | [ ] |

---

## 7. Inventory (Purchase Manager)

### 7.1 List & Filters

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 7.1.1 | Inventory page load | As PM, go to Inventory. | Stats (Total Materials, Stock In This Month, Low Stock, Total Value); search; category and stock level filters; table; Export. | [ ] |
| 7.1.2 | Search | Type in search (material name or code). | List filters in real time. | [ ] |
| 7.1.3 | Category filter | Select a category. | Only materials in that category. | [ ] |
| 7.1.4 | Stock level filter | Select In Stock / Low Stock / Out of Stock. | List filters by quantity vs low_stock_threshold and zero. | [ ] |
| 7.1.5 | Table columns | Check table. | Material, Code, Category, Quantity, Unit, Low Stock Threshold, Status, Actions. | [ ] |
| 7.1.6 | Status badges | Check status column. | In Stock / Low Stock / Out of Stock (or equivalent) per row. | [ ] |
| 7.1.7 | Pagination | If multiple pages, use Previous/Next. | Page updates correctly. | [ ] |
| 7.1.8 | Empty state | Filters yield no rows. | Message e.g. "No items match your current filters." | [ ] |

### 7.2 Edit / Adjust

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 7.2.1 | Open edit | Click Edit or Adjust on a row. | Edit modal opens with current quantity and field for new quantity. | [ ] |
| 7.2.2 | Change quantity | Enter new quantity (e.g. 0 or different value). | Can proceed to confirm (e.g. "Update" or "Confirm"). | [ ] |
| 7.2.3 | Confirm adjustment modal | Proceed to confirm. | Modal shows: material name, code, unit; **Current Quantity**; **New Quantity**; **Decrease/Increase**; **Reason** (required); **no "Additional Details"**; **no "Adjustment Type"** block; warning that action will be logged. | [ ] |
| 7.2.4 | Reason required | Leave Reason empty; try confirm. | "Confirm & Update" disabled or validation error. | [ ] |
| 7.2.5 | Confirm & Update success | Enter reason; click "Confirm & Update". | Inventory row updated; modals close; list refreshes; success message; audit log entry. | [ ] |
| 7.2.6 | Warning text | In confirm modal. | Warning states inventory will increase or decrease and action will be logged. | [ ] |
| 7.2.7 | Cancel edit | Close edit or confirm modal without submitting. | No change to inventory. | [ ] |

### 7.3 Export

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 7.3.1 | Open Export modal | Click "Export". | Modal "Export Inventory" with options (e.g. CSV, Excel, PDF). | [ ] |
| 7.3.2 | Export CSV | Select CSV (if present); confirm. | File downloads; data matches current view/filters. | [ ] |
| 7.3.3 | Export Excel | Select Excel; confirm. | File downloads; content correct. | [ ] |
| 7.3.4 | Export PDF | Select PDF; confirm. | "Generating PDF…" or similar; file downloads. | [ ] |
| 7.3.5 | Close Export modal | Click Cancel or X. | Modal closes. | [ ] |

---

## 8. Materials (Purchase Manager)

### 8.1 List & Filters

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 8.1.1 | Materials page load | As PM, go to Materials. | Header; "+ Add New Material"; search; category filter; table (Name, Code, UOM, Category, Brand, Low Stock Threshold, Actions). | [ ] |
| 8.1.2 | Search | Type in search (name, code, or description). | List filters. | [ ] |
| 8.1.3 | Category filter | Select category. | List filters by category. | [ ] |
| 8.1.4 | Pagination | If total pages > 1, use Previous/Next or page numbers. | Correct page and "Showing X to Y of Z". | [ ] |
| 8.1.5 | Empty state | No materials or no match. | Message e.g. "No materials match your filters" or "Add your first material". | [ ] |

### 8.2 Add Material

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 8.2.1 | Open Add Material | Click "+ Add New Material". | Form modal: Name, Code, Unit, Category, Description, Low Stock Threshold, Vendor (if present). | [ ] |
| 8.2.2 | Required fields | Leave name or code empty; try Continue. | Validation error or disabled. | [ ] |
| 8.2.3 | Vendor required (if enforced) | Leave vendor empty when required; submit. | Error e.g. "Vendor is required". | [ ] |
| 8.2.4 | Continue to confirm | Fill required fields; click "Continue". | Confirm modal with summary. | [ ] |
| 8.2.5 | Confirm & Create Material | Click "Confirm & Create Material" once. | One raw_material created; modals close; list refreshes; success message. | [ ] |
| 8.2.6 | No duplicate on double-click | Double-click "Confirm & Create Material". | Only one material created; button shows "Creating…" then resets. | [ ] |
| 8.2.7 | Duplicate code | Create material with existing code. | Error (e.g. duplicate code); no create. | [ ] |
| 8.2.8 | Cancel Add | Close form or confirm without submitting. | No new material. | [ ] |

### 8.3 Edit Material

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 8.3.1 | Open Edit | Click "Edit" on a material. | Form opens with existing values (name, code, unit, category, etc.). | [ ] |
| 8.3.2 | Update and save | Change fields; save (no confirm modal for edit if not used). | Material updated; list and dropdowns elsewhere reflect change. | [ ] |
| 8.3.3 | Edit cancel | Open edit; close without saving. | No change. | [ ] |

---

## 9. Outlets

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 9.1 | Outlets page (PM) | As PM, go to Outlets. | Brand selection (e.g. Nippu Kodi, El Chaapo, Boom Pizza); after brand, outlet list. | [ ] |
| 9.2 | Outlets page (Supervisor) | As Supervisor, go to Outlets. | Same brand selection and list behaviour. | [ ] |
| 9.3 | Select brand | Click a brand. | Outlets for that brand (code prefix) load; count shown. | [ ] |
| 9.4 | Search outlets | Enter text in search. | List filters by name or address. | [ ] |
| 9.5 | Clear search | After searching, clear search. | Full list for brand shown again. | [ ] |
| 9.6 | Outlet card/row | Check each outlet. | Name, code, address (if shown); "View Details" or "View Details & Allocate". | [ ] |
| 9.7 | Navigate to outlet details | Click outlet or "View Details". | Navigate to outlet details page (e.g. `outlets/:outletId`). | [ ] |
| 9.8 | No outlets | Brand with no outlets. | Message e.g. "No outlets match" or "No outlets found". | [ ] |

---

## 10. Outlet Details – Allocation Requests

**Applies to both Purchase Manager and Supervisor where allocation requests are created/edited.**

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 10.1 | Outlet details load | Open an outlet (from Outlets list). | Back button; outlet info (name, code, address, contact, phone); "Create Allocation Request" or "Edit Today's Request"; allocation requests list. | [ ] |
| 10.2 | Back to Outlets | Click "Back to Outlets". | Navigate to Outlets list. | [ ] |
| 10.3 | Create Allocation Request | Click "+ Create Allocation Request" (or "Request Allocation"). | Modal with item rows: material selector, quantity; Add Row; confirm step. | [ ] |
| 10.4 | Edit Today's Request | When today's request exists and unpacked; click "Edit Today's Allocation Request". | Same modal pre-filled with existing items; can add/remove/edit. | [ ] |
| 10.5 | Add Row | In allocate modal, click "Add Row". | New row with material dropdown and quantity. | [ ] |
| 10.6 | Material search popup | In row, click "Select material...". | Search popup; type filters; select material fills row. | [ ] |
| 10.7 | Duplicate material | Add two rows with same material; try submit. | Validation "Duplicate materials" (or similar); submit blocked. | [ ] |
| 10.8 | Invalid quantity | Set quantity ≤ 0 or non-numeric; submit. | Validation error. | [ ] |
| 10.9 | Confirm modal | Add items with valid qty; proceed to confirm. | Confirm modal with summary. | [ ] |
| 10.10 | Confirm & Create Request | Click "Confirm & Create Request" once. | One allocation_request + items created; modal closes; list refreshes; success. | [ ] |
| 10.11 | Confirm & Update Request | Edit existing request; change items; confirm "Confirm & Update Request". | Request and items updated; no duplicate request. | [ ] |
| 10.12 | No duplicate on double-click | Double-click "Confirm & Create Request". | Only one allocation request created; button shows "Creating…" then resets. | [ ] |
| 10.13 | Allocation requests list | On outlet details. | Table or list of requests (date, status, items, etc.); packed requests may show different actions. | [ ] |
| 10.14 | Cancel allocate modal | Open allocate modal; cancel. | Modal closes; no create/update. | [ ] |

---

## 11. Supervisor – Raw Materials

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 11.1 | Raw Materials page load | As Supervisor, go to Raw Materials. | Stats (Total, Active, Inactive); search; category and status filters; table (or cards on mobile); Export. | [ ] |
| 11.2 | Search | Type in search. | List filters by name, code, or description. | [ ] |
| 11.3 | Category filter | Select category. | List filters. | [ ] |
| 11.4 | Status filter | Select Active / Inactive. | List filters by is_active. | [ ] |
| 11.5 | Export modal | Click "Export". | Modal with CSV, Excel, PDF. | [ ] |
| 11.6 | Export CSV/Excel/PDF | Choose format; export. | File downloads; content correct. | [ ] |
| 11.7 | Pagination | Use Previous/Next if multiple pages. | Page changes correctly. | [ ] |
| 11.8 | Read-only | Confirm no Edit/Add (if supervisor is read-only here). | No create/edit material actions for Supervisor. | [ ] |

---

## 12. Supervisor – Inventory

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 12.1 | Inventory page (Supervisor) | As Supervisor, go to Inventory (if in nav). | Page loads; list of inventory for their cloud kitchen; search/filters as implemented. | [ ] |
| 12.2 | View only / no adjust | Confirm Supervisor cannot adjust inventory (if intended). | No Edit/Adjust or confirm adjustment; or restricted. | [ ] |
| 12.3 | Export | If Export present, run CSV/Excel/PDF. | File downloads; data correct. | [ ] |

---

## 13. Admin Dashboard

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 13.1 | Session info | Log in as Admin. | Session Information shows Full Name, Role, Email, Login Type, Cloud Kitchen (if any). | [ ] |
| 13.2 | Manage Users button | Click "Manage Users" (if wired). | Navigates or opens expected screen; or placeholder. | [ ] |
| 13.3 | View Inventory / Reports | Click "View Inventory" or "View Reports" (if wired). | Expected behaviour or placeholder. | [ ] |
| 13.4 | Logout | Click Logout. | Auth sign-out (if applicable); session cleared; redirect to login. | [ ] |

---

## 14. Alerts, Modals & Global Behaviour

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 14.1 | Success alert | Trigger any success (e.g. create slip, allocate). | Alert modal or toast with success message and OK/dismiss. | [ ] |
| 14.2 | Error alert | Trigger validation or API error. | Error message shown; user can dismiss. | [ ] |
| 14.3 | Warning alert | Trigger warning (e.g. duplicate materials). | Warning message shown. | [ ] |
| 14.4 | Dismiss alert | Click OK or dismiss on alert. | Alert closes. | [ ] |
| 14.5 | Modal overlay | Open any modal. | Backdrop dims background; focus in modal. | [ ] |
| 14.6 | Modal close – X or Cancel | Close modal via X or Cancel. | Modal closes; no unintended submit. | [ ] |
| 14.7 | Loading states | During API calls (create, update, export). | Button shows loading text (e.g. "Creating…"); button disabled where appropriate. | [ ] |

---

## 15. Double-Submit & Loading States

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 15.1 | Stock In – Creating… | Confirm Purchase Slip; click "Confirm & Create" once. | Button shows "Creating…" and is disabled; then modal closes or button resets. | [ ] |
| 15.2 | Stock In – no duplicate slips | Double-click "Confirm & Create". | Only one stock_in (and batches, inventory update). | [ ] |
| 15.3 | Stock Out – no duplicate allocation | Double-click "Confirm Allocation". | Only one stock_out. | [ ] |
| 15.4 | Self Stock Out – no duplicate | Double-click "Confirm Self Stock Out". | Only one self stock out. | [ ] |
| 15.5 | Allocation request – no duplicate | Double-click "Confirm & Create Request" on outlet details. | Only one allocation_request. | [ ] |
| 15.6 | Materials – no duplicate | Double-click "Confirm & Create Material". | Only one raw_material. | [ ] |
| 15.7 | Inventory – no duplicate update | Double-click "Confirm & Update" on adjustment. | Single inventory update (if applicable). | [ ] |

---

## 16. Edge Cases & Error Handling

| # | Test Case | Steps | Expected Result | Pass |
|---|-----------|--------|-----------------|------|
| 16.1 | Stock In – supplier validation reset | Trigger confirm without supplier; get alert. | After alert, button is "Confirm & Create" again (not stuck "Creating…"). | [ ] |
| 16.2 | Stock In – receipt date validation reset | Same for missing receipt date. | Loading state reset. | [ ] |
| 16.3 | Session expiry | Expire session (or clear storage); trigger a submit. | Message like "Session expired. Please log in again."; no partial create; loading reset. | [ ] |
| 16.4 | Insufficient stock (allocate) | Allocate more than available. | Clear error with available qty; no stock_out. | [ ] |
| 16.5 | Self stock out – empty reason | Submit with empty reason. | Validation; no create. | [ ] |
| 16.6 | Inventory adjustment – empty reason | Confirm adjustment with empty reason. | Submit disabled or validation. | [ ] |
| 16.7 | Cancel during loading | Start a submit; click Cancel (if enabled) or navigate away. | No crash; on return, data consistent; no duplicate if request already sent. | [ ] |
| 16.8 | Network error | Simulate network failure during create. | Error message; loading state reset; user can retry. | [ ] |
| 16.9 | Empty cloud kitchen (PM) | PM with no cloud_kitchen_id. | Overview/Stock In/Inventory etc. handle gracefully (empty or message). | [ ] |
| 16.10 | RLS / permission error | Action that violates RLS (e.g. wrong kitchen). | Error from API; user sees message; no partial state. | [ ] |

---

## 17. Quick Smoke Checklist

Run this minimal set after every deploy:

- [ ] **1.1** – Login type selection
- [ ] **1.8** or **1.9** – Key login success (PM or Supervisor)
- [ ] **2.1, 2.2** – PM dashboard and nav
- [ ] **4.2.1, 4.2.6** – Stock In: open Add modal, material popup
- [ ] **4.3.7** – Stock In: one successful Confirm & Create
- [ ] **4.3.8** – Stock In: no duplicate on double-click
- [ ] **5.8** – Stock Out: one successful allocation
- [ ] **6.11** – Self Stock Out: one successful create
- [ ] **7.2.3** – Inventory: confirm modal has Reason only (no Additional Details, no Adjustment Type)
- [ ] **7.2.5** – Inventory: one successful adjustment
- [ ] **10.10** – Outlet details: one successful allocation request create
- [ ] **15.2** – No duplicate Stock In on double-click

---

## Notes

- **Roles:** Run PM flows as Purchase Manager, allocation flows as Supervisor (and PM where they have access). Admin for admin-only routes.
- **Data:** Ensure at least one cloud kitchen, outlet, raw materials, and (for Stock Out) an unpacked allocation request.
- **DB checks:** After double-submit tests, query `stock_in`, `stock_out`, `allocation_requests`, `raw_materials` to confirm single row per action.
- **Browsers:** Test in at least one real browser (e.g. Chrome/Firefox) for click timing and focus.
- **Mobile:** Where applicable, test key flows on small viewport (sidebar, tables, modals, export).

When you add new features or modals, add corresponding test cases and double-submit checks to this document.
