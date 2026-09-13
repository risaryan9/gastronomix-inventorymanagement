-- =====================================================================
-- Let an admin mark an outlet FOCO or FOFO, without breaking ownership
--
-- outlets.ownership_model (04) says who OPERATES an outlet: 'foco', the
-- company, or 'fofo', a franchise that buys supplies from us. Until now it
-- changed only as a side effect of linking an outlet to a FOFO franchise (12).
-- Admins also need to set it directly, from the Outlets page — to mark an
-- outlet as changing over before its franchise exists, or to correct one.
--
-- WHAT CHANGES.
--
--   fofo.set_outlet_ownership_model(...)     the audited way to change it
--   trigger on public.outlets                refuses 'foco' for a FOFO-owned outlet
--
-- THE ONE RULE: AN OUTLET A FOFO FRANCHISE OWNS IS FRANCHISE-OPERATED. Linking
-- sets 'fofo' (12); nothing may set it back while the link exists, or a
-- franchise would be ordering for an outlet the rest of the system believes the
-- company runs. Remove the outlet from its franchise first.
--
-- WHY A TRIGGER AS WELL AS THE FUNCTION. The internal app writes public.outlets
-- directly with the anon key — its Outlets page edits name, code and kitchen
-- that way — and the live policy on outlets allows that write. So the function
-- alone would be a door with a wall missing beside it. The trigger holds the
-- rule for every writer. The function exists for the readable message, the
-- FOCO-code check and the audit event.
--
-- MARKING AN OUTLET 'fofo' IS REFUSED WHILE IT HAS AN ACTIVE FOCO DASHBOARD
-- CODE (public.franchise_outlet_codes), for the same reason linking is (12):
-- that code says the FOCO dashboard reports on it as a company-run outlet.
-- Deactivate the code first if the outlet really is changing over. This is
-- checked in the function only — FOCO codes are managed elsewhere, and a
-- trigger would make the order of those two edits matter.
--
-- MARKING 'fofo' DOES NOT LINK THE OUTLET TO ANY FRANCHISE. A 'fofo' outlet
-- with no owner is valid: it is franchise-operated, and not yet onboarded.
--
-- Requires: 03 (franchise_outlets), 04 (ownership_model), 10
-- (log_fofo_audit_event), 11 (assert_active_admin).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The guard, for every writer
-- ---------------------------------------------------------------------

-- SECURITY DEFINER because the writer may be the anon key, which cannot read
-- the fofo schema, and the check has to see franchise_outlets regardless.
CREATE OR REPLACE FUNCTION fofo.outlets_keep_owned_outlets_fofo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_owner text;
BEGIN
  IF NEW.ownership_model = 'foco' AND OLD.ownership_model IS DISTINCT FROM 'foco' THEN
    SELECT f.name INTO v_owner
      FROM fofo.franchise_outlets fo
      JOIN fofo.franchises f ON f.id = fo.franchise_id
     WHERE fo.outlet_id = NEW.id;

    IF FOUND THEN
      RAISE EXCEPTION 'Outlet % belongs to FOFO franchise % — remove it from that franchise before marking it FOCO', NEW.code, v_owner;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outlets_keep_owned_outlets_fofo ON public.outlets;
CREATE TRIGGER trg_outlets_keep_owned_outlets_fofo
  BEFORE UPDATE OF ownership_model ON public.outlets
  FOR EACH ROW
  EXECUTE FUNCTION fofo.outlets_keep_owned_outlets_fofo();

COMMENT ON FUNCTION fofo.outlets_keep_owned_outlets_fofo() IS
'Trigger on public.outlets: refuses ownership_model = foco for an outlet a FOFO franchise owns. Holds the rule for every writer, including the internal app''s direct anon-key updates. Unlink the outlet first.';

-- ---------------------------------------------------------------------
-- 2. The audited change
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
  v_outlet public.outlets%ROWTYPE;
  v_owner  fofo.franchises%ROWTYPE;
BEGIN
  PERFORM fofo.assert_active_admin(p_changed_by);

  IF p_ownership_model IS NULL OR p_ownership_model NOT IN ('foco', 'fofo') THEN
    RAISE EXCEPTION 'Ownership model must be foco or fofo';
  END IF;

  -- Locked, so this and a link or unlink of the same outlet queue (12 locks
  -- the outlet too).
  SELECT * INTO v_outlet FROM public.outlets WHERE id = p_outlet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outlet % not found', p_outlet_id;
  END IF;

  IF v_outlet.ownership_model = p_ownership_model THEN
    RETURN false;     -- a repeat click changes nothing
  END IF;

  IF p_ownership_model = 'foco' THEN
    -- The trigger refuses this too; checked here first for the franchise
    -- name in the message and the audit trail's sake.
    SELECT f.* INTO v_owner
      FROM fofo.franchise_outlets fo
      JOIN fofo.franchises f ON f.id = fo.franchise_id
     WHERE fo.outlet_id = p_outlet_id;
    IF FOUND THEN
      RAISE EXCEPTION 'Outlet % belongs to FOFO franchise % — remove it from that franchise before marking it FOCO', v_outlet.code, v_owner.name;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.franchise_outlet_codes c
       WHERE c.outlet_id = p_outlet_id AND c.is_active = true
    ) THEN
      RAISE EXCEPTION 'Outlet % has an active FOCO dashboard code, so it is company-operated. If it is changing over to FOFO, deactivate its FOCO code first.', v_outlet.code;
    END IF;
  END IF;

  UPDATE public.outlets
     SET ownership_model = p_ownership_model, updated_at = now()
   WHERE id = p_outlet_id;

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
    p_old_values       => jsonb_build_object('ownership_model', v_outlet.ownership_model),
    p_new_values       => jsonb_build_object(
      'ownership_model', p_ownership_model,
      'outlet_code',     v_outlet.code,
      'outlet_name',     v_outlet.name
    )
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fofo.set_outlet_ownership_model(uuid, text, uuid) IS
'Marks an outlet company-operated (foco) or franchise-operated (fofo). Refuses foco for an outlet a FOFO franchise owns, and fofo for an outlet with an active FOCO dashboard code. Does not link the outlet to any franchise. Returns false when unchanged. Audited. Admins only.';

-- ---------------------------------------------------------------------
-- 3. Grants (decision 0004): revoke by name, then check proacl
-- ---------------------------------------------------------------------

-- A trigger function needs no EXECUTE grant to fire, so it gets none.
REVOKE ALL ON FUNCTION fofo.outlets_keep_owned_outlets_fofo()             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.set_outlet_ownership_model(uuid, text, uuid)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fofo.set_outlet_ownership_model(uuid, text, uuid) TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The trigger is on outlets:
--
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.outlets'::regclass AND NOT tgisinternal;
--
-- Grants — set_outlet_ownership_model service_role only, the trigger function
-- owner only:
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace
--   AND p.proname IN ('outlets_keep_owned_outlets_fofo', 'set_outlet_ownership_model');
--
-- Nothing is inconsistent now — must return no rows (an owned outlet marked foco):
--
-- SELECT o.code FROM fofo.franchise_outlets fo
-- JOIN public.outlets o ON o.id = fo.outlet_id
-- WHERE o.ownership_model <> 'fofo';

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP TRIGGER IF EXISTS trg_outlets_keep_owned_outlets_fofo ON public.outlets;
-- DROP FUNCTION IF EXISTS fofo.outlets_keep_owned_outlets_fofo();
-- DROP FUNCTION IF EXISTS fofo.set_outlet_ownership_model(uuid, text, uuid);
