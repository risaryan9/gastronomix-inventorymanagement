-- =====================================================================
-- A daily cutoff after which supervisors cannot raise requisitions
--
-- Outlets could raise a requisition at any hour. The kitchen needs the
-- day's demand settled early enough to buy and pack against it, so each
-- cloud kitchen now carries a cutoff time and a supervisor cannot create a
-- requisition past it. Default 11:30 IST, changeable by the admin from the
-- Kitchen Wise Overview screen.
--
-- SCOPE. Nippu Kodi and El Chaapo outlets only, and only when the person
-- raising it is a supervisor. Boom Pizza is deliberately exempt (its
-- operators run a different flow), and so are the purchase manager and the
-- admin, who need a way to enter a genuine late request. Both exemptions
-- are decisions, not oversights — see docs/REQUISITION_CUTOFF.md.
--
-- WHY A TRIGGER, NOT A CHECK INSIDE save_allocation_request(). Three pages
-- call that RPC and it is ~350 lines; re-declaring the whole body to add
-- six lines of guard risks losing something in the copy. A BEFORE INSERT
-- trigger sits under every write path instead — the RPC, a future one, and
-- a direct PostgREST insert alike — which is what "hard lock" has to mean.
-- save_allocation_request is SECURITY DEFINER, and a definer function does
-- not skip triggers, only RLS.
--
-- THE WINDOW, AND WHY IT IS UTC ARITHMETIC. request_date comes from
-- public.business_today(), which is the UTC date — deliberately, so the
-- business day does not roll until 05:30 IST and a late shift's work stays
-- on the day it started (see lib/businessDate.js). The requisition window
-- is therefore exactly:
--
--   [ 00:00 UTC , cutoff_ist - 05:30 )   of the current UTC day
--   [ 05:30 IST , cutoff_ist        )   the same thing, said in IST
--
-- So an 11:30 IST cutoff is 06:00 UTC, and the check is a plain
-- time-of-day comparison against the UTC clock. Comparing IST times
-- instead would need a special case for 00:00-05:29 IST, which belongs to
-- the *previous* business day and whose cutoff passed hours ago; in UTC
-- that case needs no special handling at all, because 02:00 IST is 20:30
-- UTC on the previous day and 20:30 >= 06:00 blocks it correctly.
--
-- THE CHECK CONSTRAINT. A cutoff at or before 05:30 IST would be a window
-- of zero or negative length — no supervisor could ever submit — and the
-- subtraction would wrap past midnight into a time that silently allows
-- everything. The constraint makes that unreachable rather than trusting
-- the admin form to prevent it.
--
-- EXPECT THIS TO BITE. Measured over the 60 days before this migration,
-- 32 of 58 El Chaapo requisitions and 2 of 5 Nippu Kodi ones were created
-- after 11:30 IST, plus a few between midnight and 05:30 IST that belong
-- to the previous business day. Roughly 60% of current EC/NK submissions
-- would have been refused. That is the point of the change, but it is a
-- behaviour change for most supervisors on day one, not a quiet tidy-up.
-- =====================================================================

BEGIN;

ALTER TABLE public.cloud_kitchens
ADD COLUMN IF NOT EXISTS requisition_cutoff_ist time NOT NULL DEFAULT '11:30';

COMMENT ON COLUMN public.cloud_kitchens.requisition_cutoff_ist IS
'Time of day, in IST, after which supervisors can no longer create a requisition for this kitchen''s Nippu Kodi and El Chaapo outlets. Stored as IST because that is the only timezone anyone here states it in; the trigger converts to UTC to compare. The window opens with the business day at 05:30 IST (00:00 UTC).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cloud_kitchens_requisition_cutoff_after_day_start'
  ) THEN
    ALTER TABLE public.cloud_kitchens
    ADD CONSTRAINT cloud_kitchens_requisition_cutoff_after_day_start
    CHECK (requisition_cutoff_ist > TIME '05:30');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_requisition_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- Hard-coded on purpose. These are the two brands the cutoff was asked
  -- for; making it a table would imply a generality nobody has decided on,
  -- and would hide a policy decision inside data. Adding a brand is a
  -- one-line migration and a line in the doc.
  c_locked_brands  text[] := ARRAY['NK', 'EC'];
  v_role           text;
  v_brand          text;
  v_cutoff_ist     time;
  v_cutoff_utc     time;
