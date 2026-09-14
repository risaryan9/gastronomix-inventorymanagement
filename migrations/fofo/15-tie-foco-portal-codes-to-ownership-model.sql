-- =====================================================================
-- An outlet's FOCO portal code follows its ownership model; only FOFO
-- outlets can be given to a franchise
--
-- public.franchise_outlet_codes holds the code FOCO franchise owners use to
-- open their portal (the read-only analytics dashboard). The portal reads it
-- with the anon key, and the table's only read policy is
-- `franchise_outlet_codes_anon_read ... USING (is_active)` — so a code with
-- is_active = false is invisible to the portal, and cannot open it.
--
-- WHAT CHANGES.
--
--   franchise_outlet_codes.deactivated_for_fofo_at   why a code is off
--   trigger on public.outlets                        keeps the code in step
--   fofo.set_outlet_ownership_model(...)             replaced (13)
--   fofo.link_franchise_outlet(...)                  replaced (12)
--
-- 1. SWITCHING AN OUTLET TO FOFO TURNS ITS PORTAL CODE OFF. Migration 13
--    refused FOFO for an outlet with an active code; decided since: the switch
--    is allowed, and the code is deactivated in the same statement, because a
--    franchise-operated outlet's former FOCO owners must not keep a view of
--    its sales. Recorded in deactivated_for_fofo_at.
--
-- 2. SWITCHING BACK TO FOCO TURNS IT ON AGAIN — but only a code this switch
--    turned off (deactivated_for_fofo_at is set). A code that was off for any
--    other reason stays off: reversing an ownership change must not undo an
--    unrelated decision to cut someone's access. (Today every code is active,
--    so the two cases give the same answer; the column keeps them apart later.)
--
-- 3. BOTH ARE A TRIGGER ON outlets, not code in one function. ownership_model
--    can be written by set_outlet_ownership_model, and — the live outlets
--    policy allows it — by a direct anon-key update. The rule must hold for
--    both, and a trigger is the one place every writer passes through.
--
-- 4. ONLY A FOFO OUTLET CAN BE LINKED TO A FRANCHISE. Migration 12 let
--    linking switch a FOCO outlet to FOFO on the way; with the model now set
--    on its own from the Outlets page, a click in the franchise screen's
--    picker must not quietly turn a company-run outlet into a franchise one.
--    Two deliberate steps: mark it FOFO (Outlets), then link it (FOFO
--    Franchises). Linking no longer changes ownership_model at all.
--
-- ENFORCEMENT DEPENDS ON THE PORTAL READING WITH THE ANON KEY (confirmed
-- 2026-09-14). A portal that read codes with the service_role key would bypass
-- the policy and would have to check is_active itself.
--
-- NO BACKFILL. Every outlet is FOCO today and every code is active, so no
-- existing row is out of step.
--
-- Requires: 12, 13.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Why a portal code is off
-- ---------------------------------------------------------------------

ALTER TABLE public.franchise_outlet_codes
  ADD COLUMN IF NOT EXISTS deactivated_for_fofo_at timestamptz;

ALTER TABLE public.franchise_outlet_codes
  DROP CONSTRAINT IF EXISTS franchise_outlet_codes_fofo_deactivation_is_inactive;
ALTER TABLE public.franchise_outlet_codes
  ADD CONSTRAINT franchise_outlet_codes_fofo_deactivation_is_inactive
  CHECK (deactivated_for_fofo_at IS NULL OR is_active = false);

COMMENT ON COLUMN public.franchise_outlet_codes.is_active IS
'Whether this code opens the FOCO portal. The portal reads codes with the anon key through a policy that shows only active rows, so false locks it out. Turned off automatically when the outlet becomes FOFO (see deactivated_for_fofo_at).';

COMMENT ON COLUMN public.franchise_outlet_codes.deactivated_for_fofo_at IS
'Set when the code was turned off because its outlet became franchise-operated (FOFO). Only such a code is turned back on if the outlet returns to FOCO; a code turned off for any other reason stays off.';

-- ---------------------------------------------------------------------
-- 2. The trigger
-- ---------------------------------------------------------------------

-- SECURITY DEFINER: the writer may be the anon key, which may neither update
-- franchise_outlet_codes nor see an inactive code.
CREATE OR REPLACE FUNCTION fofo.outlets_sync_foco_portal_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
BEGIN
  IF NEW.ownership_model = 'fofo' AND OLD.ownership_model IS DISTINCT FROM 'fofo' THEN
    UPDATE public.franchise_outlet_codes
       SET is_active = false, deactivated_for_fofo_at = now(), updated_at = now()
     WHERE outlet_id = NEW.id AND is_active = true;

  ELSIF NEW.ownership_model = 'foco' AND OLD.ownership_model IS DISTINCT FROM 'foco' THEN
    UPDATE public.franchise_outlet_codes
       SET is_active = true, deactivated_for_fofo_at = NULL, updated_at = now()
     WHERE outlet_id = NEW.id AND deactivated_for_fofo_at IS NOT NULL;
  END IF;

  RETURN NULL;   -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_outlets_sync_foco_portal_code ON public.outlets;
