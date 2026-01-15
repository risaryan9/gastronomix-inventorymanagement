# Setup Instructions

## 1. Database Setup

### Run SQL Scripts in Supabase SQL Editor

All migration files are in the `migrations/` folder. See `migrations/README.md` for detailed instructions.

1. **Run the main schema** (`migrations/supabase-schema.sql`)
   - Creates all tables, indexes, and RLS policies

2. **Add key-based login policy** (`migrations/add-key-login-policy.sql` or `migrations/add-key-login-policy-alternative.sql`)
   - Allows login_key lookups for authentication
   - Run this in Supabase SQL Editor
   - Use the alternative version if you get syntax errors

3. **Seed initial data** (`migrations/seed-data.sql`)
   - Creates cloud kitchens, users, and outlets

## 2. Admin User Setup

The admin user needs to be created in Supabase Auth. You have two options:

### Option A: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Users**
3. Click **Add User** → **Create new user**
4. Enter:
   - Email: `admin@gastronomix.com`
   - Password: (from your .env file, default: `pass123`)
   - Auto Confirm User: ✅ (checked)
5. After creating, note the User ID
6. Update the `users` table to match the auth user ID:
   ```sql
   UPDATE users 
   SET id = '<auth_user_id_from_supabase>' 
   WHERE email = 'admin@gastronomix.com';
   ```

### Option B: Using Setup Script

1. Install dependencies:
   ```bash
   npm install dotenv @supabase/supabase-js
   ```

2. Run the setup script:
   ```bash
   node backend/setup-admin-user.js
   ```

## 3. Frontend Setup

1. **Create `.env` file in `frontend` directory:**
   ```env
   VITE_SUPABASE_URL=https://zyjdzkrtdwlcwkpfnxya.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_YbOJ_g09hCR3fiep6SUiTg_3ffc9cdK
   ```

2. **Install dependencies:**
   ```bash
   cd frontend
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## 4. Login Credentials

**Note:** All login credentials are stored in the Supabase database. The keys below are from the initial seed data for development/testing purposes.

### Admin
- **Email:** `admin@gastronomix.com`
- **Password:** (from your .env file)
- **Storage:** Email/password stored in Supabase Auth

### Purchase Manager
- **Login Key:** `PM-KEY-2024-ABC123XYZ` (from seed data)
- **Storage:** `login_key` field in `users` table in Supabase database
- **How it works:** The login form queries the database to verify the key

### Supervisor
- **Login Key:** `SUP-KEY-2024-DEF456UVW` (from seed data)
- **Storage:** `login_key` field in `users` table in Supabase database
- **How it works:** The login form queries the database to verify the key

### Viewing/Managing Login Keys

To view or change login keys, query the `users` table in Supabase:

```sql
-- View all users and their login keys
SELECT id, full_name, role, login_key, email, is_active 
FROM users 
WHERE role IN ('purchase_manager', 'supervisor');

-- Update a login key
UPDATE users 
SET login_key = 'NEW-KEY-HERE' 
WHERE id = '<user_id>';
```

**Important:** Login keys are fetched dynamically from the database - they are NOT hardcoded in the application.

## 5. Troubleshooting

### "Missing Supabase environment variables"
- Make sure `.env` file is in the `frontend` directory
- Restart the dev server after creating/updating `.env`

### "Invalid login key or user not found"
- Make sure you ran `migrations/add-key-login-policy.sql` in Supabase
- Verify the login key matches exactly (case-sensitive)
- Check that the user is active in the database

### "400 Bad Request" on admin login
- Admin user must be created in Supabase Auth first
- The user ID in `users` table must match the auth user ID
- Verify email and password are correct

### "500 Internal Server Error" on key login
- Check that RLS policy for login_key lookup is created
- Verify the users table has the correct data
- Check Supabase logs for detailed error
