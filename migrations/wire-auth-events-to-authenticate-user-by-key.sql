-- =====================================================================
-- Close A1 / A2 — audit key-based login attempts
--
-- docs/AUDIT_TRAIL_REQUIREMENTS.md §3.A:
--   A1 — key-based login (success)
--   A2 — key-based login (failure / invalid key)
--
-- replace-audit-logs-with-audit-events.sql already created the two write
-- targets (audit_events + audit_auth_events) and the log_auth_event() /
-- hash_login_key() helpers, but deliberately left them unwired — "that
-- rewiring is a separate, deliberate change to a live login path, not
-- bundled here". This migration is that change.
--
-- Per decision #2 (logging lives in the database), everything happens
-- inside authenticate_user_by_key itself. It is already SECURITY DEFINER,
-- so it can write audit rows regardless of the caller's role — which is
-- exactly what A1 needs, since key-based logins run as anon.
--
-- NO FRONTEND CHANGE IS REQUIRED. The function's signature and returned
-- columns are untouched; Login.jsx -> handleKeyLogin keeps working as-is
-- and cannot opt out of being logged.
--
-- Three safety properties this migration is built around:
--   1. A failing audit write must NEVER block a login. Every log_auth_event
--      call is wrapped in its own exception block; a broken audit path
--      degrades to a server-log WARNING, not an outage on the login screen.
--   2. The failure reason must NEVER leak to the client. It is recorded in
--      audit_auth_events only; the function still returns zero rows on
--      every failure, so the frontend shows the same generic message
--      whether the key was unknown, the user inactive, or the role wrong.
--   3. The raw login key is NEVER stored. Only hash_login_key()'s sha256
--      digest of the normalized key is written (§6.5).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Request-context helpers
--
--    §6.5 left open whether the app can actually see a client IP /user
--    agent server-side. It can: PostgREST exposes the inbound HTTP headers
--    to SQL via current_setting('request.headers'), so this needs no
--    frontend plumbing at all. Both helpers return NULL rather than
--    raising when called outside a PostgREST request (psql, migrations,
--    the SQL editor), so they are safe to call from anywhere.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_request_user_agent()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_headers json;
BEGIN
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  RETURN v_headers ->> 'user-agent';
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.current_request_user_agent IS
  'User-agent of the current PostgREST request, or NULL outside one. Never raises.';

CREATE OR REPLACE FUNCTION public.current_request_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_headers json;
  v_raw     text;
BEGIN
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  IF v_headers IS NULL THEN
    RETURN NULL;
  END IF;

  -- Supabase fronts Postgres with Cloudflare, so cf-connecting-ip is the
  -- most trustworthy value when present. Otherwise take the first hop of
  -- x-forwarded-for (client, proxy1, proxy2, ...), then x-real-ip.
  --
  -- Caveat worth knowing when reading this data: x-forwarded-for is
  -- client-supplied and therefore spoofable. Treat the IP as a
  -- corroborating signal, not proof of origin.
  v_raw := coalesce(
    v_headers ->> 'cf-connecting-ip',
    nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''),
    v_headers ->> 'x-real-ip'
  );

  v_raw := nullif(btrim(coalesce(v_raw, '')), '');
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_raw::inet;
EXCEPTION WHEN OTHERS THEN
  -- A malformed or spoofed header must not break the calling flow.
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.current_request_ip IS
  'Best-effort client IP of the current PostgREST request, or NULL outside one. Never raises. Note x-forwarded-for is client-spoofable.';

