-- =====================================================================
-- Let audit_events carry FOFO money actions
--
-- audit_events.category is a closed CHECK list, written when the table
-- replaced audit_logs. It covers the internal tool's vocabulary — stock,
-- catalog, requisitions, checkout — and nothing on the FOFO side fits any
-- of them: a store credit application is not inventory_out, and calling it
-- checkout would put it in the same bucket as the dispatch flow and quietly
-- corrupt every report that filters on that word.
--
-- So this widens the list by one value. It does not touch existing rows,
-- and nothing that was allowed before stops being allowed.
--
--   fofo_money   invoices, payments, credit notes, store credit — the
--                money side of the franchise dashboard
--
-- Decision 0004 requires every money-moving write to produce an audit
-- event, and fofo.apply_store_credit is the first FOFO function to need
-- one. The coming accept RPC (15-create-fofo-accept-order-rpc.sql) will use
-- the same category for the stock-out and credit note it writes.
--
-- Run this BEFORE 08-create-fofo-store-credit-rpcs.sql. The CHECK is only
-- evaluated on INSERT, so nothing fails at CREATE time if you do not —
-- it fails later, at the first redemption, which is a worse place to find
-- out.
-- =====================================================================

BEGIN;

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_category_check;

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_category_check CHECK (category = ANY (ARRAY[
    'auth', 'inventory_in', 'catalog', 'inventory_out',
    'reversal', 'requisition', 'checkout', 'dispatch_plan',
    'fofo_money'
  ]));

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The new value is allowed and the old ones still are:
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'audit_events_category_check';
--
-- Nothing was orphaned by the swap — this must return 0:
--
-- SELECT COUNT(*) FROM public.audit_events
-- WHERE category NOT IN ('auth','inventory_in','catalog','inventory_out',
--                        'reversal','requisition','checkout','dispatch_plan',
--                        'fofo_money');
--
-- The read side renders from a registry keyed category:action
-- (frontend/src/lib/auditEvents.js, ACTION_META). A fofo_money event with
-- no registry entry will render as an unknown action, not crash — but add
-- the entries when the FOFO screens are built, per decision 0004.

-- =====================================================================
-- Rollback
-- =====================================================================
-- Only safe while no fofo_money rows exist; check first.
--
-- ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_category_check;
-- ALTER TABLE public.audit_events
--   ADD CONSTRAINT audit_events_category_check CHECK (category = ANY (ARRAY[
--     'auth', 'inventory_in', 'catalog', 'inventory_out',
--     'reversal', 'requisition', 'checkout', 'dispatch_plan'
--   ]));
