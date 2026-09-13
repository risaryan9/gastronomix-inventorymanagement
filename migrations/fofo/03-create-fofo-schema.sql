-- =====================================================================
-- The fofo schema, and who a FOFO franchise is
--
-- FOFO = franchise owned, franchise operated. These franchisees run their
-- own outlets and buy supplies from Gastronomix through a dashboard on its
-- own domain (docs/fofo-dashboard-spec.md). They are customers, not staff.
--
-- WHY A SEPARATE SCHEMA, NOT A public.fofo_ PREFIX. Two reasons.
--
--   1. Supabase's PostgREST only exposes schemas on its "Exposed schemas"
--      list. Leaving `fofo` off that list means the anon key — which ships
--      inside the internal frontend bundle and is therefore public —
--      cannot reach these tables at all, whatever the policies say. That
--      matters here more than usual: the live SELECT policy on
--      stock_in_batches ends in `OR (auth.uid() IS NULL)`, so the same key
--      already reads every purchase cost in the company. Order and payment
--      rows must not sit behind the same door.
--
--   2. `franchise_` is already taken in public by the FOCO dashboard
--      (franchise_outlet_codes, franchise_daily_snapshot). FOCO franchises
--      own outlets the company operates; FOFO franchises operate their own
--      and buy from us. Two different programmes, and a prefix war between
--      them would be lost by whoever reads the schema next.
--
-- ** AFTER RUNNING THIS: do NOT add `fofo` to Exposed schemas in the
--    Supabase dashboard. The partner app reaches these tables only through
--    server-side API routes using the service_role key. **
--
-- WHAT CHANGES. The schema, and three tables:
--
--   fofo.franchises         the business we invoice
--   fofo.franchise_outlets  which outlets it owns
--   fofo.franchise_users    who can log in
--
-- RLS IS ENABLED WITH NO POLICIES, ON PURPOSE. That denies every role.
-- service_role bypasses RLS, so the API still works, and anything else that
-- ever reaches these tables reads nothing rather than everything. It is the
-- opposite default from the public schema, which is the point.
--
-- FRANCHISEES ARE NOT IN public.users. That table is staff: its role CHECK
-- lists only staff roles and its rows hang off a cloud kitchen. Putting
-- customers in it would break both, and would put them behind the key-based
-- login RPC that every staff screen trusts.
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS fofo;

COMMENT ON SCHEMA fofo IS
'FOFO franchise dashboard: franchises, carts, orders and money. Deliberately NOT on Supabase''s exposed-schema list — reachable only server-side with the service_role key. Not to be confused with the public.franchise_* tables, which belong to the FOCO dashboard.';

-- Nothing but service_role gets in. anon and authenticated are revoked by
-- name: decision 0004 records that REVOKE ... FROM PUBLIC does not work in
-- this database, because privileges are granted to roles by name at CREATE
-- time by an ALTER DEFAULT PRIVILEGES rule on schema public.
REVOKE ALL ON SCHEMA fofo FROM PUBLIC;
REVOKE ALL ON SCHEMA fofo FROM anon, authenticated;
GRANT USAGE ON SCHEMA fofo TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA fofo
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fofo
  GRANT ALL ON SEQUENCES TO service_role;

-- ---------------------------------------------------------------------
-- 1. The franchise business
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.franchises (
  id             uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  name           text NOT NULL,
  gst_number     text,
  address        text,
  city           text,
  contact_person text,
  contact_phone  text,
  contact_email  text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

COMMENT ON TABLE fofo.franchises IS
'One row per FOFO franchise business — the legal entity we invoice. Distinct from public.franchise_outlet_codes, which belongs to the FOCO dashboard.';

COMMENT ON COLUMN fofo.franchises.gst_number IS
'GSTIN, optional: a franchise may not be registered. Present here rather than derived from the outlet, because public.outlets carries no address or tax details at all.';

-- ---------------------------------------------------------------------
-- 2. Which outlets it owns
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.franchise_outlets (
  id           uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  franchise_id uuid NOT NULL REFERENCES fofo.franchises(id),
  outlet_id    uuid NOT NULL REFERENCES public.outlets(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT franchise_outlets_one_owner_per_outlet UNIQUE (outlet_id)
);

CREATE INDEX IF NOT EXISTS idx_fofo_franchise_outlets_franchise
  ON fofo.franchise_outlets (franchise_id);

COMMENT ON TABLE fofo.franchise_outlets IS
'Which outlets a FOFO franchise owns. outlet_id is unique: an outlet has exactly one owner. Expanding a franchise is adding rows here, which also widens its catalogue, because the brands it may buy are derived from the codes of the outlets it owns.';

-- Deliberately absent: cloud_kitchen_id. It already lives on
-- public.outlets, and a second copy here would be a second answer to the
-- same question, free to drift. The order table does snapshot it, but for
-- a different reason — see 05-create-fofo-orders-and-carts.sql.

-- ---------------------------------------------------------------------
-- 3. Who logs in
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.franchise_users (
  id           uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  franchise_id uuid NOT NULL REFERENCES fofo.franchises(id),
  email        text NOT NULL,
  auth_user_id uuid,
  is_active    boolean NOT NULL DEFAULT true,
  invited_at   timestamptz,
  activated_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT franchise_users_email_key UNIQUE (email),
  CONSTRAINT franchise_users_auth_user_key UNIQUE (auth_user_id),
  -- Activated means both halves happened. Neither alone is a valid state.
  CONSTRAINT franchise_users_activation_consistent CHECK (
    (auth_user_id IS NULL     AND activated_at IS NULL)
    OR (auth_user_id IS NOT NULL AND activated_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fofo_franchise_users_franchise
  ON fofo.franchise_users (franchise_id);

COMMENT ON TABLE fofo.franchise_users IS
'Login accounts for a FOFO franchise. A franchise may have several people. These are customers and are deliberately NOT in public.users, which is staff and whose role CHECK would reject them.';

COMMENT ON COLUMN fofo.franchise_users.auth_user_id IS
'The Supabase Auth user, set when the invitation link is used to choose a password. NULL means invited but not yet activated — that gap is the state, so no separate flag exists.';

-- ---------------------------------------------------------------------
-- 4. Deny by default
-- ---------------------------------------------------------------------

ALTER TABLE fofo.franchises        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.franchise_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fofo.franchise_users   ENABLE ROW LEVEL SECURITY;

-- No policies, deliberately: RLS with no policy denies every role, and
-- service_role bypasses RLS. Isolating one franchise from another is the
-- API's job, because nothing else can reach these tables.

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The schema exists and holds three empty tables:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'fofo' ORDER BY table_name;
--
-- RLS is on and there are no policies:
--
-- SELECT c.relname, c.relrowsecurity,
--        (SELECT COUNT(*) FROM pg_policies p
--          WHERE p.schemaname = 'fofo' AND p.tablename = c.relname) AS policies
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'fofo' AND c.relkind = 'r';
--
-- anon and authenticated cannot use the schema — both must be false:
--
-- SELECT has_schema_privilege('anon', 'fofo', 'USAGE')          AS anon_usage,
--        has_schema_privilege('authenticated', 'fofo', 'USAGE') AS auth_usage,
--        has_schema_privilege('service_role', 'fofo', 'USAGE')  AS service_usage;
--
-- AND CHECK BY HAND: Supabase dashboard → Settings → API → Exposed schemas
-- must NOT list `fofo`.

-- =====================================================================
-- Rollback
-- =====================================================================
-- DROP SCHEMA IF EXISTS fofo CASCADE;
