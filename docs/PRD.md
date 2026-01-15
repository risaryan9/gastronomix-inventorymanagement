# Product Requirements Document (PRD)
## Gastronomix Inventory Management System

**Version:** 1.0  
**Date:** 2024  
**Status:** Draft

---

## 1. Executive Summary

### 1.1 Problem Statement
Gastronomix, an F&B brand operating multiple cloud kitchens, faces critical challenges in inventory management and logistics operations. The current manual, paper-based system lacks transparency, data-driven insights, and efficient resource allocation capabilities.

### 1.2 Solution Overview
An end-to-end inventory management system that digitizes the entire inventory lifecycle - from purchase to allocation - providing real-time tracking, analytics, and automated alerts to optimize resource utilization across cloud kitchens and outlets.

### 1.3 Business Objectives
- Eliminate paper-based tracking and reduce human error
- Provide real-time visibility into inventory levels and consumption patterns
- Enable data-driven decision making for resource allocation
- Optimize inventory turnover and reduce waste
- Improve operational efficiency across cloud kitchens

---

## 2. Current State Analysis

### 2.1 Organizational Structure
- **3 Cloud Kitchens** (each serving 25-30 outlets)
- **~75-90 Total Outlets** across all cloud kitchens
- **Staff per Cloud Kitchen:**
  - 1 Purchase Manager (handles inventory "in")
  - 1 Supervisor (handles inventory "out" to outlets)

### 2.2 Current Process Flow
1. **Outlets:** Create paper request slips for raw materials
2. **Supervisor:** Receives request slips, reviews them, and allocates resources based on intuition (no digital tracking)
3. **Purchase Manager:** Manages incoming stock manually
4. **Tracking:** All tracking done on pen and paper - no digital records of allocations or consumption

### 2.3 Pain Points
- ❌ No visibility into consumption patterns per outlet
- ❌ Inability to identify high/low consuming outlets
- ❌ Lack of data to validate allocation decisions
- ❌ No systematic tracking of inventory levels
- ❌ Risk of over-allocation or stockouts
- ❌ Manual processes prone to errors

---

## 3. Product Overview

### 3.1 Product Vision
To become the single source of truth for inventory management, enabling Gastronomix to make data-driven decisions, optimize resource allocation, and streamline operations across all cloud kitchens and outlets.

### 3.2 Target Users
1. **Supervisors** (3 users - one per cloud kitchen)
2. **Purchase Managers** (3 users - one per cloud kitchen)
3. **Admins** (1-3 users - management/operations team)

---

## 4. User Roles & Permissions

### 4.1 Supervisor Role
**Primary Responsibilities:**
- Review paper request slips from outlets
- Allocate raw materials from main inventory to outlets (based on paper requests)
- View consumption analytics per outlet
- Make allocation decisions based on data insights

**Key Features:**
- ✅ Inventory allocation functionality (create allocations directly)
- ✅ Outlet consumption reports and analytics
- ✅ Real-time inventory levels
- ✅ Allocation history

**Permissions:**
- Read/Write: Allocations, consumption data
- Read: Inventory levels, outlet information
- No Access: Stock-in, cost management, raw material catalog

### 4.2 Purchase Manager Role
**Primary Responsibilities:**
- All supervisor capabilities (inherited)
- Manage stock-in operations (receiving inventory)
- Receive low stock alerts
- Manage raw material catalog (add/edit items)
- Update per-unit costs of raw materials

**Key Features:**
- ✅ All supervisor features
- ✅ Stock-in entry interface
- ✅ Low stock alerts/notifications
- ✅ Raw material catalog management
- ✅ Cost management (update unit costs)
- ✅ Inventory threshold configuration

**Permissions:**
- All Supervisor permissions
- Read/Write: Stock-in, raw material catalog, costs
- Configure: Stock thresholds and alerts

