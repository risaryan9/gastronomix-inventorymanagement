-- =====================================================================
-- ONE-OFF DATA FIX -- not a schema migration.
--
-- On 2026-08-11 a purchase manager finalized the same Hyperpure invoice
-- twice on CK3, 21 minutes apart:
--
--   10:08:26  0577cf59-ebf0-49d0-9843-dc6511e253c9   <- original, KEEP
--   10:29:53  8c4de5a0-6985-4398-a0bd-004268435fab   <- duplicate, DELETE
--
-- Both carry supplier 'Hyperpure', invoice 'ZBSKA27-00253795',
-- total_cost 8625.07, and 9 identical line items.
--
-- WHY DELETING IS THE RIGHT FIX (and is safe):
--
--   * inventory.quantity is not an independently stored number. The
--     trigger trigger_sync_inventory_quantity recomputes it as
--     SUM(stock_in_batches.quantity_remaining) on every batch INSERT,
--     UPDATE *and DELETE*. Removing the duplicate's batches therefore
--     corrects inventory automatically. Never edit inventory by hand.
--
--   * Stock-outs DID happen after the duplicate was created, but
--     fifo_consume() walks batches ORDER BY created_at ASC, and the
--     duplicate is the newest batch for all 9 materials. FIFO drained
--     the original's batches and never reached the duplicate. Verified:
--     all 9 duplicate batches still have
--     quantity_remaining = quantity_purchased and zero rows in
--     stock_out_batch_consumption.
--
--   * A manual downward adjustment would NOT work here: it FIFO-consumes
--     the OLDEST batches (genuine older stock), corrupting the cost
--     layers, and would leave the phantom invoice in stock_in so every
--     purchase/spend report keeps double-counting Rs 8,625.07.
--
-- WHAT THIS DOES NOT TOUCH:
--
--   * The invoice PDF in the 'invoices' storage bucket. The upload path
--     is derived from cloud kitchen + invoice number with upsert:true,
--     so BOTH rows point at the same file
--     (cloud_kitchen_ck3/cloud_kitchen_ck3-zbska27-00253795.pdf).
--     Deleting it would break the surviving record.
--
--   * The original 'stock_in_received' audit_events rows. Both survive;
--     audit_events.entity_id has no FK. The reversal row added below
--     links back to the duplicate's event via reversed_event_id.
--
-- HOW TO RUN: paste into the Supabase SQL editor (it runs as the service
-- role and bypasses RLS -- the DELETE policies on these tables require
-- is_admin() with a real auth.uid(), which key-based logins do not have).
-- Run STEP 1, then STEP 2 to verify.
-- =====================================================================


-- =====================================================================
-- STEP 1 -- remove the duplicate.
--
-- Self-guarding: re-checks that nothing has consumed the duplicate's
-- batches and aborts the whole block (rolling back) if anything has.
-- Safe to run even if someone did a stock-out five minutes ago.
-- =====================================================================

DO $$
DECLARE
  v_dup      uuid := '8c4de5a0-6985-4398-a0bd-004268435fab'::uuid;  -- duplicate stock_in
  v_keep     uuid := '0577cf59-ebf0-49d0-9843-dc6511e253c9'::uuid;  -- original stock_in
  v_ck3      uuid := 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f'::uuid;  -- Cloud Kitchen CK3
  v_admin    uuid := '4565b86c-5c2b-437f-aea7-bd3adb70d07d'::uuid;  -- Admin User
  v_dup_evt  uuid := '39b2e5c0-3f35-4e4e-81fc-b054f77c9ffd'::uuid;  -- duplicate's stock_in_received event
  v_touched  int;
  v_batches  int;
  v_rows     jsonb;
BEGIN
  -- ---- guard ------------------------------------------------------
  SELECT count(*) INTO v_touched
  FROM stock_in_batches b
  WHERE b.stock_in_id = v_dup
    AND (
      b.quantity_remaining <> b.quantity_purchased
      OR EXISTS (SELECT 1 FROM stock_out_batch_consumption c WHERE c.batch_id = b.id)
    );

  IF v_touched > 0 THEN
    RAISE EXCEPTION
      'ABORTED: % duplicate batch(es) have been consumed. Do not delete - the fix needs revising.',
      v_touched;
  END IF;

  SELECT count(*) INTO v_batches
  FROM stock_in_batches WHERE stock_in_id = v_dup;

  IF v_batches = 0 THEN
    RAISE EXCEPTION 'ABORTED: no batches found for % - already cleaned up?', v_dup;
  END IF;

  -- ---- snapshot for the audit payload ------------------------------
  SELECT jsonb_agg(jsonb_build_object(
           'raw_material_id', b.raw_material_id,
           'material',        r.name,
           'quantity',        b.quantity_purchased,
           'unit_cost',       b.unit_cost,
           'gst_percent',     b.gst_percent
         ) ORDER BY r.name)
    INTO v_rows
  FROM stock_in_batches b
  JOIN raw_materials r ON r.id = b.raw_material_id
  WHERE b.stock_in_id = v_dup;

  -- ---- delete: children first, then the header ---------------------
  -- Each batch DELETE fires trigger_sync_inventory_quantity, which
  -- recomputes inventory.quantity for that kitchen + material.
  DELETE FROM stock_in_batches WHERE stock_in_id = v_dup;
  DELETE FROM stock_in         WHERE id          = v_dup;

  -- ---- record the correction ---------------------------------------
  PERFORM log_audit_event(
    p_actor_user_id     => v_admin,
    p_actor_role        => 'admin',
    p_cloud_kitchen_id  => v_ck3,
    p_category          => 'reversal',
    p_action            => 'stock_in_duplicate_removed',
    p_severity          => 'critical',
    p_entity_type       => 'stock_in',
    p_entity_id         => v_dup,
    p_reversed_event_id => v_dup_evt,
    p_old_values        => jsonb_build_object(
      'reason',           'Duplicate stock-in for the same invoice, entered 21 minutes after the original. No stock had been consumed from the duplicate batches.',
      'invoice_number',   'ZBSKA27-00253795',
      'supplier_name',    'Hyperpure',
      'receipt_date',     '2026-08-11',
      'total_cost',       8625.07,
      'kept_stock_in_id', v_keep,
      'batches_removed',  v_batches,
      'items',            v_rows
    )
  );

  RAISE NOTICE 'Done. Removed duplicate stock_in % (% batches).', v_dup, v_batches;
