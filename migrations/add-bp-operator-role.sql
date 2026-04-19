-- =====================================================
-- Add Boom Pizza Operator Role (bp_operator)
-- This migration adds support for outlet-specific operators
-- =====================================================

-- 1. Add outlet_map column to users table
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS outlet_map UUID NULL 
  REFERENCES public.outlets(id) ON DELETE RESTRICT;

-- Create index for outlet_map lookups
CREATE INDEX IF NOT EXISTS idx_users_outlet_map 
  ON public.users(outlet_map) 
  WHERE outlet_map IS NOT NULL;

COMMENT ON COLUMN public.users.outlet_map IS 
  'For bp_operator role: the specific outlet this operator manages. NULL for other roles.';

-- 2. Update role check constraint to include bp_operator
ALTER TABLE public.users 
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users 
  ADD CONSTRAINT users_role_check CHECK (
    role = ANY (ARRAY[
      'supervisor'::text,
      'purchase_manager'::text,
      'admin'::text,
      'dispatch_executive'::text,
      'kitchen_executive'::text,
      'bp_operator'::text
    ])
  );

-- 3. Add constraint: bp_operator must have outlet_map and cloud_kitchen_id
-- (using a CHECK constraint with a subquery for cross-column validation)
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_bp_operator_outlet_constraint;

ALTER TABLE public.users
  ADD CONSTRAINT users_bp_operator_outlet_constraint CHECK (
    (role != 'bp_operator') OR (
      role = 'bp_operator' 
      AND cloud_kitchen_id IS NOT NULL 
      AND outlet_map IS NOT NULL
      AND login_key IS NOT NULL
      AND email IS NULL
    )
  );

-- 4. Add constraint: outlet_map must belong to the same cloud_kitchen
-- We'll use a trigger function for this validation
CREATE OR REPLACE FUNCTION validate_outlet_belongs_to_cloud_kitchen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If outlet_map is NULL, validation passes (not a bp_operator or outlet not set yet)
  IF NEW.outlet_map IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Check that the outlet belongs to the user's cloud kitchen
  IF NOT EXISTS (
    SELECT 1 
    FROM public.outlets 
    WHERE id = NEW.outlet_map 
      AND cloud_kitchen_id = NEW.cloud_kitchen_id
  ) THEN
    RAISE EXCEPTION 'Outlet must belong to the same cloud kitchen as the user';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Add trigger to validate outlet belongs to cloud kitchen
DROP TRIGGER IF EXISTS trg_validate_outlet_cloud_kitchen ON public.users;

CREATE TRIGGER trg_validate_outlet_cloud_kitchen
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  WHEN (NEW.outlet_map IS NOT NULL)
  EXECUTE FUNCTION validate_outlet_belongs_to_cloud_kitchen();

-- 5. Create unique index: one active bp_operator per outlet
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_bp_operator_per_outlet
  ON public.users(outlet_map)
  WHERE role = 'bp_operator' 
    AND outlet_map IS NOT NULL 
    AND is_active = true 
    AND deleted_at IS NULL;

COMMENT ON INDEX idx_users_unique_bp_operator_per_outlet IS 
  'Ensures only one active bp_operator can be assigned to each outlet';

-- 6. Update authenticate_user_by_key function to return outlet_map
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
  updated_at TIMESTAMPTZ,
  outlet_map UUID
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
    u.updated_at,
    u.outlet_map
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
  'Authenticates by login key, role, and cloud kitchen. Returns user with outlet_map. Compares keys normalized: no dashes, uppercase (e.g. bpck1a23f = BP-CK1-A23F).';

-- =====================================================
-- Summary of changes:
-- 1. Added users.outlet_map column (FK to outlets with ON DELETE RESTRICT)
-- 2. Updated role check to include bp_operator
-- 3. Added constraint requiring bp_operator to have outlet_map, cloud_kitchen_id, login_key
-- 4. Added validation that outlet belongs to user's cloud kitchen (trigger)
-- 5. Created unique index ensuring one active bp_operator per outlet
-- 6. Updated authenticate_user_by_key to return outlet_map field
-- =====================================================
