/*
 * Onboarding emails (admin side) and registration through a link (franchise
 * side). The database half is migration 11; this is the half that needs a
 * server: tokens, email, and Supabase Auth.
 *
 * THE TOKEN. 32 random bytes, base64url, in the link. Only its SHA-256 hex
 * digest is stored (fofo.franchise_invitations.token_hash), so nothing read
 * from the database can register an account. The token travels in the link's
 * #fragment, not its query string: a browser never sends the fragment to any
 * server, so it stays out of access logs and Referer headers. The registration
 * page reads it and posts it in a request body.
 *
 * ORDER, AND WHAT HAPPENS WHEN A STEP FAILS.
 *
 *   Welcome:       check → send → record. Recorded only once Resend has
 *                  accepted it, so "last sent" never claims a send that failed.
 *
 *   Registration:  create the link (its own transaction) → send → if sending
 *                  fails, revoke it. Create before send, as migration 11 says,
 *                  because the opposite failure is worse: an email carrying a
 *                  link with no row behind it can never work. A failed send
 *                  therefore costs a number and shows as a cancelled link.
 *
 *   Register:      check the link → create the Supabase Auth user → claim the
 *                  link. If the claim fails — used a second earlier, email
 *                  taken — the Auth user just created is deleted, so no login
 *                  exists without a franchise user behind it.
 *
 * No database transaction is held open across a call to Resend or Supabase
 * Auth: a slow answer must not hold a pooled connection or the franchise's
 * row lock.
 */
import { transaction } from './db.js'
import { HttpError, isUuid } from './http.js'
import { requireActiveAdmin } from './adminAuth.js'
import { partnerAppUrl, registrationEmail, sendEmail, welcomeEmail } from './email.js'
import { getFranchise } from './franchiseAdmin.js'
import { clientIp, hashToken, newToken, requireEmail, requireNewPassword, TOKEN_PATTERN, userAgent } from './request.js'
import { createUser, deleteUser } from './supabaseAuth.js'

const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000   // spec §8.1: 7 days

/* ------------------------------------------------------------------ *
 * Admin: welcome email
 * ------------------------------------------------------------------ */

async function sendableFranchise(db, franchiseId) {
  if (!isUuid(franchiseId)) throw new HttpError(404, 'Franchise not found')
  const { rows } = await db.query(
    `SELECT id, name, contact_email, is_active
       FROM fofo.franchises WHERE id = $1 AND deleted_at IS NULL`,
    [franchiseId]
  )
  if (!rows.length) throw new HttpError(404, 'Franchise not found')
  if (!rows[0].is_active) throw new HttpError(422, `Franchise ${rows[0].name} is not active`)
  return rows[0]
}

export async function sendWelcomeEmail(authUserId, franchiseId) {
  partnerAppUrl()   // fail before anything else if unset — the email's logo comes from it
  const franchise = await transaction(async (db) => {
    await requireActiveAdmin(db, authUserId)
    return sendableFranchise(db, franchiseId)
  })

  await sendEmail({
    to: franchise.contact_email,
    ...welcomeEmail({ franchiseName: franchise.name, appUrl: partnerAppUrl() }),
  })

  // Checks the admin and the franchise again, stamps it, audits it.
  return transaction(async (db) => {
    const admin = await requireActiveAdmin(db, authUserId)
    const { rows } = await db.query('SELECT fofo.record_welcome_email_sent($1, $2) AS sent_to', [franchiseId, admin.id])
    return { sent_to: rows[0].sent_to, franchise: await getFranchise(db, franchiseId) }
  })
}

/* ------------------------------------------------------------------ *
 * Admin: registration email, and cancelling one
 * ------------------------------------------------------------------ */

