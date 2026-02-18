# Admin Dashboard — Widgets & Analytics Specification

**Document version:** 1.1  
**Last updated:** February 2026 (expanded with data-gap analytics)  
**Audience:** Product, Engineering, and Stakeholders  
**Context:** Gastronomix Inventory Management — Admin role sees all cloud kitchens; this document defines recommended widgets and analytics for the Admin Dashboard.

---

## 1. Purpose & Scope

### 1.1 Why an Admin Dashboard?

- **Single pane of glass:** Admins need cross–cloud-kitchen visibility without logging in per kitchen.
- **Operational health:** Quick view of inventory health, procurement, allocations, and exceptions.
- **Data-driven decisions:** Compare kitchens, outlets, and materials; spot trends and outliers.
- **Compliance & audit:** Track who did what and when; support audits and investigations.
- **Business metrics:** Inventory value, spend, wastage, and consumption tied to time and entity.

### 1.2 What “Admin” Can See

- **All cloud kitchens** (no `cloud_kitchen_id` filter).
- **All outlets**, **all users** (by role), **all raw materials**, **all vendors**.
- **All transactions:** `stock_in`, `stock_out` (outlet + self), `allocation_requests`, `inventory`, `stock_in_batches`.
- **Audit logs** (if populated) for critical actions.

### 1.3 Out of Scope (for this document)

- Implementation tech stack (charts library, state management).
- Exact API contracts (endpoints, query params).
- Design mockups or pixel-level UI.

---

## 2. Data Sources Summary

| Source | Description | Key fields for analytics |
|--------|-------------|---------------------------|
| `cloud_kitchens` | Kitchen entities | id, name, code, is_active |
| `outlets` | Outlets per kitchen | id, cloud_kitchen_id, name, code, is_active |
| `users` | Staff (admin, purchase_manager, supervisor) | id, role, cloud_kitchen_id, full_name, is_active |
| `raw_materials` | Material catalog | id, name, code, unit, category, material_type, vendor_id |
| `vendors` | Supplier master | id, name, is_active |
| `inventory` | Current stock per kitchen × material | cloud_kitchen_id, raw_material_id, quantity, low_stock_threshold |
| `stock_in` | Incoming stock | cloud_kitchen_id, receipt_date, total_cost, stock_in_type, supplier_name, received_by |
| `stock_in_batches` | FIFO batches | cloud_kitchen_id, raw_material_id, quantity_remaining, unit_cost |
| `stock_out` | Allocations / self stock-out | cloud_kitchen_id, outlet_id, allocation_date, self_stock_out, reason, allocated_by |
| `stock_out_items` | Line items per stock_out | stock_out_id, raw_material_id, quantity |
| `allocation_requests` | Request slips | cloud_kitchen_id, outlet_id, request_date, is_packed |
| `audit_logs` | Action trail | user_id, action, entity_type, entity_id, created_at |
| `material_costs` | Cost history | raw_material_id, cost_per_unit, effective_from, effective_to |

---

## 3. Widget Categories & Widgets

Widgets are grouped by theme. Each subsection defines **purpose**, **metrics**, **data sources**, **suggested visualization**, and **filters**.

---

### 3.1 Organization & Operations Overview

#### 3.1.1 Org Summary KPI Strip

**Purpose:** High-level counts and health at a glance.

| Metric | Description | Data source | Notes |
|--------|-------------|-------------|--------|
| Cloud kitchens | Count of active kitchens | `cloud_kitchens` WHERE is_active AND deleted_at IS NULL | |
| Outlets | Total active outlets | `outlets` WHERE is_active AND deleted_at IS NULL | |
| Purchase managers | Count by role | `users` WHERE role = 'purchase_manager' AND is_active | |
| Supervisors | Count by role | `users` WHERE role = 'supervisor' AND is_active | |
| Total materials (catalog) | Distinct raw materials | `raw_materials` WHERE is_active | |
| Low-stock SKUs (all kitchens) | Items where quantity ≤ low_stock_threshold or quantity = 0 | `inventory` + `raw_materials.low_stock_threshold` | Sum across kitchens (unique material can be low in multiple) or count (material, kitchen) pairs |
| Total inventory value | Sum(quantity_remaining × unit_cost) | `stock_in_batches` WHERE quantity_remaining > 0 | All kitchens |

**Visualization:** Horizontal KPI cards (numbers + optional sparkline or comparison to previous period).  
**Filters:** None (global) or optional “as of date” for value.

---

#### 3.1.2 Cloud Kitchen Comparison Table

**Purpose:** Compare key metrics across cloud kitchens in one table.