BEGIN
  -- Only supervisors are held to the cutoff. The purchase manager raises
  -- requisitions from the same shared Outlets page and is the one packing
  -- them; bp_operator runs the exempt brand; admin is not restricted.
  SELECT role INTO v_role FROM public.users WHERE id = NEW.requested_by;
  IF v_role IS DISTINCT FROM 'supervisor' THEN
    RETURN NEW;
  END IF;

  -- Brand lives in the outlet code prefix (NK…, EC…, BP…), which is how
  -- every screen in the app already derives it.
  SELECT upper(left(code, 2)) INTO v_brand FROM public.outlets WHERE id = NEW.outlet_id;
  IF v_brand IS NULL OR NOT (v_brand = ANY(c_locked_brands)) THEN
    RETURN NEW;
  END IF;

  SELECT requisition_cutoff_ist INTO v_cutoff_ist
  FROM public.cloud_kitchens WHERE id = NEW.cloud_kitchen_id;

  -- No kitchen row, no cutoff to enforce. Refusing here would block a
  -- requisition over a lookup failure that has nothing to do with timing.
  IF v_cutoff_ist IS NULL THEN
    RETURN NEW;
  END IF;

  v_cutoff_utc := v_cutoff_ist - INTERVAL '5 hours 30 minutes';

  IF (now() AT TIME ZONE 'UTC')::time >= v_cutoff_utc THEN
    RAISE EXCEPTION
      'Requisitions close at % IST and today''s window has passed. The next window opens at 05:30 IST.',
      to_char(v_cutoff_ist, 'HH12:MI AM')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_requisition_cutoff IS
'BEFORE INSERT guard on allocation_requests: refuses a supervisor-raised requisition for an NK or EC outlet once the kitchen''s requisition_cutoff_ist has passed for the current business day. Editing an existing requisition is deliberately NOT blocked — see docs/REQUISITION_CUTOFF.md.';

DROP TRIGGER IF EXISTS trg_enforce_requisition_cutoff ON public.allocation_requests;

CREATE TRIGGER trg_enforce_requisition_cutoff
BEFORE INSERT ON public.allocation_requests
FOR EACH ROW
EXECUTE FUNCTION public.enforce_requisition_cutoff();

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Current setting per kitchen, in both timezones:
--
-- SELECT name,
--        requisition_cutoff_ist AS cutoff_ist,
--        requisition_cutoff_ist - INTERVAL '5 hours 30 minutes' AS cutoff_utc,
--        (now() AT TIME ZONE 'UTC')::time AS now_utc,
--        (now() AT TIME ZONE 'UTC')::time
--          < (requisition_cutoff_ist - INTERVAL '5 hours 30 minutes') AS window_open
-- FROM public.cloud_kitchens
-- WHERE is_active AND deleted_at IS NULL
-- ORDER BY name;
--
-- Change one kitchen's cutoff (what the admin screen does):
--
-- UPDATE public.cloud_kitchens SET requisition_cutoff_ist = '10:00'
-- WHERE code = 'CK3';

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP TRIGGER IF EXISTS trg_enforce_requisition_cutoff ON public.allocation_requests;
-- DROP FUNCTION IF EXISTS public.enforce_requisition_cutoff();
-- ALTER TABLE public.cloud_kitchens
--   DROP CONSTRAINT IF EXISTS cloud_kitchens_requisition_cutoff_after_day_start;
-- ALTER TABLE public.cloud_kitchens DROP COLUMN IF EXISTS requisition_cutoff_ist;
