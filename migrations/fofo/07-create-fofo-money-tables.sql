-- =====================================================================
-- FOFO invoices, payments, credit notes and store credit
--
-- Four different things that are easy to confuse, and must not share a
-- table (docs/fofo-dashboard-spec.md §10):
--
--   orders       the job — what they asked for, how far along. Changes.
--   invoices     the bill — "you owe X for these lines". NEVER changes.
--   credit_notes "part of that bill was wrong, Y comes back". Never changes.
--   store credit what a credit note turned into, and what has been
--                spent of it. Two append-only tables.
--
-- WHY THE INVOICE IS A TABLE AND NOT COLUMNS ON THE ORDER. One order
-- produces two invoices: the goods when they pay, and the transport after
-- we pack. Different amounts, different dates, different numbers.
--
-- WHY invoice_items REPEATS order_items. It is a copy, deliberately, not a
-- view. An invoice must say what it said on the day it was issued, forever.
-- If it joined live to order_items, a quantity trimmed in September would
-- rewrite an invoice issued in August — which is the exact failure the
-- invoice / credit-note split exists to prevent.
--
-- INVOICE ROWS ARE NEVER UPDATED. Not a total, not a line. A wrong amount
-- is corrected by a credit note pointing back at it. Invoice and credit
-- note numbers must be gapless and sequential per financial year, which is
-- also why a number is allocated only when money is confirmed — an
-- abandoned checkout must not punch a hole in the sequence.
--
-- NOTHING ANYWHERE STORES A BALANCE, OR A REMAINING AMOUNT. The balance
-- is earned minus spent, worked out on every read. A stored figure is how
-- you end up with a number nobody can explain: it says 600, the franchise
-- says 900, and there is no way to settle it. With rows you print them —
-- +1000 from CN-0007, -400 against INV-0043, -150 against INV-0051,
-- balance 450, and every line points at the paper behind it.
--
-- WHY CREDIT IS SPENT IN ITS OWN TABLE AND NOT AS A NEGATIVE ROW. Credit
-- is spent in parts: 1000 earned may settle three invoices over a month.
-- Decrementing a remaining_amount column would record that 600 of CN-0007
-- was used but not WHICH INVOICE USED IT — the first question an auditor
-- asks, and the first question a franchise asks when it disputes the
-- balance. An application row answers it in both directions: where a
-- credit went, and how an invoice was settled. See decision 0013.
--
-- STORE CREDIT IS A PAYMENT, NOT A DISCOUNT. Applying it never changes an
-- invoice, its taxable value or its GST. The invoice is issued in full and
-- the credit settles part of what is payable, exactly as cash would. The
-- tax was already adjusted by the credit note, once, when it was issued —
-- taking it off the new invoice as well would claim the same relief twice
-- and undercharge GST. Decision 0013 exists because this WILL get
-- "simplified" into a discount line by someone one day.
--
-- THREE UNIQUE CONSTRAINTS THAT ARE SAFETY FEATURES, NOT TIDINESS:
--   payments.razorpay_payment_id  — Razorpay retries webhooks. Without
--                                   this, a retry is a second payment.
--   store_credits.credit_note_id  — one credit note becomes credit once,
--                                   ever. Without it, a double-clicked
--                                   button is free money.
--   (the third is not a constraint but a trigger: applications can never
--    add up to more than the credit, or more than the invoice. A CHECK
--    cannot see other rows, so it cannot do this job.)
--
-- THE BUYER IS COPIED ONTO THE INVOICE, for the same reason the lines are.
-- A tax invoice names who it was issued to, and that must stay what it was
-- on the day: if a franchise registers for GST or moves next year, last
-- year's invoices keep last year's name, address and GSTIN. Joining live to
-- fofo.franchises would rewrite them. Credit notes do not repeat it — they
-- point at an invoice, and the invoice never changes, so reading the buyer
-- from there is safe. (Buyer STATE is deliberately absent for now: it
-- belongs with the CGST/SGST/IGST split, which is not designed yet.)
--
-- MONEY IS numeric(14,2) AND LINES OBEY ONE ROUNDING RULE, which the
-- invoice_items CHECKs enforce rather than describe: taxable value is
-- quantity × unit price rounded to the paisa, GST is that rounded value ×
-- rate rounded to the paisa, and the line total is their sum. Rounded lines
-- then add up to the invoice — see 05-create-fofo-orders-and-carts.sql.
--
-- REFUNDS ARE ALWAYS STORE CREDIT. There is no bank-refund table because
-- there is no bank refund. A credit note always produces a credit row.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Invoices
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.invoices (
  id             uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  invoice_number text NOT NULL,
  order_id       uuid NOT NULL REFERENCES fofo.orders(id),
  franchise_id   uuid NOT NULL REFERENCES fofo.franchises(id),
  invoice_type   text NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),

  -- Who it was issued to, frozen at issue. See the header.
  buyer_name     text NOT NULL,
  buyer_gstin    text,
  buyer_address  text NOT NULL,
  buyer_city     text,

  taxable_value  numeric(14,2) NOT NULL,
  gst_amount     numeric(14,2) NOT NULL,
  total          numeric(14,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_number_key UNIQUE (invoice_number),
  CONSTRAINT invoices_type_check CHECK (invoice_type IN ('goods', 'logistics')),
  CONSTRAINT invoices_amounts_non_negative CHECK (
    taxable_value >= 0 AND gst_amount >= 0 AND total >= 0
  ),
  CONSTRAINT invoices_total_adds_up CHECK (total = taxable_value + gst_amount),
  CONSTRAINT invoices_buyer_named CHECK (
    btrim(buyer_name) <> '' AND btrim(buyer_address) <> ''
  )
);