**Columns (suggested):**

- Kitchen name / code  
- Outlets count  
- Inventory value (from batches)  
- Stock-in count (e.g. this month)  
- Stock-out count (e.g. this month) — outlet + self  
- Low-stock items count  
- Pending allocation requests (e.g. today or this week)

**Data sources:** Aggregations from `outlets`, `stock_in_batches`, `stock_in`, `stock_out`, `inventory` (+ raw_materials thresholds), `allocation_requests`, grouped by `cloud_kitchen_id`.  
**Visualization:** Table with optional sort and link to kitchen-specific drill-down.  
**Filters:** Date range (e.g. “this month” for stock-in/out counts).

---

### 3.2 Inventory Analytics

#### 3.2.1 Inventory Value Over Time (All Kitchens or per Kitchen)

**Purpose:** Trend of total inventory value to see buildup or drawdown.

**Metrics:** Sum of (quantity_remaining × unit_cost) per day (or week).  
**Data source:** Either:  
- **Snapshot table** (if you maintain daily/weekly snapshots), or  
- **Reconstruct from transactions:** stock_in and stock_out movements with cost (complex with FIFO).  
Simplest: **point-in-time from `stock_in_batches`** at “today” only; for history you need snapshots or event replay.

**Visualization:** Line or area chart — time on X-axis, value (INR) on Y-axis.  
**Filters:** Cloud kitchen (or “All”), date range (if history exists).

---

#### 3.2.2 Inventory Value by Cloud Kitchen (Current)

**Purpose:** Compare current inventory value across kitchens.

**Metrics:** Total value per cloud_kitchen_id from `stock_in_batches`.  
**Visualization:** Bar chart (kitchen on X-axis, value on Y-axis) or donut/pie.  
**Filters:** None or “as of” date.

---

#### 3.2.3 Low-Stock & Out-of-Stock Report

**Purpose:** List items that need reordering or attention, across all kitchens.

**Metrics:** Per (cloud_kitchen, raw_material): current quantity, low_stock_threshold, status (e.g. “Out of stock”, “Low stock”), last movement date if available.  
**Data source:** `inventory` JOIN `raw_materials` (for threshold, name, unit, category).  
**Visualization:** Table with columns: Kitchen, Material, Current Qty, Threshold, Status, Unit. Sort by quantity ascending or by “out of stock” first.  
**Filters:** Cloud kitchen, category, material type (raw / semi_finished / finished).

---

#### 3.2.4 Top Materials by Value (Current)

**Purpose:** Which materials contribute most to inventory value (for focus and risk).

**Metrics:** Per raw_material_id (and optionally per kitchen): sum(quantity_remaining × unit_cost).  
**Data source:** `stock_in_batches` JOIN `raw_materials`.  
**Visualization:** Horizontal bar chart or table — material name, value, % of total.  
**Filters:** Cloud kitchen, top N (e.g. 10, 20).

---

### 3.3 Procurement & Stock-In Analytics

#### 3.3.1 Stock-In Volume & Count Over Time

**Purpose:** How much is being received (by count of slips and/or by quantity/value) over time.

**Metrics:**  
- Count of `stock_in` records per day/week/month.  
- Sum of `stock_in.total_cost` per period (optional).  
- Split by `stock_in_type`: purchase vs kitchen.

**Data source:** `stock_in` aggregated by receipt_date (and stock_in_type).  
**Visualization:** Line or bar chart — time on X-axis; series: total, purchase, kitchen.  
**Filters:** Cloud kitchen, date range.

---

#### 3.3.2 Stock-In by Type (Purchase vs Kitchen)

**Purpose:** Share of purchase vs in-house (kitchen) stock-in.

**Metrics:** Count and/or total value by stock_in_type for selected period.  
**Data source:** `stock_in`.  
**Visualization:** Donut or stacked bar; table with counts and value.  
**Filters:** Cloud kitchen, date range.

---

#### 3.3.3 Top Suppliers by Spend or Volume

**Purpose:** Which suppliers (or “Kitchen” for kitchen type) account for most activity.

**Metrics:** For `stock_in_type = 'purchase'`: group by supplier_name (or vendor_id if linked), sum(total_cost), count(slips). For kitchen: single “Kitchen” bucket.  
**Data source:** `stock_in` (supplier_name / vendor_id).  
**Visualization:** Bar chart or table — supplier, total spend, slip count.  
**Filters:** Cloud kitchen, date range.

---

#### 3.3.4 Stock-In by Material / Category

**Purpose:** Which materials or categories are being received most (quantity or value).

