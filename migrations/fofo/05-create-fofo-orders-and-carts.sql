-- =====================================================================
-- FOFO carts and orders
--
-- A franchise browses a catalogue whose prices move with our purchase
-- costs, fills a cart, and freezes those prices by starting a payment. See
-- docs/fofo-dashboard-spec.md §8.2 for the flow and §6 for how a price is
-- built.
--
-- WHAT CHANGES. Four tables in the fofo schema: carts, cart_items, orders,
-- order_items.
--
-- THE CART HOLDS NO PRICES. Not one column. Prices are recomputed on every
-- read, because raw material costs change and a cart must show what things
-- cost now. A price stored here would be a stale number pretending to be a
-- promise — and the promise is exactly what checkout is for.
--
-- ORDER LINES FREEZE THE WHOLE CALCULATION, not just the final number:
-- base cost, margin, GST rate, HSN, and both resulting prices. Six months
-- on, "why was this 128.80?" has an answer that does not depend on what the
-- margin happens to be today. Never recompute these from the catalogue —
-- recomputing is how an old invoice silently changes.
--
-- WHY cloud_kitchen_id IS COPIED ONTO THE ORDER even though it is
-- derivable from the outlet: an order was served by whichever kitchen the
-- outlet belonged to AT THE TIME. If an outlet is later moved to a
-- different kitchen, old orders must not silently change who fulfilled
-- them, or what they should have cost. This is a snapshot, not duplication
-- — unlike fofo.franchise_outlets, which deliberately does not copy it.
--
-- ONE LIVE PENDING ORDER PER OUTLET, as a partial unique index. Without it
-- a franchise can freeze a price, wait for it to move, freeze again, and
-- pay whichever turned out cheaper.
--
-- EXPIRY IS A TIMESTAMP, NOT A STATUS SWEEP. expires_at is compared on
-- read. A cron job flipping rows to 'expired' would be a second source of
-- truth racing the payment webhook, and would go stale if it died. Crucially
-- `paid` beats `expired` forever: a valid Razorpay webhook for an order
-- whose expires_at has passed still marks it paid. Expiry blocks STARTING a
-- payment; it never cancels one. A slow OTP must not cost us their money.
--
-- MONEY HAS A FIXED PRECISION, AND ONE ROUNDING RULE. Totals are
-- numeric(14,2) — rupees and paise, nothing smaller. Unit prices are
-- numeric(14,4), because a weighted-average cost is rarely a whole paisa
-- and rounding a unit price before multiplying by 12.5 kg moves the line
-- total. The rule, everywhere: work out each LINE, round it to the paisa,
-- then add rounded lines up. Never round a unit price and multiply; never
-- add unrounded lines and round the total — the three give three answers,
-- and Razorpay, the invoice and the order must all agree to the paisa.
-- orders.grand_total = subtotal + gst_total is a CHECK; the line sums are
-- across rows, so the checkout function that freezes an order owns them.
--
-- THE AMOUNT RAZORPAY IS ASKED FOR IS DERIVED, NOT TYPED. amount_paise is
-- a generated column: grand_total × 100, as an integer, because Razorpay
-- works in whole paise. The payment webhook compares Razorpay's integer to
-- this integer. It cannot drift from grand_total, and no floating-point
-- conversion sits between what we charged and what we check.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Cart
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.carts (
  id           uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  franchise_id uuid NOT NULL REFERENCES fofo.franchises(id),
  outlet_id    uuid NOT NULL REFERENCES public.outlets(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_one_per_outlet UNIQUE (outlet_id)
);

CREATE TABLE IF NOT EXISTS fofo.cart_items (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  cart_id         uuid NOT NULL REFERENCES fofo.carts(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity        numeric NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT cart_items_one_row_per_material UNIQUE (cart_id, raw_material_id)
);

COMMENT ON TABLE fofo.carts IS
'One open cart per FOFO outlet. Survives an expired checkout, so someone who walks away returns to an intact basket.';

COMMENT ON TABLE fofo.cart_items IS
'What is in a cart. Quantities only — no prices. Prices are computed fresh on every read and frozen only at checkout, onto fofo.order_items.';

-- ---------------------------------------------------------------------
-- 2. Orders
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.orders (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  order_number          text NOT NULL,
  franchise_id          uuid NOT NULL REFERENCES fofo.franchises(id),
  outlet_id             uuid NOT NULL REFERENCES public.outlets(id),
  cloud_kitchen_id      uuid NOT NULL REFERENCES public.cloud_kitchens(id),
  status                text NOT NULL DEFAULT 'pending_payment',
  expires_at            timestamptz,
  razorpay_order_id     text,

  placed_at             timestamptz,
  accepted_at           timestamptz,
  accepted_by           uuid REFERENCES public.users(id),
  packed_at             timestamptz,
  ready_at              timestamptz,
  shipped_at            timestamptz,
  delivered_at          timestamptz,

  shipping_carrier      text,
  shipping_tracking_ref text,
  shipping_notes        text,

  subtotal              numeric(14,2) NOT NULL DEFAULT 0,
  gst_total             numeric(14,2) NOT NULL DEFAULT 0,
  grand_total           numeric(14,2) NOT NULL DEFAULT 0,
  amount_paise          bigint GENERATED ALWAYS AS ((grand_total * 100)::bigint) STORED,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_order_number_key UNIQUE (order_number),
  -- The payment webhook finds its order by this. Unique, so one Razorpay
  -- order can never resolve to two of ours. NULL until checkout creates it.
  CONSTRAINT orders_razorpay_order_id_key UNIQUE (razorpay_order_id),
  CONSTRAINT orders_status_check CHECK (status IN (
    'pending_payment',
    'expired',
    'payment_failed',
    'paid',
    'accepted',
    'packed',
    'ready_to_ship',
    'shipped',
    'delivered',
    'cancelled'
  )),
  CONSTRAINT orders_totals_non_negative CHECK (
    subtotal >= 0 AND gst_total >= 0 AND grand_total >= 0
  ),
  CONSTRAINT orders_grand_total_adds_up CHECK (
    grand_total = subtotal + gst_total
  )
);

-- The rule that stops a franchise holding two frozen prices at once.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_live_pending_per_outlet
  ON fofo.orders (outlet_id)
  WHERE status = 'pending_payment';

-- The purchase manager's queue: their kitchen's orders, newest first.
CREATE INDEX IF NOT EXISTS idx_fofo_orders_kitchen_status
  ON fofo.orders (cloud_kitchen_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fofo_orders_franchise
  ON fofo.orders (franchise_id, created_at DESC);

COMMENT ON TABLE fofo.orders IS
'One FOFO order, per outlet. Routes to the purchase manager of cloud_kitchen_id. Lives from pending_payment through to delivered; expired and payment_failed are dead ends, cancelled is admin-only and exceptional.';

COMMENT ON COLUMN fofo.orders.cloud_kitchen_id IS
'The kitchen that serves this order, snapshotted from outlets.cloud_kitchen_id at checkout. Deliberately not derived on read: moving an outlet to another kitchen later must not rewrite who fulfilled an old order.';

COMMENT ON COLUMN fofo.orders.expires_at IS
'When the frozen prices stop being offered. Compared on read; never swept by a job. `paid` beats `expired` permanently — a valid payment webhook for a lapsed order still marks it paid, because expiry blocks starting a payment, not finishing one.';

COMMENT ON COLUMN fofo.orders.razorpay_order_id IS
'The Razorpay order created at checkout. The only link from an incoming payment webhook back to this row — the webhook carries Razorpay''s ids, not ours, and no invoice exists yet to hang a payment on. Unique.';

COMMENT ON COLUMN fofo.orders.amount_paise IS
'grand_total in whole paise, generated. What checkout sends to Razorpay as the amount, and what the webhook compares the captured payment against — integer to integer. Never set directly.';

COMMENT ON COLUMN fofo.orders.status IS
'pending_payment -> paid -> accepted -> packed -> ready_to_ship -> shipped -> delivered, with expired and payment_failed as dead ends from pending_payment. A purchase manager can only trim quantities; cancelled is admin-only.';

-- ---------------------------------------------------------------------
-- 3. Order lines — the frozen price
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.order_items (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  order_id           uuid NOT NULL REFERENCES fofo.orders(id) ON DELETE CASCADE,
  raw_material_id    uuid NOT NULL REFERENCES public.raw_materials(id),

  quantity_ordered   numeric NOT NULL,
  quantity_accepted  numeric,

  unit_base_cost     numeric(14,4) NOT NULL,
  margin_percent     numeric(7,3) NOT NULL,
  gst_percent        numeric(7,3) NOT NULL,
  hsn_code           text,              -- optional, as on raw_materials: copied as it was
  unit_price_ex_gst  numeric(14,4) NOT NULL,
  unit_price_inc_gst numeric(14,4) NOT NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_items_one_row_per_material UNIQUE (order_id, raw_material_id),
  CONSTRAINT order_items_quantity_ordered_positive CHECK (quantity_ordered > 0),
  CONSTRAINT order_items_quantity_accepted_valid CHECK (
    quantity_accepted IS NULL
    OR (quantity_accepted >= 0 AND quantity_accepted <= quantity_ordered)
  ),
  CONSTRAINT order_items_prices_non_negative CHECK (
    unit_base_cost >= 0
    AND margin_percent >= 0
    AND gst_percent >= 0
    AND unit_price_ex_gst >= 0
    AND unit_price_inc_gst >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_fofo_order_items_order
  ON fofo.order_items (order_id);

COMMENT ON TABLE fofo.order_items IS
'The lines of an order, with every price frozen at checkout. Storing the whole calculation — cost, margin, GST rate and both prices — means an old order can be explained without knowing what the catalogue says today.';

COMMENT ON COLUMN fofo.order_items.unit_base_cost IS
'What the unit cost US, GST-INCLUSIVE: the weighted average of active batches for a bought material, or the rolled-up food cost for a made one. GST-inclusive because this is a no-input-tax-credit food business, so vendor GST is a real cost — see 01-add-fofo-sale-columns-to-materials.sql.';

COMMENT ON COLUMN fofo.order_items.quantity_accepted IS
'Set when the purchase manager accepts. NULL until then. A trim leaves quantity_ordered untouched: the difference between the two is what the credit note covers, and both numbers must survive for the paperwork to make sense.';

-- ---------------------------------------------------------------------
-- 4. Deny by default
-- ---------------------------------------------------------------------

ALTER TABLE fofo.carts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.cart_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.order_items ENABLE ROW LEVEL SECURITY;

-- No policies: RLS with none denies every role, and service_role bypasses
-- it. See 03-create-fofo-schema.sql.

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Four empty tables:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'fofo' ORDER BY table_name;
--
-- Only one pending order per outlet — the second INSERT must FAIL:
--
-- INSERT INTO fofo.orders (order_number, franchise_id, outlet_id, cloud_kitchen_id)
-- VALUES ('TEST-1', '<franchise>', '<outlet>', '<kitchen>');
-- INSERT INTO fofo.orders (order_number, franchise_id, outlet_id, cloud_kitchen_id)
-- VALUES ('TEST-2', '<franchise>', '<outlet>', '<kitchen>');
--
-- ...but a second order is fine once the first is paid:
--
-- UPDATE fofo.orders SET status = 'paid' WHERE order_number = 'TEST-1';
-- -- now the TEST-2 insert succeeds
--
-- Accepting more than was ordered must FAIL:
--
-- UPDATE fofo.order_items SET quantity_accepted = quantity_ordered + 1;
--
-- The purchase manager's queue for one kitchen:
--
-- SELECT o.order_number, o.status, f.name AS franchise, ou.code AS outlet,
--        o.grand_total, o.created_at
-- FROM fofo.orders o
-- JOIN fofo.franchises f ON f.id = o.franchise_id
-- JOIN public.outlets ou ON ou.id = o.outlet_id
-- WHERE o.cloud_kitchen_id = '<kitchen>'
--   AND o.status IN ('paid', 'accepted', 'packed', 'ready_to_ship')
-- ORDER BY o.created_at DESC;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP TABLE IF EXISTS fofo.order_items;
-- DROP TABLE IF EXISTS fofo.orders;
-- DROP TABLE IF EXISTS fofo.cart_items;
-- DROP TABLE IF EXISTS fofo.carts;
