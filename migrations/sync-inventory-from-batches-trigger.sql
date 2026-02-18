-- =====================================================
-- Migration: Sync inventory.quantity from stock_in_batches
-- Creates a trigger to automatically maintain inventory.quantity
-- as the sum of stock_in_batches.quantity_remaining
-- =====================================================

-- =====================================================
-- 1. Function to sync inventory quantity from batches
-- =====================================================

CREATE OR REPLACE FUNCTION sync_inventory_quantity_from_batches()
RETURNS TRIGGER AS $$
DECLARE
  v_cloud_kitchen_id uuid;
  v_raw_material_id uuid;
  v_total_quantity numeric;
BEGIN
  -- Determine which (cloud_kitchen_id, raw_material_id) to update
  -- Handle INSERT, UPDATE, and DELETE
  IF TG_OP = 'DELETE' THEN
    v_cloud_kitchen_id := OLD.cloud_kitchen_id;
    v_raw_material_id := OLD.raw_material_id;
  ELSE
    v_cloud_kitchen_id := NEW.cloud_kitchen_id;
    v_raw_material_id := NEW.raw_material_id;
  END IF;

  -- Calculate total quantity from all batches for this kitchen + material
  SELECT COALESCE(SUM(quantity_remaining), 0)
  INTO v_total_quantity
  FROM stock_in_batches
  WHERE cloud_kitchen_id = v_cloud_kitchen_id
    AND raw_material_id = v_raw_material_id;

  -- Update or insert inventory record
  INSERT INTO inventory (
    cloud_kitchen_id,
    raw_material_id,
    quantity,
    last_updated_at,
    updated_by
  )
  VALUES (
    v_cloud_kitchen_id,
    v_raw_material_id,
    v_total_quantity,
    NOW(),
    NULL  -- Trigger doesn't have user context; edge function will set this
  )
  ON CONFLICT (cloud_kitchen_id, raw_material_id)
  DO UPDATE SET
    quantity = v_total_quantity,
    last_updated_at = NOW();
    -- Note: updated_by is NOT changed here; only when user explicitly adjusts via edge function

  RETURN NULL;  -- For AFTER trigger, return value is ignored
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION sync_inventory_quantity_from_batches() IS
  'Trigger function that maintains inventory.quantity as sum of stock_in_batches.quantity_remaining';

-- =====================================================
-- 2. Create trigger on stock_in_batches
-- =====================================================

DROP TRIGGER IF EXISTS trigger_sync_inventory_quantity ON stock_in_batches;

CREATE TRIGGER trigger_sync_inventory_quantity
AFTER INSERT OR UPDATE OR DELETE ON stock_in_batches
FOR EACH ROW
EXECUTE FUNCTION sync_inventory_quantity_from_batches();

COMMENT ON TRIGGER trigger_sync_inventory_quantity ON stock_in_batches IS
  'Automatically syncs inventory.quantity whenever stock_in_batches changes';

-- =====================================================
-- 3. One-time sync: update all existing inventory records
-- =====================================================

-- Recalculate quantity for all existing inventory records from batches
UPDATE inventory
SET quantity = COALESCE(batch_totals.total_qty, 0),
    last_updated_at = NOW()
FROM (
  SELECT
    cloud_kitchen_id,
    raw_material_id,
    SUM(quantity_remaining) AS total_qty
  FROM stock_in_batches
  GROUP BY cloud_kitchen_id, raw_material_id
) AS batch_totals
WHERE inventory.cloud_kitchen_id = batch_totals.cloud_kitchen_id
  AND inventory.raw_material_id = batch_totals.raw_material_id;

-- For inventory records with no batches, set quantity to 0
UPDATE inventory
SET quantity = 0,
    last_updated_at = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM stock_in_batches
  WHERE stock_in_batches.cloud_kitchen_id = inventory.cloud_kitchen_id
    AND stock_in_batches.raw_material_id = inventory.raw_material_id
);

-- =====================================================
-- Notes:
-- =====================================================
-- After this migration:
-- 1. inventory.quantity is always derived from stock_in_batches.quantity_remaining
-- 2. App code should NEVER directly update inventory.quantity
-- 3. Stock In: only insert into stock_in_batches (trigger updates inventory)
-- 4. Stock Out: only update stock_in_batches (FIFO) (trigger updates inventory)
-- 5. Manual adjustment: use edge function that creates adjustment batch + audit log
-- =====================================================
