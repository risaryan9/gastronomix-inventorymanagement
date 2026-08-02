-- Let the admin read stock_in and stock_in_batches across every cloud kitchen.
--
-- WHY THIS IS NEEDED
--
-- The admin logs in through Supabase auth, so auth.uid() is set, and the admin
-- user has cloud_kitchen_id = NULL by design (admin is not scoped to a kitchen).
-- Both tables' only SELECT policies are kitchen-scoped:
--
--   (auth.uid() IS NOT NULL
--    AND is_purchase_manager_or_admin()
--    AND EXISTS (SELECT 1 FROM users
--                WHERE users.id = auth.uid()
--                  AND users.cloud_kitchen_id = stock_in.cloud_kitchen_id))
--   OR (auth.uid() IS NULL)
--
-- For the admin the EXISTS can never be true — NULL never equals a kitchen id —
-- and auth.uid() is not NULL, so the whole predicate is false. The admin reads
-- zero rows from both tables. Key-based logins are unaffected because they fall
-- through the `auth.uid() IS NULL` branch.
--
-- The practical effect: every cost figure on the admin dashboard reads as zero,
-- because unit costs live in stock_in_batches and spend lives in stock_in.
-- Inventory quantities were never affected — `inventory` has a permissive
-- public read policy — which is why the gap only shows up in money terms.
--
-- These are read-only policies. Writes stay exactly as they are: the admin
-- still cannot insert, update or delete stock movements, which remain the
-- purchase manager's job.
--
-- is_admin() is SECURITY DEFINER and returns false when auth.uid() is NULL, so
-- it adds no access for anonymous key-based sessions.

CREATE POLICY "Admin read stock_in"
  ON public.stock_in
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admin read stock_in_batches"
  ON public.stock_in_batches
  FOR SELECT
  TO authenticated
  USING (public.is_admin());