END $$;


-- =====================================================================
-- STEP 2 -- verify.
--
-- Expected output:
--   headers left for invoice   1
--   orphan batches             0
--   Coriander Leaves           0.000    (was 1.000)
--   Eggs                      30.000    (was 90.000)
--   Green Chilli               0.700    (was 1.700)
--   Potato                    17.000    (was 27.000)
--   Rice for Staff            90.000    (was 180.000)
--   Ridge Gourd                4.000    (was 8.000)
--   Salted Butter              4.000    (was 6.000)
--   Tomato Hybrid              2.000    (was 4.000)
--   Toned Curd                 2.000    (was 3.000)
-- =====================================================================

SELECT 'headers left for invoice' AS check, count(*)::text AS value
FROM stock_in
WHERE invoice_number = 'ZBSKA27-00253795'

UNION ALL

SELECT 'orphan batches', count(*)::text
FROM stock_in_batches
WHERE stock_in_id = '8c4de5a0-6985-4398-a0bd-004268435fab'::uuid

UNION ALL

SELECT r.name, i.quantity::text
FROM inventory i
JOIN raw_materials r ON r.id = i.raw_material_id
WHERE i.cloud_kitchen_id = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f'::uuid
  AND r.name IN ('Coriander Leaves', 'Eggs', 'Green Chilli', 'Potato',
                 'Rice for Staff', 'Ridge Gourd', 'Salted Butter',
                 'Tomato Hybrid', 'Toned Curd');


-- =====================================================================
-- STEP 3 -- DO NOT RUN. Kept only to record why it is wrong.
--
-- The obvious guard against a repeat is a unique index:
--
--   CREATE UNIQUE INDEX stock_in_unique_purchase_invoice
--     ON stock_in (cloud_kitchen_id, invoice_number)
--     WHERE stock_in_type = 'purchase' AND invoice_number IS NOT NULL;
--
-- It cannot be created, and should not be. Verified 2026-08-11: 13
-- (cloud_kitchen_id, invoice_number) groups already hold more than one
-- purchase stock-in, and every one of them is legitimate:
--
--   * Opening-stock entries use a placeholder in the invoice field --
--     CK2 has 17 rows under 'Current Inventory'/Hyperpure dated
--     2026-04-02, 4 under 'Consumables Invontory', 2 under
--     'Current Inventory'/Local. CK3 has 2 under 'Inventory'.
--
--   * 'Local' suppliers get the DATE as their invoice number, so several
--     genuinely different purchases share one string: 03/08/26, 04/08/26,
--     7/8/26, 9/8/26, 10/08/26 across CK2 and CK3, each with a different
--     total. This is normal daily work and the index would block it.
--
--   * Two real Hyperpure invoices on CK2 are split across two entries
--     with different totals (ZBSKA27-00007780, ZHPKA27-00249360).
--
-- What to do instead: a soft warning in the UI. In
-- frontend/src/pages/purchase-manager/StockIn.jsx, before finalizing a
-- 'purchase', look for an existing stock_in with the same
-- cloud_kitchen_id + invoice_number and, if one exists, make the user
-- confirm ("an entry for this invoice already exists - continue?").
-- That catches the accidental double-submit this file cleaned up without
-- forbidding any of the legitimate patterns above.
--
-- Query to re-check the duplicate-invoice landscape at any time:
--
--   SELECT ck.code, s.invoice_number, s.supplier_name, count(*) AS entries
--   FROM stock_in s
--   JOIN cloud_kitchens ck ON ck.id = s.cloud_kitchen_id
--   WHERE s.stock_in_type = 'purchase' AND s.invoice_number IS NOT NULL
--   GROUP BY 1, 2, 3
--   HAVING count(*) > 1
--   ORDER BY 1, 2;
-- =====================================================================
