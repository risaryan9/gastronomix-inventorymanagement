# API Specifications
## Gastronomix Inventory Management System

This document outlines the API endpoints and Supabase Functions required for the system.

---

## Architecture Overview

- **Database:** Supabase PostgreSQL (direct queries via Supabase client)
- **Backend Logic:** Supabase Edge Functions (Deno runtime)
- **Authentication:** Supabase Auth (JWT tokens)
- **Real-time:** Supabase Realtime (optional for live updates)

---

## Authentication & Authorization

All API requests require authentication via Supabase JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

Role-based access is enforced via:
1. Row Level Security (RLS) policies in database
2. Function-level role checks in Edge Functions

---

## API Endpoints

### Base URL
- Local: `http://localhost:54321/functions/v1/`
- Production: `https://<project-ref>.supabase.co/functions/v1/`

---

## 1. Authentication APIs

### 1.1 Login
**Endpoint:** Supabase Auth (built-in)  
**Method:** POST  
**Path:** `/auth/v1/token?grant_type=password`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "jwt_token",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

---

### 1.2 Get Current User
**Endpoint:** Supabase Client (direct query)  
**Table:** `users`  
**Query:** Filter by `auth.uid()`

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "supervisor",
  "cloud_kitchen_id": "uuid",
  "is_active": true
}
```

---

## 2. Allocation APIs

### 2.1 Create Allocation
**Endpoint:** Supabase Edge Function (transaction required)  
**Function:** `create-allocation`

**Request:**
```json
{
  "outlet_id": "uuid",
  "allocation_date": "2024-01-15",
  "notes": "Allocation based on paper request",
  "items": [
    {
      "raw_material_id": "uuid",
      "quantity": 10.0
    },
    {
      "raw_material_id": "uuid",
      "quantity": 5.0
    }
  ]
}
```

**Response:**
```json
{
  "id": "uuid",
  "outlet_id": "uuid",
  "allocation_date": "2024-01-15",
  "created_at": "2024-01-15T10:00:00Z",
  "items": [...]
}
```

**Error Response (insufficient stock):**
```json
{
  "error": "Insufficient stock",
  "details": {
    "raw_material_id": "uuid",
    "raw_material_name": "Flour",
    "allocation_quantity": 10.0,
    "available": 7.5
  }
}
```

**Function Logic:**
1. Validate user permissions (supervisor/purchase_manager/admin)
2. Validate outlet belongs to user's cloud kitchen
3. Begin transaction
4. Validate sufficient inventory for all items
5. Create allocation record
6. Create allocation_items
7. Update inventory (reduce quantities via trigger)
8. Commit transaction

---

### 2.2 Get Allocations
**Endpoint:** Supabase Client  
**Table:** `allocations` (with joins)

**Query Parameters:**
- `outlet_id`: uuid
- `cloud_kitchen_id`: uuid
- `start_date`: YYYY-MM-DD
- `end_date`: YYYY-MM-DD
- `limit`: number
- `offset`: number

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "outlet_id": "uuid",
      "outlet_name": "Outlet 1",
      "allocation_date": "2024-01-15",
      "allocated_by": "uuid",
      "allocated_by_name": "John Doe",
      "items": [
        {
          "raw_material_id": "uuid",
          "raw_material_name": "Flour",
          "quantity": 10.0,
          "unit": "kg"
        }
      ],
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "count": 50
}
```

---

## 3. Inventory APIs

### 3.1 Get Inventory
**Endpoint:** Supabase Client  
**Table:** `inventory` (with joins)