-- AFTER, so it runs only once the change has passed the BEFORE trigger from
-- 13 that refuses FOCO for a franchise-owned outlet.
CREATE TRIGGER trg_outlets_sync_foco_portal_code
  AFTER UPDATE OF ownership_model ON public.outlets
  FOR EACH ROW
  EXECUTE FUNCTION fofo.outlets_sync_foco_portal_code();

COMMENT ON FUNCTION fofo.outlets_sync_foco_portal_code() IS
'Trigger on public.outlets: when an outlet becomes FOFO its active FOCO portal code is turned off (deactivated_for_fofo_at set); when it returns to FOCO, a code turned off that way is turned back on. Holds for every writer of ownership_model.';

-- ---------------------------------------------------------------------
-- 3. Changing the model (replaces 13)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.set_outlet_ownership_model(
  p_outlet_id       uuid,
  p_ownership_model text,
  p_changed_by      uuid
)
RETURNS boolean       -- false when it already had that model
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_outlet      public.outlets%ROWTYPE;
  v_owner       fofo.franchises%ROWTYPE;
  v_code_before public.franchise_outlet_codes%ROWTYPE;
  v_code_after  public.franchise_outlet_codes%ROWTYPE;
BEGIN
  PERFORM fofo.assert_active_admin(p_changed_by);

  IF p_ownership_model IS NULL OR p_ownership_model NOT IN ('foco', 'fofo') THEN
    RAISE EXCEPTION 'Ownership model must be foco or fofo';
  END IF;

  SELECT * INTO v_outlet FROM public.outlets WHERE id = p_outlet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outlet % not found', p_outlet_id;
  END IF;

  IF v_outlet.ownership_model = p_ownership_model THEN
    RETURN false;     -- a repeat click changes nothing
  END IF;

  IF p_ownership_model = 'foco' THEN
    -- The BEFORE trigger from 13 refuses this too; checked here first for the
    -- franchise's name in the message.
    SELECT f.* INTO v_owner
      FROM fofo.franchise_outlets fo
      JOIN fofo.franchises f ON f.id = fo.franchise_id
     WHERE fo.outlet_id = p_outlet_id;
    IF FOUND THEN
      RAISE EXCEPTION 'Outlet % belongs to FOFO franchise % — remove it from that franchise before marking it FOCO', v_outlet.code, v_owner.name;
    END IF;
  END IF;

  SELECT * INTO v_code_before FROM public.franchise_outlet_codes WHERE outlet_id = p_outlet_id;

  -- The trigger turns the portal code off or on.
  UPDATE public.outlets
     SET ownership_model = p_ownership_model, updated_at = now()
   WHERE id = p_outlet_id;

  SELECT * INTO v_code_after FROM public.franchise_outlet_codes WHERE outlet_id = p_outlet_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => NULL,
    p_category         => 'fofo_account',
    p_action           => 'outlet_ownership_model_changed',
    p_actor_user_id    => p_changed_by,
    p_severity         => 'review',
    p_entity_type      => 'outlet',
    p_entity_id        => p_outlet_id,
    p_outlet_id        => p_outlet_id,
    p_cloud_kitchen_id => v_outlet.cloud_kitchen_id,
    p_old_values       => jsonb_build_object(
      'ownership_model',         v_outlet.ownership_model,
      'foco_portal_code_active', v_code_before.is_active
    ),
    p_new_values       => jsonb_build_object(
      'ownership_model',         p_ownership_model,
      'outlet_code',             v_outlet.code,
      'outlet_name',             v_outlet.name,
      'foco_portal_code_active', v_code_after.is_active
    )
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fofo.set_outlet_ownership_model(uuid, text, uuid) IS
'Marks an outlet company-operated (foco) or franchise-operated (fofo). Becoming FOFO turns its FOCO portal code off; returning to FOCO turns a code turned off that way back on (the trigger on outlets does both). Refuses FOCO for an outlet a FOFO franchise owns. Returns false when unchanged. Audited, including the portal code''s state before and after. Admins only.';

-- ---------------------------------------------------------------------
-- 4. Linking (replaces 12): FOFO outlets only, and no model change
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.link_franchise_outlet(
  p_franchise_id uuid,
  p_outlet_id    uuid,
  p_linked_by    uuid
)
RETURNS boolean       -- false when it was already linked to this franchise
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_franchise fofo.franchises%ROWTYPE;
  v_outlet    public.outlets%ROWTYPE;
  v_owner     fofo.franchises%ROWTYPE;
  v_link_id   uuid;
