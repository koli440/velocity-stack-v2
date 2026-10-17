// Power zones Z1-Z6 (issue #194): LT-based, user-editable, effective-dated like FTP/LT/weight.
//
// Boundaries are upper bounds in percent: Z1/Z2 relative to LT1 power, Z3/Z4/Z5 relative to LT2
// power. Defaults: Z1 <75% LT1, Z2 75-100% LT1, Z3 LT1-LT2, Z4 100-105% LT2, Z5 105-120% LT2,
// Z6 >120% LT2. When an activity has no LT power for its date, LT1/LT2 are estimated from FTP
// (LT1 ~ 75% FTP, LT2 ~ 100% FTP) and the zones are flagged as estimated.
// An activity snapshots the boundary percentages valid on its date (power_zone_pcts_at_activity,
// set by a DB trigger; NULL = defaults) and resolves them against its own LT/FTP snapshots, so
// old analyses stay stable when the athlete later changes anything.

export const ZONE_COUNT = 6
export const DEFAULT_ZONE_PCTS = [75, 100, 100, 105, 120]
export const ZONE_PCT_FIELDS = ['z1_max_pct', 'z2_max_pct', 'z3_max_pct', 'z4_max_pct', 'z5_max_pct']
export const ZONE_SNAPSHOT_COLUMN = 'power_zone_pcts_at_activity'
export const FTP_LT1_FRACTION = 0.75
export const FTP_LT2_FRACTION = 1

export const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic']

export function zoneLabel(zone) {
  return `Z${zone}`
}

function dayOf(date) {
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  return String(date || '').slice(0, 10)
}

/** Validates a form entry; returns { error } or { entry }. */
export function validateZoneEntry(raw) {
  const date = String(raw?.effective_from || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Enter a valid effective date' }
  }
  const entry = { effective_from: date }
  for (const key of ZONE_PCT_FIELDS) {
    const text = String(raw?.[key] ?? '').trim()
    const n = Number(text)
    if (text === '' || !Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 300) {
      return { error: `Z${key[1]} upper bound must be a whole percentage between 1 and 300` }
    }
    entry[key] = n
  }
  if (entry.z1_max_pct >= entry.z2_max_pct) return { error: 'Z1 upper bound must be lower than Z2 upper bound (both % of LT1)' }
  if (entry.z3_max_pct >= entry.z4_max_pct || entry.z4_max_pct >= entry.z5_max_pct) {
    return { error: 'Z3, Z4 and Z5 upper bounds (% of LT2) must be strictly increasing' }
  }
  return { entry }
}

/** History entry valid on `date` (latest effective_from <= date), or null. */
export function resolveZonesAt(history, date) {
  const day = dayOf(date)
  if (!day || !Array.isArray(history)) return null
  let best = null
  for (const h of history) {
    if (!h?.effective_from || h.effective_from > day) continue
    if (!best || h.effective_from > best.effective_from) best = h
  }
  return best
}

/** [z1..z5] percentages of a history entry, or null. */
export function zonePctsFromEntry(entry) {
  if (!entry) return null
  return normalizePcts(ZONE_PCT_FIELDS.map((k) => entry[k]))
}

/** Percentages snapshotted on an activity row; null when it uses the defaults. */
export function zonePctsFromActivity(activity) {
  return normalizePcts(activity?.[ZONE_SNAPSHOT_COLUMN])
}

function normalizePcts(arr) {
  if (!Array.isArray(arr) || arr.length !== 5) return null
  const out = arr.map(Number)
  if (!out.every((n) => Number.isFinite(n) && n > 0)) return null
  if (out[0] >= out[1] || out[2] >= out[3] || out[3] >= out[4]) return null
  return out
}

/**
 * Resolves watts boundaries. `lt` is { lt1Power, lt2Power } (see ltFromActivity); `ftp` the FTP
 * snapshot used when an LT power is missing. Returns null when zones cannot be derived.
 * @returns {{ bounds: number[], lt1: number, lt2: number, pcts: number[], estimated: boolean,
 *   source: 'lt'|'ftp'|'lt+ftp' } | null}
 */
export function computeZones({ lt = null, ftp = null, pcts = null } = {}) {
  const p = normalizePcts(pcts) || DEFAULT_ZONE_PCTS
  const lt1Known = Number(lt?.lt1Power) > 0 ? Number(lt.lt1Power) : null
  const lt2Known = Number(lt?.lt2Power) > 0 ? Number(lt.lt2Power) : null
  const ftpW = Number(ftp) > 0 ? Number(ftp) : null
  const lt1 = lt1Known ?? (ftpW ? ftpW * FTP_LT1_FRACTION : null)
  const lt2 = lt2Known ?? (ftpW ? ftpW * FTP_LT2_FRACTION : null)
  if (!lt1 || !lt2 || lt1 >= lt2) return null
  const bounds = [
    (lt1 * p[0]) / 100,
    (lt1 * p[1]) / 100,
    (lt2 * p[2]) / 100,
    (lt2 * p[3]) / 100,
    (lt2 * p[4]) / 100,
  ].map(Math.round)
  for (let i = 1; i < bounds.length; i++) if (bounds[i] <= bounds[i - 1]) return null
  const estimated = lt1Known == null || lt2Known == null
  return {
    bounds,
    lt1: Math.round(lt1),
    lt2: Math.round(lt2),
    pcts: p,
    estimated,
    source: lt1Known != null && lt2Known != null ? 'lt' : lt1Known == null && lt2Known == null ? 'ftp' : 'lt+ftp',
  }
}

