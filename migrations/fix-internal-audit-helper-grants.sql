-- =====================================================================
-- Make the internal audit helpers actually internal
--
-- log_audit_event() and log_auth_event() are both documented as internal:
--
--   "Not directly callable by anon/authenticated (see REVOKE below) —
--    call it from inside another SECURITY DEFINER function"
--
-- and both migrations that create them end with a REVOKE meant to enforce
-- that. **Neither REVOKE did anything.** Both functions are callable by
-- anon today.
--
-- WHY THE ORIGINAL REVOKE FAILED
--
-- The statements were:
--     REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;
--
-- REVOKE ... FROM PUBLIC only strips the implicit privilege every role
-- holds via PUBLIC. It does not touch privileges granted to a role by
-- name. This project's database has:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
--
-- (confirmed in pg_default_acl, for both the postgres and supabase_admin
-- granting roles) so at CREATE time each function immediately received
-- *direct, by-name* grants. The observed ACL on both functions is:
--
--     postgres=X/postgres
--     anon=X/postgres            <-- direct; REVOKE FROM PUBLIC misses it
--     authenticated=X/postgres
--     service_role=X/postgres
--
-- WHY IT MATTERS
--
-- The anon key ships inside the frontend bundle and is therefore public.
-- Anyone holding it could call log_audit_event() directly with arbitrary
-- arguments and forge audit rows — any actor_user_id, any actor_role, any
-- category, any action, any severity, any payload — or call
-- log_auth_event() to fabricate login_success entries. An attacker could
-- also bury a real event under noise.
--
-- That inverts the guarantee replace-audit-logs-with-audit-events.sql
-- claims for this design:
--
--   "Writes only happen through log_audit_event()/log_auth_event() ...
--    this is what makes 'no client-side inserts' (decision #2) actually
--    enforceable rather than just a convention."
--
-- Until this migration it was a convention, not an enforcement.
--
-- SCOPE — these two functions only. The narrow purpose-built RPCs
-- (log_manual_inventory_adjustment, log_raw_material_created,
-- log_raw_material_updated, log_self_stock_out, finalize_stock_in,
-- set_raw_material_active, receive_inter_cloud_transfer, ...) are
-- *deliberately* client-callable: each hardcodes its own category, action,
-- severity and entity_type server-side and accepts only business facts,
-- so a caller supplies data but never controls what kind of event is
-- logged. Their grants are correct as-is and are left alone.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Revoke the client-reachable roles by name.
--
-- PUBLIC is included for completeness. anon and authenticated are the two
-- that actually mattered.
--
-- service_role is deliberately LEFT WITH ACCESS. That key is server-side
-- only and already bypasses RLS entirely, so revoking it buys no
-- client-side safety while risking a trusted backend or edge function.
--
-- Nothing internal breaks. Both functions are owned by postgres and every
-- caller (authenticate_user_by_key, pack_allocation_request,
-- finalize_stock_in, ...) is SECURITY DEFINER and also owned by postgres,
-- so those nested calls are privilege-checked against postgres — which
-- keeps EXECUTE — not against the anon/authenticated role that invoked
-- the outer RPC.
-- ---------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.log_audit_event(
  uuid, text, uuid, text, text, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.log_auth_event(
  boolean, text, text, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.log_audit_event IS
  'Internal write helper for audit_events. NOT callable by anon/authenticated — enforced by an explicit by-name REVOKE in migrations/fix-internal-audit-helper-grants.sql (revoking FROM PUBLIC alone is not enough here; see that file). Call it from inside another SECURITY DEFINER function owned by postgres.';

COMMENT ON FUNCTION public.log_auth_event IS
  'Internal write helper for A1/A2. NOT callable by anon/authenticated — enforced by an explicit by-name REVOKE in migrations/fix-internal-audit-helper-grants.sql. Called from inside authenticate_user_by_key.';

COMMIT;

-- =====================================================================
-- ⚠️ TRAP FOR FUTURE MIGRATIONS — read before touching these two
-- =====================================================================
-- CREATE OR REPLACE FUNCTION preserves an existing ACL, so replacing the
-- body of either function is safe and keeps this revoke in force.
--
-- DROP + CREATE does NOT. A dropped function loses its ACL, and the
-- recreated one is granted to anon/authenticated again by the ALTER
-- DEFAULT PRIVILEGES described above — silently re-opening the hole. That
-- is exactly how log_auth_event regained the grant: the A1/A2 migration
-- had to DROP it to add a seventh parameter, and the accompanying
-- REVOKE ... FROM PUBLIC did not put things back.
--
-- So: if a future migration DROPs either function, it MUST repeat the
-- by-name REVOKE above. Changing the schema-wide default privileges was
-- considered and rejected — it would also strip the grants from every
-- future RPC that is *supposed* to be client-callable, breaking them in a
-- way that is hard to trace.
--
-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
-- 1. Neither helper should be reachable by the client roles:
--      SELECT p.proname,
--             has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
--             has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service,
--             has_function_privilege('postgres',      p.oid, 'EXECUTE') AS postgres
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.proname IN ('log_audit_event', 'log_auth_event');
--    -- expect anon=false, authed=false, service=true, postgres=true
--
-- 2. The narrow RPCs must STILL be client-callable — if any of these came
--    back false, this migration was too broad:
--      SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.proname IN ('log_manual_inventory_adjustment',
--                          'log_raw_material_created', 'log_raw_material_updated',
--                          'log_self_stock_out', 'finalize_stock_in',
--                          'set_raw_material_active', 'receive_inter_cloud_transfer',
--                          'authenticate_user_by_key', 'pack_allocation_request');
--    -- expect anon=true for every row
--
-- 3. End-to-end, the important one: log in with a key through the app and
--    confirm an auth row still appears. This proves the nested call from
--    authenticate_user_by_key still works despite the caller being anon.
--      SELECT e.created_at, e.action, a.success, a.failure_reason
--      FROM public.audit_events e
--      JOIN public.audit_auth_events a ON a.event_id = e.id
--      ORDER BY e.created_at DESC LIMIT 5;
-- =====================================================================
