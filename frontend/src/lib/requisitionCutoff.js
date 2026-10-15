// The daily requisition cutoff.
//
// Each cloud kitchen carries a time of day, in IST, after which supervisors
// can no longer raise a requisition for its Nippu Kodi and El Chaapo outlets.
// The rule is enforced by a BEFORE INSERT trigger in the database
// (migrations/add-requisition-cutoff-per-cloud-kitchen.sql) — everything here
// is the UI half: telling the supervisor the window is closing before they
// fill in a form they cannot submit.
//
// THIS FILE CANNOT BE THE LOCK. It runs on the supervisor's own device, off
// that device's clock, in code they can open. Treat every function here as
// advisory. The database is what actually refuses the write, and its message
// is what the user sees when it does.
//
// THE WINDOW (decision 0025). The window for business day D runs from 21:00
// IST the night before to the kitchen's cutoff on D. A requisition raised in
// the night part of it is dated D, the day it is for. In UTC, where the
// business day lives (businessDate.js), that is one test with no midnight
// special case: from 15:30 UTC (21:00 IST) to the end of the UTC day (05:30
// IST) a cutoff-bound supervisor is ordering for the next UTC date. 22:00 IST
// is 16:30 UTC and 02:00 IST is 20:30 UTC: the same UTC day, both past 15:30.
//
// Between the cutoff and 21:00 IST, nothing is open.
//
// ONLY THE REQUISITION DATE MOVES. getBusinessDate() is not shifted, and must
// not be: the supervisor's checkout and closing screens run on it. Use
// getRequisitionDate() for "which requisition is this screen about", and
// getBusinessDate() for everything else.
//
// The database states the same rule in public.requisition_date_for()
// (migrations/open-tomorrows-requisition-window-at-9pm.sql). Change both.
//
// See docs/REQUISITION_CUTOFF.md for the whole feature, including why Boom
// Pizza is exempt and why editing is not blocked.

import { supabase } from './supabase'
import { getBusinessDate } from './businessDate'

/** Brands the cutoff applies to. Mirrors c_locked_brands in the trigger. */
export const CUTOFF_BRANDS = ['NK', 'EC']

/** IST is UTC+5:30, and India has no daylight saving, so this never varies. */
const IST_OFFSET_MINUTES = 5 * 60 + 30

const DEFAULT_CUTOFF_IST = '11:30'

/** 'HH:MM[:SS]' -> minutes since midnight. */
export const parseTimeToMinutes = (value) => {
  if (!value) return null
  const [hours, minutes] = String(value).split(':')
  const total = Number(hours) * 60 + Number(minutes)
  return Number.isFinite(total) ? total : null
}

