-- =====================================================================
-- Allow key-based (anon) users to read operators for outlets.
--
-- Supervisors often use key-based login (anon role). Without this policy,
-- the operator dropdown in the supervisor closing form will appear empty
-- even when operators exist for the outlet.
-- =====================================================================

BEGIN;

-- Read-only: allow all users to view operators for active, non-deleted outlets.
-- Mirrors the general pattern used for outlets where read access is allowed
-- and the application layer filters by outlet_id.
DROP POLICY IF EXISTS "All users can view operators" ON public.operators;
CREATE POLICY "All users can view operators" ON public.operators
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.outlets o
      WHERE o.id = operators.outlet_id
        AND o.is_active = true
        AND o.deleted_at IS NULL
    )
  );

COMMIT;

