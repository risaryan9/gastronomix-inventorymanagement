-- =====================================================================
-- Franchise sign-in: sessions, sign-in throttling, and who signed in
--
-- Phase 3 of docs/fofo-dashboard-spec.md: franchise users sign in to the
-- partner app. Registration (11) created their Supabase Auth user and their
-- fofo.franchise_users row; this is what happens after.
--
-- WHAT CHANGES.
--
--   fofo.franchise_sessions               one row per signed-in browser
--   fofo.franchise_sign_in_attempts       every attempt, for throttling
--   fofo.sign_in_throttled(...)
--   fofo.record_sign_in_attempt(...)
--   fofo.start_franchise_session(...)
--   fofo.resolve_franchise_session(...)
--   fofo.end_franchise_session(...)
--   fofo.end_all_franchise_user_sessions_for_password_reset(...)
--
-- THE SESSION IS THE SERVER'S, NOT SUPABASE'S (decision 0018). Supabase Auth
-- checks the password; the server then throws Supabase's token away and gives
-- the browser its own random session token in an HttpOnly cookie. Only the
-- token's SHA-256 is stored here, as with registration links. Why not keep
-- the Supabase token: the partner app holds no Supabase key (decision 0015),
-- and a Supabase JWT in a franchise user's hands would work against PostgREST
-- directly — see 0018 for what it can and cannot reach.
--
-- DEACTIVATION TAKES EFFECT ON THE NEXT REQUEST. Every request resolves its
-- session through resolve_franchise_session, which checks that the user AND
-- the franchise are still active. If not, the session is ended there and
-- then, with the reason recorded. Nothing has to remember to sign people out
-- when an admin switches a franchise off.
--
-- THROTTLING LIVES HERE, NOT IN MEMORY. Serverless functions share no memory,
-- so "5 wrong passwords" has to be counted in the database. Supabase Auth
-- rate-limits too, but every sign-in reaches it from the partner app's server,
-- so its per-IP limit would count all franchises together; this counts per
-- email and per real client IP.
--
-- ATTEMPTS ARE NOT AUDIT EVENTS. A failed sign-in is noise in the audit trail
-- and unbounded under attack, so it goes to its own table. A successful
-- sign-in, a sign-out and a password reset are audited, naming the user.
--
-- Requires: 03, 10 (log_fofo_audit_event), 11 (franchise_users shape).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Sessions
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.franchise_sessions (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  franchise_user_id uuid NOT NULL REFERENCES fofo.franchise_users(id),
  token_hash        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_reason    text,
  ip_address        inet,
  user_agent        text,

  CONSTRAINT franchise_sessions_token_hash_key UNIQUE (token_hash),
  -- A SHA-256 digest as hex. Anything else means a raw token was stored.
  CONSTRAINT franchise_sessions_token_is_a_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT franchise_sessions_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT franchise_sessions_revoked_with_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT franchise_sessions_revoked_reason_known CHECK (revoked_reason IS NULL OR revoked_reason IN (
    'signed_out', 'password_reset', 'user_deactivated', 'franchise_deactivated'
  ))
);

CREATE INDEX IF NOT EXISTS idx_fofo_franchise_sessions_live_by_user
  ON fofo.franchise_sessions (franchise_user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE fofo.franchise_sessions IS
'One signed-in browser of a franchise user. The browser holds a random token in an HttpOnly cookie; only its SHA-256 is here. Ended by signing out, by a password reset, or automatically when the user or franchise is found inactive on a request. Expired and ended rows are kept as a record.';

-- ---------------------------------------------------------------------
-- 2. Sign-in attempts
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.franchise_sign_in_attempts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          text NOT NULL,
  ip_address     inet,
  succeeded      boolean NOT NULL,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT franchise_sign_in_attempts_reason CHECK (
    (succeeded AND failure_reason IS NULL) OR
    (NOT succeeded AND failure_reason IN (
      'bad_credentials', 'not_a_franchise_user', 'user_inactive', 'franchise_inactive', 'throttled'
    ))
  )
);

CREATE INDEX IF NOT EXISTS idx_fofo_sign_in_attempts_email
  ON fofo.franchise_sign_in_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fofo_sign_in_attempts_ip
  ON fofo.franchise_sign_in_attempts (ip_address, created_at DESC);

