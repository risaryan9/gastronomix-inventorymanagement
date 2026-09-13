-- =====================================================================
-- Say which FOFO order a stock-out was for
--
-- When a purchase manager accepts a FOFO order, stock leaves the kitchen
-- and a normal public.stock_out is written — FOFO sales move stock like
-- anything else. Without a link back, the stock_out row says 7 kg of
-- chicken left the shelf but not why, and reconciling a month of sales
-- against a month of stock movements becomes guesswork.
--
-- WHAT CHANGES. One column on stock_out:
--
--   fofo_order_id uuid REFERENCES fofo.orders(id)
--
-- SAME IDEA AS allocation_request_id, which already sits on this table and
-- answers the same question for internal requisitions. A stock_out row now
-- carries at most one of: an allocation request (internal requisition), a
-- transfer target (inter-kitchen), a self_stock_out flag (wastage and
-- adjustments), or a FOFO order (a sale). They are mutually exclusive in
-- practice but not enforced, matching how the existing columns behave.
--
-- NOTE THIS DIVERGES FROM DECISION 0010, DELIBERATELY. Dispatch plans and
-- closing sheets are records and do not move stock; the purchase manager
-- does that by hand. A FOFO accept DOES move stock, automatically, in the
-- same transaction that accepts the order. The difference is that a
-- customer has already paid: the stock must be committed at the moment we
-- promise it, and the FIFO consume must be able to fail the whole accept if
-- it cannot be honoured.
--
-- RUN ORDER. fofo.orders must exist first — see 05-create-fofo-orders-and-carts.sql.
-- =====================================================================

BEGIN;

ALTER TABLE public.stock_out
ADD COLUMN IF NOT EXISTS fofo_order_id UUID REFERENCES fofo.orders(id);

CREATE INDEX IF NOT EXISTS idx_stock_out_fofo_order
  ON public.stock_out (fofo_order_id)
  WHERE fofo_order_id IS NOT NULL;

COMMENT ON COLUMN public.stock_out.fofo_order_id IS
'The FOFO order this stock left for, when it was a sale to a franchise. NULL for every other kind of stock-out. The sale-side counterpart of allocation_request_id, which links an internal requisition.';

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The column exists and nothing uses it yet:
--
-- SELECT COUNT(*) FILTER (WHERE fofo_order_id IS NOT NULL) AS fofo_stock_outs,
--        COUNT(*) AS total_stock_outs
-- FROM public.stock_out;
--
-- Once orders start flowing — what left the shelf for one order:
--
-- SELECT o.order_number, m.name, soi.quantity, so.allocation_date
-- FROM public.stock_out so
-- JOIN fofo.orders o           ON o.id = so.fofo_order_id
-- JOIN public.stock_out_items soi ON soi.stock_out_id = so.id
-- JOIN public.raw_materials m  ON m.id = soi.raw_material_id
-- WHERE o.order_number = '<order number>';
--
-- Sales stock-outs that somehow have no order, which should be none:
--
-- SELECT so.id, so.allocation_date, so.reason
-- FROM public.stock_out so
-- WHERE so.reason ILIKE '%fofo%' AND so.fofo_order_id IS NULL;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP INDEX IF EXISTS public.idx_stock_out_fofo_order;
-- ALTER TABLE public.stock_out DROP COLUMN IF EXISTS fofo_order_id;
