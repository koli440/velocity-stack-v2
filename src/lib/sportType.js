// src/lib/sportType.js
//
// One source-independent sport model. Every import path (Strava, Intervals.icu, Wahoo, Garmin, .fit upload / bulk
// import) maps its own type names to a canonical sport key here, and the workload computation, the calendar and the
// activity feed all read the same keys.
//
// A canonical sport is stored as:
//   activities.activity_type  'ride' | 'run' | 'gym'
//   activities.ride_type      the flavour: road (default, unset), mtb, gravel, ebike, indoor, virtual, track (rides)
//                             run, trail_run, treadmill_run (runs); null for gym sessions
// Anything else (swim, walk, ski...) maps to null and is not imported by the providers.

export const RIDE_SPORTS = Object.freeze(['road', 'mtb', 'gravel', 'ebike', 'indoor', 'virtual'])
export const RUN_SPORTS = Object.freeze(['run', 'trail_run', 'treadmill_run'])

/** key -> { activityType, rideType, label, icon, tone }. `rideType` is null where the DB default applies. */
export const SPORTS = Object.freeze({
  road: { activityType: 'ride', rideType: null, label: 'Ride', icon: 'bike', tone: 'emerald' },
  mtb: { activityType: 'ride', rideType: 'mtb', label: 'MTB', icon: 'mountain', tone: 'emerald' },
  gravel: { activityType: 'ride', rideType: 'gravel', label: 'Gravel', icon: 'gravel', tone: 'emerald' },
  ebike: { activityType: 'ride', rideType: 'ebike', label: 'E-bike', icon: 'ebike', tone: 'emerald' },
  indoor: { activityType: 'ride', rideType: 'indoor', label: 'Indoor ride', icon: 'trainer', tone: 'emerald' },
  virtual: { activityType: 'ride', rideType: 'virtual', label: 'Virtual ride', icon: 'trainer', tone: 'emerald' },
  run: { activityType: 'run', rideType: 'run', label: 'Run', icon: 'run', tone: 'sky' },
  trail_run: { activityType: 'run', rideType: 'trail_run', label: 'Trail run', icon: 'run', tone: 'sky' },
  treadmill_run: { activityType: 'run', rideType: 'treadmill_run', label: 'Treadmill run', icon: 'run', tone: 'sky' },
  gym: { activityType: 'gym', rideType: null, label: 'Gym', icon: 'flame', tone: 'violet' },
})

export const RUN_RIDE_TYPES = Object.freeze(['run', 'trail_run', 'treadmill_run'])
export const isRunRideType = (v) => RUN_RIDE_TYPES.includes(v)

export const sportInfo = (key) => (key && SPORTS[key]) || null

// ---- Provider mappings ----

const STRAVA = {
  Ride: 'road', Handcycle: 'road', VirtualRide: 'virtual', EBikeRide: 'ebike', EMountainBikeRide: 'ebike',
  GravelRide: 'gravel', MountainBikeRide: 'mtb',
  Run: 'run', TrailRun: 'trail_run', VirtualRun: 'treadmill_run',
  WeightTraining: 'gym', Workout: 'gym', Crossfit: 'gym', HighIntensityIntervalTraining: 'gym',
}
// Intervals.icu uses the same activity type names as Strava.
export const sportFromStrava = (type) => STRAVA[type] ?? null
export const sportFromIntervals = sportFromStrava

const WAHOO = {
  0: 'road', 11: 'gravel', 12: 'indoor', 13: 'mtb', 14: 'road', 15: 'road', 16: 'road', 49: 'indoor', 61: 'indoor',
  64: 'ebike', 68: 'virtual', 70: 'road',
  1: 'run', 3: 'run', 4: 'trail_run', 5: 'treadmill_run', 67: 'run', 71: 'treadmill_run',
  42: 'gym', 43: 'gym',
}
export const sportFromWahoo = (typeId) => WAHOO[Number(typeId)] ?? null