COMMENT ON TABLE fofo.franchise_sign_in_attempts IS
'Every sign-in attempt to the partner app, successful or not, for throttling and investigation. Not audit_events: failures are unbounded under attack. The email is as typed (lowercased), whether or not it belongs to anyone.';

-- ---------------------------------------------------------------------
-- 3. Throttling
-- ---------------------------------------------------------------------

-- 5 failures for one email, or 30 from one IP, in 15 minutes. Per email
-- stops guessing one person's password; per IP stops trying one password
-- against many emails. A successful sign-in does not reset the count: an
-- attacker who knows one password must not earn more guesses at others.
CREATE OR REPLACE FUNCTION fofo.sign_in_throttled(p_email text, p_ip inet)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fofo, public
AS $$
  SELECT
    (SELECT count(*) FROM fofo.franchise_sign_in_attempts
      WHERE email = lower(btrim(p_email)) AND NOT succeeded
        AND failure_reason <> 'throttled'
        AND created_at > now() - interval '15 minutes') >= 5
    OR
    (p_ip IS NOT NULL AND
     (SELECT count(*) FROM fofo.franchise_sign_in_attempts
       WHERE ip_address = p_ip AND NOT succeeded
         AND failure_reason <> 'throttled'
         AND created_at > now() - interval '15 minutes') >= 30);
$$;

COMMENT ON FUNCTION fofo.sign_in_throttled(text, inet) IS
'True when sign-in should be refused without checking the password: 5 failed attempts for this email, or 30 from this IP, in the last 15 minutes. Throttled attempts themselves do not count, so waiting always works.';