-- One goods invoice per order. Logistics is uncapped: a shipment can be
-- re-billed, and each attempt is its own document. A partial unique index
-- rather than an EXCLUDE constraint, because EXCLUDE with `=` on a uuid
-- needs btree_gist and this database does not have it.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_goods_per_order
  ON fofo.invoices (order_id)
  WHERE invoice_type = 'goods';

CREATE INDEX IF NOT EXISTS idx_fofo_invoices_franchise
  ON fofo.invoices (franchise_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_fofo_invoices_order
  ON fofo.invoices (order_id);

COMMENT ON TABLE fofo.invoices IS
'A bill issued to a franchise. Never updated: a wrong amount is corrected by a credit note. One order has one goods invoice and may have logistics invoices too.';

COMMENT ON COLUMN fofo.invoices.buyer_address IS
'Copied from fofo.franchises at issue. NOT NULL on purpose: franchises.address is optional, so an invoice cannot be issued to a franchise with no address on file — the failure lands on the admin who onboarded them, not on a tax document with a blank where the recipient should be.';

COMMENT ON COLUMN fofo.invoices.buyer_gstin IS
'Copied from fofo.franchises.gst_number at issue. NULL means the franchise was unregistered on that day, which is itself a fact the invoice must keep — it decides how the sale is reported.';

COMMENT ON COLUMN fofo.invoices.invoice_number IS
'Gapless and sequential per financial year — a GST requirement. Allocated only when payment is confirmed, so an abandoned checkout cannot punch a hole in the sequence.';

CREATE TABLE IF NOT EXISTS fofo.invoice_items (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  invoice_id         uuid NOT NULL REFERENCES fofo.invoices(id) ON DELETE CASCADE,
  description        text NOT NULL,
  hsn_code           text,
  quantity           numeric NOT NULL,
  unit_price_ex_gst  numeric(14,4) NOT NULL,
  gst_percent        numeric(7,3) NOT NULL,
  line_taxable_value numeric(14,2) NOT NULL,
  line_gst           numeric(14,2) NOT NULL,
  line_total         numeric(14,2) NOT NULL,
  sort_order         integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- The rounding rule, enforced. Postgres round() is half away from zero;
  -- whatever computes a line must use it rather than reimplement it.
  CONSTRAINT invoice_items_taxable_is_rounded CHECK (
    line_taxable_value = round(quantity * unit_price_ex_gst, 2)
  ),
  CONSTRAINT invoice_items_gst_is_rounded CHECK (
    line_gst = round(line_taxable_value * gst_percent / 100, 2)
  ),
  CONSTRAINT invoice_items_total_adds_up CHECK (
    line_total = line_taxable_value + line_gst
  )
);

CREATE INDEX IF NOT EXISTS idx_fofo_invoice_items_invoice
  ON fofo.invoice_items (invoice_id);

COMMENT ON TABLE fofo.invoice_items IS
'The lines as they were billed. A COPY of the order lines, never a view onto them: an invoice must keep saying what it said, even after the order changes. description is text rather than a material FK for the same reason — renaming a material must not rewrite an old bill.';

-- ---------------------------------------------------------------------
-- 2. Payments
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.payments (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  invoice_id            uuid NOT NULL REFERENCES fofo.invoices(id),
  razorpay_order_id     text,
  razorpay_payment_id   text,
  amount                numeric(14,2) NOT NULL,
  status                text NOT NULL,
  signature_verified_at timestamptz,
  raw_webhook           jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_razorpay_payment_id_key UNIQUE (razorpay_payment_id),
  CONSTRAINT payments_amount_positive CHECK (amount > 0),
  CONSTRAINT payments_status_check CHECK (status IN ('created', 'captured', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_fofo_payments_invoice
  ON fofo.payments (invoice_id);

COMMENT ON TABLE fofo.payments IS
'Razorpay payments against an invoice. Only ever written by the server after verifying the webhook signature — the browser never reports a payment.';

COMMENT ON COLUMN fofo.payments.razorpay_payment_id IS
'Unique, and that uniqueness is the idempotency key. Razorpay retries webhooks; without this constraint a retry records a second payment and the franchise appears to have paid twice.';

COMMENT ON COLUMN fofo.payments.raw_webhook IS
'Exactly what Razorpay sent. When a payment is disputed months later this payload is the evidence, and it is the only copy we will have.';

-- ---------------------------------------------------------------------
-- 3. Credit notes
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.credit_notes (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  credit_note_number text NOT NULL,
  invoice_id         uuid NOT NULL REFERENCES fofo.invoices(id),
  order_id           uuid NOT NULL REFERENCES fofo.orders(id),
  amount             numeric(14,2) NOT NULL,
  reason             text NOT NULL,
  issued_at          timestamptz NOT NULL DEFAULT now(),
  issued_by          uuid REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_number_key UNIQUE (credit_note_number),
  CONSTRAINT credit_notes_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_fofo_credit_notes_invoice
  ON fofo.credit_notes (invoice_id);

COMMENT ON TABLE fofo.credit_notes IS
'The formal "part of that bill was wrong", pointing at the invoice it corrects. Created when a purchase manager trims a quantity — the reason field is required of him on screen, not optional paperwork. Numbers are gapless per financial year, same as invoices.';

-- ---------------------------------------------------------------------
-- 4. Store credit: what was earned, and what has been spent of it
-- ---------------------------------------------------------------------
-- Two append-only tables rather than one signed ledger, because credit is
-- drawn down in parts. "What is left of CN-0007" has to be answerable, and
-- it is answered by subtraction — never by a column that someone keeps up
-- to date. Money is numeric(14,2) here, as everywhere on the money side.
-- Note what that does and does not do: Postgres ROUNDS a third decimal on
-- the way in (450.635 is stored as 450.64) rather than rejecting it, so
-- the type keeps stored amounts tidy but will not expose a rounding bug
-- upstream. What does is the arithmetic CHECKs on invoices and
-- invoice_items, which refuse a line that was not rounded by the rule.

CREATE TABLE IF NOT EXISTS fofo.store_credits (
  id             uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  franchise_id   uuid NOT NULL REFERENCES fofo.franchises(id),
  credit_note_id uuid NOT NULL REFERENCES fofo.credit_notes(id),
  amount         numeric(14,2) NOT NULL,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_credits_amount_positive CHECK (amount > 0),
  -- A credit note becomes credit exactly once, ever.
  CONSTRAINT store_credits_credit_note_key UNIQUE (credit_note_id)
);

-- (franchise_id, created_at, id) is the FIFO drawdown order, index and all:
-- created_at alone is not unique, and an unstable order would make which
-- credit got spent depend on the plan. Same rule as decision 0009.
CREATE INDEX IF NOT EXISTS idx_fofo_store_credits_franchise
  ON fofo.store_credits (franchise_id, created_at, id);

COMMENT ON TABLE fofo.store_credits IS
'Store credit a franchise has earned: one row per credit note, immutable. What is left of a credit is its amount less the applications against it — there is no remaining column, deliberately. See fofo.store_credit_statement.';

COMMENT ON COLUMN fofo.store_credits.credit_note_id IS
'NOT NULL and unique. Every rupee of store credit traces to a credit note, because a refund is a tax document before it is a balance — there is no goodwill credit that skips the paperwork. Unique means a double-clicked button or a retried webhook is a no-op rather than free money.';

CREATE TABLE IF NOT EXISTS fofo.store_credit_applications (
  id         uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  credit_id  uuid NOT NULL REFERENCES fofo.store_credits(id),
  invoice_id uuid NOT NULL REFERENCES fofo.invoices(id),
  amount     numeric(14,2) NOT NULL,
  applied_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_credit_applications_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_fofo_store_credit_applications_credit
  ON fofo.store_credit_applications (credit_id);

CREATE INDEX IF NOT EXISTS idx_fofo_store_credit_applications_invoice
  ON fofo.store_credit_applications (invoice_id);

COMMENT ON TABLE fofo.store_credit_applications IS
'One part of one credit, spent against one invoice. Immutable and append-only, like everything else on the money side. There is deliberately no unique key on (credit_id, invoice_id): a credit may legitimately be applied to the same invoice twice, in two goes, and over-application is prevented by the amount caps below rather than by forbidding a second row.';

COMMENT ON COLUMN fofo.store_credit_applications.applied_by IS
'The staff member, when someone internal applied it. NULL when the franchise applied its own credit from the dashboard — those people are not in public.users at all.';

-- ---------------------------------------------------------------------
-- 4a. The two caps. A CHECK cannot see other rows, so these are a trigger
-- ---------------------------------------------------------------------
-- Without these, the arithmetic that stops credit being spent twice lives
-- only in application code, and the first concurrent redemption gets past
-- it: two requests both read "600 left", both write 600, and the franchise
-- has spent 1200 of a 600 credit. Reading a total and acting on it is only
-- safe if the row is locked first, and that is what this does.

CREATE OR REPLACE FUNCTION fofo.assert_store_credit_application_fits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fofo, public
AS $$
DECLARE
  v_credit_amount   numeric(14,2);
  v_credit_owner    uuid;
  v_credit_used     numeric(14,2);
  v_invoice_total   numeric(14,2);
  v_invoice_owner   uuid;
  v_invoice_number  text;
  v_invoice_used    numeric(14,2);
BEGIN
  -- LOCK ORDER: invoice first, then credit — the same order
  -- fofo.apply_store_credit takes them in. Two code paths that lock the
  -- same two rows in opposite orders deadlock instead of queueing.
  SELECT total, franchise_id, invoice_number
    INTO v_invoice_total, v_invoice_owner, v_invoice_number
    FROM fofo.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  SELECT amount, franchise_id INTO v_credit_amount, v_credit_owner
    FROM fofo.store_credits WHERE id = NEW.credit_id FOR UPDATE;

  -- One franchise's credit cannot settle another's bill. Both foreign keys
  -- pass happily while this is wrong, because they point at different
  -- tables and neither can see the other.
  IF v_credit_owner <> v_invoice_owner THEN
    RAISE EXCEPTION
      'Store credit % belongs to franchise %, but invoice % belongs to franchise %',
      NEW.credit_id, v_credit_owner, NEW.invoice_id, v_invoice_owner;
  END IF;

  -- BEFORE INSERT, so the row being inserted is not in these sums yet.
  SELECT COALESCE(SUM(amount), 0) INTO v_credit_used
    FROM fofo.store_credit_applications WHERE credit_id = NEW.credit_id;

  IF v_credit_used + NEW.amount > v_credit_amount THEN
    RAISE EXCEPTION
      'Store credit % overdrawn. Credit is %, already applied %, this adds %',
      NEW.credit_id, v_credit_amount, v_credit_used, NEW.amount;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_invoice_used
    FROM fofo.store_credit_applications WHERE invoice_id = NEW.invoice_id;

  -- A crude cap against the whole bill, not against what is still owed
  -- after Razorpay: the precise figure needs the payments table and lives
  -- in fofo.apply_store_credit. This one only has to make free money
  -- impossible no matter who writes the row.
  IF v_invoice_used + NEW.amount > v_invoice_total THEN
    RAISE EXCEPTION
      'Invoice % overdrawn by store credit. Invoice is %, already applied %, this adds %',
      v_invoice_number, v_invoice_total, v_invoice_used, NEW.amount;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fofo.assert_store_credit_application_fits() IS
'Refuses an application that would spend more of a credit than exists, spend more against an invoice than it is worth, or cross two franchises. Locks the invoice then the credit — in that order everywhere — so two concurrent redemptions queue rather than both reading a stale total.';

DROP TRIGGER IF EXISTS trg_store_credit_application_fits
  ON fofo.store_credit_applications;

CREATE TRIGGER trg_store_credit_application_fits
  BEFORE INSERT ON fofo.store_credit_applications
  FOR EACH ROW EXECUTE FUNCTION fofo.assert_store_credit_application_fits();

-- ---------------------------------------------------------------------
-- 4b. The statement: the "remaining" figure, derived on every read
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW fofo.store_credit_statement AS
SELECT c.id                                        AS credit_id,
       c.franchise_id,
       cn.credit_note_number,
       c.created_at                                AS earned_at,
       c.reason,
       c.amount                                    AS amount_earned,
       COALESCE(SUM(a.amount), 0)                  AS amount_applied,
       c.amount - COALESCE(SUM(a.amount), 0)       AS amount_remaining
  FROM fofo.store_credits c
  JOIN fofo.credit_notes cn ON cn.id = c.credit_note_id
  LEFT JOIN fofo.store_credit_applications a ON a.credit_id = c.id
 GROUP BY c.id, c.franchise_id, cn.credit_note_number,
          c.created_at, c.reason, c.amount;

COMMENT ON VIEW fofo.store_credit_statement IS
'One row per credit with what is left of it. This is the remaining-amount column the design deliberately does not store: computed, so it cannot drift from the rows it is made of, and cheap at any volume this business will reach. A franchise balance is SUM(amount_remaining) — or fofo.store_credit_balance().';

-- ---------------------------------------------------------------------
-- 5. Deny by default
-- ---------------------------------------------------------------------

ALTER TABLE fofo.invoices                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.invoice_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.payments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.credit_notes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.store_credits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.store_credit_applications ENABLE ROW LEVEL SECURITY;

-- No policies: RLS with none denies every role, and service_role bypasses
-- it. See 03-create-fofo-schema.sql.

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Six empty tables and one view:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'fofo' ORDER BY table_name;
--
-- A second goods invoice on one order must FAIL (logistics must succeed):
--
-- INSERT INTO fofo.invoices (invoice_number, order_id, franchise_id, invoice_type,
--   buyer_name, buyer_address, taxable_value, gst_amount, total)
-- VALUES ('INV-T1', '<order>', '<franchise>', 'goods', 'Test Foods', '1 MG Rd', 100, 12, 112);
-- INSERT INTO fofo.invoices (invoice_number, order_id, franchise_id, invoice_type,
--   buyer_name, buyer_address, taxable_value, gst_amount, total)
-- VALUES ('INV-T2', '<order>', '<franchise>', 'goods', 'Test Foods', '1 MG Rd', 100, 12, 112); -- fails
-- VALUES ... 'logistics' ...                                                                  -- succeeds
--
-- An invoice whose total does not add up must FAIL:
--   ... taxable_value 100, gst_amount 12, total 113 ...
--
-- An invoice with no buyer address must FAIL — blank counts as missing:
--   ... buyer_address '  ' ...
--
-- THE ROUNDING RULE. 12.5 kg at 34.3333/kg, 5% GST:
--   taxable = round(12.5 * 34.3333, 2) = 429.17
--   gst     = round(429.17 * 5 / 100, 2) = 21.46
--   total   = 450.63
-- INSERT INTO fofo.invoice_items (invoice_id, description, quantity,
--   unit_price_ex_gst, gst_percent, line_taxable_value, line_gst, line_total)
-- VALUES ('<invoice>', 'Paneer', 12.5, 34.3333, 5, 429.17, 21.46, 450.63);  -- succeeds
-- ... the same with line_taxable_value 429.13 (34.33 × 12.5: unit price rounded first) -- fails
--
-- A credit note cannot be credited twice — the second must FAIL:
--
-- INSERT INTO fofo.store_credits (franchise_id, credit_note_id, amount, reason)
-- VALUES ('<franchise>', '<credit_note>', 1000, 'CN-T1 trim');
-- -- repeat the same statement; it must fail on the unique key
--
-- PARTIAL SPENDING WORKS, AND OVERDRAWING DOES NOT. Against a 1000 credit:
--
-- INSERT INTO fofo.store_credit_applications (credit_id, invoice_id, amount)
-- VALUES ('<credit>', '<invoice>', 400);       -- succeeds, 600 left
-- INSERT INTO fofo.store_credit_applications (credit_id, invoice_id, amount)
-- VALUES ('<credit>', '<invoice2>', 600);      -- succeeds, 0 left
-- INSERT INTO fofo.store_credit_applications (credit_id, invoice_id, amount)
-- VALUES ('<credit>', '<invoice3>', 1);        -- FAILS: credit overdrawn
--
-- An invoice cannot absorb more credit than it is worth:
--
-- INSERT INTO fofo.store_credit_applications (credit_id, invoice_id, amount)
-- VALUES ('<credit>', '<invoice of 500>', 900);  -- FAILS: invoice overdrawn
--
-- Nor can one franchise's credit settle another's bill:
--
-- INSERT INTO fofo.store_credit_applications (credit_id, invoice_id, amount)
-- VALUES ('<franchise A credit>', '<franchise B invoice>', 10);   -- FAILS
--
-- THE CONCURRENCY CHECK, which is the whole point of the trigger. In two
-- psql sessions, against one credit of 1000:
--
--   A: BEGIN; INSERT ... amount 1000;      -- does not commit yet
--   B: BEGIN; INSERT ... amount 1000;      -- blocks on the credit row lock
--   A: COMMIT;
--   B:                                     -- unblocks, then FAILS overdrawn
--
-- Without the row lock B reads "1000 available" from A's pre-image and
-- both succeed. If B succeeds here, the trigger is not doing its job.
--
-- A franchise's balance, and the rows behind it:
--
-- SELECT fofo.store_credit_balance('<franchise>');
--
-- SELECT credit_note_number, amount_earned, amount_applied, amount_remaining
-- FROM fofo.store_credit_statement
-- WHERE franchise_id = '<franchise>' ORDER BY earned_at;
--
-- The two must agree — the balance is the sum of the remainders:
--
-- SELECT fofo.store_credit_balance('<franchise>')
--        - (SELECT COALESCE(SUM(amount_remaining), 0)
--             FROM fofo.store_credit_statement
--            WHERE franchise_id = '<franchise>');    -- must be 0
--

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP VIEW  IF EXISTS fofo.store_credit_statement;
-- DROP TABLE IF EXISTS fofo.store_credit_applications;
-- DROP TABLE IF EXISTS fofo.store_credits;
-- DROP FUNCTION IF EXISTS fofo.assert_store_credit_application_fits();
-- DROP TABLE IF EXISTS fofo.credit_notes;
-- DROP TABLE IF EXISTS fofo.payments;
-- DROP TABLE IF EXISTS fofo.invoice_items;
-- DROP TABLE IF EXISTS fofo.invoices;
