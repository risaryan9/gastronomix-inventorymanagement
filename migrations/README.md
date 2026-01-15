# Database Migrations

This folder contains all SQL migration scripts for the Gastronomix Inventory Management System.

## Migration Order

Run these migrations in the following order in your Supabase SQL Editor:

### 1. Initial Schema Setup
**File:** `supabase-schema.sql`
- Creates all tables, indexes, constraints
- Sets up RLS policies
- Creates views
- **Run this first** - it's the complete database schema

### 2. Fix RLS Recursion (IMPORTANT - Run this first if you get recursion errors)
**File:** `fix-rls-recursion.sql`
- Creates `is_admin()` function to prevent infinite recursion in RLS policies
- Fixes the "infinite recursion detected in policy" error
- **Run this if you encounter recursion errors**

### 3. Key-Based Login Support
**File:** `add-key-login-policy.sql` or `add-key-login-policy-alternative.sql`
- Adds RLS policy to allow login_key lookups for authentication
- **Required for Purchase Manager and Supervisor login**
- Use the alternative version if the first one gives syntax errors
- **Note:** The main schema (supabase-schema.sql) now includes the is_admin() function, so this should work without recursion

### 4. User Login Migration (Optional)
**File:** `migrate-users-login.sql`
- Only run this if you already have a users table and need to migrate to key-based login
- Adds login_key column and constraints
- **Skip if you're starting fresh** (supabase-schema.sql already includes this)

### 5. Seed Data
**File:** `seed-data.sql`
- Creates initial cloud kitchens, users, and outlets
- **Run last** - after all schema is set up
- Contains test data for development
- **Note:** Login keys in seed data are examples - all keys are stored in and fetched from the database

## Quick Start

If you're setting up a fresh database:

```sql
-- 1. Run the main schema
-- Copy and paste supabase-schema.sql into Supabase SQL Editor

-- 2. If you get recursion errors, run fix-rls-recursion.sql
-- (The main schema should already have the fix, but run this if needed)

-- 3. Add key-based login policy
-- Copy and paste add-key-login-policy.sql (or alternative version)

-- 3. Seed initial data
-- Copy and paste seed-data.sql
```

## Managing Login Keys

**Important:** Login keys are stored in the `users` table in the database, NOT hardcoded in the application. The frontend queries the database to verify keys.

### View Login Keys
```sql
SELECT id, full_name, role, login_key, is_active 
FROM users 
WHERE role IN ('purchase_manager', 'supervisor');
```

### Update a Login Key
```sql
UPDATE users 
SET login_key = 'NEW-SECURE-KEY-HERE' 
WHERE id = '<user_id>';
```

### Generate New Login Keys
You can generate secure keys using:
- UUID: `gen_random_uuid()::text`
- Custom format: `'PM-KEY-' || to_char(now(), 'YYYY') || '-' || substr(md5(random()::text), 1, 12)`

## Notes

- All migrations use `IF NOT EXISTS` and `DROP POLICY IF EXISTS` to be idempotent
- You can safely re-run migrations (they won't duplicate data)
- The seed data uses fixed UUIDs for consistency
- **Login keys are dynamically fetched from the database** - never hardcoded in the application
