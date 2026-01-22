-- =====================================================
-- Create Login Function with SECURITY DEFINER
-- This function bypasses RLS for login key lookups
-- =====================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.authenticate_user_by_key(TEXT, TEXT, UUID);

-- Create function to authenticate user by login key
-- This function bypasses RLS using SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.authenticate_user_by_key(
  p_login_key TEXT,
  p_role TEXT,
  p_cloud_kitchen_id UUID
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  cloud_kitchen_id UUID,
  is_active BOOLEAN,
  login_key TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.cloud_kitchen_id,
    u.is_active,
    u.login_key,
    u.created_at,
    u.updated_at
  FROM public.users u
  WHERE u.login_key = p_login_key
    AND u.role = p_role
    AND u.cloud_kitchen_id = p_cloud_kitchen_id
    AND u.is_active = true
    AND u.deleted_at IS NULL
  LIMIT 1;
END;
$$;

-- Grant execute permission to public (for unauthenticated login)
GRANT EXECUTE ON FUNCTION public.authenticate_user_by_key(TEXT, TEXT, UUID) TO public, authenticated, anon;

-- Add comment explaining the function
COMMENT ON FUNCTION public.authenticate_user_by_key(TEXT, TEXT, UUID) IS 
'Authenticates a user by login key, role, and cloud kitchen ID. Bypasses RLS for login purposes. Returns user data if all parameters match.';
