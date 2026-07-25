-- =====================================================
-- Restrict allocation_request_items INSERT to unpacked requests
-- =====================================================
-- Context: the Purchase Manager "add item" feature (StockOut.jsx Allocate Stock
-- modal) lets a PM add a material the supervisor forgot to an outlet's
-- requisition, but only while it's still open (is_packed = false) -- once packed,
-- stock has already left against a fixed item list.
--
-- The existing INSERT policy (from fix-outlets-and-allocation-requests-rls.sql)
-- never checked is_packed, so any caller could technically insert new items into
-- an already-packed request. UPDATE and DELETE on this table
-- (add-allocation-request-items-update-delete-policies.sql) already require
-- is_packed = false; this brings INSERT in line with them so the guard isn't
-- app-code-only.

DROP POLICY IF EXISTS "Supervisors and purchase managers can create allocation request items" ON allocation_request_items;

CREATE POLICY "Supervisors and purchase managers can create allocation request items" ON allocation_request_items
  FOR INSERT
  TO public
  WITH CHECK (
    raw_material_id IS NOT NULL
    AND quantity > 0
    AND allocation_request_id IN (
      SELECT id FROM allocation_requests WHERE is_packed = false
    )
  );
