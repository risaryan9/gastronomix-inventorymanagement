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

/*
 * THE EMAIL DESIGN follows the internal app and the partner app: dark by
 * default — the same navy, card and brand gold — with Poppins where the mail
 * client allows web fonts.
 *
 * Email cannot have a theme switch, so light is left to the reader's system:
 * clients that honour prefers-color-scheme (Apple Mail, iOS, some others) get
 * the partner app's light palette through the <style> block. Everything is
 * inline first, because Gmail and Outlook ignore much of <style>; those show
 * the dark design. Colours are hex, not hsl(), for the same reason.
 */
const DARK = {
  page: '#111317', card: '#1a1d23', border: '#2e3138', text: '#f2f2f2',
  muted: '#a6a6a6', gold: '#e1bb07', onGold: '#111317',
}

function layout({ heading, paragraphs, button, footer, appUrl }) {
  const c = DARK
  const body = paragraphs
    .map((p) => `<p class="gx-text" style="margin:0 0 16px;color:${c.text};font-size:15px;line-height:1.6">${p}</p>`)
    .join('')
  const cta = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 20px"><tr><td style="border-radius:12px;background:${c.gold}">
         <a href="${escapeHtml(button.href)}" class="gx-button"
            style="display:inline-block;padding:14px 26px;border-radius:12px;background:${c.gold};color:${c.onGold};font-weight:800;font-size:16px;text-decoration:none">
           ${escapeHtml(button.label)}
         </a>
       </td></tr></table>
       <p class="gx-muted" style="margin:0 0 4px;color:${c.muted};font-size:12px">If the button does not work, copy this address into your browser:</p>
       <p style="margin:0;font-size:12px;word-break:break-all"><a href="${escapeHtml(button.href)}" class="gx-link" style="color:${c.gold};text-decoration:underline">${escapeHtml(button.href)}</a></p>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body, table, td, p, a, h1 { font-family: 'Poppins', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media (prefers-color-scheme: light) {
      .gx-page { background: #f6f7f9 !important; }
      .gx-card { background: #ffffff !important; border-color: #d4d7de !important; }
      .gx-text, .gx-heading { color: #181c25 !important; }
      .gx-muted { color: #585e6a !important; }
      .gx-eyebrow { color: #936b06 !important; }
      .gx-link { color: #936b06 !important; }
      .gx-button { color: #181c25 !important; }
    }
  </style>
</head>
<body class="gx-page" style="margin:0;padding:0;background:${c.page}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="gx-page" style="background:${c.page}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td align="center" style="padding-bottom:20px">
          <img src="${escapeHtml(appUrl)}/gastronomix-logo.png" width="64" height="64" alt="Gastronomix" style="display:block;border:0;width:64px;height:64px">
          <p class="gx-eyebrow" style="margin:10px 0 0;color:${c.muted};font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase">Gastronomix Partners</p>
        </td></tr>
        <tr><td class="gx-card" style="background:${c.card};border:2px solid ${c.border};border-radius:16px;padding:32px">
          <h1 class="gx-heading" style="margin:0 0 20px;color:${c.text};font-size:22px;font-weight:700;line-height:1.3">${heading}</h1>
          ${body}${cta}
        </td></tr>
        <tr><td style="padding:18px 8px 0">
          <p class="gx-muted" style="margin:0;color:${c.muted};font-size:12px;line-height:1.5;text-align:center">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function welcomeEmail({ franchiseName, appUrl }) {
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
      appUrl,
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

export function registrationEmail({ franchiseName, invitationNumber, link, expiresAt, appUrl }) {
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
      appUrl,
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
