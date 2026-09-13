-- =====================================================================
-- Admin: create and edit franchises, and give them outlets
--
-- Step 1 of onboarding (docs/fofo-dashboard-spec.md §8.1, and
-- docs/fofo-onboarding-checklist.md): an admin creates the franchise with its
-- main contact email, then links the outlets it owns. Migration 11 built
-- everything after that — the welcome email, registration links, users —
-- but nothing could create the franchise those functions act on.
--
-- WHAT CHANGES.
--
--   fofo.franchises            contact_email required; name, email and GSTIN
--                              constrained to one clean shape
--   fofo.create_franchise(...)
--   fofo.update_franchise(...)
--   fofo.set_franchise_active(...)
--   fofo.link_franchise_outlet(...)
--   fofo.unlink_franchise_outlet(...)
--
-- WHY FUNCTIONS, NOT INSERTS FROM THE SERVER. The server holds service_role
-- and could write these tables directly. It goes through functions for the
-- same reason migration 11 does: the admin check, the row locks and the
-- audit event happen together, in one transaction, or not at all. Every
-- change here is audited under fofo_account, naming the admin (decision
-- 0004). Reading franchises needs no function — the server SELECTs.
--
-- THE CONTACT EMAIL IS REQUIRED. Every onboarding email goes to it (§8.1) and
-- lock_sendable_franchise already refuses a franchise without one. A franchise
-- that cannot be onboarded is not worth being able to create. The table is
-- empty (checked below), so the NOT NULL costs nothing.
--
-- VALUES ARE CLEANED BEFORE THEY ARE STORED, AND THE TABLE REFUSES ANYTHING
-- ELSE. Blank text becomes NULL, emails are lowercased, and a GSTIN is
-- uppercased with its spaces removed. The functions do the cleaning and give
-- a readable message; the CHECKs are the guarantee.
--
-- THE GSTIN FORMAT IS CHECKED. It is printed on every invoice as the buyer's,
-- and a mistyped one is found by the buyer's auditor, not by us
-- (fofo-accounting-review.md §E). Only the shape is checked — 2-digit state
-- code, 10-character PAN, entity number, Z, check character — not the
-- checksum, and not that the state matches the address (no state is stored
-- yet). A GSTIN is optional: an unregistered franchise has none.
--
-- EDITING A FRANCHISE NEVER CHANGES AN ISSUED INVOICE. Invoices copy the
-- buyer's name, GSTIN and address when they are issued (decision 0016), and
-- a registration email copies the address it went to. So an edit here changes
-- what the NEXT document says, and nothing already sent.
--
-- DEACTIVATING, NOT DELETING. There is no delete. A franchise with orders and
-- invoices cannot disappear, and one with none can simply be switched off.
-- Deactivated, it cannot be sent emails (lock_sendable_franchise), its links
-- cannot be claimed (claim_franchise_invitation), and the API must refuse its
-- users' logins.
--
-- LINKING AN OUTLET MARKS IT FRANCHISE-OPERATED. outlets.ownership_model
-- becomes 'fofo' (04), because an outlet a FOFO franchise buys for is by
-- definition one it operates. Two refusals guard against picking the wrong
-- outlet out of a list of 77:
--
--   - an outlet already owned by another franchise — unlink it first, so a
--     move between franchises is two deliberate, audited steps
--   - an outlet with an active FOCO dashboard code (public.franchise_outlet_codes)
--     — that outlet is company-operated for another programme. Deactivate its
--     FOCO code first if it really is changing over.
--
-- UNLINKING DOES NOT TOUCH ORDERS. An order copies its franchise, outlet and
-- serving kitchen when it is placed (05), so one in progress completes
-- normally, and it still shows in the franchise's order history. What unlinking
-- does stop is new ordering for that outlet, so the outlet's cart — quantities
-- only, never prices — is discarded. ownership_model is left as 'fofo':
-- whether the outlet goes back to company operation is a separate question
-- from who owns it, and it is most often being moved to another franchise.
--
-- FOR WHOEVER BUILDS CHECKOUT: lock the franchise_outlets row (FOR SHARE)
-- when creating an order, so an unlink and a checkout for the same outlet
-- queue rather than interleave.
--
-- Requires: 03 (franchises, franchise_outlets), 04 (ownership_model),
-- 05 (carts), 10 (log_fofo_audit_event), 11 (assert_active_admin).
-- =====================================================================

BEGIN;

