-- =====================================================
-- 1. Update login_key: remove 2024, add 4 random chars
--    First char = letter (A-Z), next 3 = letter or digit (A-Z0-9)
--    e.g. DE-CK1-2024 → DE-CK1-XK1J
-- =====================================================

UPDATE public.users
SET login_key = (
  regexp_replace(login_key, '-?2024$', '')
  || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 1 + floor(random() * 26)::int, 1)
  || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1 + floor(random() * 36)::int, 1)
  || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1 + floor(random() * 36)::int, 1)
  || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1 + floor(random() * 36)::int, 1)
)
WHERE login_key IS NOT NULL
  AND login_key != ''
  AND login_key ~ '-?2024$';

-- =====================================================
-- 2. Login function: accept any format that normalizes to the same key
--    Normalize: remove dashes, uppercase. So deck1a23f = de-ck1-a23f = DE-CK1-A23F
-- =====================================================

DROP FUNCTION IF EXISTS public.authenticate_user_by_key(TEXT, TEXT, UUID);

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
  WHERE upper(replace(trim(u.login_key), '-', '')) = upper(replace(trim(p_login_key), '-', ''))
    AND u.role = p_role
    AND u.cloud_kitchen_id = p_cloud_kitchen_id
    AND u.is_active = true
    AND u.deleted_at IS NULL
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authenticate_user_by_key(TEXT, TEXT, UUID) TO public, authenticated, anon;

COMMENT ON FUNCTION public.authenticate_user_by_key(TEXT, TEXT, UUID) IS
'Authenticates by login key, role, and cloud kitchen. Compares keys normalized: no dashes, uppercase (e.g. deck1a23f = DE-CK1-A23F).';
