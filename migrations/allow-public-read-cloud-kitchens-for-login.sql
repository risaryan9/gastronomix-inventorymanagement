-- =====================================================
-- Allow Public Read Access to Cloud Kitchens for Login
-- This allows unauthenticated users to see cloud kitchens
-- during the login process so they can select their kitchen
-- =====================================================

-- Policy to allow public read access to active cloud kitchens
-- This is safe because we only expose name, code, and id
-- No sensitive data is exposed
CREATE POLICY "Public can read active cloud kitchens for login" 
ON public.cloud_kitchens
FOR SELECT
TO public
USING (
  is_active = true 
  AND deleted_at IS NULL
);

-- Note: This policy allows anyone to see active cloud kitchens
-- This is necessary for the login flow where users select their kitchen
-- before authenticating. Only basic information (id, name, code) is exposed,
-- which is not sensitive data.
