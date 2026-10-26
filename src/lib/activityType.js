// src/lib/activityType.js
//
// Activity type (issue #326): 'ride' (default, every existing activity) or 'gym' (strength / workout
// sessions). Pure helpers shared by the importers, the upload paths and the UI.

export const ACTIVITY_TYPES = Object.freeze(['ride', 'gym'])
export const DEFAULT_ACTIVITY_TYPE = 'ride'
export const ACTIVITY_TYPE_LABELS = Object.freeze({ ride: 'Ride', gym: 'Gym' })

/** Unknown / missing values are rides (existing rows have no type in older payloads). */
export function normalizeActivityType(value) {
  return ACTIVITY_TYPES.includes(value) ? value : DEFAULT_ACTIVITY_TYPE
}

export const isGymActivity = (a) => normalizeActivityType(a?.activity_type ?? a?.activityType) === 'gym'

/** Strava `sport_type` / Intervals.icu `type` values that are gym sessions. */
export const GYM_SPORT_TYPES = Object.freeze(['WeightTraining', 'Workout', 'Crossfit', 'HighIntensityIntervalTraining'])
export const isGymSportType = (type) => GYM_SPORT_TYPES.includes(type)