**Metrics:** From `stock_in` JOIN `stock_in_items` JOIN `raw_materials`: sum(quantity) or sum(total_cost) by raw_material_id or category.  
**Data source:** `stock_in`, `stock_in_items`, `raw_materials`.  
**Visualization:** Bar chart or table — material/category, quantity or value.  
**Filters:** Cloud kitchen, date range, material type.

---

### 3.4 Allocation & Stock-Out Analytics

#### 3.4.1 Stock-Out Volume Over Time (Outlet vs Self)

**Purpose:** How much is going out (to outlets vs internal) over time.

**Metrics:** Count of `stock_out` per day/week/month; split by self_stock_out (outlet vs self). Optionally sum of value (from stock_out_items × cost; cost may need batch lookup).  
**Data source:** `stock_out`; for value: `stock_out_items` + cost from batches or material_costs.  
**Visualization:** Line or stacked bar — time on X-axis; series: outlet allocations, self stock-out.  
**Filters:** Cloud kitchen, date range.

---

#### 3.4.2 Self Stock-Out by Reason (Wastage, Staff Food, Internal Production, etc.)

**Purpose:** Break down internal consumption by reason for control and wastage tracking.

**Metrics:** Count and optionally quantity/value by `reason` (e.g. wastage, staff-food, internal-production).  
**Data source:** `stock_out` WHERE self_stock_out = true, optionally JOIN stock_out_items for quantity.  
**Visualization:** Donut or bar — reason on X-axis, count or quantity on Y-axis.  
**Filters:** Cloud kitchen, date range.

---

#### 3.4.3 Allocation Requests Fulfillment

**Purpose:** How many requests are pending vs packed and timing.

**Metrics:**  
- Count of allocation_requests by request_date and is_packed (pending vs packed).  
- Average time from request_date to stock_out.created_at (if linked).  
**Data source:** `allocation_requests`; optionally JOIN `stock_out` on allocation_request_id.  
**Visualization:** Table or small KPI: “Pending today”, “Pending this week”; bar chart of requests per day (pending vs packed).  
**Filters:** Cloud kitchen, date range.

---

#### 3.4.4 Outlet Consumption (Quantity or Value)

**Purpose:** Which outlets consume the most (for capacity and fairness).

**Metrics:** Sum of quantity (or value) from `stock_out_items` per outlet_id, for outlet stock-outs only (self_stock_out = false).  
**Data source:** `stock_out` JOIN `stock_out_items` JOIN `outlets`, filtered by self_stock_out = false.  
**Visualization:** Bar chart or table — outlet name (and kitchen), quantity or value, % of total.  
**Filters:** Cloud kitchen, date range.

---

#### 3.4.5 Consumption by Material or Category

**Purpose:** Which materials/categories are allocated most to outlets.

**Metrics:** Sum quantity (or value) from stock_out_items by raw_material_id or category.  
**Data source:** `stock_out` JOIN `stock_out_items` JOIN `raw_materials` (outlet only).  
**Visualization:** Bar chart or table.  
**Filters:** Cloud kitchen, date range, material type.

---

### 3.5 Financial & Cost Analytics

#### 3.5.1 Total Spend (Stock-In) Over Time

**Purpose:** Procurement spend trend (purchase type only or all).

**Metrics:** Sum(stock_in.total_cost) per period; optionally only stock_in_type = 'purchase'.  
**Data source:** `stock_in`.  
**Visualization:** Line or bar chart — time vs INR.  
**Filters:** Cloud kitchen, date range.

---

#### 3.5.2 Cost per Material Over Time

**Purpose:** Price trends for key materials (from material_costs or from stock_in unit costs).

**Metrics:** Average or last unit_cost per raw_material_id per period (from stock_in_items or material_costs).  
**Data source:** `material_costs` (effective_from/effective_to) or `stock_in` JOIN `stock_in_items`.  
**Visualization:** Line chart — material(s) on series, time on X-axis, cost on Y-axis.  
**Filters:** Cloud kitchen, material(s), date range.

---

#### 3.5.3 Inventory Turnover (Concept)

**Purpose:** How fast inventory is used (ratio of consumption to average stock).

**Metrics:** Consumption in period (from stock_out to outlets) / average inventory value or quantity in that period. Requires consumption and inventory series; can be simplified to “value out / average value” for a period.  
**Data source:** stock_out_items (outlet only), inventory or stock_in_batches for average.  
**Visualization:** KPI or small table per kitchen or per material.  
**Filters:** Cloud kitchen, date range.

---

### 3.6 User Activity & Audit

#### 3.6.1 Recent Activity Feed (Stock-In, Stock-Out, Key Actions)

