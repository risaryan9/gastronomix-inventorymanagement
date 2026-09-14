// How money, quantities and dates read across the partner app. One module, so
// every screen formats the same number the same way (CLAUDE.md: shared rules
// live in one module).

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

/** ₹1,23,456.78 — screens use ₹ (PDFs cannot; decision 0007). */
export const formatINR = (value) => inr.format(Number(value) || 0)

/** ₹1,23,457 — for summaries where paise are noise. */
export const formatINRWhole = (value) => inrWhole.format(Math.round(Number(value) || 0))

const UNIT_LABEL = { kg: 'kg', liter: 'L', nos: 'pcs', packets: 'packets' }
export const unitLabel = (unit) => UNIT_LABEL[unit] || unit

/** "2.5 kg", "30 pcs" — trailing zeros dropped. */
export const formatQty = (qty, unit) => `${Number((Number(qty) || 0).toFixed(3))} ${unitLabel(unit)}`

const IST = 'Asia/Kolkata'
export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' })
export const formatShortDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' })

/** "today", "yesterday", "5 days ago", or a date once it is over a month old. */
export function formatRelativeDay(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return formatDate(iso)
}