/** 690 -> '11:30 AM'. The screens only ever state this in IST. */
export const formatIstTime = (value) => {
  const minutes = typeof value === 'number' ? value : parseTimeToMinutes(value)
  if (minutes === null) return '—'
  const hours24 = Math.floor(minutes / 60) % 24
  const mins = minutes % 60
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`
}

/** 'HH:MM' in IST -> minutes since midnight UTC. 11:30 IST -> 360 (06:00 UTC). */
export const istToUtcMinutes = (istValue) => {
  const minutes = parseTimeToMinutes(istValue)
  if (minutes === null) return null
  return minutes - IST_OFFSET_MINUTES
}

/**
 * The business day opens at 05:30 IST, which is 00:00 UTC. No longer when a
 * supervisor's window opens (that is NEXT_DAY_OPENS_IST), but still the
 * earliest a cutoff may be set.
 */
export const WINDOW_OPENS_IST = '05:30'

/**
 * Tomorrow's window opens at 21:00 IST, 15:30 UTC. Mirrors TIME '15:30' in
 * public.requisition_date_for(). The cutoff must be earlier than this; the
 * database CHECK cloud_kitchens_requisition_cutoff_before_next_window says so.
 */
export const NEXT_DAY_OPENS_IST = '21:00'

const isNextDayWindow = (now) => {
  const nowUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return nowUtcMinutes >= istToUtcMinutes(NEXT_DAY_OPENS_IST)
}

/** 'YYYY-MM-DD' + 1 day, on the calendar, without touching a timezone. */
const nextDate = (yyyyMmDd) => {
  const date = new Date(`${yyyyMmDd}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Whether the cutoff applies to this outlet at all.
 *
 * Brand lives in the outlet code prefix, which is how every screen in this app
 * derives it. Only supervisors are held to the cutoff — the purchase manager
 * uses the same shared Outlets page and is exempt, as are Boom Pizza operators.
 */
export const cutoffAppliesTo = ({ role, outletCode, brandCode }) => {
  if (role !== 'supervisor') return false
  const brand = (brandCode || String(outletCode || '').slice(0, 2)).toUpperCase()
  return CUTOFF_BRANDS.includes(brand)
}

/**
 * The date a requisition raised now would carry, as YYYY-MM-DD: the business
 * day, or the next one for a cutoff-bound supervisor from 21:00 IST. Mirrors
 * public.requisition_date_for(), which is what actually dates the row.
 */
export const getRequisitionDate = ({ role, outletCode, brandCode, now = new Date() }) => {
  const today = getBusinessDate(now)
  if (!cutoffAppliesTo({ role, outletCode, brandCode })) return today
  return isNextDayWindow(now) ? nextDate(today) : today
}

/** '2026-10-16' -> 'Fri, 16 Oct'. Read as a calendar date, never shifted. */
export const formatRequisitionDate = (yyyyMmDd) =>
  new Date(`${yyyyMmDd}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/**
 * Where the current moment sits relative to the window.
 *
 *   05:30 IST – cutoff    open, for today
 *   cutoff – 21:00 IST    closed
 *   21:00 – 05:30 IST     open, for the next business day (`forNextDay`)
 *
 * `minutesLeft` counts to the cutoff the open window ends at, which at night
 * is tomorrow morning's. `now` is injectable so this can be reasoned about
 * without waiting for a particular time of day.
 */
export const evaluateCutoff = (cutoffIst, now = new Date()) => {
  const cutoffUtcMinutes = istToUtcMinutes(cutoffIst || DEFAULT_CUTOFF_IST)
  if (cutoffUtcMinutes === null) return { open: true, forNextDay: false, minutesLeft: null, cutoffIst }

  const nowUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const forNextDay = isNextDayWindow(now)
  const open = forNextDay || nowUtcMinutes < cutoffUtcMinutes

  let minutesLeft = 0
  if (forNextDay) minutesLeft = cutoffUtcMinutes + 24 * 60 - nowUtcMinutes
  else if (open) minutesLeft = cutoffUtcMinutes - nowUtcMinutes

  return {
    open,
    forNextDay,
    cutoffIst: cutoffIst || DEFAULT_CUTOFF_IST,
    minutesLeft,
  }
}

/** '2h 15m left' / '20m left', for the banner above the outlet list. */
export const formatMinutesLeft = (minutes) => {
  if (minutes === null || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m left`
  return `${hours}h ${mins}m left`
}

export const fetchKitchenCutoff = async (cloudKitchenId) => {
  if (!cloudKitchenId) return null
  const { data, error } = await supabase
    .from('cloud_kitchens')
    .select('id, name, requisition_cutoff_ist')
    .eq('id', cloudKitchenId)
    .single()

  if (error) throw error
  return data?.requisition_cutoff_ist || DEFAULT_CUTOFF_IST
}

/**
 * Admin-only. The RLS policy "Admin full access to cloud_kitchens" is what
 * makes this succeed for an admin and fail for everyone else, so there is no
 * role check here to drift out of step with it.
 */
export const updateKitchenCutoff = async (cloudKitchenId, cutoffIst) => {
  const minutes = parseTimeToMinutes(cutoffIst)
  const opensAt = parseTimeToMinutes(WINDOW_OPENS_IST)
  const nextOpensAt = parseTimeToMinutes(NEXT_DAY_OPENS_IST)
  // The database CHECKs say the same things; catching them here turns a
  // constraint name into a sentence.
  if (minutes === null || minutes <= opensAt) {
    throw new Error(`The cutoff must be later than ${formatIstTime(WINDOW_OPENS_IST)} IST, when the business day opens.`)
  }
  if (minutes >= nextOpensAt) {
    throw new Error(`The cutoff must be earlier than ${formatIstTime(NEXT_DAY_OPENS_IST)} IST, when the next day's window opens.`)
  }

  const { error } = await supabase
    .from('cloud_kitchens')
    .update({ requisition_cutoff_ist: cutoffIst, updated_at: new Date().toISOString() })
    .eq('id', cloudKitchenId)

  if (error) throw error
  return cutoffIst
}
