# Backend - Supabase Functions

This folder contains backend scripts and Supabase Edge Functions for the Gastronomix Inventory Management System.

## Structure

```
backend/
├── setup-admin-user.js    # Script to create admin user in Supabase Auth
└── functions/             # Supabase Edge Functions (to be created)
    └── ...
```

## Setup Scripts

### setup-admin-user.js

Creates the admin user in Supabase Auth and links it to the users table.

**Prerequisites:**
- Admin user must exist in `users` table (from seed-data.sql)
- `.env` file in project root with:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`
  - `ADMIN_USER_ID`

**Usage:**
```bash
npm install dotenv @supabase/supabase-js
node backend/setup-admin-user.js
```

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
