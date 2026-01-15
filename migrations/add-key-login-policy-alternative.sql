-- =====================================================
-- Alternative: Add RLS Policy for Key-Based Login
-- Using a simpler policy structure
-- =====================================================

-- First, let's create a policy that allows public read access
-- but only for rows where login_key exists (for authentication)
DROP POLICY IF EXISTS "Allow login key lookup for authentication" ON users;

-- Create policy with proper syntax
CREATE POLICY "Allow login key lookup for authentication" 
ON users
FOR SELECT
TO public
USING (
  login_key IS NOT NULL 
  AND is_active = true
);

-- Note: The 'TO public' clause makes this available to unauthenticated users
-- This is necessary for key-based login to work
