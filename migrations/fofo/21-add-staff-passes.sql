-- =====================================================================
-- Staff passes: how a key-login staff member proves who they are to the
-- partner app's server
--
-- The staff side of FOFO (spec §8.3, §8.4): a purchase manager accepts an
-- order and raises its logistics invoice, a kitchen executive packs it. All of
-- that lives in the fofo schema, which the internal app cannot reach, so those
-- screens call the partner app's server (decision 0015). The server then has to
-- know who is calling.
--
-- An admin proves it with a Supabase Auth session. Purchase managers and
-- kitchen executives have none: they log in with a key, and the internal app
-- only remembers who they are in the browser, where anyone can write anything.
-- So the server checks the key itself, once, and hands back a PASS: a random
-- token that stands for "this person, this role, this kitchen" until it runs
-- out. Decision 0023 holds the reasoning; this file holds the tables.
--
-- WHAT CHANGES.
--
--   fofo.staff_passes                 one row per pass handed out
--   fofo.staff_pass_attempts          every time a key was offered for a pass
--   fofo.staff_pass_throttled(...)
--   fofo.issue_staff_pass(...)        checks the key, records the attempt, stores the pass
--   fofo.resolve_staff_pass(...)      every request: who holds this pass, if anyone still does
--   fofo.end_staff_pass(...)          signing out
--
-- Nothing in the public schema changes. Key login itself is untouched:
-- authenticate_user_by_key still decides who gets into the internal app.
--
-- ONLY TWO ROLES GET A PASS: purchase_manager and kitchen_executive, the two
-- that act on FOFO orders. A supervisor, a dispatch executive or a Boom Pizza
-- operator has a key too and is refused here. Adding a role means changing
-- staff_passes_role_known, issue_staff_pass and the server's list together.
--
-- THE KEY CHECK IS QUIET. It does not call authenticate_user_by_key, which
-- writes an auth audit event on every call: the staff member has just logged in
-- through that function, and a second "logged in" event a moment later would
-- make the auth trail read as two logins. What happens here goes to
-- fofo.staff_pass_attempts instead, failures included, which is also what the
-- throttle counts. As with franchise sign-in (14), a failed attempt is not an
-- audit event: failures are unbounded under attack.
--
-- THE PASS IS CHECKED AGAINST THE USER ON EVERY REQUEST, not only when it was
-- issued. resolve_staff_pass ends a pass, with the reason, the moment it finds
-- that the user was deactivated or deleted, changed role, moved kitchen, or had
-- their key changed. So rotating someone's key in Admin → Users signs them out
-- of FOFO on their next click; nothing has to remember to do it. This is why a
-- pass stores the hash of the key it was issued for.
--
-- A PASS SAYS WHO, NOT WHAT THEY MAY TOUCH. It gives a role and a kitchen. The
-- function that accepts or packs an order must still check that the order
-- belongs to that kitchen, on every call (spec §12). Nothing here does that.
--
-- ONLY HASHES ARE STORED. The pass token as SHA-256, as with franchise sessions
-- and registration links; the login key as public.hash_login_key, the same
-- form the auth audit trail keeps.
--
-- Requires: 03 (the fofo schema).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Passes
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.staff_passes (
  id               uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id          uuid NOT NULL REFERENCES public.users(id),
  -- The role and kitchen the key was accepted for. Kept so that a later change
  -- to either on public.users is noticed and ends the pass.
  role             text NOT NULL,
  cloud_kitchen_id uuid NOT NULL REFERENCES public.cloud_kitchens(id),
  -- The key this pass was issued for, hashed. A different hash on the user
  -- later means the key was rotated, and the pass ends.
  login_key_hash   text NOT NULL,
  token_hash       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_reason   text,
  ip_address       inet,
  user_agent       text,

  CONSTRAINT staff_passes_token_hash_key UNIQUE (token_hash),
  -- SHA-256 digests as hex. Anything else means a raw token or key was stored.
  CONSTRAINT staff_passes_token_is_a_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT staff_passes_key_is_a_hash CHECK (login_key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT staff_passes_role_known CHECK (role IN ('purchase_manager', 'kitchen_executive')),
  CONSTRAINT staff_passes_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT staff_passes_revoked_with_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT staff_passes_revoked_reason_known CHECK (revoked_reason IS NULL OR revoked_reason IN (
    'signed_out', 'user_deactivated', 'role_changed', 'kitchen_changed', 'key_changed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_fofo_staff_passes_live_by_user
  ON fofo.staff_passes (user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE fofo.staff_passes IS
'One pass handed to a key-login staff member (purchase manager or kitchen executive) so the partner app''s server knows who is calling. The browser holds a random token; only its SHA-256 is here. Ended by signing out, or automatically when a request finds the user deactivated, in another role or kitchen, or with a changed key. Expired and ended rows are kept as a record. Decision 0023.';

-- ---------------------------------------------------------------------
-- 2. Attempts
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.staff_pass_attempts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- As offered. Not foreign keys: a wrong guess may name a kitchen that does
  -- not exist, and the attempt is still worth keeping.
  role             text NOT NULL,
  cloud_kitchen_id uuid NOT NULL,
  ip_address       inet,
  succeeded        boolean NOT NULL,
  failure_reason   text,
  -- Who got a pass. Null on a failure.
  user_id          uuid REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_pass_attempts_reason CHECK (
    (succeeded AND failure_reason IS NULL AND user_id IS NOT NULL) OR
    (NOT succeeded AND user_id IS NULL AND failure_reason IN ('bad_key', 'throttled'))
  )
);

CREATE INDEX IF NOT EXISTS idx_fofo_staff_pass_attempts_ip
  ON fofo.staff_pass_attempts (ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fofo_staff_pass_attempts_target
  ON fofo.staff_pass_attempts (role, cloud_kitchen_id, created_at DESC);

COMMENT ON TABLE fofo.staff_pass_attempts IS
'Every time a login key was offered to the partner app''s server for a staff pass, successful or not, for throttling and investigation. The key itself is never stored. Not audit_events: the login it follows is already audited by authenticate_user_by_key, and failures are unbounded under attack.';

-- ---------------------------------------------------------------------
-- 3. Throttling
-- ---------------------------------------------------------------------

-- 10 wrong keys from one IP, or 30 for one role in one kitchen, in 15
-- minutes. There is no email to count against, as there is for a franchise
-- user, so the second count is per target: it stops one kitchen's keys being
-- guessed from many addresses. Its cost is that someone can lock a kitchen's
-- staff out of GETTING a pass for 15 minutes; a pass already held keeps
-- working, and so does the internal app.
--
-- This protects this door only. authenticate_user_by_key is callable with the
-- internal app's public key and is not throttled at all (docs/fofo-handoff.md,
-- Traps).
CREATE OR REPLACE FUNCTION fofo.staff_pass_throttled(
  p_role             text,
  p_cloud_kitchen_id uuid,
  p_ip               inet
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fofo, public
AS $$
  SELECT
    (p_ip IS NOT NULL AND
     (SELECT count(*) FROM fofo.staff_pass_attempts
       WHERE ip_address = p_ip AND failure_reason = 'bad_key'
         AND created_at > now() - interval '15 minutes') >= 10)
    OR
    (SELECT count(*) FROM fofo.staff_pass_attempts
      WHERE role = p_role AND cloud_kitchen_id = p_cloud_kitchen_id
        AND failure_reason = 'bad_key'
        AND created_at > now() - interval '15 minutes') >= 30;
$$;

COMMENT ON FUNCTION fofo.staff_pass_throttled(text, uuid, inet) IS
'True when a staff pass should be refused without checking the key: 10 wrong keys from this IP, or 30 for this role in this kitchen, in the last 15 minutes. Throttled attempts themselves do not count, so waiting always works.';

-- ---------------------------------------------------------------------
-- 4. Issuing, resolving and ending passes
-- ---------------------------------------------------------------------

-- The key check and the pass, in one call. Returns an OUTCOME rather than
-- raising, so a refusal is recorded in the same transaction (a RAISE would
-- roll the record back):
--
--   ok         the key belongs to an active user of that role in that kitchen;
--              the pass is stored
--   bad_key    it does not. Deliberately one answer for every way of being
--              wrong (no such key, wrong role, wrong kitchen, deactivated), so
--              the caller learns nothing about which
--   throttled  too many wrong keys; the key was not looked at
--
-- The predicate is authenticate_user_by_key's: the key with dashes, spaces and
-- case ignored, the role, the kitchen, active and not deleted. Keep the two the
-- same, or someone who can log in cannot get a pass.
--
-- A role outside the two that get a pass is a mistake in the caller, not a
-- wrong guess, and raises.
CREATE OR REPLACE FUNCTION fofo.issue_staff_pass(
  p_login_key        text,
  p_role             text,
  p_cloud_kitchen_id uuid,
  p_token_hash       text,
  p_expires_at       timestamptz,
  p_ip_address       inet DEFAULT NULL,
  p_user_agent       text DEFAULT NULL
)
RETURNS TABLE (
  outcome            text,
  user_id            uuid,
  full_name          text,
  role               text,
  cloud_kitchen_id   uuid,
  cloud_kitchen_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_key  text := upper(replace(btrim(coalesce(p_login_key, '')), '-', ''));
  v_user public.users%ROWTYPE;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('purchase_manager', 'kitchen_executive') THEN
    RAISE EXCEPTION 'A staff pass is only for a purchase manager or a kitchen executive, not %', coalesce(p_role, 'no role');
  END IF;
  IF p_cloud_kitchen_id IS NULL THEN
    RAISE EXCEPTION 'A staff pass needs a cloud kitchen';
  END IF;

  IF fofo.staff_pass_throttled(p_role, p_cloud_kitchen_id, p_ip_address) THEN
    INSERT INTO fofo.staff_pass_attempts (role, cloud_kitchen_id, ip_address, succeeded, failure_reason)
    VALUES (p_role, p_cloud_kitchen_id, p_ip_address, false, 'throttled');
    RETURN QUERY SELECT 'throttled'::text, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_key <> '' THEN
    SELECT u.* INTO v_user
      FROM public.users u
     WHERE upper(replace(btrim(u.login_key), '-', '')) = v_key
       AND u.role = p_role
       AND u.cloud_kitchen_id = p_cloud_kitchen_id
       AND u.is_active = true
       AND u.deleted_at IS NULL
     LIMIT 1;
  END IF;

  IF v_user.id IS NULL THEN
    INSERT INTO fofo.staff_pass_attempts (role, cloud_kitchen_id, ip_address, succeeded, failure_reason)
    VALUES (p_role, p_cloud_kitchen_id, p_ip_address, false, 'bad_key');
    RETURN QUERY SELECT 'bad_key'::text, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  INSERT INTO fofo.staff_passes
    (user_id, role, cloud_kitchen_id, login_key_hash, token_hash, expires_at, ip_address, user_agent)
  VALUES
    (v_user.id, v_user.role, v_user.cloud_kitchen_id, public.hash_login_key(v_user.login_key),
     p_token_hash, p_expires_at, p_ip_address, p_user_agent);

  INSERT INTO fofo.staff_pass_attempts (role, cloud_kitchen_id, ip_address, succeeded, user_id)
  VALUES (p_role, p_cloud_kitchen_id, p_ip_address, true, v_user.id);

  RETURN QUERY
    SELECT 'ok'::text, v_user.id, v_user.full_name, v_user.role, v_user.cloud_kitchen_id,
           (SELECT ck.name FROM public.cloud_kitchens ck WHERE ck.id = v_user.cloud_kitchen_id);
END;
$$;

COMMENT ON FUNCTION fofo.issue_staff_pass(text, text, uuid, text, timestamptz, inet, text) IS
'Checks a staff login key for a role and kitchen and, if it is right, stores a pass for the token hash given. Returns the outcome: ok, bad_key or throttled. Records the attempt in every case and never raises for a refusal, so the record survives. Writes no audit event: the login itself is audited by authenticate_user_by_key.';

-- Every request. Returns the staff member, or no row when the pass is
-- unknown, ended, expired — or no longer matches its user, in which case it is
-- ended now with the reason. Role and kitchen are read from public.users at
-- this moment; the copies on the pass are only what they are compared with.
CREATE OR REPLACE FUNCTION fofo.resolve_staff_pass(p_token_hash text)
RETURNS TABLE (
  pass_id            uuid,
  user_id            uuid,
  full_name          text,
  role               text,
  cloud_kitchen_id   uuid,
  cloud_kitchen_name text,
  expires_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_pass   fofo.staff_passes%ROWTYPE;
  v_user   public.users%ROWTYPE;
  v_reason text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  SELECT * INTO v_pass FROM fofo.staff_passes sp WHERE sp.token_hash = p_token_hash;
  IF NOT FOUND OR v_pass.revoked_at IS NOT NULL OR v_pass.expires_at <= now() THEN
    RETURN;
  END IF;

  SELECT * INTO v_user FROM public.users u WHERE u.id = v_pass.user_id;

  v_reason := CASE
    WHEN v_user.id IS NULL OR v_user.is_active IS NOT TRUE OR v_user.deleted_at IS NOT NULL
      THEN 'user_deactivated'
    WHEN v_user.role IS DISTINCT FROM v_pass.role
      THEN 'role_changed'
    WHEN v_user.cloud_kitchen_id IS DISTINCT FROM v_pass.cloud_kitchen_id
      THEN 'kitchen_changed'
    WHEN v_user.login_key IS NULL OR public.hash_login_key(v_user.login_key) <> v_pass.login_key_hash
      THEN 'key_changed'
  END;

  IF v_reason IS NOT NULL THEN
    UPDATE fofo.staff_passes sp SET revoked_at = now(), revoked_reason = v_reason
     WHERE sp.id = v_pass.id AND sp.revoked_at IS NULL;
    RETURN;
  END IF;

  -- At most one write per five minutes per pass, not one per request.
  IF v_pass.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE fofo.staff_passes sp SET last_seen_at = now() WHERE sp.id = v_pass.id;
  END IF;

  RETURN QUERY
    SELECT v_pass.id, v_user.id, v_user.full_name, v_user.role, v_user.cloud_kitchen_id,
           (SELECT ck.name FROM public.cloud_kitchens ck WHERE ck.id = v_user.cloud_kitchen_id),
           v_pass.expires_at;
END;
$$;

COMMENT ON FUNCTION fofo.resolve_staff_pass(text) IS
'Resolves a pass token hash to the staff member holding it, on every request. Returns no row for an unknown, ended or expired pass, and ends — with the reason — a pass whose user has been deactivated, changed role or kitchen, or had their key changed. Says who is calling; it does not say which orders they may act on.';

CREATE OR REPLACE FUNCTION fofo.end_staff_pass(p_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
  -- Already ended, or never existed: signing out is always fine.
  UPDATE fofo.staff_passes SET revoked_at = now(), revoked_reason = 'signed_out'
   WHERE token_hash = p_token_hash AND revoked_at IS NULL;
$$;

COMMENT ON FUNCTION fofo.end_staff_pass(text) IS
'Ends one pass, when the staff member signs out of the internal app. Harmless to repeat.';

-- ---------------------------------------------------------------------
-- 5. Deny by default, and grants (decision 0004)
-- ---------------------------------------------------------------------

ALTER TABLE fofo.staff_passes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.staff_pass_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION fofo.staff_pass_throttled(text, uuid, inet)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.issue_staff_pass(text, text, uuid, text, timestamptz, inet, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.resolve_staff_pass(text)                                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.end_staff_pass(text)                                                 FROM PUBLIC, anon, authenticated;

-- staff_pass_throttled is called only from inside issue_staff_pass, which runs
-- as its owner, so the server is not granted it.
GRANT EXECUTE ON FUNCTION fofo.issue_staff_pass(text, text, uuid, text, timestamptz, inet, text) TO service_role;
GRANT EXECUTE ON FUNCTION fofo.resolve_staff_pass(text)                                          TO service_role;
GRANT EXECUTE ON FUNCTION fofo.end_staff_pass(text)                                              TO service_role;

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- Both tables exist with RLS on and no policies:
--
-- SELECT c.relname, c.relrowsecurity,
--        (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fofo' AND p.tablename = c.relname) AS policies
-- FROM pg_class c
-- WHERE c.relnamespace = 'fofo'::regnamespace
--   AND c.relname IN ('staff_passes', 'staff_pass_attempts');
--
-- No function is callable by anon or authenticated, and the server holds
-- three of the four (proacl must not mention anon, authenticated or a bare
-- "=X"):
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace
--   AND p.proname IN ('staff_pass_throttled', 'issue_staff_pass', 'resolve_staff_pass', 'end_staff_pass');
--
-- Who holds a live pass now:
--
-- SELECT u.full_name, sp.role, ck.name AS kitchen, sp.created_at, sp.last_seen_at, sp.expires_at
-- FROM fofo.staff_passes sp
-- JOIN public.users u ON u.id = sp.user_id
-- JOIN public.cloud_kitchens ck ON ck.id = sp.cloud_kitchen_id
-- WHERE sp.revoked_at IS NULL AND sp.expires_at > now()
-- ORDER BY sp.last_seen_at DESC;
--
-- Wrong keys in the last day, by where they came from:
--
-- SELECT ip_address, role, cloud_kitchen_id, count(*) AS wrong_keys, max(created_at) AS latest
-- FROM fofo.staff_pass_attempts
-- WHERE failure_reason = 'bad_key' AND created_at > now() - interval '1 day'
-- GROUP BY 1, 2, 3 ORDER BY wrong_keys DESC;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP FUNCTION IF EXISTS fofo.end_staff_pass(text);
-- DROP FUNCTION IF EXISTS fofo.resolve_staff_pass(text);
-- DROP FUNCTION IF EXISTS fofo.issue_staff_pass(text, text, uuid, text, timestamptz, inet, text);
-- DROP FUNCTION IF EXISTS fofo.staff_pass_throttled(text, uuid, inet);
-- DROP TABLE IF EXISTS fofo.staff_pass_attempts;
-- DROP TABLE IF EXISTS fofo.staff_passes;