const GARMIN_RIDES = {
  CYCLING: 'road', ROAD_BIKING: 'road', TRACK_CYCLING: 'road', RECUMBENT_CYCLING: 'road', BMX: 'road',
  MOUNTAIN_BIKING: 'mtb', DOWNHILL_BIKING: 'mtb', ENDURO_MTB: 'mtb', E_ENDURO_MTB: 'ebike', E_BIKE_MOUNTAIN: 'ebike', E_BIKE_FITNESS: 'ebike',
  GRAVEL_CYCLING: 'gravel', CYCLOCROSS: 'gravel',
  INDOOR_CYCLING: 'indoor', VIRTUAL_RIDE: 'virtual', HANDCYCLING: 'road',
  RUNNING: 'run', STREET_RUNNING: 'run', TRACK_RUNNING: 'run', TRAIL_RUNNING: 'trail_run', ULTRA_RUN: 'trail_run',
  TREADMILL_RUNNING: 'treadmill_run', INDOOR_RUNNING: 'treadmill_run', VIRTUAL_RUN: 'treadmill_run',
  STRENGTH_TRAINING: 'gym',
}
/** Garmin Activity API appendix A name -> canonical sport (null = not imported, 'unknown' handled by the caller). */
export const sportFromGarminType = (type) => GARMIN_RIDES[String(type ?? '').trim().toUpperCase().replace(/_V2$/, '')] ?? null

/** FIT session sport / sub_sport (as printed by analyze.py) -> canonical sport; null when not cycling or running. */
export function sportFromFit(summary) {
  if (summary?.activity_type === 'gym') return 'gym'
  const sport = String(summary?.sport ?? '').toLowerCase()
  const sub = String(summary?.sub_sport ?? '').toLowerCase()
  if (sport === 'cycling' || sport === 'e_biking') {
    if (sport === 'e_biking' || sub.startsWith('e_bike')) return 'ebike'
    if (sub === 'mountain' || sub === 'downhill') return 'mtb'
    if (sub === 'gravel_cycling' || sub === 'cyclocross') return 'gravel'
    if (sub === 'virtual_activity') return 'virtual'
    if (sub === 'indoor_cycling' || sub === 'spin' || sub === 'generic_indoor') return 'indoor'
    return 'road'
  }
  if (sport === 'running') {
    if (sub === 'trail') return 'trail_run'
    if (sub === 'treadmill' || sub === 'indoor_running' || sub === 'virtual_activity') return 'treadmill_run'
    return 'run'
  }
  return null
}

/**
 * Ride type to store: runs always use their own flavour; for rides a detected non-road flavour wins over the
 * rider's chosen / default type, while plain road keeps the rider's choice (e.g. a track default).
 */
export function resolveRideType(sport, chosen) {
  const info = sportInfo(sport)
  if (!info) return chosen ?? null
  if (info.activityType === 'run') return info.rideType
  if (info.activityType === 'gym') return null
  return info.rideType || chosen || null
}

// ---- Presentation ----

/** What an activity row looks like in lists: { key, label, icon, tone }. Track sessions keep their own look. */
export function activitySport(a) {
  const type = a?.activity_type ?? a?.activityType
  if (type === 'gym') return { key: 'gym', ...pick(SPORTS.gym) }
  const rideType = a?.ride_type ?? a?.rideType
  if (type === 'run') return { key: isRunRideType(rideType) ? rideType : 'run', ...pick(SPORTS[isRunRideType(rideType) ? rideType : 'run']) }
  if (a?.track_id || a?.trackId || a?.tracks?.name || rideType === 'track') return { key: 'track', label: 'Track', icon: 'velodrome', tone: 'amber' }
  const key = RIDE_SPORTS.includes(rideType) ? rideType : 'road'
  return { key, ...pick(SPORTS[key]) }
}

const pick = ({ label, icon, tone }) => ({ label, icon, tone })

export const isRunActivity = (a) => (a?.activity_type ?? a?.activityType) === 'run'

/** A non-default sport worth a tag in lists: runs and non-road ride flavours (road rides, track and gym have their own). */
export const isSportFlavour = (a) => {
  const type = a?.activity_type ?? a?.activityType
  if (type === 'run') return true
  if (type === 'gym') return false
  const key = activitySport(a).key
  return key !== 'road' && key !== 'track'
}

export const SPORT_TAG_CLASS = Object.freeze({
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
})
export const SPORT_TEXT_CLASS = Object.freeze({
  emerald: 'text-emerald-600 dark:text-emerald-400',
  sky: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
  amber: 'text-amber-600 dark:text-amber-400',
})
