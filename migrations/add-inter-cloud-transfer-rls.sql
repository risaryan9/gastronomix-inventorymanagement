-- =====================================================
-- RLS: Allow purchase managers to create inter_cloud
-- stock_in and stock_in_batches for destination kitchen.
-- (Key-based/anon users already allowed by existing policies;
-- this adds explicit support for inter_cloud.)
-- =====================================================

-- stock_in: allow INSERT when type is inter_cloud (destination kitchen)
DROP POLICY IF EXISTS "Purchase managers create inter_cloud stock in for transfer" ON public.stock_in;
CREATE POLICY "Purchase managers create inter_cloud stock in for transfer" ON public.stock_in
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND stock_in_type = 'inter_cloud'
    AND cloud_kitchen_id IS NOT NULL
    AND received_by IS NOT NULL
    AND receipt_date IS NOT NULL
  );

-- stock_in_batches: allow INSERT when the stock_in is inter_cloud type
-- (stock_in already validated; batches must match that stock_in's cloud_kitchen_id)
DROP POLICY IF EXISTS "Purchase managers create stock in batches for inter_cloud" ON public.stock_in_batches;
CREATE POLICY "Purchase managers create stock in batches for inter_cloud" ON public.stock_in_batches
  FOR INSERT
  TO public
  WITH CHECK (
    is_purchase_manager_or_admin()
    AND stock_in_id IS NOT NULL
    AND raw_material_id IS NOT NULL
    AND cloud_kitchen_id IS NOT NULL
    AND quantity_purchased > 0
    AND quantity_remaining >= 0
    AND quantity_remaining <= quantity_purchased
    AND unit_cost > 0
    AND EXISTS (
      SELECT 1 FROM public.stock_in
      WHERE stock_in.id = stock_in_batches.stock_in_id
      AND stock_in.stock_in_type = 'inter_cloud'
      AND stock_in.cloud_kitchen_id = stock_in_batches.cloud_kitchen_id
    )
  );

-- inventory: existing "Purchase managers can update inventory" and
-- "Purchase managers can insert inventory" already allow any cloud_kitchen_id
-- (no change needed).