BEGIN
  PERFORM fofo.assert_active_admin(p_linked_by);

  SELECT * INTO v_franchise FROM fofo.franchises WHERE id = p_franchise_id FOR UPDATE;
  IF NOT FOUND OR v_franchise.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Franchise % not found', p_franchise_id;
  END IF;
  IF NOT v_franchise.is_active THEN
    RAISE EXCEPTION 'Franchise % is not active — reactivate it before adding outlets', v_franchise.name;
  END IF;

  -- Locked, so two admins linking the same outlet to two franchises queue
  -- here and the second is told who got it; and so a switch back to FOCO
  -- cannot slip in between the check below and the insert.
  SELECT * INTO v_outlet FROM public.outlets WHERE id = p_outlet_id FOR UPDATE;
  IF NOT FOUND OR v_outlet.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Outlet % not found', p_outlet_id;
  END IF;
  IF NOT v_outlet.is_active THEN
    RAISE EXCEPTION 'Outlet % is not active', v_outlet.code;
  END IF;

  SELECT f.* INTO v_owner
    FROM fofo.franchise_outlets fo
    JOIN fofo.franchises f ON f.id = fo.franchise_id
   WHERE fo.outlet_id = p_outlet_id;

  IF FOUND THEN
    IF v_owner.id = p_franchise_id THEN
      RETURN false;   -- already theirs; a repeat click changes nothing
    END IF;
    RAISE EXCEPTION 'Outlet % already belongs to franchise % — remove it there first', v_outlet.code, v_owner.name;
  END IF;

  IF v_outlet.ownership_model <> 'fofo' THEN
    RAISE EXCEPTION 'Outlet % is FOCO. Mark it FOFO on the Outlets page first, then add it here.', v_outlet.code;
  END IF;

  INSERT INTO fofo.franchise_outlets (franchise_id, outlet_id)
  VALUES (p_franchise_id, p_outlet_id)
  RETURNING id INTO v_link_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => p_franchise_id,
    p_category         => 'fofo_account',
    p_action           => 'franchise_outlet_linked',
    p_actor_user_id    => p_linked_by,
    p_severity         => 'review',
    p_entity_type      => 'fofo_franchise_outlet',
    p_entity_id        => v_link_id,
    p_outlet_id        => p_outlet_id,
    p_cloud_kitchen_id => v_outlet.cloud_kitchen_id,
    p_new_values       => jsonb_build_object(
      'outlet_code', v_outlet.code,
      'outlet_name', v_outlet.name
    )
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fofo.link_franchise_outlet(uuid, uuid, uuid) IS
'Gives a FOFO outlet to a franchise. Refuses a FOCO outlet (mark it FOFO on the Outlets page first), an inactive franchise or outlet, and an outlet owned by another franchise. Does not change the outlet''s ownership model. Returns false when already linked to this franchise. Audited. Admins only.';

-- ---------------------------------------------------------------------
-- 5. Grants (decision 0004): CREATE OR REPLACE keeps a function's grants,
-- but they are restated rather than trusted.
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION fofo.outlets_sync_foco_portal_code()               FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.set_outlet_ownership_model(uuid, text, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.link_franchise_outlet(uuid, uuid, uuid)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.set_outlet_ownership_model(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fofo.link_franchise_outlet(uuid, uuid, uuid)      TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The column, its CHECK, and both triggers on outlets:
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'franchise_outlet_codes'
--   AND column_name = 'deactivated_for_fofo_at';
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.outlets'::regclass AND NOT tgisinternal;
--
-- Grants — both functions service_role only, the trigger function owner only:
--
-- SELECT proname, proacl FROM pg_proc
-- WHERE pronamespace = 'fofo'::regnamespace
--   AND proname IN ('outlets_sync_foco_portal_code', 'set_outlet_ownership_model', 'link_franchise_outlet');
--
-- Nothing out of step now — both must return no rows:
--
-- SELECT o.code FROM public.outlets o JOIN public.franchise_outlet_codes c ON c.outlet_id = o.id
-- WHERE o.ownership_model = 'fofo' AND c.is_active;
--
-- SELECT o.code FROM fofo.franchise_outlets fo JOIN public.outlets o ON o.id = fo.outlet_id
-- WHERE o.ownership_model <> 'fofo';

-- =====================================================================
-- Rollback
-- =====================================================================
-- Re-run the link_franchise_outlet section of 12 and the
-- set_outlet_ownership_model section of 13, then:
-- DROP TRIGGER IF EXISTS trg_outlets_sync_foco_portal_code ON public.outlets;
-- DROP FUNCTION IF EXISTS fofo.outlets_sync_foco_portal_code();
-- ALTER TABLE public.franchise_outlet_codes
--   DROP CONSTRAINT IF EXISTS franchise_outlet_codes_fofo_deactivation_is_inactive,
--   DROP COLUMN IF EXISTS deactivated_for_fofo_at;
-- Codes turned off by a FOFO switch in the meantime stay off; reactivate by hand.
