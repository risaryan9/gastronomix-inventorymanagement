-- =====================================================================
-- Capture ip_address / user_agent on EVERY audit event, not just logins
--
-- wire-auth-events-to-authenticate-user-by-key.sql added
-- current_request_ip() and current_request_user_agent(), and wired them
-- into log_auth_event() — so A1/A2 login rows carry the client IP and
-- user agent. Confirmed working in production: 3 of 3 auth rows have a
-- real IP.
--
-- But log_audit_event() — the helper behind every OTHER audited action —
-- was never updated. Result: 0 of 10 non-auth rows have an IP.
--
-- That is the wrong way round. §3.A1 wants the login event as the anchor
-- "every other audited action ties back to", but tying back is only
-- useful if the other actions record where they came from too. Without
-- it you can see that someone logged in from an address, and separately
-- that stock was written off, with nothing connecting the two beyond a
-- user id that is shared by everyone holding the same login key.
--
-- ONE FUNCTION COVERS EVERYTHING. Only two functions insert into
-- audit_events at all — log_audit_event and log_auth_event — and the
-- latter already captures context. Every one of the sixteen non-auth
-- flows (B1, B2, C1-C3, D1-D4, E1-E4, F1, F2, G1, G2, H1) routes through
-- log_audit_event, so changing it here is sufficient; no calling function
-- needs to be touched.
--
-- SIGNATURE IS UNCHANGED, deliberately:
--   * no overload is created, so every existing caller keeps working
--     with no edit;
--   * CREATE OR REPLACE preserves the ACL, so the by-name REVOKE from
--     anon/authenticated in fix-internal-audit-helper-grants.sql stays in
--     force. (A DROP + CREATE here would silently re-grant it — see the
--     trap documented in that migration.)
--
-- The helpers return NULL rather than raising when there is no PostgREST
-- request context — migrations, psql, the SQL editor — so backfills and
-- manual calls are unaffected.
--
-- CAVEAT for whoever reads this data: x-forwarded-for is client-supplied
-- and therefore spoofable. Treat the IP as corroborating evidence, not
-- proof of origin. current_request_ip() prefers cf-connecting-ip, which
-- Supabase's Cloudflare layer sets and a client cannot forge.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_actor_user_id     uuid,
  p_actor_role        text,
  p_cloud_kitchen_id  uuid,
  p_category          text,
  p_action            text,
  p_severity          text DEFAULT 'review',
  p_entity_type       text DEFAULT NULL,
  p_entity_id         uuid DEFAULT NULL,
  p_outlet_id         uuid DEFAULT NULL,
  p_correlation_id    uuid DEFAULT NULL,
  p_reversed_event_id uuid DEFAULT NULL,
  p_old_values        jsonb DEFAULT NULL,
  p_new_values        jsonb DEFAULT NULL
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
    actor_user_id, actor_role, cloud_kitchen_id, outlet_id,
    category, action, entity_type, entity_id,
    correlation_id, reversed_event_id, severity,
    old_values, new_values,
    ip_address, user_agent
  ) VALUES (
    p_actor_user_id, p_actor_role, p_cloud_kitchen_id, p_outlet_id,
    p_category, p_action, p_entity_type, p_entity_id,
    p_correlation_id, p_reversed_event_id, p_severity,
    p_old_values, p_new_values,
    -- Read straight off the inbound request. Nested SECURITY DEFINER
    -- calls still see these: request.headers is a transaction-scoped
    -- setting on the PostgREST connection, not something the calling
    -- function has to pass down.
    public.current_request_ip(),
    public.current_request_user_agent()
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

COMMENT ON FUNCTION public.log_audit_event IS
  'Internal write helper for audit_events. Captures the caller''s IP and user agent from the PostgREST request automatically, so no calling function needs to pass them. NOT callable by anon/authenticated — enforced by the by-name REVOKE in migrations/fix-internal-audit-helper-grants.sql, which this CREATE OR REPLACE preserves. Call it from inside another SECURITY DEFINER function owned by postgres.';

COMMIT;

-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. The revoke must have survived the replace — this is the one thing
--    that could regress here:
--      SELECT has_function_privilege('anon',
--               'public.log_audit_event(uuid,text,uuid,text,text,text,text,uuid,uuid,uuid,uuid,jsonb,jsonb)',
--               'EXECUTE') AS anon_can_call;
--    -- expect false. If true, re-run fix-internal-audit-helper-grants.sql.
--
-- 2. Both writers now capture context:
--      SELECT proname,
--             pg_get_functiondef(oid) ILIKE '%current_request_ip%' AS captures_ip
--      FROM pg_proc
--      WHERE proname IN ('log_audit_event','log_auth_event')
--        AND pronamespace = 'public'::regnamespace;
--    -- expect true for both.
--
-- 3. Exercise any audited action through the app, then confirm the new
--    rows carry context where the old ones do not:
--      SELECT category, action,
--             created_at AT TIME ZONE 'Asia/Kolkata' AS ist_time,
--             ip_address, left(user_agent, 40) AS user_agent
--      FROM public.audit_events
--      ORDER BY created_at DESC
--      LIMIT 10;
--    -- rows written BEFORE this migration keep NULL ip/user_agent; they
--    -- are not backfilled, because inventing request context for past
--    -- events would be fabricating evidence.
--
-- 4. Coverage over time:
--      SELECT category,
--             count(*) AS rows,
--             count(ip_address) AS with_ip
--      FROM public.audit_events GROUP BY category ORDER BY category;
-- =====================================================================
