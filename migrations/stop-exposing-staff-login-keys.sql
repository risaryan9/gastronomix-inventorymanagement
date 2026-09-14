-- =====================================================================
-- Stop anyone with the public key reading staff login keys
--
-- A login key is the password for every key-login role: purchase managers,
-- supervisors, dispatch and kitchen executives, Boom Pizza operators (23
-- users when this was written). Until this migration, anyone holding the anon
-- key — which ships inside the internal app's JavaScript and is therefore
-- public — could read all of them:
--
--   - public.users has a SELECT policy whose condition is simply `true`
--     ("Users can view names for allocation requests"), for role public;
--   - anon, authenticated and PUBLIC all held SELECT on the whole table,
--     login_key included.
--
-- So one request — GET /rest/v1/users?select=full_name,role,login_key — was
-- enough to sign in as any of those staff. RLS cannot fix it: RLS chooses
-- ROWS, and the rows are meant to be readable (screens show staff names).
-- The fix is a COLUMN privilege.
--
-- WHAT CHANGES.
--
--   public.users                       SELECT on login_key removed from
--                                      PUBLIC, anon and authenticated; every
--                                      other column stays readable as before
--   public.admin_list_login_keys()     how Admin → Users still shows keys
--
-- WHO STILL SEES A KEY, AND HOW.
--
--   Key login        authenticate_user_by_key() is SECURITY DEFINER; it reads
--                    the column as its owner and returns the row only to
--                    someone who already typed that key. Unchanged.
--   Admins           admin_list_login_keys(), which checks is_admin() — a
--                    Supabase Auth session belonging to an active admin.
--   Purchase manager No longer. The PM Overview showed its kitchen's
--                    supervisor keys, but a key-logged-in PM has no session
--                    the database can verify, so any function returning keys
--                    "to a PM" would return them to anyone. Decided: PMs see
--                    supervisor names and phone numbers; admins manage keys.
--
-- writes are unaffected. Admins insert and update login_key through
-- the existing admin policy; writing a column does not need SELECT on it.
--
-- ** RUN THIS ONLY AFTER THE INTERNAL APP CHANGE IS DEPLOYED. ** Before it,
-- the admin login and Admin → Users asked for select('*'), which now fails
-- for a column the caller may not read. The new code names its columns and
-- works both before and after this migration.
--
-- ** THEN ROTATE EVERY LOGIN KEY. ** They have been publicly readable; this
-- migration stops future reads but cannot un-read past ones.
--
-- A NEW COLUMN ON public.users IS NOT READABLE THROUGH THE API until it is
-- granted, because the table-level SELECT grant is gone. That is the point —
-- the next secret column is not exposed by default — but it will look like a
-- bug the first time. See docs/decisions/0017-staff-login-keys-are-not-readable-through-the-api.md.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Admin → Users: the keys, for admins only
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_login_keys()
RETURNS TABLE (user_id uuid, login_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- is_admin() is false without a Supabase Auth session, so a key-login
  -- caller or anyone with only the anon key is refused.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an active admin can view login keys'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.login_key
      FROM public.users u
     WHERE u.login_key IS NOT NULL
       AND u.deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.admin_list_login_keys() IS
'Login keys for Admin → Users, keyed by user id. Refuses anyone who is not an active admin with a Supabase Auth session. The only way besides key login itself to read public.users.login_key through the API.';

-- Client-callable by signed-in users only (decision 0004: revoke by name).
REVOKE ALL ON FUNCTION public.admin_list_login_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_login_keys() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. The column privilege
-- ---------------------------------------------------------------------
-- A column REVOKE does nothing while a table-level SELECT grant stands, so
-- the table grant goes and every other column is granted back by name.
-- Columns are read from the catalog rather than listed, so a column added
-- between writing and running this is not silently dropped from the API.

REVOKE SELECT ON public.users FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO v_columns
    FROM pg_attribute
   WHERE attrelid = 'public.users'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname <> 'login_key';

  EXECUTE format('GRANT SELECT (%s) ON public.users TO anon, authenticated', v_columns);
END $$;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Nobody but service_role and the owner can read login_key (all false):
--
-- SELECT has_column_privilege('anon',          'public.users', 'login_key', 'SELECT') AS anon,
--        has_column_privilege('authenticated', 'public.users', 'login_key', 'SELECT') AS authenticated,
--        has_column_privilege('public',        'public.users', 'login_key', 'SELECT') AS public;
--
-- Every other column still readable (all true):
--
-- SELECT attname, has_column_privilege('anon', 'public.users', attname, 'SELECT')
-- FROM pg_attribute
-- WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
-- ORDER BY attnum;
--
-- The admin function's grants — authenticated and service_role, no anon:
--
-- SELECT proacl FROM pg_proc WHERE proname = 'admin_list_login_keys';
--
-- AND CHECK BY HAND, in the deployed internal app: a key login works; Admin →
-- Users lists users with their keys; a PM Overview shows its supervisors.

-- =====================================================================
-- Rollback — restores the exposure; only to unbreak a screen in a hurry
-- =====================================================================
-- GRANT SELECT ON public.users TO anon, authenticated;
-- DROP FUNCTION IF EXISTS public.admin_list_login_keys();