-- ---------------------------------------------------------------------
-- 2. log_auth_event — add p_new_values, populate ip/user_agent
--
--    DROP + CREATE rather than CREATE OR REPLACE: adding a defaulted 7th
--    parameter would otherwise create an OVERLOAD alongside the existing
--    6-argument version, and every call would then fail as ambiguous.
--    Safe to drop — nothing calls it yet (it has been unwired since it
--    was created).
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.log_auth_event(boolean, text, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.log_auth_event(
  p_success                    boolean,
  p_attempted_login_key_hash   text,
  p_attempted_role             text,
  p_attempted_cloud_kitchen_id uuid,
  p_resolved_user_id           uuid  DEFAULT NULL,
  p_failure_reason             text  DEFAULT NULL,
  p_new_values                 jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.audit_events (
    actor_user_id, actor_role, cloud_kitchen_id,
    category, action, severity, new_values,
    ip_address, user_agent
  ) VALUES (
    p_resolved_user_id,
    p_attempted_role,
    p_attempted_cloud_kitchen_id,
    'auth',
    CASE WHEN p_success THEN 'login_success' ELSE 'login_failed' END,
    -- Successful logins are the highest-volume event in the whole audit
    -- trail and are "purely additive with no financial or physical-stock
    -- effect" (§6.3's own definition of 'info'), so they stay 'info' and
    -- out of the review queue. Failures are 'critical' per §6.3.
    CASE WHEN p_success THEN 'info' ELSE 'critical' END,
    coalesce(p_new_values, '{}'::jsonb) || jsonb_build_object('success', p_success),
    public.current_request_ip(),
    public.current_request_user_agent()
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_auth_events (
    event_id, attempted_login_key_hash, attempted_role,
    attempted_cloud_kitchen_id, success, resolved_user_id, failure_reason
  ) VALUES (
    v_event_id, p_attempted_login_key_hash, p_attempted_role,
    p_attempted_cloud_kitchen_id, p_success, p_resolved_user_id, p_failure_reason
  );

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_auth_event IS
  'Internal write helper for A1/A2. Not directly callable by anon/authenticated (see REVOKE below) — called from inside authenticate_user_by_key.';

REVOKE EXECUTE ON FUNCTION public.log_auth_event(
  boolean, text, text, uuid, uuid, text, jsonb
) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 3. authenticate_user_by_key — same signature, same returned columns,
--    same authentication rule. The ONLY behavioural change is that both
--    outcomes now write an audit trail.
--
--    CREATE OR REPLACE (not DROP) keeps the existing grants to
--    public/authenticated/anon intact; they are re-issued below anyway.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.authenticate_user_by_key(
  p_login_key TEXT,
  p_role TEXT,
  p_cloud_kitchen_id UUID
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  cloud_kitchen_id UUID,
  is_active BOOLEAN,
  login_key TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  outlet_map UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user           public.users%ROWTYPE;
  v_candidate      public.users%ROWTYPE;
  v_key_hash       text;
  v_failure_reason text;
  v_matched_user   uuid;
BEGIN
  -- Hash once, up front: it is the only form of the key that is ever
  -- persisted, and both branches below need it.
  --
  -- coalesce matters here. hash_login_key(NULL) is NULL, which would
  -- violate audit_auth_events.attempted_login_key_hash NOT NULL and cost
  -- us the audit row for a null-key attempt (swallowed by the exception
  -- handler below). A missing key is semantically an empty attempt, so
  -- hash it as one and keep it on the record.
  v_key_hash := public.hash_login_key(coalesce(p_login_key, ''));

  -- The authentication check itself — byte-for-byte the same predicate as
  -- before this migration (normalized key + role + kitchen + active + not
  -- deleted). Nothing here changes who can log in.
  SELECT u.* INTO v_user
  FROM public.users u
  WHERE upper(replace(trim(u.login_key), '-', '')) = upper(replace(trim(p_login_key), '-', ''))
    AND u.role = p_role
    AND u.cloud_kitchen_id = p_cloud_kitchen_id
    AND u.is_active = true
    AND u.deleted_at IS NULL
  LIMIT 1;

  -- -------------------------------------------------------------------
  -- A1 — success
  -- -------------------------------------------------------------------
  IF FOUND THEN
    BEGIN
      PERFORM public.log_auth_event(
        p_success                    => true,
        p_attempted_login_key_hash   => v_key_hash,
        p_attempted_role             => p_role,
        p_attempted_cloud_kitchen_id => p_cloud_kitchen_id,
        p_resolved_user_id           => v_user.id
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let an audit failure lock a real user out.
      RAISE WARNING 'audit: log_auth_event(success) failed for user %: %', v_user.id, SQLERRM;
    END;

    RETURN QUERY SELECT
      v_user.id, v_user.email, v_user.full_name, v_user.role,
      v_user.cloud_kitchen_id, v_user.is_active, v_user.login_key,
      v_user.created_at, v_user.updated_at, v_user.outlet_map;
    RETURN;
  END IF;

  -- -------------------------------------------------------------------
  -- A2 — failure
  --
  -- Work out WHY it failed, for the audit trail only. This second lookup
  -- matches on the normalized key ALONE (ignoring role/kitchen/active/
  -- deleted) so we can tell "nobody has this key" apart from "this key
  -- exists but the attempt was wrong in some way" — the difference
  -- between a blind guess and someone holding a real, stale credential.
  --
  -- None of this reaches the caller: the function still returns zero rows,
  -- so Login.jsx shows the same generic message in every failure case.
  -- -------------------------------------------------------------------
  SELECT u.* INTO v_candidate
  FROM public.users u
  WHERE upper(replace(trim(u.login_key), '-', '')) = upper(replace(trim(p_login_key), '-', ''))
  -- Prefer a live row if a key somehow collides across users.
  ORDER BY (u.deleted_at IS NULL) DESC, (u.is_active IS TRUE) DESC, u.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    v_failure_reason := 'no_matching_key';
  ELSE
    v_matched_user := v_candidate.id;
    v_failure_reason := CASE
      WHEN v_candidate.deleted_at IS NOT NULL
        THEN 'deleted_user'
      WHEN v_candidate.is_active IS NOT TRUE
        THEN 'inactive_user'
      WHEN v_candidate.role IS DISTINCT FROM p_role
        THEN 'role_mismatch'
      WHEN v_candidate.cloud_kitchen_id IS DISTINCT FROM p_cloud_kitchen_id
        THEN 'cloud_kitchen_mismatch'
      ELSE 'unknown'
    END;
  END IF;

  BEGIN
    PERFORM public.log_auth_event(
      p_success                    => false,
      p_attempted_login_key_hash   => v_key_hash,
      p_attempted_role             => p_role,
      p_attempted_cloud_kitchen_id => p_cloud_kitchen_id,
      p_resolved_user_id           => NULL,   -- no one authenticated
      p_failure_reason             => v_failure_reason,
      -- audit_auth_events.resolved_user_id means "who got in", so it stays
      -- NULL on failure. The user whose key was presented but rejected is
      -- still worth keeping, so it rides along in the event payload.
      p_new_values                 => CASE
                                        WHEN v_matched_user IS NULL THEN NULL
                                        ELSE jsonb_build_object('matched_user_id', v_matched_user)
                                      END
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit: log_auth_event(failure) failed: %', SQLERRM;
  END;

  RETURN;  -- zero rows — unchanged failure contract
END;
$function$;

GRANT EXECUTE ON FUNCTION public.authenticate_user_by_key(TEXT, TEXT, UUID) TO public, authenticated, anon;

COMMENT ON FUNCTION public.authenticate_user_by_key(TEXT, TEXT, UUID) IS
  'Authenticates by login key, role, and cloud kitchen. Returns user with outlet_map. Compares keys normalized: no dashes, uppercase (e.g. bpck1a23f = BP-CK1-A23F). Writes an audit_events + audit_auth_events row for every attempt, success or failure (A1/A2) — the failure reason is recorded for admins but never returned to the caller.';

COMMIT;

-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. A successful login (use a real key/role/kitchen):
--      SELECT * FROM public.authenticate_user_by_key('<KEY>', '<role>', '<ck-uuid>');
--
-- 2. A failed login — should return zero rows, not an error:
--      SELECT * FROM public.authenticate_user_by_key('TOTALLY-WRONG-KEY', 'supervisor', '<ck-uuid>');
--
-- 3. Both should now be visible, newest first:
--      SELECT e.created_at, e.action, e.severity, e.actor_role,
--             a.success, a.failure_reason, a.resolved_user_id,
--             e.new_values ->> 'matched_user_id' AS matched_user_id,
--             e.ip_address, e.user_agent
--      FROM public.audit_events e
--      JOIN public.audit_auth_events a ON a.event_id = e.id
--      WHERE e.category = 'auth'
--      ORDER BY e.created_at DESC
--      LIMIT 20;
--
--    ip_address/user_agent are NULL when run from the SQL editor or psql
--    (no PostgREST request context) and populated when the app calls it.
--
-- 4. Confirm the raw key never landed anywhere:
--      SELECT attempted_login_key_hash FROM public.audit_auth_events LIMIT 5;
--    -- expect 64-char sha256 hex digests, never a readable key.
-- =====================================================================