**Purpose:** Timeline of who did what for oversight and audit.

**Metrics:** Last N events: e.g. “Stock-in #x by User A at Kitchen Y”, “Stock-out to Outlet Z by User B”, “Self stock-out (wastage) by User C”.  
**Data source:** `stock_in`, `stock_out` (created_at, received_by/allocated_by), optionally `audit_logs` if populated.  
**Visualization:** Chronological list or timeline; link to detail modals.  
**Filters:** Cloud kitchen, user, entity type, date range.

---

#### 3.6.2 Activity by User (Count of Actions)

**Purpose:** Which staff are most active (stock-in, stock-out) to balance workload and audit.

**Metrics:** Count of stock_in (received_by) and stock_out (allocated_by) per user_id per period.  
**Data source:** `stock_in`, `stock_out` grouped by user.  
**Visualization:** Table — user name, role, kitchen, stock-in count, stock-out count.  
**Filters:** Cloud kitchen, date range, role.

---

#### 3.6.3 Audit Log Viewer (If audit_logs Used)

**Purpose:** Inspect detailed audit trail (create/update/delete, entity type, old/new values).

**Metrics:** Raw audit events with user, action, entity_type, entity_id, old_values, new_values, created_at.  
**Data source:** `audit_logs` JOIN `users`.  
**Visualization:** Searchable/filterable table; optional export.  
**Filters:** User, entity type, action, date range.

---

### 3.7 Alerts & Health

#### 3.7.1 Low-Stock & Out-of-Stock Alerts

**Purpose:** Proactive list of items needing reorder across all kitchens.

**Metrics:** Same as § 3.2.3; can add “days since last stock-in” if you track or infer it.  
**Visualization:** Compact table or alert list; link to inventory and stock-in.  
**Filters:** Cloud kitchen, severity (out vs low).

---

#### 3.7.2 Pending Allocations Summary

**Purpose:** Requests not yet fulfilled (by kitchen or globally).

**Metrics:** Count of allocation_requests WHERE is_packed = false, optionally by request_date.  
**Data source:** `allocation_requests`.  
**Visualization:** KPI + table (outlet, request date, kitchen).  
**Filters:** Cloud kitchen, request date.

---

#### 3.7.3 Data Quality or Anomaly Hints (Optional)

**Purpose:** Simple sanity checks (e.g. negative stock, missing costs, duplicate invoices).

**Metrics:** Count of inventory where quantity < 0; stock_in with total_cost = 0 or null; duplicate (invoice_number, supplier_name, date) per kitchen.  
**Data source:** `inventory`, `stock_in`.  
**Visualization:** Small “Data health” card with counts and links to fix.  
**Filters:** Cloud kitchen.

---

### 3.8 Optional: Trends & Simple Forecasting

#### 3.8.1 Consumption Trend (Outlets)

**Purpose:** Is outlet consumption increasing or decreasing?

**Metrics:** Sum of quantity (or value) per outlet per week/month; show trend (e.g. last 3 months).  
**Data source:** `stock_out` + `stock_out_items` (outlet only).  
**Visualization:** Line chart per outlet or mini sparklines in outlet table.  
**Filters:** Cloud kitchen, outlet, date range.

---

#### 3.8.2 Reorder Suggestions (Heuristic)

**Purpose:** Suggest “consider reordering” for low-stock items with recent consumption.

**Metrics:** For each (kitchen, material) with low/zero stock: recent consumption rate (e.g. last 7 or 30 days from stock_out); suggest “order X units” based on rate × lead time (if you have lead time).  
**Data source:** `inventory`, `raw_materials`, `stock_out_items`, `stock_out`.  
**Visualization:** Table — material, kitchen, current stock, threshold, avg daily consumption, suggested order.  
**Filters:** Cloud kitchen.

---

## 4. Filters & Global Controls

- **Date range:** Start/end date; presets: Today, This week, This month, Last month, Quarter, YTD.
- **Cloud kitchen:** Dropdown “All” or specific kitchen (for all widgets that support it).
- **As-of date:** For point-in-time metrics (e.g. inventory value) if you support history.

Keep filter state in URL or global dashboard state so all widgets respect the same context.

---

## 5. Implementation Notes

### 5.1 Backend / Data Layer

- **Views:** Create SQL views for heavy aggregations (e.g. inventory value by kitchen, low-stock list, consumption by outlet) to keep frontend queries simple and consistent.
- **RPC or Edge Functions:** For complex metrics (e.g. turnover, reorder suggestions), consider Supabase RPC or Edge Functions to avoid large client-side computation.
- **Caching:** Cache aggregated KPIs (e.g. 5–15 min) to reduce load; real-time where necessary (e.g. pending allocations).
- **RLS:** Admin-only routes must enforce `role = 'admin'` and allow reading all kitchens; avoid filtering by cloud_kitchen_id for admin dashboard APIs when “all” is selected.