### 4.3 Admin Role
**Primary Responsibilities:**
- Complete system access and oversight
- View comprehensive analytics across all dimensions
- Manage users and roles
- Configure system settings
- Generate detailed reports

**Key Features:**
- ✅ All Purchase Manager features
- ✅ Cross-cloud kitchen analytics
- ✅ Outlet-level detailed analytics
- ✅ User management
- ✅ System configuration
- ✅ Export capabilities (reports, data)

**Permissions:**
- Full system access (all roles combined)
- User management
- System configuration
- Advanced analytics and reporting

---

## 5. Core Features & Requirements

### 5.1 Inventory Allocation
**User Story:** As a Supervisor, I need to allocate raw materials from main inventory to outlets (after reviewing paper request slips).

**Requirements:**
- Interface to create new allocations
- Select outlet and raw materials to allocate
- Specify quantities for each raw material
- Automatic inventory deduction upon allocation
- Allocation history tracking
- Validation to prevent over-allocation
- Notes field for allocation details

**Acceptance Criteria:**
- Supervisor can create allocations with outlet, items, and quantities
- Allocation reduces main inventory automatically
- System prevents allocation exceeding available stock
- Allocation records are maintained with timestamps and user
- Allocation history is viewable and filterable by outlet, date range

### 5.2 Stock-In Management
**User Story:** As a Purchase Manager, I need to record incoming stock and update inventory levels.

**Requirements:**
- Interface to record stock-in transactions
- Select raw materials and enter quantities
- Update inventory levels automatically
- Record purchase details (date, supplier, cost)
- Stock-in history and audit trail

**Acceptance Criteria:**
- Purchase Manager can add stock-in entries
- Inventory levels increase automatically
- Stock-in records are stored with metadata
- History of all stock-in operations available

### 5.3 Low Stock Alerts
**User Story:** As a Purchase Manager, I need to be alerted when inventory levels are running low.

**Requirements:**
- Configurable threshold per raw material
- Real-time or periodic alert generation
- Alert dashboard/notification system
- Alert history tracking
- Threshold configuration interface

**Acceptance Criteria:**
- Alerts trigger when stock falls below threshold
- Purchase Manager receives alerts (dashboard/notification)
- Thresholds can be set per item
- Alert history is maintained

### 5.4 Raw Material Catalog Management
**User Story:** As a Purchase Manager, I need to add new raw materials and update their costs.

**Requirements:**
- Add new raw material types
- Edit existing raw material details
- Set/update per-unit costs
- Set measurement units (kg, liters, pieces, etc.)
- Catalog search and filtering

**Acceptance Criteria:**
- Purchase Manager can add new items to catalog
- Can update item details and costs
- Changes reflect across system
- Cost history tracking (optional)

### 5.5 Consumption Analytics
**User Story:** As a Supervisor/Purchase Manager, I need to view which outlets are consuming more/less resources.

**Requirements:**
- Outlet-level consumption reports
- Time-period filtering (daily, weekly, monthly)
- Consumption trends visualization
- Comparative analysis (outlets, time periods)
- Export capabilities

**Acceptance Criteria:**
- Consumption data visible per outlet
- Charts/graphs for visualization
- Filterable by date range
- Data is accurate and up-to-date

### 5.6 Admin Analytics Dashboard
**User Story:** As an Admin, I need comprehensive analytics across all cloud kitchens, outlets, and staff.

**Requirements:**
- Multi-dimensional analytics dashboard
- Cloud kitchen performance metrics
- Outlet performance comparison
- Staff activity tracking
- Aggregate consumption patterns
- Custom report generation
- Export to various formats

**Acceptance Criteria:**
- Dashboard shows key metrics at a glance
- Drill-down capabilities to detailed views
- Filters for time period, cloud kitchen, outlet
- Reports can be exported (PDF, CSV, Excel)

### 5.7 User Management (Admin)
**User Story:** As an Admin, I need to manage users, roles, and permissions.