**Query Parameters:**
- `cloud_kitchen_id`: uuid (optional for admin)
- `raw_material_id`: uuid
- `low_stock_only`: boolean

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "cloud_kitchen_id": "uuid",
      "cloud_kitchen_name": "Cloud Kitchen 1",
      "raw_material_id": "uuid",
      "raw_material_name": "Flour",
      "raw_material_code": "RM001",
      "unit": "kg",
      "quantity": 50.5,
      "low_stock_threshold": 10.0,
      "is_low_stock": false,
      "last_updated_at": "2024-01-15T09:00:00Z"
    }
  ]
}
```

---

### 3.2 Get Low Stock Alerts
**Endpoint:** Supabase Client  
**Table:** `inventory` (with filter)

**Query:** `quantity <= low_stock_threshold AND cloud_kitchen_id = ?`

**Response:**
```json
{
  "data": [
    {
      "raw_material_id": "uuid",
      "raw_material_name": "Flour",
      "quantity": 8.5,
      "low_stock_threshold": 10.0,
      "cloud_kitchen_id": "uuid",
      "cloud_kitchen_name": "Cloud Kitchen 1"
    }
  ],
  "count": 3
}
```

---

### 3.3 Update Low Stock Threshold
**Endpoint:** Supabase Client  
**Table:** `inventory`

**Request:**
```json
{
  "low_stock_threshold": 15.0
}
```

**Response:**
```json
{
  "id": "uuid",
  "low_stock_threshold": 15.0,
  "updated_at": "2024-01-15T10:00:00Z"
}
```

---

## 4. Stock-In APIs

### 4.1 Create Stock-In
**Endpoint:** Supabase Edge Function (transaction required)  
**Function:** `create-stock-in`

**Request:**
```json
{
  "cloud_kitchen_id": "uuid",
  "receipt_date": "2024-01-15",
  "supplier_name": "Supplier ABC",
  "invoice_number": "INV-001",
  "notes": "Bulk purchase",
  "items": [
    {
      "raw_material_id": "uuid",
      "quantity": 100.0,
      "unit_cost": 5.50,
      "total_cost": 550.00
    }
  ]
}
```

**Response:**
```json
{
  "id": "uuid",
  "cloud_kitchen_id": "uuid",
  "receipt_date": "2024-01-15",
  "total_cost": 550.00,
  "items": [...],
  "created_at": "2024-01-15T10:00:00Z"
}
```

**Function Logic:**
1. Validate user permissions (Purchase Manager or Admin)
2. Start transaction
3. Create stock_in record
4. Create stock_in_items
5. Update inventory (increase quantities via trigger)
6. Update material_costs if cost changed
7. Commit transaction

---

### 4.2 Get Stock-In History
**Endpoint:** Supabase Client  
**Table:** `stock_in` (with joins)

**Query Parameters:**
- `cloud_kitchen_id`: uuid
- `start_date`: YYYY-MM-DD
- `end_date`: YYYY-MM-DD
- `supplier_name`: string
- `limit`: number
- `offset`: number

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "cloud_kitchen_id": "uuid",
      "cloud_kitchen_name": "Cloud Kitchen 1",
      "receipt_date": "2024-01-15",
      "supplier_name": "Supplier ABC",
      "invoice_number": "INV-001",
      "total_cost": 550.00,
      "received_by": "uuid",
      "received_by_name": "Jane Doe",
      "items": [
        {
          "raw_material_id": "uuid",
          "raw_material_name": "Flour",
          "quantity": 100.0,
          "unit_cost": 5.50,
          "total_cost": 550.00
        }
      ],
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "count": 30
}
```

---

## 5. Raw Materials APIs

### 5.1 Get Raw Materials
**Endpoint:** Supabase Client  
**Table:** `raw_materials`