### 5.2 Frontend

- **Layout:** Use a grid: KPI strip on top, then mix of charts and tables; “Cloud kitchen comparison” and “Low-stock report” are good above-the-fold candidates.
- **Drill-down:** Where useful, link widgets to existing pages (e.g. Stock In, Stock Out, Inventory, Outlets) with filters pre-filled (kitchen, date, material).
- **Empty states:** Handle “no data” and “no access” clearly; show “Select a date range” when needed.
- **Export:** For tables, support CSV (and optionally PDF) export for reports and audit.

### 5.3 Prioritization Suggestion

**Phase 1 (Must-have):**  
- § 3.1.1 Org Summary KPI Strip  
- § 3.1.2 Cloud Kitchen Comparison Table  
- § 3.2.3 Low-Stock & Out-of-Stock Report  
- § 3.3.1 Stock-In Volume & Count Over Time  
- § 3.4.1 Stock-Out Volume (Outlet vs Self)  
- § 3.6.1 Recent Activity Feed  

**Phase 2 (High value):**  
- § 3.2.2 Inventory Value by Kitchen  
- § 3.3.2 Stock-In by Type  
- § 3.4.2 Self Stock-Out by Reason  
- § 3.4.4 Outlet Consumption  
- § 3.5.1 Total Spend Over Time  
- § 3.7.1 & 3.7.2 Alerts and Pending Allocations  

**Phase 3 (Nice-to-have):**  
- § 3.2.1 Inventory Value Over Time (needs snapshots)  
- § 3.2.4 Top Materials by Value  
- § 3.3.3 Top Suppliers  
- § 3.4.3 Allocation Fulfillment  
- § 3.5.2 Cost per Material  
- § 3.6.2 Activity by User  
- § 3.6.3 Audit Log Viewer  
- § 3.7.3 Data Quality  
- § 3.8.x Trends & Reorder Suggestions  

---

## 6. Summary Table of Widgets

| # | Widget | Category | Main metrics | Suggested viz |
|---|--------|----------|--------------|----------------|
| 1 | Org Summary KPI Strip | Overview | Kitchens, outlets, users, materials, low-stock, value | KPI cards |
| 2 | Cloud Kitchen Comparison | Overview | Per-kitchen: value, stock-in/out counts, low-stock, pending | Table |
| 3 | Inventory Value Over Time | Inventory | Total value by time | Line/area |
| 4 | Inventory Value by Kitchen | Inventory | Current value per kitchen | Bar/donut |
| 5 | Low-Stock & Out-of-Stock Report | Inventory | List of low/out items | Table |
| 6 | Top Materials by Value | Inventory | Material × value | Bar/table |
| 7 | Stock-In Volume Over Time | Procurement | Count/value by time, by type | Line/bar |
| 8 | Stock-In by Type | Procurement | Purchase vs kitchen share | Donut/stacked |
| 9 | Top Suppliers | Procurement | Spend/volume by supplier | Bar/table |
| 10 | Stock-In by Material/Category | Procurement | Quantity/value by material | Bar/table |
| 11 | Stock-Out Volume Over Time | Allocations | Outlet vs self by time | Line/stacked bar |
| 12 | Self Stock-Out by Reason | Allocations | Wastage, staff-food, etc. | Donut/bar |
| 13 | Allocation Requests Fulfillment | Allocations | Pending vs packed, timing | Table/KPI |
| 14 | Outlet Consumption | Allocations | Quantity/value by outlet | Bar/table |
| 15 | Consumption by Material/Category | Allocations | By material/category | Bar/table |
| 16 | Total Spend Over Time | Financial | Procurement spend | Line/bar |
| 17 | Cost per Material Over Time | Financial | Unit cost trend | Line |
| 18 | Inventory Turnover | Financial | Consumption vs stock | KPI/table |
| 19 | Recent Activity Feed | Audit | Last N events | Timeline/list |
| 20 | Activity by User | Audit | Count by user | Table |
| 21 | Audit Log Viewer | Audit | Full audit trail | Table |
| 22 | Low-Stock Alerts | Alerts | Same as § 3.2.3 | Table/list |
| 23 | Pending Allocations Summary | Alerts | Unfulfilled requests | KPI/table |
| 24 | Data Quality Hints | Alerts | Anomalies | Card/table |
| 25 | Consumption Trend | Trends | Outlet trend | Line/sparkline |
| 26 | Reorder Suggestions | Trends | Suggested order qty | Table |

