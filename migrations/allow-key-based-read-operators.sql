-- =====================================================================
-- Allow key-based (anon) users to read all operators globally.
--
-- Supervisors often use key-based login (anon role). Without this policy,
-- the operator dropdown in the supervisor closing form will appear empty
-- even when operators exist.
-- =====================================================================

BEGIN;

-- Read-only: allow all users to view all operators.
DROP POLICY IF EXISTS "All users can view operators" ON public.operators;
CREATE POLICY "All users can view operators" ON public.operators
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMIT;

