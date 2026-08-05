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
// TIMEZONE. The business day is the UTC date (see businessDate.js), so the
// window is [00:00 UTC, cutoff_ist - 05:30) on the current UTC day. Working in
// UTC keeps the 00:00-05:29 IST case — which belongs to the *previous*
// business day — from needing a special case: 02:00 IST is 20:30 UTC
// yesterday, and 20:30 is already past any cutoff.
//
// See docs/REQUISITION_CUTOFF.md for the whole feature, including why Boom
// Pizza is exempt and why editing is not blocked.

import { supabase } from './supabase'

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

/** The business day opens at 05:30 IST, which is 00:00 UTC. */
export const WINDOW_OPENS_IST = '05:30'

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
 * Where the current moment sits relative to the window.
 *
 * `now` is injectable so this can be reasoned about without waiting for a
 * particular time of day.
 */
export const evaluateCutoff = (cutoffIst, now = new Date()) => {
  const cutoffUtcMinutes = istToUtcMinutes(cutoffIst || DEFAULT_CUTOFF_IST)
  if (cutoffUtcMinutes === null) return { open: true, minutesLeft: null, cutoffIst }

  const nowUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const open = nowUtcMinutes < cutoffUtcMinutes

  return {
    open,
    cutoffIst: cutoffIst || DEFAULT_CUTOFF_IST,
    minutesLeft: open ? cutoffUtcMinutes - nowUtcMinutes : 0,
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
  if (minutes === null || minutes <= opensAt) {
    // The database CHECK says the same thing; catching it here turns a
    // constraint name into a sentence.
    throw new Error(`The cutoff must be later than ${formatIstTime(WINDOW_OPENS_IST)} IST, when the business day opens.`)
  }

  const { error } = await supabase
    .from('cloud_kitchens')
    .update({ requisition_cutoff_ist: cutoffIst, updated_at: new Date().toISOString() })
    .eq('id', cloudKitchenId)

  if (error) throw error
  return cutoffIst
}