/** Zones for an activity row: its own LT, FTP and zone-percentage snapshots. */
export function zonesFromActivity(activity, lt = null) {
  return computeZones({
    lt: lt || {
      lt1Power: activity?.lt1_power_at_activity_w,
      lt2Power: activity?.lt2_power_at_activity_w,
    },
    ftp: activity?.ftp_at_activity_w,
    pcts: zonePctsFromActivity(activity),
  })
}

/** Why zones are unavailable, as a user-facing sentence. */
export const ZONES_UNAVAILABLE_MESSAGE =
  "No power zones could be derived for this activity's date: set LT1 and LT2 power (or an FTP) in your profile."

/** Zone rows for display: [{ zone, label, name, minW, maxW }] (minW null for Z1, maxW null for Z6). */
export function zoneRanges(zones) {
  if (!zones) return []
  const { bounds } = zones
  return Array.from({ length: ZONE_COUNT }, (_, i) => ({
    zone: i + 1,
    label: zoneLabel(i + 1),
    name: ZONE_NAMES[i],
    minW: i === 0 ? null : bounds[i - 1],
    maxW: i === ZONE_COUNT - 1 ? null : bounds[i],
  }))
}

/** "<150 W", "150–200 W", ">300 W" */
export function formatZoneRange(r) {
  if (r.minW == null) return `<${r.maxW} W`
  if (r.maxW == null) return `>${r.minW} W`
  return `${r.minW}–${r.maxW} W`
}

/** Zone (1-6) of a power value; a boundary value belongs to the zone above. Null for non-finite. */
export function zoneOfPower(zones, watts) {
  const v = Number(watts)
  if (!zones || watts == null || !Number.isFinite(v)) return null
  let z = 1
  while (z <= zones.bounds.length && v >= zones.bounds[z - 1]) z++
  return z
}

/** Parses a DSL zone number; integer 1-6 or null. */
export function isValidZone(n) {
  return Number.isInteger(n) && n >= 1 && n <= ZONE_COUNT
}

/**
 * Watts window of a DSL zone band. `powerMin`/`powerMax` are zone numbers: both set = from the
 * lower edge of the first zone to the upper edge of the last (inclusive; `Z3` has both equal);
 * only powerMax (`<Z2`) = below that zone; only powerMin (`>Z4`) = above that zone.
 * Returns { min, max } watts (null = open-ended) or null without zones.
 */
export function zoneBandWatts(zones, { powerMin, powerMax }) {
  if (!zones) return null
  const lower = (z) => (z <= 1 ? null : zones.bounds[z - 2])
  const upper = (z) => (z >= ZONE_COUNT ? null : zones.bounds[z - 1])
  if (powerMin != null && powerMax != null) return { min: lower(powerMin), max: upper(powerMax) }
  if (powerMax != null) return { min: null, max: lower(powerMax) }
  if (powerMin != null) return { min: upper(powerMin), max: null }
  return null
}

/** Seconds per zone (array of 6) in a ~1 Hz power stream; null without zones or samples. */
export function zoneSeconds(stream, zones) {
  if (!zones || !Array.isArray(stream)) return null
  const secs = Array(ZONE_COUNT).fill(0)
  let any = false
  for (const raw of stream) {
    if (raw == null || !Number.isFinite(Number(raw))) continue
    any = true
    secs[zoneOfPower(zones, raw) - 1]++
  }
  return any ? secs : null
}

/** Time-in-zone rows for the activity page: [{ zone, label, name, seconds, pct, minW, maxW }]. */
export function zoneBreakdown(stream, zones) {
  const secs = zoneSeconds(stream, zones)
  if (!secs) return []
  const total = secs.reduce((a, b) => a + b, 0)
  const ranges = zoneRanges(zones)
  return ranges.map((r, i) => ({ ...r, seconds: secs[i], pct: total ? Math.round((secs[i] / total) * 1000) / 10 : 0 }))
}

export async function fetchZoneHistory(supabase, userId) {
  const { data, error } = await supabase
    .from('power_zone_history')
    .select(`id, effective_from, ${ZONE_PCT_FIELDS.join(', ')}`)
    .eq('user_id', userId)
    .order('effective_from', { ascending: false })
  return { history: data || [], error }
}

export async function saveZoneEntry(supabase, { userId, entry, id = null }) {
  const row = { ...entry, user_id: userId }
  const q = id
    ? supabase.from('power_zone_history').update(row).eq('id', id).eq('user_id', userId)
    : supabase.from('power_zone_history').upsert(row, { onConflict: 'user_id,effective_from' })
  const { error } = await q
  return { error }
}

export async function deleteZoneEntry(supabase, { userId, id }) {
  const { error } = await supabase.from('power_zone_history').delete().eq('id', id).eq('user_id', userId)
  return { error }
}