**Query Parameters:**
- `category`: string
- `search`: string (name/code)
- `is_active`: boolean
- `limit`: number
- `offset`: number

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Flour",
      "code": "RM001",
      "unit": "kg",
      "category": "Ingredients",
      "description": "All-purpose flour",
      "current_cost": 5.50,
      "is_active": true
    }
  ],
  "count": 100
}
```

---

### 5.2 Create Raw Material
**Endpoint:** Supabase Client  
**Table:** `raw_materials`

**Request:**
```json
{
  "name": "Sugar",
  "code": "RM002",
  "unit": "kg",
  "category": "Ingredients",
  "description": "Granulated sugar"
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Sugar",
  "code": "RM002",
  "unit": "kg",
  "category": "Ingredients",
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

### 5.3 Update Raw Material
**Endpoint:** Supabase Client  
**Table:** `raw_materials`

**Request:**
```json
{
  "name": "Sugar - Updated",
  "description": "Updated description",
  "category": "Sweeteners"
}
```

---

### 5.4 Update Material Cost
**Endpoint:** Supabase Edge Function  
**Function:** `update-material-cost`

**Request:**
```json
{
  "raw_material_id": "uuid",
  "cost_per_unit": 6.00,
  "effective_from": "2024-01-15"
}
```

**Function Logic:**
1. Validate user permissions
2. Set old cost record's effective_to
3. Create new material_costs record
4. Return success

---

## 6. Outlets APIs

### 6.1 Get Outlets
**Endpoint:** Supabase Client  
**Table:** `outlets`

**Query Parameters:**
- `cloud_kitchen_id`: uuid
- `is_active`: boolean
- `search`: string

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "cloud_kitchen_id": "uuid",
      "name": "Outlet 1",
      "code": "OUT001",
      "address": "123 Main St",
      "contact_person": "John",
      "contact_phone": "+1234567890",
      "is_active": true
    }
  ]
}
```

---

## 7. Analytics APIs

### 7.1 Get Consumption Summary
**Endpoint:** Supabase Client (View)  
**View:** `consumption_summary`

**Query Parameters:**
- `outlet_id`: uuid
- `cloud_kitchen_id`: uuid
- `raw_material_id`: uuid
- `start_date`: YYYY-MM-DD (default: 30 days ago)
- `end_date`: YYYY-MM-DD (default: today)

**Response:**
```json
{
  "data": [
    {
      "outlet_id": "uuid",
      "outlet_name": "Outlet 1",
      "cloud_kitchen_id": "uuid",
      "cloud_kitchen_name": "Cloud Kitchen 1",
      "raw_material_id": "uuid",
      "raw_material_name": "Flour",
      "total_consumption": 150.5,
      "allocation_days": 10,
      "first_allocation": "2024-01-01",
      "last_allocation": "2024-01-15"
    }
  ]
}
```

---

### 7.2 Get Dashboard Metrics (Admin)
**Endpoint:** Supabase Edge Function  
**Function:** `get-dashboard-metrics`

**Query Parameters:**
- `cloud_kitchen_id`: uuid (optional)
- `start_date`: YYYY-MM-DD
- `end_date`: YYYY-MM-DD

**Response:**
```json
{
  "total_allocations": 150,
  "total_stock_in": 25,
  "low_stock_items": 5,
  "top_consuming_outlets": [
    {
      "outlet_id": "uuid",
      "outlet_name": "Outlet 1",
      "total_consumption": 500.5
    }
  ],
  "cloud_kitchen_metrics": [
    {
      "cloud_kitchen_id": "uuid",
      "cloud_kitchen_name": "CK 1",
      "total_allocations": 50,
      "total_consumption": 1000.0
    }
  ]
}
```

---

## 8. User Management APIs (Admin Only)

### 8.1 Get Users
**Endpoint:** Supabase Client  
**Table:** `users`

**Query Parameters:**
- `role`: supervisor | purchase_manager | admin
- `cloud_kitchen_id`: uuid
- `is_active`: boolean

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "full_name": "John Doe",
      "role": "supervisor",
      "cloud_kitchen_id": "uuid",
      "cloud_kitchen_name": "Cloud Kitchen 1",
      "is_active": true,
      "created_at": "2024-01-01T10:00:00Z"
    }
  ]
}
```

---

### 8.2 Create User
**Endpoint:** Supabase Edge Function  
**Function:** `create-user`

**Request:**
```json
{
  "email": "newuser@example.com",
  "full_name": "Jane Doe",
  "role": "supervisor",
  "cloud_kitchen_id": "uuid",
  "password": "temp_password"
}
```

**Function Logic:**
1. Validate admin permissions
2. Create user in Supabase Auth
3. Create user record in users table
4. Send invitation email (optional)
5. Return user record

---

### 8.3 Update User
**Endpoint:** Supabase Client  
**Table:** `users`

**Request:**
```json
{
  "full_name": "Jane Doe Updated",
  "role": "purchase_manager",
  "cloud_kitchen_id": "uuid",
  "is_active": true
}
```

---

## Supabase Edge Functions Structure

```
supabase/functions/
├── create-allocation/
│   └── index.ts
├── create-stock-in/
│   └── index.ts
├── update-material-cost/
│   └── index.ts
├── get-dashboard-metrics/
│   └── index.ts
└── create-user/
    └── index.ts
```

---

## Error Handling

All APIs should return standardized error responses:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": {
    // Additional error details
  }
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (e.g., insufficient stock)
- `500` - Internal Server Error

---

## Rate Limiting

Consider implementing rate limiting for production:
- Supabase provides built-in rate limiting
- Configure limits per user/role
- Protect against abuse

---

## Caching Strategy (Future)

- Cache frequently accessed data (raw materials catalog)
- Cache dashboard metrics (refresh every 5-10 minutes)
- Use Supabase caching or Redis (if needed)