---

## 7. Important Analytics Not Possible Today (Data Gaps + Next Steps)

This section covers high-impact analytics that are strategically important for Gastronomix but are **not fully computable** with currently available data sources. For each, this document defines what additional data must be captured and how to operationalize it.

### 7.1 Gap Map — Priority Analytics Requiring New Data

| Priority | Analytics / Widget | Why important | Why blocked today | New data required |
|----------|--------------------|---------------|-------------------|-------------------|
| P0 | Service Level (Fill Rate) by Outlet | Measures allocation quality and outlet satisfaction | Request line-item demanded qty vs fulfilled qty is not fully preserved for every flow | Requested quantity and fulfilled quantity at item level, request->stock_out linkage quality |
| P0 | Supplier OTIF + Lead Time Reliability | Prevents stock-outs and unstable procurement | No purchase order lifecycle or promised delivery date tracking | PO, PO items, expected delivery date/time, actual received date/time, short receipt flags |
| P0 | Stock Accuracy & Shrinkage | Detects pilferage/process loss | No cycle-count/physical-count module | Scheduled counts, counted qty, system qty at count time, variance reason |
| P0 | Expiry Risk & Shelf-Life Loss | Reduces avoidable wastage and compliance risk | Batches lack expiry/manufacture data and expiry disposal events | Expiry date, manufactured date, lot/batch number, disposal reason/qty/date |
| P1 | Theoretical vs Actual Consumption Variance | Core control KPI for kitchen operations | No recipes/BOM and no sales-to-consumption mapping | Recipe master, recipe ingredients, outlet sales qty, production batches |
| P1 | Menu-Level COGS and Gross Margin | Connects inventory to business profitability | No sales revenue and recipe cost rollups | POS sales feed (item, qty, net sales), recipe cost engine, taxes/discounts |
| P1 | Forecast Accuracy (Demand vs Actual) | Improves procurement planning and waste reduction | No explicit forecast records to compare against actual | Forecast table per outlet/material/menu + generated_at + horizon |
| P1 | Procurement Price Variance (PPV) | Tracks vendor negotiation effectiveness | Inconsistent supplier linkage and no baseline contract price | Vendor contracts/rate cards, PO unit price, GRN received price |
| P2 | Internal Production Yield Analytics | Monitors semi-finished/finished conversion efficiency | No explicit input-output production transaction model | Production batch records, input material qty, output qty, standard yield |
| P2 | Working Capital Coverage (Days of Inventory on Hand) | Finance planning and liquidity control | Historical consumption/value series incomplete at daily granularity | Inventory snapshots, rolling daily consumption values |
| P2 | Wastage Cost Attribution | Quantifies wastage cost by reason/location/owner | Wastage reasons exist but cost attribution and event detail are limited | Wastage event ledger with cost basis method and owner/context |
| P3 | Sustainability Dashboard (CO2 / water proxy) | Long-term ESG and brand positioning | No emission factors or sustainability metadata | Material-level emission factors and sustainability attributes |

---

### 7.2 Detailed Playbooks for Each “Currently Not Possible” Analytics

#### 7.2.1 Service Level (Fill Rate) by Outlet and Material

**Business question:** Are outlets receiving what they requested, on time and in full?  
**Current blocker:** `allocation_requests` exists, but consistently comparable requested-vs-fulfilled item-level data needs to be guaranteed.

**Minimum data capture needed:**
- `allocation_request_items.requested_qty`
- `stock_out_items.fulfilled_qty` (or reuse `quantity` with clear semantic)
- Item-level mapping key: `allocation_request_item_id` on `stock_out_items`
- Timestamps for request submitted, packed, dispatched, delivered (if delivery stage exists)

**New KPIs enabled:**
- Fill rate = fulfilled_qty / requested_qty
- Perfect fill % = requests with 100% fulfillment
- Partial fulfillment % by outlet, kitchen, material
- Average fulfillment cycle time

**Widget ideas:**
- Fill-rate heatmap (outlet × material category)
- Outlet SLA leaderboard
- “Top under-fulfilled materials” table

---

#### 7.2.2 Supplier Reliability: OTIF, Lead Time, and Rejection Rate

**Business question:** Which suppliers are dependable and should receive more procurement share?  
**Current blocker:** No end-to-end PO process with promised dates and receipt variances.

