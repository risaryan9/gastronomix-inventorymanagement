/*
 * Small pieces every account endpoint shares: who is asking, random tokens,
 * and the rules for an email address and a new password.
 */
import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { HttpError } from './http.js'

/** 32 random bytes, base64url: 43 characters, no padding. */
export const newToken = () => randomBytes(32).toString('base64url')
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** SHA-256 hex. Tokens are stored only in this form. */
export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex')

/**
 * The client's IP, or null. Vercel sets x-forwarded-for; its first entry is
 * the client. Only used for records and throttling — never for a decision
 * that a forged header could turn in the caller's favour beyond that.
 */
export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = forwarded || req.headers['x-real-ip'] || ''
  return isIP(ip) ? ip : null
}

export const userAgent = (req) => String(req.headers['user-agent'] || '').slice(0, 500) || null

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Trimmed and lowercased, or HttpError 400. */
export function requireEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 320) throw new HttpError(400, 'Enter a valid email address')
  return email
}

export const MIN_PASSWORD_LENGTH = 8
// bcrypt, which Supabase Auth uses, reads only the first 72 bytes.
const MAX_PASSWORD_LENGTH = 72

/** A password someone is choosing, or HttpError 400. */
export function requireNewPassword(value) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Choose a password of at most ${MAX_PASSWORD_LENGTH} characters`)
  }
  return password
}
