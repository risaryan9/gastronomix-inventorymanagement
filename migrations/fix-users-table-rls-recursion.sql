-- =====================================================
-- Fix infinite recursion on users table RLS
-- The policy "Admin full access to users" used an inline
-- SELECT from users to check admin status, causing
-- infinite recursion when the app queries users (e.g.
-- after admin login: GET users?id=eq.xxx&role=eq.admin).
-- Fix: Use SECURITY DEFINER is_admin() so the check
-- does not trigger RLS on users.
-- =====================================================

-- 1. Drop the problematic policy (from database_migration.sql)
DROP POLICY IF EXISTS "Admin full access to users" ON public.users;

-- 2. Ensure is_admin() exists and is SECURITY DEFINER
--    (so it bypasses RLS when reading users)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
END;
$$;

-- Grant so authenticated (and anon if needed) can call it
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

-- 3. Recreate admin full access using the function (no recursion)
CREATE POLICY "Admin full access to users" ON public.users
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- NOTES
-- =====================================================
-- - is_admin() runs as the function owner (e.g. postgres),
--   so the inner SELECT from users does not trigger RLS.
-- - "Users read own record" (id = auth.uid()) remains for
--   non-admin users to read their own row.
-- - "Allow login key lookup for authentication" remains for
--   key-based login.
-- - "Users can view names for allocation requests" (if
--   present) allows nested selects for allocation request
--   context.
