/*
 * The server's one door into Postgres.
 *
 * WHY NOT supabase-js. The fofo schema is deliberately not exposed to
 * PostgREST (decision 0015), so no Supabase key reaches it over the REST API —
 * not even service_role. The server connects to Postgres directly instead,
 * through Supabase's TRANSACTION POOLER (DATABASE_URL, port 6543): serverless
 * functions start and stop constantly, and a direct connection per start would
 * exhaust Postgres's connection limit. A transaction pooler hands a connection
 * back after every transaction, so:
 *
 *   - session state does not survive between transactions — anything set with
 *     SET must be SET LOCAL inside the transaction that needs it;
 *   - named prepared statements are unsafe. node-postgres only prepares a
 *     statement when a query is given a `name`, so never pass one.
 *
 * EVERY TRANSACTION RUNS AS service_role, NOT AS postgres. The pooler logs in as
 * the `postgres` role, which owns everything and ignores every grant. Dropping
 * to service_role with SET LOCAL ROLE means the server has exactly the access
 * the service_role key would give it: the fofo functions it was granted, and
 * none of the internal helpers migrations 11 and 12 revoked from it. A grant
 * that is wrong then fails here, loudly, instead of being silently bypassed.
 *
 * TLS. Supabase's certificate is signed by Supabase's own CA, which Node does
 * not trust by default. Set DATABASE_CA_CERT to that certificate (Supabase
 * dashboard → Database settings → SSL configuration → download) and the
 * connection is verified. Without it the connection is still encrypted but not
 * verified, and a warning is logged once. `sslmode=disable` in DATABASE_URL
 * turns TLS off — for a local Postgres only.
 */
import pg from 'pg'

let pool = null
let warnedUnverified = false

function connectionConfig() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set')

  // node-postgres lets ssl settings in the URL override the ssl object below,
  // so they are read here and removed from the URL.
  const url = new URL(raw)
  const sslmode = url.searchParams.get('sslmode')
  for (const param of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(param)
  }

  let ssl
  if (sslmode === 'disable') {
    ssl = false
  } else if (process.env.DATABASE_CA_CERT) {
    // Vercel keeps newlines in a pasted PEM; a value written on one line with
    // literal \n sequences is accepted too.
    ssl = { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true }
  } else {
    if (!warnedUnverified) {
      console.warn('DATABASE_CA_CERT is not set: the database connection is encrypted but its certificate is not verified.')
      warnedUnverified = true
    }
    ssl = { rejectUnauthorized: false }
  }

  return {
    connectionString: url.toString(),
    ssl,
    // One warm function instance serves one request at a time; the pooler does
    // the real pooling. A couple of connections covers the odd overlap.
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  }
}

function getPool() {
  if (!pool) {
    pool = new pg.Pool(connectionConfig())
    // An idle connection dropped by the pooler must not crash the function.
    pool.on('error', (err) => console.error('Idle database connection error:', err.message))
  }
  return pool
}

/**
 * Runs `work(client)` inside one transaction, as service_role. Commits if it
 * resolves, rolls back if it throws, and rethrows.
 *
 *   const rows = await transaction(async (db) => (await db.query(sql, params)).rows)
 */
export async function transaction(work) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE service_role')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Closes the pool. Only for scripts and tests; functions never call it. */
export async function closePool() {
  if (pool) {
    const closing = pool
    pool = null
    await closing.end()
  }
}
