// The partner app's one way to call its server.
//
// Same-origin, so the session cookie (HttpOnly — this code never sees it)
// travels on its own. There is no Supabase client and no key here, and there
// never will be: every piece of data comes from /api (decision 0015).

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Fired when a signed-in request comes back 401 — the session ended, or the
// user or franchise was deactivated — so the app can send the person to sign in.
export const UNAUTHORIZED_EVENT = 'gx:unauthorized'

export async function api(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach Gastronomix Partners. Check your connection and try again.')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    // /api/auth/* answers 401 for "not signed in" and "wrong password" as a
    // matter of course; only elsewhere does a 401 mean a session just ended.
    if (response.status === 401 && !path.startsWith('auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(response.status, payload?.error || 'Something went wrong. Please try again.')
  }
  return payload
}
