// Ride types: an extensible list mirrored by the public.ride_types table (migration
// 20261225000000). Add a row there and an entry here to introduce a new type.
// `hasGear` controls whether the gear UI (multiple gears + segments) is shown.

export const DEFAULT_RIDE_TYPE = 'road'

export const RIDE_TYPES = Object.freeze([
  { key: 'road', label: 'Road', hasGear: false },
  { key: 'track', label: 'Track', hasGear: true },
])

/** Unset / unknown-empty values are treated as the application default (road). */
export function effectiveRideType(value) {
  return typeof value === 'string' && value ? value : DEFAULT_RIDE_TYPE
}

export function rideTypeLabel(value) {
  const key = effectiveRideType(value)
  return RIDE_TYPES.find((t) => t.key === key)?.label ?? key
}

/** Gear UI and fixed-gear gear stats apply to track rides only. */
export function rideTypeHasGear(value) {
  return RIDE_TYPES.find((t) => t.key === effectiveRideType(value))?.hasGear === true
}

export function isKnownRideType(value) {
  return RIDE_TYPES.some((t) => t.key === value)
}

/**
 * THE rule for whether a ride's stored gear counts (activity detail, feed, Gear Architect records, PB prefill):
 * only track rides use gear. An unset ride type (legacy rows) is road, exactly like the activity detail, so
 * stored chainring/cog on such a ride is never read as a used gear. Race tag and gear are independent.
 */
export function activityHasGear(activity) {
  return rideTypeHasGear(activity?.ride_type)
}