**Requirements:**
- Create/edit/delete users
- Assign roles (Supervisor, Purchase Manager)
- Map users to cloud kitchens
- User activity logging
- Access control enforcement

**Acceptance Criteria:**
- Admin can manage all users
- Roles are properly enforced
- Users can only access their assigned cloud kitchen data
- User actions are logged

---

## 6. Technical Requirements

### 6.1 Technology Stack
- **Frontend:** React.js + Tailwind CSS
- **Backend:** Supabase (PostgreSQL database + Supabase Functions)
- **Authentication:** Supabase Auth
- **Real-time:** Supabase Realtime (optional for live updates)
- **Hosting:** TBD (Vercel, Netlify, or similar)

### 6.2 Non-Functional Requirements

**Performance:**
- Page load time < 2 seconds
- API response time < 500ms (p95)
- Support 50+ concurrent users

**Security:**
- Role-based access control (RBAC)
- Data encryption in transit (HTTPS)
- Authentication required for all operations
- Audit logging for critical operations

**Scalability:**
- Support current scale (3 cloud kitchens, 90 outlets)
- Architecture scalable to 10+ cloud kitchens
- Database optimized for query performance

**Usability:**
- Responsive design (desktop-first, mobile-compatible)
- Intuitive navigation
- Minimal learning curve for users
- Clear error messages

**Reliability:**
- 99.5% uptime
- Data backup and recovery
- Transaction integrity

---

## 7. Data Model Overview

### 7.1 Core Entities
- **Users** (Supervisor, Purchase Manager, Admin)
- **Cloud Kitchens**
- **Outlets**
- **Raw Materials** (Catalog)
- **Inventory** (Main stock per cloud kitchen)
- **Allocations** (Inventory to outlets)
- **Stock-In** (Purchases/receipts)
- **Audit Logs** (Audit trail)

### 7.2 Key Relationships
- User → Cloud Kitchen (many-to-one)
- Cloud Kitchen → Outlets (one-to-many)
- Cloud Kitchen → Inventory (one-to-many per material)
- Outlet → Allocations (one-to-many)
- Inventory → Allocations (one-to-many)
- Raw Material → Inventory (one-to-many)
- Raw Material → Allocation Items (one-to-many)

---

## 8. Success Metrics

### 8.1 Adoption Metrics
- User login frequency (daily/weekly active users)
- Feature usage rates
- Allocation digitization rate (paper → digital)

### 8.2 Operational Metrics
- Time saved per allocation
- Reduction in allocation errors
- Inventory accuracy improvement
- Response time to low stock alerts

### 8.3 Business Metrics
- Reduction in over-allocation
- Improvement in inventory turnover
- Cost savings from optimized allocation
- Reduction in stockouts

---

## 9. Constraints & Assumptions

### 9.1 Constraints
- Paper-based request slips will continue (supervisors review paper slips and create allocations directly)
- No outlet inventory tracking (stock delivered daily to small outlets)
- Limited to 3 cloud kitchens initially
- Users may have varying technical proficiency
- Internet connectivity required for system access

### 9.2 Assumptions
- Users have basic computer literacy
- Outlets continue using paper slips (no outlet-facing interface in Phase 1)
- Supervisors review paper requests and create allocations directly (no digital request tracking)
- Standard business hours for primary operations
- One user per role per cloud kitchen

---

## 10. Future Considerations (Out of Scope - Phase 1)

- Mobile application
- Outlet-facing interface/digital requests
- Barcode/QR code scanning
- Supplier management
- Purchase order generation
- Forecasting and predictive analytics
- Multi-language support
- Advanced reporting with AI insights

---

## 11. Approval & Sign-off

**Product Owner:** [To be filled]  
**Tech Lead:** [To be filled]  
**Stakeholders:** [To be filled]

**Date:** [To be filled]

---

*This PRD is a living document and will be updated as the product evolves.*