-- The constraints below were written for an empty table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fofo.franchises) THEN
    RAISE EXCEPTION
      'fofo.franchises is not empty. This migration makes contact_email required and constrains name, email and GSTIN — check existing rows against those rules by hand first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. One clean shape for a franchise's details
-- ---------------------------------------------------------------------

ALTER TABLE fofo.franchises
  ALTER COLUMN contact_email SET NOT NULL;

ALTER TABLE fofo.franchises
  DROP CONSTRAINT IF EXISTS franchises_name_not_blank,
  DROP CONSTRAINT IF EXISTS franchises_contact_email_normalised,
  DROP CONSTRAINT IF EXISTS franchises_gst_number_format;

ALTER TABLE fofo.franchises
  ADD CONSTRAINT franchises_name_not_blank
    CHECK (name = btrim(name) AND name <> ''),
  ADD CONSTRAINT franchises_contact_email_normalised
    CHECK (contact_email = lower(btrim(contact_email)) AND contact_email <> ''),
  -- 2-digit state code, PAN (5 letters, 4 digits, 1 letter), entity number,
  -- the letter Z, check character.
  ADD CONSTRAINT franchises_gst_number_format
    CHECK (gst_number IS NULL OR gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

COMMENT ON COLUMN fofo.franchises.contact_email IS
'The franchise''s main contact email. Required: every onboarding email — welcome and registration — goes here, never to an individual. Stored lowercase and trimmed. Not a login: franchise users register with emails of their own choosing.';

COMMENT ON COLUMN fofo.franchises.gst_number IS
'GSTIN, optional: a franchise may not be registered. Stored uppercase with no spaces, and its shape is checked, because it is printed on every invoice as the buyer''s. The checksum is not verified. Present here rather than derived from the outlet, because public.outlets carries no address or tax details at all.';

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------

-- Trimmed text, or NULL when nothing is left.
CREATE OR REPLACE FUNCTION fofo.clean_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = fofo, public
AS $$
  SELECT NULLIF(btrim(p_value), '');
$$;

-- Cleans and validates what an admin typed, and returns it as a franchise
-- row with only the editable fields set. One place, so create and update
-- cannot come to disagree about what a valid franchise is.
CREATE OR REPLACE FUNCTION fofo.clean_franchise_details(
  p_name           text,
  p_gst_number     text,
  p_address        text,
  p_city           text,
  p_contact_person text,
  p_contact_phone  text,
  p_contact_email  text
)
RETURNS fofo.franchises
LANGUAGE plpgsql
IMMUTABLE
SET search_path = fofo, public
AS $$
DECLARE
  v fofo.franchises%ROWTYPE;
BEGIN
  v.name           := fofo.clean_text(p_name);
  v.gst_number     := NULLIF(upper(regexp_replace(COALESCE(p_gst_number, ''), '\s', '', 'g')), '');
  v.address        := fofo.clean_text(p_address);
  v.city           := fofo.clean_text(p_city);
  v.contact_person := fofo.clean_text(p_contact_person);
  v.contact_phone  := fofo.clean_text(p_contact_phone);
  v.contact_email  := lower(fofo.clean_text(p_contact_email));

  IF v.name IS NULL THEN
    RAISE EXCEPTION 'A franchise needs a name';
  END IF;
  IF v.contact_email IS NULL THEN
    RAISE EXCEPTION 'A franchise needs a contact email — onboarding emails are sent to it';
  END IF;
  IF v.contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION '"%" is not a valid email address', v.contact_email;
  END IF;
  IF v.gst_number IS NOT NULL
     AND v.gst_number !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN
    RAISE EXCEPTION '"%" is not a valid GSTIN — expected 15 characters, e.g. 29ABCDE1234F1Z5', v.gst_number;
  END IF;

  RETURN v;
END;
$$;

-- The editable details as JSON, for audit old/new values.
CREATE OR REPLACE FUNCTION fofo.franchise_details_json(f fofo.franchises)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = fofo, public
AS $$
  SELECT jsonb_build_object(
    'name',           f.name,
    'gst_number',     f.gst_number,
    'address',        f.address,
    'city',           f.city,
    'contact_person', f.contact_person,
    'contact_phone',  f.contact_phone,
    'contact_email',  f.contact_email
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Create and edit
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.create_franchise(
  p_name           text,
  p_gst_number     text,
  p_address        text,
  p_city           text,
  p_contact_person text,
  p_contact_phone  text,
  p_contact_email  text,
  p_created_by     uuid
)
RETURNS uuid          -- the new franchise id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v    fofo.franchises%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM fofo.assert_active_admin(p_created_by);

  v := fofo.clean_franchise_details(
    p_name, p_gst_number, p_address, p_city,
    p_contact_person, p_contact_phone, p_contact_email
  );

  INSERT INTO fofo.franchises
    (name, gst_number, address, city, contact_person, contact_phone, contact_email)
  VALUES
    (v.name, v.gst_number, v.address, v.city, v.contact_person, v.contact_phone, v.contact_email)
  RETURNING id INTO v_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id  => v_id,
    p_category      => 'fofo_account',
    p_action        => 'franchise_created',
    p_actor_user_id => p_created_by,
    p_severity      => 'info',
    p_entity_type   => 'fofo_franchise',
    p_entity_id     => v_id,
    p_new_values    => fofo.franchise_details_json(v)
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fofo.create_franchise(text, text, text, text, text, text, text, uuid) IS
'Creates a FOFO franchise, active, with no outlets and no users. Cleans the details (blank to NULL, email lowercase, GSTIN uppercase) and raises a readable message if the name or contact email is missing or the email or GSTIN is malformed. Audited. Admins only.';

CREATE OR REPLACE FUNCTION fofo.update_franchise(
  p_franchise_id   uuid,
  p_name           text,
  p_gst_number     text,
  p_address        text,
  p_city           text,
  p_contact_person text,
  p_contact_phone  text,
  p_contact_email  text,
  p_updated_by     uuid
)
RETURNS boolean       -- false when nothing changed
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_old    fofo.franchises%ROWTYPE;
  v_new    fofo.franchises%ROWTYPE;
  v_before jsonb;
  v_after  jsonb;
  v_old_changed jsonb;
  v_new_changed jsonb;
BEGIN
  PERFORM fofo.assert_active_admin(p_updated_by);

  SELECT * INTO v_old FROM fofo.franchises WHERE id = p_franchise_id FOR UPDATE;
  IF NOT FOUND OR v_old.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Franchise % not found', p_franchise_id;
  END IF;

  v_new := fofo.clean_franchise_details(
    p_name, p_gst_number, p_address, p_city,
    p_contact_person, p_contact_phone, p_contact_email
  );

  -- Only the fields that actually changed go into the audit event, so an
  -- edit reads as "GSTIN: none → 29ABCDE1234F1Z5", not a wall of repeats.
  v_before := fofo.franchise_details_json(v_old);
  v_after  := fofo.franchise_details_json(v_new);

  SELECT jsonb_object_agg(a.key, v_before -> a.key),
         jsonb_object_agg(a.key, a.value)
    INTO v_old_changed, v_new_changed
    FROM jsonb_each(v_after) a
   WHERE v_before -> a.key IS DISTINCT FROM a.value;

  -- A save with no edits is not an event.
  IF v_new_changed IS NULL THEN
    RETURN false;
  END IF;

  UPDATE fofo.franchises
     SET name           = v_new.name,
         gst_number     = v_new.gst_number,
         address        = v_new.address,
         city           = v_new.city,
         contact_person = v_new.contact_person,
         contact_phone  = v_new.contact_phone,
         contact_email  = v_new.contact_email,
         updated_at     = now()
   WHERE id = p_franchise_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id  => p_franchise_id,
    p_category      => 'fofo_account',
    p_action        => 'franchise_updated',
    p_actor_user_id => p_updated_by,
    -- Name, GSTIN and address are what the next invoice will print.
    p_severity      => 'review',
    p_entity_type   => 'fofo_franchise',
    p_entity_id     => p_franchise_id,
    p_old_values    => v_old_changed,
    p_new_values    => v_new_changed
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fofo.update_franchise(uuid, text, text, text, text, text, text, text, uuid) IS
'Replaces a franchise''s editable details with the values given — pass every field, not only the changed ones; a NULL clears it. Same cleaning and validation as create_franchise. Audits only the fields that changed and returns false, writing nothing, when none did. Already-issued invoices and sent emails keep what they said. Admins only.';

CREATE OR REPLACE FUNCTION fofo.set_franchise_active(
  p_franchise_id uuid,
  p_is_active    boolean,
  p_changed_by   uuid
)
RETURNS boolean       -- false when it was already in that state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v fofo.franchises%ROWTYPE;
BEGIN
  PERFORM fofo.assert_active_admin(p_changed_by);

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'is_active must be true or false';
  END IF;

  SELECT * INTO v FROM fofo.franchises WHERE id = p_franchise_id FOR UPDATE;
  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Franchise % not found', p_franchise_id;
  END IF;

  IF v.is_active = p_is_active THEN
    RETURN false;     -- a repeat click changes nothing
  END IF;

  UPDATE fofo.franchises
     SET is_active = p_is_active, updated_at = now()
   WHERE id = p_franchise_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id  => p_franchise_id,
    p_category      => 'fofo_account',
    p_action        => CASE WHEN p_is_active THEN 'franchise_reactivated'
                            ELSE 'franchise_deactivated' END,
    p_actor_user_id => p_changed_by,
    p_severity      => 'review',
    p_entity_type   => 'fofo_franchise',
    p_entity_id     => p_franchise_id,
    p_old_values    => jsonb_build_object('is_active', v.is_active),
    p_new_values    => jsonb_build_object('is_active', p_is_active)
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fofo.set_franchise_active(uuid, boolean, uuid) IS
'Switches a franchise off or back on. Off: no onboarding emails, no registrations, and the API must refuse its users'' logins. Nothing is deleted, and orders already in progress are unaffected. Returns false when already in that state. Audited. Admins only.';

-- ---------------------------------------------------------------------
-- 4. Outlets
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
  -- here and the second is told who got it.
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

  IF EXISTS (
    SELECT 1 FROM public.franchise_outlet_codes c
     WHERE c.outlet_id = p_outlet_id AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Outlet % has an active FOCO dashboard code, so it is company-operated. If it is changing over to FOFO, deactivate its FOCO code first.', v_outlet.code;
  END IF;

  INSERT INTO fofo.franchise_outlets (franchise_id, outlet_id)
  VALUES (p_franchise_id, p_outlet_id)
  RETURNING id INTO v_link_id;

  IF v_outlet.ownership_model <> 'fofo' THEN
    UPDATE public.outlets
       SET ownership_model = 'fofo', updated_at = now()
     WHERE id = p_outlet_id;
  END IF;

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
    p_old_values       => jsonb_build_object('ownership_model', v_outlet.ownership_model),
    p_new_values       => jsonb_build_object(
      'outlet_code',     v_outlet.code,
      'outlet_name',     v_outlet.name,
      'ownership_model', 'fofo'
    )
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fofo.link_franchise_outlet(uuid, uuid, uuid) IS
'Gives an outlet to a franchise and marks the outlet franchise-operated (ownership_model = fofo). Refuses an inactive franchise or outlet, an outlet owned by another franchise, and an outlet with an active FOCO dashboard code. Returns false when already linked to this franchise. Audited. Admins only.';

CREATE OR REPLACE FUNCTION fofo.unlink_franchise_outlet(
  p_franchise_id uuid,
  p_outlet_id    uuid,
  p_unlinked_by  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_franchise   fofo.franchises%ROWTYPE;
  v_outlet      public.outlets%ROWTYPE;
  v_link_id     uuid;
  v_cart_lines  integer := 0;
BEGIN
  PERFORM fofo.assert_active_admin(p_unlinked_by);

  -- Same lock order as link: franchise, then outlet.
  SELECT * INTO v_franchise FROM fofo.franchises WHERE id = p_franchise_id FOR UPDATE;
  IF NOT FOUND OR v_franchise.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Franchise % not found', p_franchise_id;
  END IF;

  SELECT * INTO v_outlet FROM public.outlets WHERE id = p_outlet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outlet % not found', p_outlet_id;
  END IF;

  SELECT id INTO v_link_id
    FROM fofo.franchise_outlets
   WHERE franchise_id = p_franchise_id AND outlet_id = p_outlet_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outlet % does not belong to franchise %', v_outlet.code, v_franchise.name;
  END IF;

  -- The cart holds quantities only; nothing of value is lost. Orders are
  -- left alone — they carry their own franchise, outlet and kitchen.
  SELECT count(ci.id) INTO v_cart_lines
    FROM fofo.carts c
    LEFT JOIN fofo.cart_items ci ON ci.cart_id = c.id
   WHERE c.outlet_id = p_outlet_id;

  DELETE FROM fofo.carts WHERE outlet_id = p_outlet_id;   -- cart_items cascade
  DELETE FROM fofo.franchise_outlets WHERE id = v_link_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id     => p_franchise_id,
    p_category         => 'fofo_account',
    p_action           => 'franchise_outlet_unlinked',
    p_actor_user_id    => p_unlinked_by,
    p_severity         => 'review',
    p_entity_type      => 'fofo_franchise_outlet',
    p_entity_id        => v_link_id,
    p_outlet_id        => p_outlet_id,
    p_cloud_kitchen_id => v_outlet.cloud_kitchen_id,
    p_old_values       => jsonb_build_object(
      'outlet_code',          v_outlet.code,
      'outlet_name',          v_outlet.name,
      'cart_lines_discarded', v_cart_lines
    )
  );
END;
$$;

COMMENT ON FUNCTION fofo.unlink_franchise_outlet(uuid, uuid, uuid) IS
'Takes an outlet away from a franchise and discards its cart. Orders already placed are untouched and complete normally. ownership_model stays fofo. To move an outlet between franchises, unlink then link. Audited. Admins only.';

-- ---------------------------------------------------------------------
-- 5. Grants (decision 0004): revoke by name, then check proacl
-- ---------------------------------------------------------------------

-- The helpers are revoked from service_role too, explicitly. Whether a
-- default-privileges rule grants a new function to a role by name depends on
-- which rules exist in the database (decision 0004), so "no GRANT line" is not
-- proof of "no grant". The functions that call these are SECURITY DEFINER and
-- run as the owner, so nothing else needs them.
REVOKE ALL ON FUNCTION fofo.clean_text(text)                                                 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.clean_franchise_details(text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.franchise_details_json(fofo.franchises)                          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION fofo.create_franchise(text, text, text, text, text, text, text, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.update_franchise(uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.set_franchise_active(uuid, boolean, uuid)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.link_franchise_outlet(uuid, uuid, uuid)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.unlink_franchise_outlet(uuid, uuid, uuid)                        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fofo.create_franchise(text, text, text, text, text, text, text, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION fofo.update_franchise(uuid, text, text, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fofo.set_franchise_active(uuid, boolean, uuid)                        TO service_role;
GRANT EXECUTE ON FUNCTION fofo.link_franchise_outlet(uuid, uuid, uuid)                          TO service_role;
GRANT EXECUTE ON FUNCTION fofo.unlink_franchise_outlet(uuid, uuid, uuid)                        TO service_role;
COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- contact_email is required and the three CHECKs exist:
--
-- SELECT is_nullable FROM information_schema.columns
-- WHERE table_schema = 'fofo' AND table_name = 'franchises'
--   AND column_name = 'contact_email';                       -- NO
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'fofo.franchises'::regclass AND contype = 'c'
-- ORDER BY conname;
--
-- The five admin functions are service_role only and the three helpers owner
-- only — no anon, no authenticated, no bare "=X/" PUBLIC entry:
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace
--   AND p.proname IN ('clean_text', 'clean_franchise_details',
--     'franchise_details_json', 'create_franchise', 'update_franchise',
--     'set_franchise_active', 'link_franchise_outlet', 'unlink_franchise_outlet')
-- ORDER BY p.proname;
--
-- A franchise, its outlets, and what happened to it:
--
-- SELECT f.name, f.is_active, o.code, o.ownership_model
-- FROM fofo.franchises f
-- LEFT JOIN fofo.franchise_outlets fo ON fo.franchise_id = f.id
-- LEFT JOIN public.outlets o ON o.id = fo.outlet_id
-- ORDER BY f.name, o.code;
--
-- SELECT created_at, actor_label, action, old_values, new_values
-- FROM public.audit_events
-- WHERE category = 'fofo_account' ORDER BY created_at DESC;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP FUNCTION IF EXISTS fofo.unlink_franchise_outlet(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.link_franchise_outlet(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.set_franchise_active(uuid, boolean, uuid);
-- DROP FUNCTION IF EXISTS fofo.update_franchise(uuid, text, text, text, text, text, text, text, uuid);
-- DROP FUNCTION IF EXISTS fofo.create_franchise(text, text, text, text, text, text, text, uuid);
-- DROP FUNCTION IF EXISTS fofo.franchise_details_json(fofo.franchises);
-- DROP FUNCTION IF EXISTS fofo.clean_franchise_details(text, text, text, text, text, text, text);
-- DROP FUNCTION IF EXISTS fofo.clean_text(text);
-- ALTER TABLE fofo.franchises
--   DROP CONSTRAINT IF EXISTS franchises_gst_number_format,
--   DROP CONSTRAINT IF EXISTS franchises_contact_email_normalised,
--   DROP CONSTRAINT IF EXISTS franchises_name_not_blank,
--   ALTER COLUMN contact_email DROP NOT NULL;
-- Outlets linked in the meantime keep ownership_model = 'fofo'; reset by hand
-- if wanted.
