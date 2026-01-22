# System Security Audit & Logical Flow Verification
## Gastronomix Inventory Management System

**Purpose:** This document explains how the inventory management system works in simple terms, focusing on identifying potential loopholes where Purchase Managers or Supervisors could cheat the system.

**Last Updated:** Based on Refactored System Logic (Post-Database Migration)

---

## Table of Contents
1. [System Overview](#system-overview)
2. [User Hierarchy and Roles](#user-hierarchy-and-roles)
3. [Daily Workflows](#daily-workflows)
4. [Security Checks and Potential Loopholes](#security-checks-and-potential-loopholes)
5. [Recommendations](#recommendations)

---

## System Overview

### What This System Does

The Gastronomix Inventory Management System tracks raw materials (like rice, chicken, vegetables, spices, etc.) across three cloud kitchens. Each cloud kitchen serves multiple outlets (restaurants). The system ensures that:

1. **Stock comes in** - When Purchase Managers receive new materials from suppliers
2. **Stock goes out** - When materials are allocated to outlets
3. **Everything is tracked** - Every movement is recorded with who did it and when

### Key Concepts

**Cloud Kitchen:** A central kitchen that prepares food for multiple outlets. There are 3 cloud kitchens in the system.

**Outlet:** A restaurant location that receives materials from its cloud kitchen. Each outlet belongs to one cloud kitchen.

**Raw Materials:** The ingredients and supplies (chicken, rice, oil, containers, etc.) that need to be tracked.

**Inventory:** The current stock of each raw material in each cloud kitchen. This is like a warehouse count.

**Allocation Request:** A request made by a Supervisor to send materials to an outlet. This is just a request - it doesn't actually move stock yet.

**Stock Out:** The actual movement of materials from the cloud kitchen to an outlet. This is what actually reduces the inventory.

**FIFO (First In, First Out):** The system tracks which batch of materials came in first and uses those first when allocating to outlets. This ensures older stock is used before newer stock.

---

## User Hierarchy and Roles

### 1. Admin
**Who they are:** Management or operations team members who oversee everything.

**What they can do:**
- See everything across all cloud kitchens
- Manage users (create, edit, delete)
- View all reports and analytics
- Access all data without restrictions

**What they cannot do:**
- Nothing - they have full access

**Security Level:** Highest - They can see everything but cannot be restricted.

---

### 2. Purchase Manager
**Who they are:** One person per cloud kitchen responsible for receiving stock and managing inventory.

**What they can do:**
- **Stock In:** Record when new materials arrive from suppliers
  - Enter purchase slips with supplier details, invoice numbers, costs
  - Create batches of materials with quantities and unit costs
  - This increases the inventory automatically
  
- **View Inventory:** See current stock levels for their cloud kitchen
  - See all materials and their quantities
  - See low stock alerts based on thresholds
  
- **Manage Materials Catalog:** Add new raw materials or edit existing ones
  - Set low stock thresholds for each material
  
- **Handle Allocation Requests:** Review requests made by Supervisors
  - See all allocation requests for their cloud kitchen
  - Modify quantities in requests if needed
  - Approve requests by creating actual Stock Out records
  - This is the ONLY way inventory can be reduced
  
- **View Stock Out History:** See all previous allocations that were actually sent to outlets

**What they cannot do:**
- Cannot access other cloud kitchens' data
- Cannot delete stock in records (only create)
- Cannot directly edit inventory quantities (only through Stock In or Stock Out)

**Security Level:** High - They control what comes in and what goes out, but all actions are logged.

---

### 3. Supervisor
**Who they are:** One person per cloud kitchen responsible for reviewing outlet requests and creating allocation requests.

**What they can do:**
- **View Outlets:** See all outlets that belong to their cloud kitchen
- **View Raw Materials:** See the list of available materials (but NOT inventory quantities)
- **Create Allocation Requests:** Request materials to be sent to outlets
  - Select an outlet
  - Select materials and quantities needed
  - Submit the request
  - This is just a REQUEST - it does NOT reduce inventory
  
- **View Allocation Requests:** See their own requests and their status
- **View Stock Out History:** See what was actually allocated (read-only)

**What they cannot do:**
- **Cannot see inventory quantities** - This is critical! They cannot see how much stock is available
- Cannot create actual Stock Out records (only requests)
- Cannot modify Stock In records
- Cannot access other cloud kitchens' data
- Cannot approve their own requests

**Security Level:** Medium - They can create requests but cannot actually move stock or see inventory levels.

---

## Daily Workflows

### Workflow 1: Receiving New Stock (Purchase Manager)

**Step-by-step process:**

1. **Supplier delivers materials** to the cloud kitchen
2. **Purchase Manager receives the delivery** and gets:
   - Invoice from supplier
   - List of materials and quantities
   - Unit costs for each material
3. **Purchase Manager opens the system** and creates a "Purchase Slip"
4. **Enters details:**
   - Receipt date
   - Supplier name
   - Invoice number
   - For each material:
     - Material name
     - Quantity received
     - Unit cost (price per unit)
     - Total cost (calculated automatically)
5. **System creates:**
   - A Stock In record (the purchase slip)
   - Stock In Batches for each material (FIFO tracking)
   - Automatically increases inventory quantities
6. **Purchase Manager can view** the purchase slip later for reference

**Who can do this:** Only Purchase Managers

**Can this be cheated?**
- Purchase Manager could enter incorrect quantities (more than received)
- Purchase Manager could enter incorrect costs (higher than actual)
- Purchase Manager could enter materials that weren't actually received
- **Mitigation:** Physical verification by Admin or comparing with supplier invoices

---

### Workflow 2: Requesting Materials for Outlet (Supervisor)

**Step-by-step process:**

1. **Outlet submits paper request** to Supervisor (outside the system)
2. **Supervisor reviews the paper request**
3. **Supervisor opens the system** and goes to the outlet's page
4. **Supervisor creates an "Allocation Request":**
   - Selects the outlet
   - Adds materials and quantities from the paper request
   - Submits the request
5. **System creates:**
   - An Allocation Request record
   - Allocation Request Items (materials and quantities)
   - **Does NOT reduce inventory** - this is just a request
6. **Supervisor can see** their request but cannot see if there's enough stock

**Who can do this:** Only Supervisors

**Can this be cheated?**
- Supervisor could request more than the outlet actually needs
- Supervisor could request materials for non-existent needs
- **Mitigation:** Purchase Manager reviews and can modify quantities before approving
- **Important:** Supervisor cannot see inventory, so they might request materials that aren't available

---

### Workflow 3: Approving and Sending Materials (Purchase Manager)

**Step-by-step process:**

1. **Purchase Manager sees** allocation requests from Supervisors
2. **Purchase Manager reviews** each request:
   - Checks if materials are available in inventory
   - Can modify quantities if needed
   - Can add or remove materials
3. **Purchase Manager approves** by creating a "Stock Out" record:
   - Links to the allocation request
   - Confirms outlet and materials
   - System uses FIFO to determine which batches to use
4. **System automatically:**
   - Creates Stock Out record
   - Creates Stock Out Items (what was actually sent)
   - Reduces inventory quantities using FIFO (oldest batches first)
   - Updates batch quantities (reduces quantity_remaining in batches)
5. **Materials are physically sent** to the outlet
6. **Purchase Manager can mark** the allocation request as "packed" if needed

**Who can do this:** Only Purchase Managers

**Can this be cheated?**
- Purchase Manager could approve requests for more than what's actually sent
- Purchase Manager could create Stock Out records without a corresponding request
- Purchase Manager could modify quantities to be different from what was sent
- **Mitigation:** Physical verification at outlet, comparing Stock Out records with actual deliveries

---

### Workflow 4: Viewing Inventory (Purchase Manager)

**Step-by-step process:**

1. **Purchase Manager opens** the Inventory page
2. **Sees list of all materials** with:
   - Current quantity in stock
   - Low stock alerts (if quantity is below threshold)
   - Last updated date
3. **Can filter and search** materials
4. **Cannot directly edit** quantities (only through Stock In or Stock Out)

**Who can do this:** Only Purchase Managers (Supervisors cannot see inventory)

**Can this be cheated?**
- Purchase Manager cannot directly manipulate inventory numbers
- All changes must go through Stock In or Stock Out records
- **Mitigation:** All changes are logged with timestamps and user information

---

## Security Checks and Potential Loopholes

### Critical Security Features

1. **Separation of Duties:**
   - Supervisors can only REQUEST allocations
   - Purchase Managers must APPROVE and create actual Stock Out records
   - This prevents one person from both requesting and approving

2. **Inventory Visibility:**
   - Supervisors cannot see inventory quantities
   - This prevents Supervisors from knowing exactly what's available
   - Purchase Managers can see inventory and make informed decisions

3. **FIFO Tracking:**
   - System tracks which batches came in first
   - When allocating, oldest batches are used first
   - This prevents manipulation of which stock is used

4. **Audit Trail:**
   - Every Stock In record shows who received it and when
   - Every Stock Out record shows who allocated it and when
   - Every Allocation Request shows who requested it and when

5. **Cloud Kitchen Isolation:**
   - Each user can only access their own cloud kitchen's data
   - Purchase Manager from Kitchen A cannot see Kitchen B's data

---

### Potential Loopholes and Vulnerabilities

#### Loophole 1: Purchase Manager Enters Fake Stock In
**What could happen:**
- Purchase Manager receives 100 kg of rice but enters 150 kg in the system
- System increases inventory by 150 kg instead of 100 kg
- Extra 50 kg is "phantom stock" that doesn't exist

**How to detect:**
- Compare Stock In records with supplier invoices
- Physical inventory counts should match system inventory
- Regular audits by Admin

**Risk Level:** HIGH - This directly inflates inventory

**Mitigation:**
- Require invoice numbers for all Stock In records
- Admin should verify invoices match Stock In records
- Regular physical inventory counts

---

#### Loophole 2: Purchase Manager Enters Incorrect Costs
**What could happen:**
- Purchase Manager receives rice at ₹50/kg but enters ₹60/kg
- System records higher cost, making purchases look more expensive
- Could be used to justify budget overruns or hide actual costs

**How to detect:**
- Compare unit costs in Stock In records with supplier invoices
- Track cost trends - sudden increases should be investigated
- Admin can view all costs and compare across time periods

**Risk Level:** MEDIUM - Affects financial reporting but not inventory quantities

**Mitigation:**
- Require invoice numbers with costs
- Admin should spot-check costs against invoices
- System should flag unusually high costs

---

#### Loophole 3: Purchase Manager Creates Stock Out Without Request
**What could happen:**
- Purchase Manager creates a Stock Out record directly without a Supervisor's Allocation Request
- This bypasses the request/approval workflow
- Materials could be allocated without proper authorization

**How to detect:**
- Check if Stock Out records have corresponding Allocation Requests
- All Stock Out records should link to an Allocation Request
- Admin can query for Stock Out records without requests

**Risk Level:** HIGH - Bypasses the control mechanism

**Mitigation:**
- System should require Allocation Request for Stock Out (enforced in database)
- Admin should regularly check for orphaned Stock Out records
- Alert Admin when Stock Out is created without request

---

#### Loophole 4: Purchase Manager Modifies Quantities in Requests
**What could happen:**
- Supervisor requests 10 kg of rice for an outlet
- Purchase Manager changes it to 15 kg before approving
- More materials are sent than requested
- Could be legitimate (if outlet needs more) or fraudulent (if materials go elsewhere)

**How to detect:**
- Compare Allocation Request quantities with Stock Out quantities
- System should show what was requested vs. what was sent
- Outlet should verify what they actually received

**Risk Level:** MEDIUM - Could be legitimate or fraudulent

**Mitigation:**
- System should log all modifications to requests
- Outlet should confirm receipt matches Stock Out record
- Admin should review significant quantity changes

---

#### Loophole 5: Supervisor Creates Excessive Requests
**What could happen:**
- Supervisor creates multiple requests for the same outlet
- Supervisor requests more materials than outlets actually need
- This could be used to stockpile materials at outlets or create confusion

**How to detect:**
- Track number of requests per outlet per day
- Compare request quantities with outlet consumption patterns
- Check if requests are being approved or left pending

**Risk Level:** LOW - Purchase Manager can review and modify before approving

**Mitigation:**
- Purchase Manager reviews all requests before approval
- System should flag unusually large requests
- Track outlet consumption to identify patterns

---

#### Loophole 6: Purchase Manager Approves Request But Doesn't Send Materials
**What could happen:**
- Purchase Manager creates Stock Out record (reducing inventory)
- But doesn't actually send materials to outlet
- Materials remain in cloud kitchen but inventory shows they're gone
- Materials could be diverted elsewhere

**How to detect:**
- Physical verification at outlet - did they receive the materials?
- Compare Stock Out records with outlet receipts
- Regular reconciliation between system and physical stock

**Risk Level:** HIGH - This is theft or diversion

**Mitigation:**
- Outlets should confirm receipt of materials
- Physical inventory counts at cloud kitchen should match system
- Admin should spot-check deliveries

---

#### Loophole 7: Multiple Stock Out Records for Same Request
**What could happen:**
- Purchase Manager creates Stock Out record for a request
- Then creates another Stock Out record for the same request
- This would reduce inventory twice for the same allocation
- Materials would be "double-allocated"

**How to detect:**
- Check if multiple Stock Out records link to the same Allocation Request
- System should prevent or flag duplicate Stock Out records
- Admin can query for duplicate allocations

**Risk Level:** HIGH - Double-counting reduces inventory incorrectly

**Mitigation:**
- System should prevent multiple Stock Out records for same request (enforced in database)
- Or mark request as "completed" after first Stock Out
- Admin should monitor for duplicates

---

#### Loophole 8: Purchase Manager Deletes or Modifies Stock In Records
**What could happen:**
- Purchase Manager deletes a Stock In record after materials are received
- This would remove the record of receiving materials
- Could hide fraudulent entries or mistakes

**How to detect:**
- Check if Stock In records can be deleted (they shouldn't be)
- Audit logs should show all deletions
- Physical inventory should match system records

**Risk Level:** MEDIUM - Depends on if deletion is allowed

**Mitigation:**
- System should not allow deletion of Stock In records (only creation)
- Or require Admin approval for deletions
- All deletions should be logged

---

#### Loophole 9: Supervisor Sees Inventory Through Other Means
**What could happen:**
- Supervisor might try to guess inventory by looking at Stock In and Stock Out records
- Supervisor could calculate approximate inventory by tracking all movements
- This would bypass the restriction on viewing inventory

**How to detect:**
- Check if Supervisor can access Stock In or Stock Out records
- According to system design, Supervisor should only see Allocation Requests and Stock Out history
- If Supervisor can see Stock In records, they could calculate inventory

**Risk Level:** LOW - Even if they calculate, they can't modify it

**Mitigation:**
- Ensure Supervisor cannot access Stock In records
- Or limit Supervisor's view to only their own requests
- System should enforce role-based access strictly

---

#### Loophole 10: Purchase Manager Creates Stock Out for Wrong Outlet
**What could happen:**
- Purchase Manager creates Stock Out record for Outlet A
- But actually sends materials to Outlet B
- This misrepresents where materials went
- Could be used to hide allocations to unauthorized outlets

**How to detect:**
- Physical verification at outlets
- Compare Stock Out records with actual deliveries
- Check if outlet confirms receipt

**Risk Level:** MEDIUM - Misrepresentation but materials still tracked

**Mitigation:**
- Outlets should confirm receipt matches records
- Regular reconciliation
- Admin should spot-check deliveries

---

## Recommendations

### For Preventing Fraud

1. **Regular Audits:**
   - Admin should compare Stock In records with supplier invoices monthly
   - Physical inventory counts should match system inventory quarterly
   - Spot-check deliveries to outlets

2. **Require Documentation:**
   - All Stock In records must have invoice numbers
   - All Stock Out records should have delivery confirmations
   - Keep paper trail of all transactions

3. **Monitor Anomalies:**
   - Flag unusually large Stock In quantities
   - Flag unusually high costs
   - Flag Stock Out records without requests
   - Flag multiple Stock Out records for same request

4. **Separation of Duties:**
   - Never allow one person to be both Supervisor and Purchase Manager
   - Admin should review all transactions regularly
   - Consider requiring two-person approval for large allocations

5. **Physical Verification:**
   - Outlets should confirm receipt of materials
   - Regular physical inventory counts at cloud kitchens
   - Compare physical counts with system records

6. **System Enhancements:**
   - Prevent deletion of Stock In records
   - Prevent multiple Stock Out records for same request
   - Require Allocation Request for all Stock Out records
   - Add alerts for unusual activities

### For System Integrity

1. **Data Validation:**
   - Ensure quantities cannot be negative
   - Ensure costs are reasonable (flag outliers)
   - Ensure dates are valid

2. **Access Control:**
   - Strictly enforce role-based access
   - Supervisors should never see inventory quantities
   - Purchase Managers should only see their kitchen's data

3. **Audit Logging:**
   - Log all Stock In creations
   - Log all Stock Out creations
   - Log all modifications to requests
   - Log all inventory changes

4. **Reconciliation:**
   - Regular reconciliation between physical and system inventory
   - Compare supplier invoices with Stock In records
   - Verify outlet receipts match Stock Out records

---

## Summary

The system is designed with multiple layers of security:

1. **Separation of Duties:** Supervisors request, Purchase Managers approve
2. **Limited Visibility:** Supervisors cannot see inventory
3. **Audit Trail:** All actions are logged
4. **FIFO Tracking:** Prevents manipulation of stock usage
5. **Isolation:** Users can only access their cloud kitchen

However, the system relies on Purchase Managers being honest and accurate. The main vulnerabilities are:

- **Purchase Manager entering incorrect Stock In data** (quantities or costs)
- **Purchase Manager creating Stock Out without proper authorization**
- **Purchase Manager approving requests but not sending materials**
- **Lack of physical verification**

To minimize risk, regular audits, physical verification, and monitoring are essential. The system provides the tools to detect fraud, but human oversight is still required.

---

**Document Prepared For:** Security Audit and Fraud Prevention  
**System Version:** Refactored Logic (Post-Database Migration)  
**Review Frequency:** Quarterly or when system changes are made
