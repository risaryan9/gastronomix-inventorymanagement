-- =====================================================================
-- Onboarding: the welcome email, numbered registration links, and users
--
-- How a franchise gets its logins (docs/fofo-dashboard-spec.md §8.1):
--
--   1. An admin creates the franchise, including its main contact email.
--   2. The admin can send a WELCOME email — informational, no link. A
--      button; independent of everything else; can be sent again.
--   3. The admin sends REGISTRATION emails, one per person who needs a
--      login. Four people, four emails. Every one goes to the franchise's
--      main contact email, and the franchise passes each link on.
--   4. Whoever opens a link chooses their own email and password. That
--      creates a Supabase Auth user and a fofo.franchise_users row linked
--      to the franchise. The link is then spent.
--
-- WHAT CHANGES.
--
--   fofo.franchises.welcome_email_last_sent_at   when the welcome last went
--   fofo.franchise_invitations                   one row per registration email
--   fofo.franchise_users                         reshaped: created on registration
--   fofo.record_welcome_email_sent(...)
--   fofo.create_franchise_invitation(...)
--   fofo.claim_franchise_invitation(...)
--   fofo.revoke_franchise_invitation(...)
--
-- A LINK IS NOT TIED TO AN EMAIL, BY DECISION. Every link goes to the
-- franchise's own main inbox and whoever holds it may register with any
-- address; managing that is the franchise's responsibility. What keeps it
-- safe enough is that each link is SINGLE USE, EXPIRES, and can be REVOKED
-- by an admin — so a forwarded link registers at most one person, and a
-- leaked one can be cancelled. It also means the email a user registers
-- with is theirs to choose, which is why franchise_users.email is set at
-- registration rather than at invitation.
--
-- NUMBERED, SO THE EMAILS ARE TELLABLE APART. invitation_number counts
-- per franchise — 1, 2, 3 — and goes in the subject: "User registration
-- #3 for Test Foods". A resend is a new invitation with the next number,
-- never the old link again, so every number maps to exactly one link.
-- Allocated as max + 1 with the franchise row locked, so two admins
-- clicking at once get #4 and #5, not two #4s.
--
-- THE TOKEN IS NEVER STORED. The server generates a random token, emails
-- it inside the link, and stores only its SHA-256 hash. A database read —
-- a backup, a log, a stray SELECT — yields nothing that can register an
-- account. The link is checked by hashing what arrives and looking that up.
--
-- WHY franchise_users CHANGES SHAPE. It was drawn for an invite-by-email
-- flow: row created at invite with the email filled in, auth_user_id NULL
-- until activation, invited_at recording the send. In this flow nobody
-- exists until they register, and the email is only known then. So a row
-- is now created at registration, fully formed — auth_user_id, email and
-- activated_at are all required, invitation_id records which link it came
-- from, and invited_at moves to the invitation where it belongs. The table
-- is empty (checked below, and the migration refuses to run otherwise).
--
-- EMAILS ARE STORED LOWERCASE. Supabase Auth treats addresses
-- case-insensitively; a plain UNIQUE would let Priya@x.in and priya@x.in
-- both register. A CHECK keeps the column lowercase and trimmed, so the
-- unique key means what it says.
--
-- WHAT THE DATABASE DOES NOT DO. Generating tokens, sending email and
-- creating the Supabase Auth user all happen in server code (the partner
-- app's API). These functions are the parts that must be atomic: allocate
-- a number, spend a link exactly once, write the audit event.
--
-- Requires: 03 (franchises, franchise_users), 10 (log_fofo_audit_event).
-- =====================================================================

BEGIN;

-- Refuse to reshape franchise_users if anyone has already been added.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fofo.franchise_users) THEN
    RAISE EXCEPTION
      'fofo.franchise_users is not empty. This migration reshapes it for the registration-link flow and was written for an empty table — migrate existing rows by hand first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Welcome email
-- ---------------------------------------------------------------------

ALTER TABLE fofo.franchises
  ADD COLUMN IF NOT EXISTS welcome_email_last_sent_at timestamptz;

COMMENT ON COLUMN fofo.franchises.welcome_email_last_sent_at IS
'When the welcome email was last sent. NULL means never. It can be sent any number of times; every send is in audit_events (fofo_account / welcome_email_sent).';

