// Single source of truth for how ride sources are presented to riders, in priority order:
// Garmin, Wahoo, SRM, Intervals.icu, Strava. Cards on /connections, onboarding and docs follow it.
//
// `kind`: 'connect' = OAuth/API integration card, 'import' = file import (no cloud API).
// `status: 'coming-soon'` renders a placeholder card. To ship Garmin, build the card component,
// map it in ConnectionsPage and flip the Garmin entry below to `status: 'available'`.
export const CONNECTIONS_PATH = '/connections'

export const RIDE_SOURCES = [
  {
    id: 'garmin',
    name: 'Garmin',
    kind: 'connect',
    status: 'coming-soon',
    blurb: 'Direct connection to Garmin Connect. Coming soon; until then, import .fit files or use Intervals.icu.',
  },
  {
    id: 'wahoo',
    name: 'Wahoo',
    kind: 'connect',
    status: 'available',
    blurb: 'Rides from your Wahoo devices, directly from Wahoo Cloud.',
  },
  {
    id: 'srm',
    name: 'SRM',
    kind: 'import',
    status: 'available',
    blurb: 'SRM (PC8/PC7/PC6/PC5): import .fit files. SRM has no cloud sync, so copy the files off the head unit and import them.',
    href: '/import-help',
    hrefLabel: 'How to get your SRM files',
  },
  {
    id: 'intervals',
    name: 'Intervals.icu',
    kind: 'connect',
    status: 'available',
    blurb: 'The bridge for Zwift, MyWhoosh and other platforms, and for Garmin or Wahoo rides that reach you through Intervals.icu.',
  },
  {
    id: 'strava',
    name: 'Strava',
    kind: 'connect',
    status: 'available',
    blurb: 'Secondary source: Strava limits how much its API may be read, so use a direct source above when you can.',
  },
]

export const RIDE_SOURCE_IDS = RIDE_SOURCES.map((s) => s.id)

export function rideSourceById(id) {
  return RIDE_SOURCES.find((s) => s.id === id) || null
}

/** "Garmin, Wahoo, SRM, Intervals.icu or Strava" */
export function rideSourceNames(sources = RIDE_SOURCES) {
  const names = sources.map((s) => s.name)
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}