**Minimum data capture needed:**
- `purchase_orders` (supplier, created_at, expected_delivery_at, status)
- `purchase_order_items` (material, ordered_qty, ordered_unit_price)
- `goods_receipts` / stock-in mapping (received_at, received_qty, rejected_qty, reason)
- `supplier_id` normalization (avoid free-text supplier names for analytics)

**New KPIs enabled:**
- On-time % (receipt date <= expected date)
- In-full % (received_qty >= ordered_qty)
- OTIF %
- Lead time avg/p90 by supplier and material
- Rejection/quality issue rate

**Widget ideas:**
- Supplier scorecard table
- Lead-time distribution chart by supplier
- OTIF trend over last 12 weeks

---

#### 7.2.3 Stock Accuracy & Shrinkage Control

**Business question:** Is system inventory aligned with physical stock?  
**Current blocker:** No regular physical counting transactions.

**Minimum data capture needed:**
- `inventory_counts` (count_date, scope, counted_by, approved_by)
- `inventory_count_items` (material, system_qty, counted_qty, variance_qty, reason_code)
- Reason taxonomy: counting error, spoilage, pilferage, process loss, unrecorded usage

**New KPIs enabled:**
- Stock accuracy % = 1 - (absolute variance / system qty baseline)
- Shrinkage % and shrinkage value by kitchen
- Variance by category/material and by user/team

**Widget ideas:**
- Accuracy trend line (monthly cycle counts)
- Variance waterfall (system vs physical)
- Top shrinkage materials and root causes

---

#### 7.2.4 Expiry Risk and Shelf-Life Loss

**Business question:** How much stock is at risk of expiry, and where?  
**Current blocker:** Batch expiry/manufacturing metadata is not consistently captured.

**Minimum data capture needed:**
- Add to `stock_in_batches`: `lot_number`, `manufactured_on`, `expires_on`
- `wastage_events` with reason = expired, near-expiry disposal, contamination, etc.
- FEFO indicator support in stock-out logic (future enhancement)

**New KPIs enabled:**
- Expiry risk value in next 3/7/14 days
- Expired stock loss (qty and INR)
- Near-expiry utilization %

**Widget ideas:**
- “Expiring soon” queue by kitchen
- Expiry-loss trend chart
- Category-wise shelf-life risk donut

---

#### 7.2.5 Theoretical vs Actual Consumption Variance

**Business question:** Are outlets/kitchens consuming inventory as expected from production/sales?  
**Current blocker:** No recipe/BOM model and no sales integration.

**Minimum data capture needed:**
- `recipes` and `recipe_items` with standard ingredient quantities
- `sales_daily` (outlet, menu_item, sold_qty, net_sales)
- Optional `production_batches` for in-house production events

**New KPIs enabled:**
- Theoretical consumption (recipe standard × sold qty)
- Actual consumption (stock_out + self stock_out + wastage)
- Variance % by material/outlet/kitchen
- “Unexplained consumption” cost

**Widget ideas:**
- Variance matrix (material × outlet)
- Top unexplained-loss materials
- Weekly theoretical-vs-actual trend

---

#### 7.2.6 Menu-Level COGS and Gross Margin

**Business question:** Which menu items are profitable after ingredient cost?  
**Current blocker:** Missing sales revenue linkage and recipe roll-up.

**Minimum data capture needed:**
- POS integration (`sales_daily` per menu item)
- Recipe mapping of menu items to ingredients
- Costing basis definition (latest cost vs weighted average vs FIFO-derived)

**New KPIs enabled:**
- Menu COGS %
- Gross margin %
- Margin erosion trend due to ingredient inflation

**Widget ideas:**
- Menu profitability leaderboard
- Margin trend by outlet/kitchen
- Low-margin alert panel

---

#### 7.2.7 Forecast Accuracy & Planning Effectiveness

**Business question:** Are planning forecasts reliable enough to drive procurement?  
**Current blocker:** Forecast values are not stored as first-class data.

**Minimum data capture needed:**
- `demand_forecasts` with dimensions: date, outlet/kitchen, material/menu item, forecast_qty, model/source
- Forecast versioning and generated timestamp

**New KPIs enabled:**
- MAPE / WAPE by horizon
- Bias (systematically over/under forecasting)
- Forecast-driven stock-out risk

**Widget ideas:**
- Forecast vs actual line chart
- Accuracy by horizon (D+1, D+3, D+7)
- Biased SKU watchlist

---

#### 7.2.8 Procurement Price Variance (PPV)

**Business question:** Are actual buy prices deviating from benchmark/contract?  
**Current blocker:** No normalized contract/rate-card baseline and PO-to-receipt comparison.