-- ---------------------------------------------------------------------
-- 2. Registration invitations
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fofo.franchise_invitations (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  franchise_id      uuid NOT NULL REFERENCES fofo.franchises(id),
  invitation_number integer NOT NULL,
  sent_to_email     text NOT NULL,
  token_hash        text NOT NULL,
  sent_by           uuid REFERENCES public.users(id),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid REFERENCES public.users(id),

  CONSTRAINT franchise_invitations_number_per_franchise UNIQUE (franchise_id, invitation_number),
  CONSTRAINT franchise_invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT franchise_invitations_number_positive CHECK (invitation_number > 0),
  -- A SHA-256 digest as hex. Anything else means a raw token was stored.
  CONSTRAINT franchise_invitations_token_is_a_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT franchise_invitations_expires_after_sent CHECK (expires_at > sent_at),
  -- A link is spent or cancelled, not both.
  CONSTRAINT franchise_invitations_used_or_revoked CHECK (used_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT franchise_invitations_revoked_by_whom CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_fofo_franchise_invitations_franchise
  ON fofo.franchise_invitations (franchise_id, invitation_number DESC);

COMMENT ON TABLE fofo.franchise_invitations IS
'One registration email sent to a franchise. Each carries a single-use, expiring link that lets whoever holds it register one login for that franchise, with an email of their choosing. Sent to the franchise''s main contact email, never to the person.';

COMMENT ON COLUMN fofo.franchise_invitations.invitation_number IS
'1, 2, 3 per franchise, shown in the email subject so the franchise can tell its registration emails apart. A resend is a new invitation with the next number.';

COMMENT ON COLUMN fofo.franchise_invitations.sent_to_email IS
'The franchise''s contact email at the moment of sending, copied — if the franchise changes its email later, this still says where the link actually went.';

COMMENT ON COLUMN fofo.franchise_invitations.token_hash IS
'SHA-256 of the token in the link, lowercase hex. The token itself is never stored, so nothing read from the database can be used to register.';

-- ---------------------------------------------------------------------
-- 3. franchise_users: created on registration, fully formed
-- ---------------------------------------------------------------------

ALTER TABLE fofo.franchise_users
  DROP COLUMN IF EXISTS invited_at;

ALTER TABLE fofo.franchise_users
  ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES fofo.franchise_invitations(id);

ALTER TABLE fofo.franchise_users
  ALTER COLUMN auth_user_id SET NOT NULL,
  ALTER COLUMN activated_at SET NOT NULL,
  ALTER COLUMN activated_at SET DEFAULT now();

ALTER TABLE fofo.franchise_users
  DROP CONSTRAINT IF EXISTS franchise_users_invitation_key;
ALTER TABLE fofo.franchise_users
  ADD CONSTRAINT franchise_users_invitation_key UNIQUE (invitation_id);

ALTER TABLE fofo.franchise_users
  DROP CONSTRAINT IF EXISTS franchise_users_email_normalised;
ALTER TABLE fofo.franchise_users
  ADD CONSTRAINT franchise_users_email_normalised
  CHECK (email = lower(btrim(email)) AND email <> '');

-- With auth_user_id and activated_at both required, the old "invited but
-- not activated" consistency check can no longer fail; drop it rather than
-- leave a rule that describes a state that no longer exists.
ALTER TABLE fofo.franchise_users
  DROP CONSTRAINT IF EXISTS franchise_users_activation_consistent;

COMMENT ON TABLE fofo.franchise_users IS
'A login for a FOFO franchise, created when someone registers through a registration link. A franchise may have several. Everything a user does is on behalf of their franchise, and audit_events names the user. Deliberately NOT in public.users, which is staff.';

COMMENT ON COLUMN fofo.franchise_users.auth_user_id IS
'The Supabase Auth user created at registration. Required: a franchise user exists only once they have registered.';

COMMENT ON COLUMN fofo.franchise_users.email IS
'The email they registered with — their choice, not necessarily the franchise contact email. Stored lowercase and trimmed so the unique key is case-insensitive in practice.';

COMMENT ON COLUMN fofo.franchise_users.invitation_id IS
'The registration link this login was created from. Unique: one link, one login. NULL only for a login an admin creates directly.';

-- ---------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------

-- An admin is an active staff user with role admin. Checked in each
-- function as well as by the API: the server authenticates the admin, and
-- the database refuses anyone else regardless.
CREATE OR REPLACE FUNCTION fofo.assert_active_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = fofo, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = p_user_id AND u.role = 'admin'
       AND u.is_active = true AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'User % is not an active admin', p_user_id;
  END IF;
END;
$$;

-- The franchise must exist, be live, and have somewhere to send email.
-- Locks the row so number allocation and sends serialise per franchise.
CREATE OR REPLACE FUNCTION fofo.lock_sendable_franchise(p_franchise_id uuid)
RETURNS fofo.franchises
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v fofo.franchises%ROWTYPE;
BEGIN
  SELECT * INTO v FROM fofo.franchises WHERE id = p_franchise_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Franchise % not found', p_franchise_id;
  END IF;
  IF NOT v.is_active OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Franchise % is not active', v.name;
  END IF;
  IF v.contact_email IS NULL OR btrim(v.contact_email) = '' THEN
    RAISE EXCEPTION 'Franchise % has no contact email to send to', v.name;
  END IF;
  RETURN v;
END;
$$;

-- 4a. Welcome email --------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.record_welcome_email_sent(
  p_franchise_id uuid,
  p_sent_by      uuid
)
RETURNS text          -- the address it went to
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v fofo.franchises%ROWTYPE;
BEGIN
  PERFORM fofo.assert_active_admin(p_sent_by);
  v := fofo.lock_sendable_franchise(p_franchise_id);

  UPDATE fofo.franchises
     SET welcome_email_last_sent_at = now(), updated_at = now()
   WHERE id = p_franchise_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id  => p_franchise_id,
    p_category      => 'fofo_account',
    p_action        => 'welcome_email_sent',
    p_actor_user_id => p_sent_by,
    p_severity      => 'info',
    p_entity_type   => 'fofo_franchise',
    p_entity_id     => p_franchise_id,
    p_new_values    => jsonb_build_object('sent_to_email', lower(btrim(v.contact_email)))
  );

  -- Cleaned the same way as a registration email's address, so both sends
  -- report the same address for the same franchise.
  RETURN lower(btrim(v.contact_email));
END;
$$;

COMMENT ON FUNCTION fofo.record_welcome_email_sent(uuid, uuid) IS
'Records that an admin sent the welcome email: stamps welcome_email_last_sent_at and writes the audit event. Call it after the email provider accepts the message. Admins only.';

-- 4b. Create a registration invitation -------------------------------

CREATE OR REPLACE FUNCTION fofo.create_franchise_invitation(
  p_franchise_id uuid,
  p_token_hash   text,
  p_expires_at   timestamptz,
  p_sent_by      uuid
)
RETURNS TABLE (invitation_id uuid, invitation_number integer, sent_to_email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v        fofo.franchises%ROWTYPE;
  v_number integer;
  v_id     uuid;
BEGIN
  PERFORM fofo.assert_active_admin(p_sent_by);

  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'A registration link must expire in the future';
  END IF;

  -- Locks the franchise: two admins sending at once queue here, so the
  -- max + 1 below cannot hand out the same number twice.
  v := fofo.lock_sendable_franchise(p_franchise_id);

  SELECT COALESCE(MAX(i.invitation_number), 0) + 1 INTO v_number
    FROM fofo.franchise_invitations i
   WHERE i.franchise_id = p_franchise_id;

  INSERT INTO fofo.franchise_invitations
    (franchise_id, invitation_number, sent_to_email, token_hash, sent_by, expires_at)
  VALUES
    (p_franchise_id, v_number, lower(btrim(v.contact_email)), p_token_hash, p_sent_by, p_expires_at)
  RETURNING id INTO v_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id  => p_franchise_id,
    p_category      => 'fofo_account',
    p_action        => 'registration_invitation_sent',
    p_actor_user_id => p_sent_by,
    p_severity      => 'info',
    p_entity_type   => 'fofo_franchise_invitation',
    p_entity_id     => v_id,
    p_new_values    => jsonb_build_object(
      'invitation_number', v_number,
      'sent_to_email',     lower(btrim(v.contact_email)),
      'expires_at',        p_expires_at
    )
  );

  RETURN QUERY SELECT v_id, v_number, lower(btrim(v.contact_email));
END;
$$;

COMMENT ON FUNCTION fofo.create_franchise_invitation(uuid, text, timestamptz, uuid) IS
'Creates one numbered registration link for a franchise and returns its number and the address to send it to. The caller generates the token, passes only its SHA-256 hex hash, and emails the link. Create first, then send: if sending fails the unused invitation can be revoked, whereas a sent link with no row could never work. Admins only.';

-- 4c. Register through a link ----------------------------------------

CREATE OR REPLACE FUNCTION fofo.claim_franchise_invitation(
  p_token_hash   text,
  p_auth_user_id uuid,
  p_email        text,
  p_ip_address   inet DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS uuid          -- the new fofo.franchise_users id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_inv       fofo.franchise_invitations%ROWTYPE;
  v_franchise fofo.franchises%ROWTYPE;
  v_email     text := lower(btrim(p_email));
  v_user_id   uuid;
BEGIN
  -- Locked: the same link opened in two tabs registers once. The second
  -- waits here, then finds used_at set.
  SELECT * INTO v_inv
    FROM fofo.franchise_invitations
   WHERE token_hash = p_token_hash
     FOR UPDATE;

  -- Messages say what went wrong without saying whether a token exists
  -- for anyone guessing.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This registration link is not valid';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This registration link has been cancelled';
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'This registration link has already been used';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'This registration link has expired';
  END IF;

  SELECT * INTO v_franchise FROM fofo.franchises WHERE id = v_inv.franchise_id;
  IF NOT v_franchise.is_active OR v_franchise.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This franchise is not active';
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'An email is required to register';
  END IF;
  IF EXISTS (SELECT 1 FROM fofo.franchise_users WHERE email = v_email) THEN
    RAISE EXCEPTION 'An account with this email already exists';
  END IF;

  INSERT INTO fofo.franchise_users
    (franchise_id, email, auth_user_id, is_active, activated_at, invitation_id)
  VALUES
    (v_inv.franchise_id, v_email, p_auth_user_id, true, now(), v_inv.id)
  RETURNING id INTO v_user_id;

  UPDATE fofo.franchise_invitations SET used_at = now() WHERE id = v_inv.id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id            => v_inv.franchise_id,
    p_category                => 'fofo_account',
    p_action                  => 'franchise_user_registered',
    p_actor_franchise_user_id => v_user_id,
    p_severity                => 'review',
    p_entity_type             => 'fofo_franchise_user',
    p_entity_id               => v_user_id,
    p_new_values              => jsonb_build_object(
      'email',             v_email,
      'invitation_number', v_inv.invitation_number
    ),
    p_ip_address              => p_ip_address,
    p_user_agent              => p_user_agent
  );

  RETURN v_user_id;
END;
$$;

COMMENT ON FUNCTION fofo.claim_franchise_invitation(text, uuid, text, inet, text) IS
'Spends a registration link: checks it is unused, unrevoked and unexpired, creates the franchise_users row linked to the franchise and to the Supabase Auth user the server just created, marks the link used, and writes the audit event naming the new user. Raises if any check fails — the server must then delete the Auth user it created.';

-- 4d. Cancel a link ---------------------------------------------------

CREATE OR REPLACE FUNCTION fofo.revoke_franchise_invitation(
  p_invitation_id uuid,
  p_revoked_by    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fofo, public
AS $$
DECLARE
  v_inv fofo.franchise_invitations%ROWTYPE;
BEGIN
  PERFORM fofo.assert_active_admin(p_revoked_by);

  SELECT * INTO v_inv FROM fofo.franchise_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation % not found', p_invitation_id;
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation #% has already been used — deactivate the user instead', v_inv.invitation_number;
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN;   -- already cancelled; a repeat click changes nothing
  END IF;

  UPDATE fofo.franchise_invitations
     SET revoked_at = now(), revoked_by = p_revoked_by
   WHERE id = p_invitation_id;

  PERFORM fofo.log_fofo_audit_event(
    p_franchise_id  => v_inv.franchise_id,
    p_category      => 'fofo_account',
    p_action        => 'registration_invitation_revoked',
    p_actor_user_id => p_revoked_by,
    p_severity      => 'review',
    p_entity_type   => 'fofo_franchise_invitation',
    p_entity_id     => p_invitation_id,
    p_new_values    => jsonb_build_object('invitation_number', v_inv.invitation_number)
  );
END;
$$;

COMMENT ON FUNCTION fofo.revoke_franchise_invitation(uuid, uuid) IS
'Cancels an unused registration link. A used link cannot be revoked — the login it created is managed as a user. Repeating it is harmless. Admins only.';

-- ---------------------------------------------------------------------
-- 5. Deny by default, and grants (decision 0004)
-- ---------------------------------------------------------------------

ALTER TABLE fofo.franchise_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION fofo.assert_active_admin(uuid)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.lock_sendable_franchise(uuid)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.record_welcome_email_sent(uuid, uuid)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.create_franchise_invitation(uuid, text, timestamptz, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.claim_franchise_invitation(text, uuid, text, inet, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fofo.revoke_franchise_invitation(uuid, uuid)                     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fofo.record_welcome_email_sent(uuid, uuid)                      TO service_role;
GRANT EXECUTE ON FUNCTION fofo.create_franchise_invitation(uuid, text, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fofo.claim_franchise_invitation(text, uuid, text, inet, text)   TO service_role;
GRANT EXECUTE ON FUNCTION fofo.revoke_franchise_invitation(uuid, uuid)                    TO service_role;
-- assert_active_admin and lock_sendable_franchise are helpers for the
-- functions above and get no grant of their own.

COMMIT;

-- =====================================================================
-- Verification
-- =====================================================================
-- The invitation table exists, and franchise_users has its new shape:
--
-- SELECT column_name, is_nullable FROM information_schema.columns
-- WHERE table_schema = 'fofo' AND table_name = 'franchise_users'
-- ORDER BY ordinal_position;       -- no invited_at; invitation_id present;
--                                   -- auth_user_id and activated_at NOT NULL
--
-- Every function is service_role only (helpers: owner only):
--
-- SELECT p.proname, p.proacl FROM pg_proc p
-- WHERE p.pronamespace = 'fofo'::regnamespace
--   AND p.proname IN ('assert_active_admin', 'lock_sendable_franchise',
--     'record_welcome_email_sent', 'create_franchise_invitation',
--     'claim_franchise_invitation', 'revoke_franchise_invitation');
--
-- A franchise's registration links and what became of each:
--
-- SELECT i.invitation_number, i.sent_at, i.expires_at,
--        CASE WHEN i.used_at IS NOT NULL THEN 'used by ' || u.email
--             WHEN i.revoked_at IS NOT NULL THEN 'revoked'
--             WHEN i.expires_at <= now() THEN 'expired'
--             ELSE 'open' END AS state
-- FROM fofo.franchise_invitations i
-- LEFT JOIN fofo.franchise_users u ON u.invitation_id = i.id
-- WHERE i.franchise_id = '<franchise>' ORDER BY i.invitation_number;

-- =====================================================================
-- Rollback (only while no invitation or franchise user exists)
-- =====================================================================
-- DROP FUNCTION IF EXISTS fofo.revoke_franchise_invitation(uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.claim_franchise_invitation(text, uuid, text, inet, text);
-- DROP FUNCTION IF EXISTS fofo.create_franchise_invitation(uuid, text, timestamptz, uuid);
-- DROP FUNCTION IF EXISTS fofo.record_welcome_email_sent(uuid, uuid);
-- DROP FUNCTION IF EXISTS fofo.lock_sendable_franchise(uuid);
-- DROP FUNCTION IF EXISTS fofo.assert_active_admin(uuid);
-- ALTER TABLE fofo.franchise_users
--   DROP CONSTRAINT franchise_users_email_normalised,
--   DROP CONSTRAINT franchise_users_invitation_key,
--   DROP COLUMN invitation_id,
--   ALTER COLUMN auth_user_id DROP NOT NULL,
--   ALTER COLUMN activated_at DROP NOT NULL,
--   ALTER COLUMN activated_at DROP DEFAULT,
--   ADD COLUMN invited_at timestamptz,
--   ADD CONSTRAINT franchise_users_activation_consistent CHECK (
--     (auth_user_id IS NULL AND activated_at IS NULL)
--     OR (auth_user_id IS NOT NULL AND activated_at IS NOT NULL));
-- DROP TABLE IF EXISTS fofo.franchise_invitations;
-- ALTER TABLE fofo.franchises DROP COLUMN IF EXISTS welcome_email_last_sent_at;
