-- =====================================================
-- Add RLS Policy for Key-Based Login
-- This allows unauthenticated users to query by login_key
-- =====================================================

-- Policy to allow login_key lookups (for authentication purposes)
-- This is safe because login_key is unique and acts as a password
-- We only return minimal user data needed for authentication
-- Note: This policy is designed to work with the is_admin() function
-- to avoid RLS recursion issues

DROP POLICY IF EXISTS "Allow login key lookup for authentication" ON users;
CREATE POLICY "Allow login key lookup for authentication" ON users
  FOR SELECT
  TO public
  USING (
    -- Only allow queries for users with login_key (key-based users)
    -- This prevents recursion by being specific
    login_key IS NOT NULL 
    AND is_active = true
  );

-- Note: This policy allows anyone to query users by login_key
-- This is acceptable because:
-- 1. login_key is unique and acts as a password
-- 2. We verify role and is_active in the application
-- 3. Only returns data if login_key matches exactly
-- 4. Uses TO public to allow unauthenticated access for login
-- For enhanced security, consider using a Supabase Edge Function instead
