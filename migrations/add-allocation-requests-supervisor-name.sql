-- Add supervisor_name to allocation_requests (required when creating from supervisor dashboard)
-- Existing rows and purchase-manager-created requests can have NULL.

ALTER TABLE public.allocation_requests
  ADD COLUMN IF NOT EXISTS supervisor_name TEXT NULL;

COMMENT ON COLUMN public.allocation_requests.supervisor_name IS 'Name of the supervisor who created the allocation request (filled in supervisor dashboard).';
