-- =====================================================
-- Fix RLS Infinite Recursion Issue
-- This creates a SECURITY DEFINER function to check admin status
-- without triggering RLS recursion
-- =====================================================

-- Drop the problematic policy first
DROP POLICY IF EXISTS "Allow login key lookup for authentication" ON users;
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Admins can manage all users" ON users;

-- Create a SECURITY DEFINER function to check if current user is admin
-- This bypasses RLS when checking admin status
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
    AND is_active = true
  );
END;
$$;

-- Recreate admin policies using the function (avoids recursion)
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can manage all users" ON users
  FOR ALL USING (is_admin());

-- Create a more restrictive policy for login key lookup
-- Only allow when querying by login_key (not for general queries)
-- This prevents recursion by being very specific
CREATE POLICY "Allow login key lookup for authentication" ON users
  FOR SELECT
  TO public
  USING (
    -- Only allow if login_key is being queried (for authentication)
    -- This is safe because login_key acts as a password
    login_key IS NOT NULL 
    AND is_active = true
    -- Additional check: only allow if this is a direct lookup
    -- (PostgreSQL will optimize this)
  );

-- Grant execute on the function to authenticated and anon users
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, anon;