**Minimum data capture needed:**
- `vendor_rate_cards` or contract price table with effective dates
- PO unit price and receipt unit price
- Unit conversion integrity (`kg`, `g`, `l`, etc.) across all records

**New KPIs enabled:**
- PPV = actual_received_price - baseline_price
- Weighted PPV impact on monthly spend
- Vendor/material-level inflation alerts

**Widget ideas:**
- PPV heatmap (supplier × material)
- Monthly PPV impact bar chart
- Top adverse PPV items table

---

## 8. Data Collection Blueprint for Advanced Analytics

This section translates analytics ambition into implementation steps, so teams can execute in phases.

### 8.1 Recommended New Tables / Fields

| Area | Recommended objects | Purpose |
|------|---------------------|---------|
| Procurement lifecycle | `purchase_orders`, `purchase_order_items`, `goods_receipts` | Capture ordered vs received detail and supplier lead-time behavior |
| Physical inventory controls | `inventory_counts`, `inventory_count_items` | Capture stock accuracy and variance reasons |
| Shelf-life and wastage | `stock_in_batches.expires_on`, `wastage_events` | Quantify expiry risk and wastage value |
| Demand and sales | `sales_daily`, `demand_forecasts` | Enable forecasting and menu profitability |
| Recipe intelligence | `recipes`, `recipe_items`, `menu_items` | Theoretical consumption and COGS calculations |
| Pricing baselines | `vendor_rate_cards` | Procurement variance tracking |

### 8.2 Data Contract Standards (Must Define Before Building Widgets)

- **Entity IDs:** Every transactional row should have immutable IDs and clear foreign keys.
- **Timestamp discipline:** Store UTC timestamps (`created_at`, `event_at`) and render local time in UI.
- **Units of measure:** Enforce canonical units and conversion factors (no mixed-unit ambiguity).
- **Reason codes:** Use controlled enums for wastage, variance, rejection, cancellation.
- **Soft-delete policy:** Keep historical visibility; avoid hard delete for transactional tables.
- **Versioning:** Forecasts, recipes, and rate cards need effective date ranges and version IDs.

### 8.3 Collection Workflow Changes in Product Screens

- **Stock-In flow:** Add supplier, PO reference, expected delivery, invoice metadata validation.
- **Stock-Out flow:** Preserve request-item linkage and partial fulfillment records.
- **Inventory module:** Add cycle-count workflow with manager approval.
- **Kitchen production flow (new):** Input materials consumed and output produced (semi/finished goods).
- **Wastage logging (new):** Mandatory reason + quantity + approval for high-value items.

### 8.4 Data Quality & Reconciliation Jobs

Implement daily/weekly jobs:
- Reconcile requested vs fulfilled quantities.
- Reconcile PO ordered vs received quantities.
- Flag missing unit costs for transactions.
- Flag high variance counts without reason codes.
- Flag stale forecasts and stale rate cards.

### 8.5 Security & Access for New Data

- Admin: full cross-kitchen access to all analytical entities.
- Purchase Manager: kitchen-scoped access to procurement, inventory, wastage, and counts.
- Supervisor: kitchen-scoped access to requests/fulfillment/allocations; restricted procurement pricing if required.
- Sensitive fields (contract prices, margin %) can be masked or role-scoped.

---

## 9. Delivery Roadmap for “Not Possible Yet” Analytics

### Phase A (Foundation: 2-4 weeks)
- Standardize IDs, enums, units, and timestamps.
- Add minimal schema fields: expiry dates, request-item linkage quality, variance reasons.
- Start data quality checks and basic monitoring.

### Phase B (Operational Capture: 4-8 weeks)
- Build procurement lifecycle records (PO -> receipt).
- Build cycle-count workflows.
- Build wastage event capture.
- Improve supplier and item master consistency.

### Phase C (Business Intelligence: 6-10 weeks)
- Integrate POS sales feed.
- Add recipe/BOM and production batch model.
- Add forecast storage and versioning.
- Ship advanced widgets: fill rate SLA, OTIF, shrinkage, expiry risk, theoretical vs actual, menu margin.

### Phase D (Optimization: ongoing)
- Add forecasting models and alerting.
- Add automated reorder recommendations with confidence score.
- Add supplier scorecards with quarterly benchmarking.

**Exit criteria to move phases:**  
Each phase should define data completeness thresholds (for example, “95% of stock-ins linked to supplier + PO”), because advanced analytics are only reliable when source capture quality is high.

---

This document is intended to be the single reference for **what to build now** on the admin dashboard and **what data to capture next** for advanced analytics that are currently not feasible. Implementation details (APIs, component structure, chart library) can be documented separately and linked here.
