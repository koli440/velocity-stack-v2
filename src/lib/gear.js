// Shared gear (chainring x cog) helpers used by <GearPicker> and every place that takes a gear.
// Gear is optional wherever it is stored: empty is a valid state and means "no gear".

import { TRACK_WHEEL_DIAMETER_INCHES } from './constants.js'
import { gearDevelopmentM } from './trackGearing.js'

// The one validation range for both chainring and cog tooth counts.
export const GEAR_TEETH_MIN = 8
export const GEAR_TEETH_MAX = 100

// Starting values for calculators only (never saved as data); used when the user has no saved default.
export const CALCULATOR_GEAR_START = Object.freeze({ chainring: 52, cog: 14 })
export const PURSUIT_GEAR_START = Object.freeze({ chainring: 58, cog: 15 })

const isEmpty = (v) => v === '' || v == null || (typeof v === 'string' && v.trim() === '')

/** Parses a tooth count: a whole number within the shared range, else null. */
export function parseTeeth(value) {
  if (isEmpty(value)) return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < GEAR_TEETH_MIN || n > GEAR_TEETH_MAX) return null
  return n
}

/**
 * Validates a chainring/cog pair.
 * Both empty is valid (no gear); one empty or an out-of-range value is an error.
 * @returns {{ chainring: number|null, cog: number|null, empty: boolean, valid: boolean, error: string|null }}
 */
export function parseGear(chainring, cog) {
  const emptyC = isEmpty(chainring)
  const emptyG = isEmpty(cog)
  if (emptyC && emptyG) return { chainring: null, cog: null, empty: true, valid: true, error: null }
  const range = `${GEAR_TEETH_MIN}-${GEAR_TEETH_MAX}`
  const fail = (error) => ({ chainring: null, cog: null, empty: false, valid: false, error })
  if (emptyC || emptyG) return fail('Enter both chainring and cog, or leave both empty')
  const c = parseTeeth(chainring)
  if (c == null) return fail(`Chainring must be a whole number of teeth (${range})`)
  const g = parseTeeth(cog)
  if (g == null) return fail(`Cog must be a whole number of teeth (${range})`)
  return { chainring: c, cog: g, empty: false, valid: true, error: null }
}

/** Gear ratio (chainring / cog), or null when the gear is empty/invalid. */
export function gearRatio(chainring, cog) {
  const g = parseGear(chainring, cog)
  return g.valid && !g.empty ? g.chainring / g.cog : null
}

/** Gear inches (default: 700c track wheel), or null when the gear is empty/invalid. */
export function gearInchesFor(chainring, cog, wheelInches = TRACK_WHEEL_DIAMETER_INCHES) {
  const r = gearRatio(chainring, cog)
  return r == null ? null : r * wheelInches
}

/** Development in metres per crank revolution, or null when the gear is empty/invalid. */
export function gearDevelopment(chainring, cog) {
  const g = parseGear(chainring, cog)
  return g.valid && !g.empty ? gearDevelopmentM(g.chainring, g.cog) : null
}

/** "52x14" label, or '' when empty. */
export function gearLabel(chainring, cog) {
  const g = parseGear(chainring, cog)
  return g.valid && !g.empty ? `${g.chainring}x${g.cog}` : ''
}

/** Form string for a stored value (null/0 -> ''). */
export function toGearField(value) {
  return value ? String(value) : ''
}

/** Normalises a profile row into saved-default gear fields ('' when unset or partial). */
export function gearDefaultFromProfile(profile) {
  const g = parseGear(profile?.default_chainring, profile?.default_cog)
  return g.valid && !g.empty
    ? { chainring: String(g.chainring), cog: String(g.cog) }
    : { chainring: '', cog: '' }
}

/**
 * Loads the saved gear default of ONE explicit owner (never relies on RLS scoping, see docs/coaching.md).
 * Returns empty strings when the owner has no default.
 */
export async function fetchGearDefault(client, ownerId) {
  if (!ownerId) return { chainring: '', cog: '' }
  const { data } = await client
    .from('profiles')
    .select('default_chainring, default_cog')
    .eq('id', ownerId)
    .maybeSingle()
  return gearDefaultFromProfile(data)
}
