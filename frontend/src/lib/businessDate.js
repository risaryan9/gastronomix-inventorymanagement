// Business-day helpers.
//
// WHY THIS EXISTS
//
// Columns like allocation_requests.request_date, dispatch_plan.plan_date,
// stock_out.allocation_date and stock_in.receipt_date are Postgres `date`
// columns. A date has no timezone, so something has to decide *when the day
// rolls over* — and that is a business question, not a display one.
//
// The business runs on IST. That is not an assumption: of the 145
// allocation_requests that existed when this was written, ZERO disagreed with
// the IST date of their created_at, while twelve disagreed with the UTC date.
// The stored history is already IST.
//
// The old code computed "today" with new Date().toISOString().split('T')[0],
// which is UTC. India is UTC+5:30, so between 00:00 and 05:30 IST that returns
// YESTERDAY. For 18.5 hours a day it happens to agree with IST, which is why
// the bug stayed invisible — but people do work in that window: the earliest
// requisition on record was created at 00:07 IST, and 26 records across
// requisitions, stock-in and stock-out fall inside it.
//
// The server-side RPCs (save_allocation_request, save_dispatch_plan) derive
// their dates as (now() AT TIME ZONE 'Asia/Kolkata')::date. getBusinessDate()
// is the frontend's exact mirror of that, so reads and writes agree.
//
// NOTE: this is deliberately NOT the browser's local timezone. A supervisor
// travelling, or a laptop with the wrong clock zone, must still file against
// the kitchen's business day.

const BUSINESS_TIME_ZONE = 'Asia/Kolkata'

/**
 * The business day (YYYY-MM-DD) for a given instant, in IST.
 * Mirrors the server's (now() AT TIME ZONE 'Asia/Kolkata')::date.
 */
export const getBusinessDate = (date = new Date()) => {
  // formatToParts rather than format(): avoids depending on any locale's
  // separator or ordering.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)

  const part = (type) => parts.find((p) => p.type === type)?.value

  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Normalizes a stored date value to YYYY-MM-DD for comparison.
 *
 * Postgres `date` columns arrive as 'YYYY-MM-DD' already; this just guards the
 * cases where a Date object or a full timestamp is passed in. It does NOT
 * shift timezones — a stored business day is already the answer, and
 * re-interpreting it would be the very bug this module exists to prevent.
 */
export const toBusinessDateString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return getBusinessDate(value)
}
