/*
 * Request and response helpers shared by every endpoint.
 *
 * Handlers throw HttpError for anything the caller should be told, and let
 * everything else fall through to sendError, which never leaks an internal
 * message: a stack trace or SQL text in a response tells an attacker how the
 * server is built.
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (value) => typeof value === 'string' && UUID.test(value)

/**
 * The JSON body as an object. Vercel parses JSON bodies into req.body already;
 * a string or Buffer is parsed here so the handler does not care which.
 */
export function jsonBody(req) {
  const body = req.body
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body
  if (body === undefined || body === null || body === '') return {}
  try {
    const parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // fall through
  }
  throw new HttpError(400, 'The request body must be a JSON object')
}

/**
 * Turns an error from a handler or from Postgres into a response.
 *
 * Postgres errors the FOFO functions raise on purpose (SQLSTATE P0001, from
 * RAISE EXCEPTION) are written for people — "Outlet EC1026 already belongs to
 * franchise Test Foods" — so they are passed through. Every other database
 * error is reported generically and logged in full.
 */
export function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message })
  }

  if (err?.code === 'P0001') {
    const status = /not found/i.test(err.message) ? 404 : 422
    return res.status(status).json({ error: err.message })
  }

  // invalid_text_representation, check_violation, not_null_violation,
  // unique_violation: bad input that slipped past the functions' own checks.
  if (['22P02', '23514', '23502', '23505'].includes(err?.code)) {
    console.error('Rejected by a database constraint:', err.code, err.message)
    return res.status(400).json({ error: 'That value was not accepted' })
  }

  console.error('Unhandled API error:', err)
  return res.status(500).json({ error: 'Something went wrong on the server' })
}