CREATE OR REPLACE FUNCTION fofo.record_sign_in_attempt(
  p_email          text,
  p_ip             inet,
  p_succeeded      boolean,
  p_failure_reason text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
  INSERT INTO fofo.franchise_sign_in_attempts (email, ip_address, succeeded, failure_reason)
  VALUES (lower(btrim(p_email)), p_ip, p_succeeded, p_failure_reason);
$$;

-- ---------------------------------------------------------------------
-- 4. Starting, resolving and ending sessions
-- ---------------------------------------------------------------------

-- Called once Supabase Auth has accepted the password. Returns an OUTCOME
-- rather than raising, so a refusal can be recorded in the same transaction
-- (a RAISE would roll the record back):
--
--   ok                    session stored, attempt recorded, sign-in audited
--   not_a_franchise_user  a valid Supabase login that is not a franchise user
--                         (an internal admin, say) — told only "incorrect"
--   user_inactive         the login has been deactivated
--   franchise_inactive    the franchise has been deactivated
--
-- The last two are only ever reported after the right password, so they tell
-- an attacker nothing they could not already try.
CREATE OR REPLACE FUNCTION fofo.start_franchise_session(
  p_auth_user_id uuid,
  p_email        text,
  p_token_hash   text,
  p_expires_at   timestamptz,
  p_ip_address   inet DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS TABLE (outcome text, franchise_user_id uuid, franchise_id uuid, email text, franchise_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_user      fofo.franchise_users%ROWTYPE;
  v_franchise fofo.franchises%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM fofo.franchise_users u WHERE u.auth_user_id = p_auth_user_id;
  IF NOT FOUND THEN
    PERFORM fofo.record_sign_in_attempt(p_email, p_ip_address, false, 'not_a_franchise_user');
    RETURN QUERY SELECT 'not_a_franchise_user'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_franchise FROM fofo.franchises f WHERE f.id = v_user.franchise_id;

  IF NOT v_user.is_active THEN
    PERFORM fofo.record_sign_in_attempt(p_email, p_ip_address, false, 'user_inactive');
    RETURN QUERY SELECT 'user_inactive'::text, v_user.id, v_user.franchise_id, v_user.email, v_franchise.name;
    RETURN;
  END IF;
  IF NOT v_franchise.is_active OR v_franchise.deleted_at IS NOT NULL THEN
    PERFORM fofo.record_sign_in_attempt(p_email, p_ip_address, false, 'franchise_inactive');
    RETURN QUERY SELECT 'franchise_inactive'::text, v_user.id, v_user.franchise_id, v_user.email, v_franchise.name;
    RETURN;
  END IF;

  INSERT INTO fofo.franchise_sessions
    (franchise_user_id, token_hash, expires_at, ip_address, user_agent)
  VALUES
    (v_user.id, p_token_hash, p_expires_at, p_ip_address, p_user_agent);

  PERFORM fofo.record_sign_in_attempt(p_email, p_ip_address, true, NULL);

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => v_user.franchise_id,
    p_category                => 'fofo_account',
    p_action                  => 'franchise_user_signed_in',
    p_actor_franchise_user_id => v_user.id,
    p_severity                => 'info',
    p_entity_type             => 'fofo_franchise_user',
    p_entity_id               => v_user.id,
    p_ip_address              => p_ip_address,
    p_user_agent              => p_user_agent
  );

  RETURN QUERY SELECT 'ok'::text, v_user.id, v_user.franchise_id, v_user.email, v_franchise.name;
END;
$$;

COMMENT ON FUNCTION fofo.start_franchise_session(uuid, text, text, timestamptz, inet, text) IS
'Starts a partner-app session for a Supabase Auth user whose password has just been accepted, and returns the outcome: ok, not_a_franchise_user, user_inactive or franchise_inactive. Records the attempt in every case, and audits a successful sign-in. Never raises for a refusal, so the record survives.';

-- Every request. Returns the caller, or no row when the session is unknown,
-- ended, expired — or belongs to a user or franchise that is no longer
-- active, in which case it is ended now with the reason.
CREATE OR REPLACE FUNCTION fofo.resolve_franchise_session(p_token_hash text)
RETURNS TABLE (
  session_id        uuid,
  franchise_user_id uuid,
  franchise_id      uuid,
  email             text,
  franchise_name    text,
  expires_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_session   fofo.franchise_sessions%ROWTYPE;
  v_user      fofo.franchise_users%ROWTYPE;
  v_franchise fofo.franchises%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  SELECT * INTO v_session FROM fofo.franchise_sessions WHERE token_hash = p_token_hash;
  IF NOT FOUND OR v_session.revoked_at IS NOT NULL OR v_session.expires_at <= now() THEN
    RETURN;
  END IF;

  SELECT * INTO v_user FROM fofo.franchise_users WHERE id = v_session.franchise_user_id;
  SELECT * INTO v_franchise FROM fofo.franchises WHERE id = v_user.franchise_id;

  IF NOT v_user.is_active THEN
    UPDATE fofo.franchise_sessions SET revoked_at = now(), revoked_reason = 'user_deactivated'
     WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN;
  END IF;
  IF NOT v_franchise.is_active OR v_franchise.deleted_at IS NOT NULL THEN
    UPDATE fofo.franchise_sessions SET revoked_at = now(), revoked_reason = 'franchise_deactivated'
     WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN;
  END IF;

  -- At most one write per five minutes per session, not one per request.
  IF v_session.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE fofo.franchise_sessions SET last_seen_at = now() WHERE id = v_session.id;
  END IF;

  RETURN QUERY SELECT v_session.id, v_user.id, v_user.franchise_id, v_user.email,
                      v_franchise.name, v_session.expires_at;
END;
$$;

COMMENT ON FUNCTION fofo.resolve_franchise_session(text) IS
'Resolves a session token hash to the signed-in franchise user and their franchise, on every request. Returns no row for an unknown, ended or expired session, and ends — with the reason — a session whose user or franchise has been deactivated.';

CREATE OR REPLACE FUNCTION fofo.end_franchise_session(
  p_token_hash text,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_session fofo.franchise_sessions%ROWTYPE;
  v_user    fofo.franchise_users%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM fofo.franchise_sessions
   WHERE token_hash = p_token_hash AND revoked_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;   -- already ended, or never existed: signing out is always fine
  END IF;

  UPDATE fofo.franchise_sessions SET revoked_at = now(), revoked_reason = 'signed_out'
   WHERE id = v_session.id;

  SELECT * INTO v_user FROM fofo.franchise_users WHERE id = v_session.franchise_user_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => v_user.franchise_id,
    p_category                => 'fofo_account',
    p_action                  => 'franchise_user_signed_out',
    p_actor_franchise_user_id => v_user.id,
    p_severity                => 'info',
    p_entity_type             => 'fofo_franchise_user',
    p_entity_id               => v_user.id,
    p_ip_address              => p_ip_address,
    p_user_agent              => p_user_agent
  );
END;
$$;

COMMENT ON FUNCTION fofo.end_franchise_session(text, inet, text) IS
'Signs one browser out. Harmless to repeat. Audited.';

-- A password reset ends every session the user has, so a browser signed in
-- with the old password — perhaps the reason for the reset — is out.
CREATE OR REPLACE FUNCTION fofo.end_all_franchise_user_sessions_for_password_reset(
  p_auth_user_id uuid,
  p_ip_address   inet DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS integer       -- sessions ended
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_user  fofo.franchise_users%ROWTYPE;
  v_ended integer;
BEGIN
  SELECT * INTO v_user FROM fofo.franchise_users WHERE auth_user_id = p_auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not a Gastronomix Partners login';
  END IF;

  UPDATE fofo.franchise_sessions SET revoked_at = now(), revoked_reason = 'password_reset'
   WHERE franchise_user_id = v_user.id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => v_user.franchise_id,
    p_category                => 'fofo_account',
    p_action                  => 'franchise_user_password_reset',
    p_actor_franchise_user_id => v_user.id,
    p_severity                => 'review',
    p_entity_type             => 'fofo_franchise_user',
    p_entity_id               => v_user.id,
    p_new_values              => jsonb_build_object('sessions_ended', v_ended),
    p_ip_address              => p_ip_address,
    p_user_agent              => p_user_agent
  );

  RETURN v_ended;
END;
$$;

COMMENT ON FUNCTION fofo.end_all_franchise_user_sessions_for_password_reset(uuid, inet, text) IS
'After a franchise user resets their password: ends all their partner-app sessions and audits the reset. Raises if the Auth user is not a franchise user.';

-- ---------------------------------------------------------------------
-- 5. Deny by default, and grants (decision 0004)
-- ---------------------------------------------------------------------

ALTER TABLE fofo.franchise_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.franchise_sign_in_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION fofo.sign_in_throttled(text, inet)                                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.record_sign_in_attempt(text, inet, boolean, text)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.start_franchise_session(uuid, text, text, timestamptz, inet, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.resolve_franchise_session(text)                                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.end_franchise_session(text, inet, text)                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.end_all_franchise_user_sessions_for_password_reset(uuid, inet, text)        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fofo.sign_in_throttled(text, inet)                                            TO service_role;
GRANT EXECUTE ON FUNCTION fofo.record_sign_in_attempt(text, inet, boolean, text)                        TO service_role;
GRANT EXECUTE ON FUNCTION fofo.start_franchise_session(uuid, text, text, timestamptz, inet, text)       TO service_role;
GRANT EXECUTE ON FUNCTION fofo.resolve_franchise_session(text)                                          TO service_role;
GRANT EXECUTE ON FUNCTION fofo.end_franchise_session(text, inet, text)                                  TO service_role;
GRANT EXECUTE ON FUNCTION fofo.end_all_franchise_user_sessions_for_password_reset(uuid, inet, text)     TO service_role;

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
--   AND c.relname IN ('franchise_sessions', 'franchise_sign_in_attempts');
--
-- Every function is service_role only:
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace
--   AND p.proname IN ('sign_in_throttled', 'record_sign_in_attempt', 'start_franchise_session',
--     'resolve_franchise_session', 'end_franchise_session',
--     'end_all_franchise_user_sessions_for_password_reset');
--
-- Who is signed in now:
--
-- SELECT u.email, f.name, s.created_at, s.last_seen_at, s.expires_at
-- FROM fofo.franchise_sessions s
-- JOIN fofo.franchise_users u ON u.id = s.franchise_user_id
-- JOIN fofo.franchises f ON f.id = u.franchise_id
-- WHERE s.revoked_at IS NULL AND s.expires_at > now()
-- ORDER BY s.last_seen_at DESC;

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP FUNCTION IF EXISTS fofo.end_all_franchise_user_sessions_for_password_reset(uuid, inet, text);
-- DROP FUNCTION IF EXISTS fofo.end_franchise_session(text, inet, text);
-- DROP FUNCTION IF EXISTS fofo.resolve_franchise_session(text);
-- DROP FUNCTION IF EXISTS fofo.start_franchise_session(uuid, text, text, timestamptz, inet, text);
-- DROP FUNCTION IF EXISTS fofo.record_sign_in_attempt(text, inet, boolean, text);
-- DROP FUNCTION IF EXISTS fofo.sign_in_throttled(text, inet);
-- DROP TABLE IF EXISTS fofo.franchise_sign_in_attempts;
-- DROP TABLE IF EXISTS fofo.franchise_sessions;
