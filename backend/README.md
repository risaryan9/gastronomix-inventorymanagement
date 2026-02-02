# Backend - Supabase Functions

This folder contains backend scripts and Supabase Edge Functions for the Gastronomix Inventory Management System.

## Structure

```
backend/
├── setup-admin-user.js      # Script to create admin user in Supabase Auth
├── seed-raw-materials.js    # Script to seed raw materials from CSV
├── materials.csv            # Raw materials data for seeding
└── functions/               # Supabase Edge Functions (to be created)
    └── ...
```

## Setup Scripts

### Prerequisites

Install dependencies first:
```bash
npm install
```

Required `.env` file in project root with:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_USER_ID`

### setup-admin-user.js

Creates the admin user in Supabase Auth and links it to the users table.

**Prerequisites:**
- Admin user must exist in `users` table (from seed-data.sql)

**Usage:**
```bash
npm run setup-admin
# or
node backend/setup-admin-user.js
```

### seed-raw-materials.js

Seeds raw materials from a CSV file. Automatically generates material codes and creates inventory entries for all active cloud kitchens.

**CSV Format:**
The `materials.csv` file should have these columns (tab or comma separated):
- `name` - Material name (required)
- `unit` - Unit of measurement: nos, kg, liter, packets, btl (required)
- `description` - Description of the material
- `category` - One of: Meat, Grains, Vegetables, Oils, Spices, Dairy, Packaging, Sanitary, Misc (required)
- `low_stock_threshold` - Low stock alert threshold (e.g., 45.000)
- `is_active` - TRUE or FALSE
- `brand` - Brand name
- `vendor` - Vendor name

**Example CSV:**
```
name	unit	description	category	low_stock_threshold	is_active	brand	vendor
Amul Butter	kg	Premium quality butter	Dairy	45.000	TRUE	Amul	Hyperpure
Chicken Breast	kg	Fresh boneless chicken	Meat	12.000	TRUE	Local	Fresko Choice
```

**Usage:**
```bash
npm run seed-materials
# or
node backend/seed-raw-materials.js
```

**What happens:**
1. Reads materials from `backend/materials.csv`
2. Auto-generates material codes (e.g., RM-DARY-001, RM-MEAT-042)
3. Inserts materials into `raw_materials` table
4. Trigger automatically creates inventory entries for all active cloud kitchens
5. Shows progress and summary

**Note:** Material codes are auto-generated based on category and existing codes to avoid duplicates.

## Supabase Edge Functions

Supabase Edge Functions will be added here for:
- Authentication helpers
- Business logic
- API endpoints
- Background jobs

### Creating Edge Functions

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Initialize Supabase in the project:
   ```bash
   supabase init
   ```

3. Create a new function:
   ```bash
   supabase functions new function-name
   ```

4. Deploy:
   ```bash
   supabase functions deploy function-name
   ```

## Environment Variables

Backend scripts and functions use environment variables from the root `.env` file:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-side only)
- `ADMIN_EMAIL` - Admin user email
- `ADMIN_PASSWORD` - Admin user password
- `ADMIN_USER_ID` - Admin user UUID from users table
