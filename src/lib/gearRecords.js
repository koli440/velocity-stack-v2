// Gear Architect records (issue #294): for the selected gear, the PB Vault records and the race rides
// (activities tagged "race", see raceTag.js) that used it. Per-segment gears count as used (#280).
// Own-account queries filter by owner explicitly (docs/coaching.md); this is never an athlete-context page.

import { parseGear } from './gear.js'
import { activityHasGear } from './rideType.js'
import { resolveGears, resolveSegments } from './gearSegments.js'
import { scopeToOwner } from './ownerScope.js'

export const MAX_GEAR_RECORD_RIDES = 500

const RACE_RIDE_COLUMNS =
  'id, title, activity_date, ride_type, chainring, cog, gears, gear_segments, avg_power_w, max_power_w, moving_time_s, elapsed_time_s, distance_m, tracks(name)'
const PB_COLUMNS =
  'id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog'
const LINKED_RACE_COLUMNS = 'id, name, location, race_date, activity_id'

const dayOf = (v) => String(v || '').slice(0, 10)
const sameGear = (g, chainring, cog) => g.chainring === chainring && g.cog === cog

/**
 * The gears a ride actually used: the primary gear plus every gear a segment refers to. Rides with an
 * explicit ride type without gear (road) hide their stored gear, so they use none.
 * @returns {Array<{ id: string, chainring: number, cog: number, note: string, role: 'primary'|'segment' }>}
 */
export function gearsUsed(activity) {
  if (!activityHasGear(activity)) return []
  const gears = resolveGears(activity)
  if (!gears.length) return []
  const inSegments = new Set(resolveSegments(activity).map((s) => s.gear_id))
  return gears
    .map((g, i) => ({ ...g, role: i === 0 ? 'primary' : 'segment' }))
    .filter((g, i) => i === 0 || inSegments.has(g.id))
}

/** True when the ride used the gear, as primary gear or in any gear segment. */
export function activityUsesGear(activity, chainring, cog) {
  return gearsUsed(activity).some((g) => sameGear(g, chainring, cog))
}

/** Normalises a gear selection to integers, or null for an empty / invalid gear. */
export function selectedGear(chainring, cog) {
  const p = parseGear(chainring, cog)
  return p.valid && !p.empty ? { chainring: p.chainring, cog: p.cog } : null
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/**
 * Pure assembly of the Gear Architect record lists. `pbs` are personal_bests rows, `activities` race-tagged
 * activity rows, `races` calendar_races rows (their activity_id links a ride to its event). Both lists are
 * newest first. A race ride shows the linked calendar race's name and location when there is one, else the
 * activity title and its velodrome.
 */
export function buildGearRecords({ chainring, cog, pbs = [], activities = [], races = [] }) {
  const gear = selectedGear(chainring, cog)
  if (!gear) return { pbRecords: [], raceRecords: [] }
  const raceByActivity = new Map((races || []).filter((r) => r?.activity_id).map((r) => [r.activity_id, r]))

  const pbRecords = (pbs || [])
    .filter((p) => p && sameGear({ chainring: num(p.chainring), cog: num(p.cog) }, gear.chainring, gear.cog))
    .map((p) => ({
      id: p.id,
      date: dayOf(p.achieved_date),
      event: p.event_name || p.discipline || '',
      venue: p.track_name || '',
      discipline: p.discipline || '',
      timeSeconds: num(p.time_seconds),
      avgSpeedKmh: num(p.avg_speed_kmh),
      gearLabel: `${gear.chainring}x${gear.cog}`,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)))

  const raceRecords = []
  for (const a of activities || []) {
    if (a?.is_race === false) continue
    const used = gearsUsed(a).find((g) => sameGear(g, gear.chainring, gear.cog))
    if (!used) continue
    const race = raceByActivity.get(a.id)
    raceRecords.push({
      id: a.id,
      date: dayOf(race?.race_date || a.activity_date),
      event: race?.name || a.title || '',
      venue: race?.location || a.tracks?.name || '',
      gearLabel: `${gear.chainring}x${gear.cog}`,
      gearRole: used.role,
      avgPowerW: num(a.avg_power_w),
      maxPowerW: num(a.max_power_w),
      timeSeconds: num(a.moving_time_s) ?? num(a.elapsed_time_s),
      distanceM: num(a.distance_m),
    })
  }
  raceRecords.sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)))
  return { pbRecords, raceRecords }
}

/**
 * Loads PB Vault records and race rides of ONE explicit owner for the selected gear. Race rides are matched
 * on the client because per-segment gears live in a jsonb list; PBs are filtered by gear in the database.
 */
export async function fetchGearRecords(client, ownerId, chainring, cog) {
  const gear = selectedGear(chainring, cog)
  if (!ownerId || !gear) return { pbRecords: [], raceRecords: [], truncated: false, error: null }

  const [pbRes, actRes, raceRes] = await Promise.all([
    scopeToOwner(client.from('personal_bests').select(PB_COLUMNS), ownerId)
      .eq('chainring', gear.chainring)
      .eq('cog', gear.cog)
      .order('achieved_date', { ascending: false }),
    scopeToOwner(client.from('activities').select(RACE_RIDE_COLUMNS), ownerId)
      .eq('is_race', true)
      .order('activity_date', { ascending: false })
      .limit(MAX_GEAR_RECORD_RIDES),
    scopeToOwner(client.from('calendar_races').select(LINKED_RACE_COLUMNS), ownerId, 'rider_id').not('activity_id', 'is', null),
  ])
  const error = pbRes.error || actRes.error || raceRes.error || null
  if (error) return { pbRecords: [], raceRecords: [], truncated: false, error }
  const activities = (actRes.data || []).map((a) => ({ ...a, is_race: true }))
  return {
    ...buildGearRecords({ chainring: gear.chainring, cog: gear.cog, pbs: pbRes.data || [], activities, races: raceRes.data || [] }),
    truncated: activities.length >= MAX_GEAR_RECORD_RIDES,
    error: null,
  }
}
