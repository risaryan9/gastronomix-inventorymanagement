// Business-day helpers.
//
// WHY THIS EXISTS
//
// Columns like allocation_requests.request_date, dispatch_plan.plan_date,
// stock_out.allocation_date and stock_in.receipt_date are Postgres `date`
// columns. A date has no timezone, so something has to decide *when the day
// rolls over*. That is a business question, not a display one.
//
// THE ANSWER HERE IS UTC — DELIBERATELY, AND IT IS NOT AN OVERSIGHT.
//
// UTC runs 5.5 hours behind IST, so deriving the day from UTC means in
// practice: **the business day does not roll over until 05:30 IST.** That
// matches how this kitchen actually runs. A late shift routinely finishes
// after midnight, and that work belongs to the day it started.
//
// This was briefly changed to IST on the reasoning that "the business is in
// India, so UTC is wrong". That broke a real workflow: a dispatch plan locked
// at 10:00 IST, with the closing form filed at 00:30 IST the next morning.
// Under IST the plan is dated the 29th while the closing screen asks for the
// 30th, so the supervisor sees "No locked dispatch plan found for today" and
// cannot file at all. The same rollover stopped the kitchen executive locking
// a draft carried past midnight. Real traffic, not hypothetical — 20 records
// were created in the midnight hour alone.
//
// So: UTC here is doing the job of "business day starts at 05:30 IST".
//
// IF YOU CHANGE THIS, CHANGE THE DATABASE TOO. public.business_today() in
// migrations/revert-business-day-to-utc.sql is the server-side mirror, used by
// save_allocation_request and save_dispatch_plan. The two must agree, or
// records get written under one day and searched for under another — which is
// exactly the bug described above.
//
// If the business day should start at a specific hour (06:00 IST is the honest
// version of what UTC approximates here), that is a better fix than either
// extreme — but it has to be made in both places at once.

/**
 * The current business day as YYYY-MM-DD.
 * Mirrors the server's public.business_today().
 */
export const getBusinessDate = (date = new Date()) =>
  date.toISOString().split('T')[0]

/**
 * Normalizes a stored date value to YYYY-MM-DD for comparison.
 *
 * Postgres `date` columns arrive as 'YYYY-MM-DD' already; this just guards the
 * cases where a Date object or a full timestamp is passed in. It does NOT
 * shift timezones — a stored business day is already the answer, and
 * re-interpreting it would reintroduce the very bug this module prevents.
 */
export const toBusinessDateString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return getBusinessDate(value)
}

/**
 * The last `days` business days, inclusive of today, as
 * { startDate, endDate } in YYYY-MM-DD.
 *
 * The arithmetic is on UTC dates for the reason this whole module exists: a
 * range built from local dates would disagree with the `date` columns it is
 * compared against for anyone working between midnight and 05:30 IST.
 */
export const lastBusinessDays = (days) => {
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (Math.max(1, days) - 1))
  return { startDate: getBusinessDate(start), endDate: getBusinessDate(today) }
}
