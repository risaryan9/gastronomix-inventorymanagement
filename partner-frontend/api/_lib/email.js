/*
 * Sending email, through Resend's HTTP API.
 *
 * Plain fetch rather than Resend's SDK: one POST is all this needs, and it
 * keeps the provider easy to swap. Configured by two server-only variables:
 *
 *   RESEND_API_KEY   the key (Resend → API Keys, "Sending access")
 *   EMAIL_FROM       e.g. "Gastronomix <onboarding@resend.dev>"
 *
 * WHILE EMAIL_FROM IS onboarding@resend.dev, Resend only delivers to the email
 * address the Resend account was registered with, and refuses anything else.
 * That refusal reaches the admin as it is, so it reads as what it is rather
 * than as a server fault. Moving to the company domain is a change to
 * EMAIL_FROM once the domain is verified in Resend — no code changes.
 *
 * Every link in an email is built from PARTNER_APP_URL, never from the request.
 * A Host header is whatever the caller sends; building a registration link from
 * it would let a forged request point the email somewhere else.
 */
import { HttpError } from './http.js'

const RESEND_URL = 'https://api.resend.com/emails'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new HttpError(500, `The server is missing ${name} — set it in Vercel and redeploy`)
  return value
}

/** The partner app's public address, without a trailing slash. */
export function partnerAppUrl() {
  return requireEnv('PARTNER_APP_URL').replace(/\/$/, '')
}

/**
 * Sends one email. Resolves to Resend's message id, or throws HttpError 502
 * carrying Resend's reason ("You can only send testing emails to your own
 * email address…").
 *
 * `idempotencyKey` makes a retried request send once, not twice.
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = requireEnv('RESEND_API_KEY')
  const from = requireEnv('EMAIL_FROM')

  let response
  try {
    response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.error('Could not reach Resend:', err.message)
    throw new HttpError(502, 'The email service could not be reached — nothing was sent. Try again.')
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    console.error('Resend refused an email:', response.status, body)
    const reason = body?.message || `status ${response.status}`
    throw new HttpError(502, `The email was not sent: ${reason}`)
  }
  return body?.id || null
}

/* ------------------------------------------------------------------ *
 * The two onboarding emails
 * ------------------------------------------------------------------ */

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// Dates in an email are read by people in India.
const istDateTime = (date) =>
  new Date(date).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

function layout({ heading, paragraphs, button, footer }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('')
  const cta = button
    ? `<p style="margin:24px 0">
         <a href="${escapeHtml(button.href)}"
            style="background:#e1bb07;color:#111;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
           ${escapeHtml(button.label)}
         </a>
       </p>
       <p style="margin:0 0 16px;font-size:13px;color:#59636e">
         If the button does not work, copy this address into your browser:<br>
         <span style="word-break:break-all">${escapeHtml(button.href)}</span>
       </p>`
    : ''
  return `<!doctype html>
<html><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1f2328;line-height:1.5">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #d1d9e0;border-radius:12px;padding:28px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#59636e">Gastronomix Partners</p>
      <h1 style="margin:0 0 20px;font-size:22px">${heading}</h1>
      ${body}${cta}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#59636e;text-align:center">${footer}</p>
  </div>
</body></html>`
}

export function welcomeEmail({ franchiseName }) {
  const name = escapeHtml(franchiseName)
  return {
    subject: `Welcome to Gastronomix Partners, ${franchiseName}`,
    html: layout({
      heading: `Welcome, ${name}`,
      paragraphs: [
        `Your franchise account with Gastronomix has been set up. Through Gastronomix Partners you will order supplies for your outlets, pay for them, and track each order until it is delivered.`,
        `<strong>What happens next:</strong> you will receive a separate <em>registration email</em> for each person at ${name} who needs a login. Each one carries a link that creates one login. Please forward each registration email to the person it is meant for — they will choose their own email address and password.`,
        `This email needs no action.`,
      ],
      footer: 'You are receiving this because this address is the main contact for your franchise with Gastronomix.',
    }),
    text: [
      `Welcome to Gastronomix Partners, ${franchiseName}.`,
      '',
      'Your franchise account with Gastronomix has been set up. Through Gastronomix Partners you will order supplies for your outlets, pay for them, and track each order until it is delivered.',
      '',
      `What happens next: you will receive a separate registration email for each person at ${franchiseName} who needs a login. Each one carries a link that creates one login. Please forward each registration email to the person it is meant for — they will choose their own email address and password.`,
      '',
      'This email needs no action.',
    ].join('\n'),
  }
}

export function registrationEmail({ franchiseName, invitationNumber, link, expiresAt }) {
  const name = escapeHtml(franchiseName)
  const expires = istDateTime(expiresAt)
  return {
    // The number is what makes four registration emails tellable apart.
    subject: `User registration #${invitationNumber} for ${franchiseName}`,
    html: layout({
      heading: `User registration #${invitationNumber} for ${name}`,
      paragraphs: [
        `This email creates <strong>one login</strong> for ${name} on Gastronomix Partners.`,
        `<strong>Forward it to the person who should have this login.</strong> When they open the link, they choose their own email address and password.`,
        `The link works <strong>once</strong> and expires on <strong>${escapeHtml(expires)}</strong> (IST). If you need another login, ask Gastronomix for another registration email.`,
      ],
      button: { label: 'Create my login', href: link },
      footer: `Registration #${invitationNumber}. If you were not expecting this email, you can ignore it — without the link, nothing happens.`,
    }),
    text: [
      `User registration #${invitationNumber} for ${franchiseName}`,
      '',
      `This email creates one login for ${franchiseName} on Gastronomix Partners.`,
      'Forward it to the person who should have this login. When they open the link, they choose their own email address and password.',
      '',
      `Create the login: ${link}`,
      '',
      `The link works once and expires on ${expires} (IST). If you need another login, ask Gastronomix for another registration email.`,
    ].join('\n'),
  }
}
