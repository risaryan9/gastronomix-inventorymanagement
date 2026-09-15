/*
 * Exact decimal arithmetic for prices, on BigInt.
 *
 * WHY NOT Number. The order, the invoice and Razorpay must agree to the paisa,
 * and the database checks invoice lines with Postgres round(), which is exact
 * decimal arithmetic rounding half away from zero (07-create-fofo-money-tables.sql).
 * Floating point cannot promise the same answer: 1.005 is stored as
 * 1.00499999…, so Math.round(1.005 * 100) / 100 gives 1.00 where Postgres gives
 * 1.01. A price computed here is later frozen onto an order and copied onto an
 * invoice whose CHECK recomputes it, so the two must round identically.
 *
 * Every value is a BigInt holding the number × 10^SCALE. Twelve places is far
 * more than any input carries (quantities 3, unit prices 4, percentages 3), so
 * products of two inputs are exact and only the explicit round() calls lose
 * digits — the same places Postgres would.
 *
 * Postgres numeric arrives from node-postgres as a string, which is parsed
 * without ever passing through a float.
 */

const SCALE = 12
const ONE = 10n ** BigInt(SCALE)

// n / d rounded half away from zero, for any signs.
function divRound(n, d) {
  const negative = (n < 0n) !== (d < 0n)
  const an = n < 0n ? -n : n
  const ad = d < 0n ? -d : d
  const q = (an * 2n + ad) / (ad * 2n)
  return negative ? -q : q
}

/** A decimal from a string ("412.5", "-3"), a finite number, or a decimal. */
export function dec(value) {
  if (typeof value === 'bigint') return value
  if (value === null || value === undefined || value === '') return 0n
  const text = typeof value === 'number' ? numberToPlainString(value) : String(value).trim()
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) throw new Error(`Not a decimal: ${value}`)
  const [, sign, whole, fraction = ''] = match
  const digits = BigInt((whole || '0') + fraction.padEnd(SCALE, '0').slice(0, SCALE))
  // Digits beyond SCALE are rounded, not truncated.
  let scaled = digits
  if (fraction.length > SCALE) {
    const extra = BigInt(fraction.slice(SCALE))
    const extraOne = 10n ** BigInt(fraction.length - SCALE)
    if (extra * 2n >= extraOne) scaled += 1n
  }
  return sign === '-' ? -scaled : scaled
}

function numberToPlainString(n) {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`)
  // Numbers only ever arrive here from hand-written constants and parsed JSON
  // quantities (0.5, 2.25), whose String() is already plain; toFixed covers
  // the exponent form a very small or very large number would take.
  const text = String(n)
  return /e/i.test(text) ? n.toFixed(SCALE) : text
}

export const add = (a, b) => dec(a) + dec(b)
export const sub = (a, b) => dec(a) - dec(b)
export const mul = (a, b) => divRound(dec(a) * dec(b), ONE)
export const div = (a, b) => {
  const d = dec(b)
  if (d === 0n) throw new Error('Division by zero')
  return divRound(dec(a) * ONE, d)
}

/** Rounded to `places` decimal places, half away from zero — Postgres round(x, places). */
export function round(value, places) {
  const step = 10n ** BigInt(SCALE - places)
  return divRound(dec(value), step) * step
}

/** The decimal as a string with exactly `places` digits after the point. */
export function toFixed(value, places) {
  const rounded = round(value, places)
  const negative = rounded < 0n
  const digits = (negative ? -rounded : rounded).toString().padStart(SCALE + 1, '0')
  const whole = digits.slice(0, digits.length - SCALE)
  const fraction = digits.slice(digits.length - SCALE, digits.length - SCALE + places)
  return `${negative ? '-' : ''}${whole}${places ? `.${fraction}` : ''}`
}

/** For JSON responses: a Number, safe once the value is rounded to a few places. */
export const toNumber = (value, places) => Number(toFixed(value, places))

export const isZero = (value) => dec(value) === 0n
export const compare = (a, b) => {
  const x = dec(a), y = dec(b)
  return x === y ? 0 : x < y ? -1 : 1
}
export const min = (a, b) => (compare(a, b) <= 0 ? dec(a) : dec(b))
export const max = (a, b) => (compare(a, b) >= 0 ? dec(a) : dec(b))

export const percent = (value, pct) => div(mul(value, pct), 100)
