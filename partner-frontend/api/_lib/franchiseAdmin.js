/*
 * Admin franchise management: the reads, and thin calls into the fofo
 * functions from migration 12 for every write.
 *
 * Writes never touch the tables directly. The functions check the admin again,
 * clean and validate the input, take the row locks and write the audit event in
 * the same transaction (migrations/fofo/12-add-franchise-admin-functions.sql).
 * Their error messages are written for people and reach the admin as they are
 * (http.js → sendError).
 *
 * Every function here takes `db`, a client already inside a transaction running
 * as service_role (db.js).
 */
import { HttpError, isUuid } from './http.js'

// In the order fofo.create_franchise and fofo.update_franchise take them.
const DETAIL_FIELDS = [
  'name',
  'gst_number',
  'address',
  'city',
  'contact_person',
  'contact_phone',
  'contact_email',
]

const MAX_FIELD_LENGTH = 500

/**
 * The seven editable fields from a request body, in function-argument order.
 *
 * `requireAll` is for an edit: update_franchise replaces every field, and a
 * NULL clears one, so a body that simply leaves a field out would wipe it. An
 * edit must therefore send all seven, even the unchanged ones.
 */
function detailArgs(body, { requireAll }) {
  return DETAIL_FIELDS.map((field) => {
    if (!(field in body)) {
      if (requireAll) throw new HttpError(400, `Missing field: ${field}`)
      return null
    }
    const value = body[field]
    if (value === null) return null
    if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`)
    if (value.length > MAX_FIELD_LENGTH) throw new HttpError(400, `${field} is too long`)
    return value
  })
}

function requireUuid(value, what) {
  if (!isUuid(value)) throw new HttpError(404, `${what} not found`)
  return value
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listFranchises(db) {
  const { rows } = await db.query(`
    SELECT f.id, f.name, f.city, f.gst_number,
           f.contact_person, f.contact_phone, f.contact_email,
           f.is_active, f.welcome_email_last_sent_at, f.created_at,
           COALESCE(o.outlets, '[]'::json) AS outlets,
           (SELECT count(*)::int FROM fofo.franchise_users u
             WHERE u.franchise_id = f.id) AS user_count
      FROM fofo.franchises f
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('id', ou.id, 'code', ou.code, 'name', ou.name)
                        ORDER BY ou.code, ou.id) AS outlets
          FROM fofo.franchise_outlets fo
          JOIN public.outlets ou ON ou.id = fo.outlet_id
         WHERE fo.franchise_id = f.id
      ) o ON true
     WHERE f.deleted_at IS NULL
     ORDER BY lower(f.name), f.id
  `)
  return rows
}

export async function getFranchise(db, franchiseId) {
  requireUuid(franchiseId, 'Franchise')

  const { rows } = await db.query(
    `SELECT id, name, gst_number, address, city,
            contact_person, contact_phone, contact_email,
            is_active, welcome_email_last_sent_at, created_at, updated_at
       FROM fofo.franchises
      WHERE id = $1 AND deleted_at IS NULL`,
    [franchiseId]
  )
  if (!rows.length) throw new HttpError(404, 'Franchise not found')

  // One after another, not Promise.all: a single client runs one query at a
  // time, and overlapping them on it is deprecated in node-postgres.
  const outlets = await db.query(
    `SELECT ou.id, ou.code, ou.name, ou.is_active, ou.ownership_model,
            ck.name AS cloud_kitchen_name, fo.created_at AS linked_at
       FROM fofo.franchise_outlets fo
       JOIN public.outlets ou ON ou.id = fo.outlet_id
       LEFT JOIN public.cloud_kitchens ck ON ck.id = ou.cloud_kitchen_id
      WHERE fo.franchise_id = $1
      ORDER BY ou.code, ou.id`,
    [franchiseId]
  )

  const users = await db.query(
    `SELECT id, email, is_active, activated_at
       FROM fofo.franchise_users
      WHERE franchise_id = $1
      ORDER BY activated_at, id`,
    [franchiseId]
  )

  // State is worked out on read — expiry is never swept into a column.
  const invitations = await db.query(
    `SELECT i.id, i.invitation_number, i.sent_to_email, i.sent_at, i.expires_at,
            i.used_at, i.revoked_at, u.email AS registered_email,
            CASE WHEN i.used_at    IS NOT NULL THEN 'used'
                 WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                 WHEN i.expires_at <= now()    THEN 'expired'
                 ELSE 'open' END AS state
       FROM fofo.franchise_invitations i
       LEFT JOIN fofo.franchise_users u ON u.invitation_id = i.id
      WHERE i.franchise_id = $1
      ORDER BY i.invitation_number DESC`,
    [franchiseId]
  )

  return {
    ...rows[0],
    outlets: outlets.rows,
    users: users.rows,
    invitations: invitations.rows,
  }
}

/**
 * Every outlet, with who owns it and its FOCO portal code. The internal app
 * could read outlets itself, but not the owner — that lives in fofo — nor an
 * inactive portal code, which the anon key cannot see (migration 15).
 *
 *   has_foco_portal_code      a portal code exists for the outlet
 *   foco_portal_code_active   and it is on (null when there is none)
 */
export async function listOutlets(db) {
  const { rows } = await db.query(`
    SELECT o.id, o.code, o.name, o.is_active, o.ownership_model,
           ck.name AS cloud_kitchen_name,
           fo.franchise_id AS owner_franchise_id,
           f.name AS owner_franchise_name,
           (c.id IS NOT NULL) AS has_foco_portal_code,
           c.is_active AS foco_portal_code_active
      FROM public.outlets o
      LEFT JOIN public.cloud_kitchens ck ON ck.id = o.cloud_kitchen_id
      LEFT JOIN fofo.franchise_outlets fo ON fo.outlet_id = o.id
      LEFT JOIN fofo.franchises f ON f.id = fo.franchise_id
      LEFT JOIN public.franchise_outlet_codes c ON c.outlet_id = o.id
     WHERE o.deleted_at IS NULL
     ORDER BY o.code, o.id
  `)
  return rows
}

/* ------------------------------------------------------------------ *
 * Writes — each one a fofo function from migration 12
 * ------------------------------------------------------------------ */

export async function createFranchise(db, adminId, body) {
  const args = detailArgs(body, { requireAll: false })
  const { rows } = await db.query(
    'SELECT fofo.create_franchise($1, $2, $3, $4, $5, $6, $7, $8) AS id',
    [...args, adminId]
  )
  return getFranchise(db, rows[0].id)
}

export async function updateFranchise(db, adminId, franchiseId, body) {
  requireUuid(franchiseId, 'Franchise')
  const args = detailArgs(body, { requireAll: true })
  const { rows } = await db.query(
    'SELECT fofo.update_franchise($1, $2, $3, $4, $5, $6, $7, $8, $9) AS changed',
    [franchiseId, ...args, adminId]
  )
  return { changed: rows[0].changed, franchise: await getFranchise(db, franchiseId) }
}

export async function setFranchiseActive(db, adminId, franchiseId, body) {
  requireUuid(franchiseId, 'Franchise')
  if (typeof body.is_active !== 'boolean') throw new HttpError(400, 'is_active must be true or false')
  const { rows } = await db.query(
    'SELECT fofo.set_franchise_active($1, $2, $3) AS changed',
    [franchiseId, body.is_active, adminId]
  )
  return { changed: rows[0].changed, franchise: await getFranchise(db, franchiseId) }
}

export async function linkOutlet(db, adminId, franchiseId, body) {
  requireUuid(franchiseId, 'Franchise')
  if (!isUuid(body.outlet_id)) throw new HttpError(400, 'Choose an outlet to add')
  const { rows } = await db.query(
    'SELECT fofo.link_franchise_outlet($1, $2, $3) AS changed',
    [franchiseId, body.outlet_id, adminId]
  )
  return { changed: rows[0].changed, franchise: await getFranchise(db, franchiseId) }
}

export async function unlinkOutlet(db, adminId, franchiseId, outletId) {
  requireUuid(franchiseId, 'Franchise')
  requireUuid(outletId, 'Outlet')
  await db.query('SELECT fofo.unlink_franchise_outlet($1, $2, $3)', [franchiseId, outletId, adminId])
  return { changed: true, franchise: await getFranchise(db, franchiseId) }
}

/* ------------------------------------------------------------------ *
 * Outlets — migrations 13 and 15
 * ------------------------------------------------------------------ */

/**
 * Marks an outlet company-operated ('foco') or franchise-operated ('fofo').
 * Becoming FOFO turns its FOCO portal code off; returning to FOCO turns it back
 * on. Refuses 'foco' for an outlet a FOFO franchise owns.
 */
export async function setOutletOwnershipModel(db, adminId, outletId, body) {
  requireUuid(outletId, 'Outlet')
  if (!['foco', 'fofo'].includes(body.ownership_model)) {
    throw new HttpError(400, 'ownership_model must be foco or fofo')
  }
  const { rows } = await db.query(
    'SELECT fofo.set_outlet_ownership_model($1, $2, $3) AS changed',
    [outletId, body.ownership_model, adminId]
  )
  const outlet = await db.query(
    `SELECT o.id, o.code, o.name, o.ownership_model,
            (c.id IS NOT NULL) AS has_foco_portal_code,
            c.is_active AS foco_portal_code_active
       FROM public.outlets o
       LEFT JOIN public.franchise_outlet_codes c ON c.outlet_id = o.id
      WHERE o.id = $1`,
    [outletId]
  )
  return { changed: rows[0].changed, outlet: outlet.rows[0] }
}