export async function sendRegistrationEmail(authUserId, franchiseId) {
  if (!isUuid(franchiseId)) throw new HttpError(404, 'Franchise not found')
  const appUrl = partnerAppUrl()   // fail before creating anything if unset

  const token = newToken()
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS)

  const created = await transaction(async (db) => {
    const admin = await requireActiveAdmin(db, authUserId)
    const { rows } = await db.query(
      `SELECT i.invitation_id, i.invitation_number, i.sent_to_email, f.name AS franchise_name
         FROM fofo.create_franchise_invitation($1, $2, $3, $4) i
         JOIN fofo.franchises f ON f.id = $1`,
      [franchiseId, hashToken(token), expiresAt.toISOString(), admin.id]
    )
    return { ...rows[0], adminId: admin.id }
  })

  const email = registrationEmail({
    franchiseName: created.franchise_name,
    invitationNumber: created.invitation_number,
    link: `${appUrl}/register#token=${token}`,
    expiresAt,
    appUrl,
  })

  try {
    await sendEmail({ to: created.sent_to_email, idempotencyKey: `invitation-${created.invitation_id}`, ...email })
  } catch (sendErr) {
    // The link exists but nobody has it. Cancel it so it never shows as open.
    try {
      await transaction((db) =>
        db.query('SELECT fofo.revoke_franchise_invitation($1, $2)', [created.invitation_id, created.adminId])
      )
    } catch (revokeErr) {
      console.error('Could not cancel an unsent registration link:', created.invitation_id, revokeErr)
    }
    throw new HttpError(
      sendErr.status || 502,
      `${sendErr.message} Registration link #${created.invitation_number} has been cancelled.`
    )
  }

  return transaction(async (db) => ({
    invitation_number: created.invitation_number,
    sent_to: created.sent_to_email,
    expires_at: expiresAt.toISOString(),
    franchise: await getFranchise(db, franchiseId),
  }))
}

export async function revokeInvitation(db, adminId, invitationId) {
  if (!isUuid(invitationId)) throw new HttpError(404, 'Invitation not found')
  const { rows } = await db.query('SELECT franchise_id FROM fofo.franchise_invitations WHERE id = $1', [invitationId])
  if (!rows.length) throw new HttpError(404, 'Invitation not found')
  await db.query('SELECT fofo.revoke_franchise_invitation($1, $2)', [invitationId, adminId])
  return { franchise: await getFranchise(db, rows[0].franchise_id) }
}

/* ------------------------------------------------------------------ *
 * Franchise side: registration through a link
 * ------------------------------------------------------------------ */

function requireToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new HttpError(400, 'This registration link is not valid')
  }
  return token
}

/**
 * Why a link cannot be used right now, or null if it can. Same wording as
 * fofo.claim_franchise_invitation, which checks again when it is claimed.
 */
function linkProblem(row) {
  if (!row) return 'This registration link is not valid'
  if (row.revoked_at) return 'This registration link has been cancelled'
  if (row.used_at) return 'This registration link has already been used'
  if (new Date(row.expires_at) <= new Date()) return 'This registration link has expired'
  if (!row.franchise_active) return 'This franchise is not active'
  return null
}

async function readLink(tokenHash) {
  return transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT i.invitation_number, i.expires_at, i.used_at, i.revoked_at,
              f.name AS franchise_name, (f.is_active AND f.deleted_at IS NULL) AS franchise_active
         FROM fofo.franchise_invitations i
         JOIN fofo.franchises f ON f.id = i.franchise_id
        WHERE i.token_hash = $1`,
      [tokenHash]
    )
    return rows[0] || null
  })
}

/** What the registration page shows before the form: whose login, until when. */
export async function describeRegistrationLink(body) {
  const row = await readLink(hashToken(requireToken(body.token)))
  const problem = linkProblem(row)
  if (problem) throw new HttpError(410, problem)
  return {
    franchise_name: row.franchise_name,
    invitation_number: row.invitation_number,
    expires_at: row.expires_at,
  }
}

export async function register(req, body) {
  const tokenHash = hashToken(requireToken(body.token))

  const email = requireEmail(body.email)
  const password = requireNewPassword(body.password)

  // Checked before creating a login, so a dead link or a taken email never
  // makes one. The claim below checks both again, under a lock.
  const row = await readLink(tokenHash)
  const problem = linkProblem(row)
  if (problem) throw new HttpError(410, problem)

  const taken = await transaction(async (db) =>
    (await db.query('SELECT 1 FROM fofo.franchise_users WHERE email = $1', [email])).rowCount > 0
  )
  if (taken) throw new HttpError(409, 'An account with this email already exists')

  const authUserId = await createUser(email, password)

  try {
    await transaction((db) =>
      db.query('SELECT fofo.claim_franchise_invitation($1, $2, $3, $4, $5)', [
        tokenHash,
        authUserId,
        email,
        clientIp(req),
        userAgent(req),
      ])
    )
  } catch (err) {
    await deleteUser(authUserId)
    throw err
  }

  return { email, franchise_name: row.franchise_name }
}
