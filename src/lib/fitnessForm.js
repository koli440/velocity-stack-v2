// Fitness / Fatigue / Form (performance management chart, issue #290).
// Pure helpers: daily load aggregation, exponentially weighted Fitness (CTL, 42 d) and Fatigue
// (ATL, 7 d), Form (TSB), ramp rate and the "building baseline" flag. Computed on read from the
// activity rows; nothing is stored. Estimated loads (HR based) are only ever kept in memory and are
// never written to activities.training_load. Reusable by the coach view (pass the rider's rows).

import { resolveLtAt } from './lactateThresholds.js'

export const FITNESS_DAYS = 42
export const FATIGUE_DAYS = 7
export const BASELINE_DAYS = 42
export const RAMP_WARN_PER_WEEK = 8
export const RAMP_HIGH_PER_WEEK = 5
// Older history than the displayed range only warms up the averages; 6 months leaves ~1% error.
export const WARMUP_DAYS = 180
export const FITNESS_RANGES = Object.freeze([
  { key: '6w', label: '6 weeks', days: 42 },
  { key: '12w', label: '12 weeks', days: 84 },
  { key: '6m', label: '6 months', days: 182 },
  { key: '1y', label: '1 year', days: 365 },
])
export const FITNESS_ACTIVITY_COLUMNS =
  'id, activity_date, training_load, moving_time_s, elapsed_time_s, duration_sec, avg_hr, lt2_hr_at_activity'

const DAY_MS = 86400000
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round1 = (n) => Math.round(n * 10) / 10

/** Local calendar day key (YYYY-MM-DD) of a Date / ISO string, or '' if invalid. */
export function localDayKey(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const dayNumber = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS)
const dayFromNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10)

export function addDays(key, days) {
  return dayFromNumber(dayNumber(key) + days)
}

export function daysBetween(fromKey, toKey) {
  return dayNumber(toKey) - dayNumber(fromKey)
}

function rideSeconds(a) {
  return num(a.moving_time_s) ?? num(a.elapsed_time_s) ?? num(a.duration_sec) ?? 0
}

/**
 * Load of one ride: { load, estimated } or null when it can't be scored.
 * Stored training_load (power/FTP in effect on the ride date, set at import) wins. Without it an
 * hrTSS-style estimate is used: hours x (avg HR / threshold HR)^2 x 100, with the threshold HR taken
 * from the ride's LT2 snapshot or the lactate-threshold history valid on that date. No threshold HR
 * or no average HR/duration -> skipped (no duration-only guess: it would ignore intensity entirely).
 */
export function activityLoad(activity, ltHistory = []) {
  const stored = num(activity?.training_load)
  if (stored !== null && stored >= 0) return { load: stored, estimated: false }
  const secs = rideSeconds(activity || {})
  const avgHr = num(activity?.avg_hr)
  if (!(secs >= 300 && secs <= 86400) || avgHr === null || avgHr < 40 || avgHr > 230) return null
  const lthr = num(activity.lt2_hr_at_activity) ?? num(resolveLtAt(ltHistory, localDayKey(activity.activity_date))?.lt2_hr)
  if (lthr === null || lthr < 30 || lthr > 250) return null
  const intensity = Math.min(avgHr / lthr, 1.15)
  return { load: round1((secs / 3600) * intensity * intensity * 100), estimated: true }
}

/**
 * Daily totals keyed by local day: { [day]: { load, estimatedLoad, rides, estimatedRides } } where
 * `load` is the full day total and `estimatedLoad` the part that came from HR estimates.
 * `skipped` counts rides that had neither a stored load nor a usable estimate.
 */
export function dailyLoads(activities, ltHistory = []) {
  const days = {}
  let skipped = 0
  for (const a of activities || []) {
    const day = localDayKey(a?.activity_date)
    if (!day) continue
    const r = activityLoad(a, ltHistory)
    if (!r) {
      skipped += 1
      continue
    }
    const d = (days[day] ||= { load: 0, estimatedLoad: 0, rides: 0, estimatedRides: 0 })
    d.load += r.load
    d.rides += 1
    if (r.estimated) {
      d.estimatedLoad += r.load
      d.estimatedRides += 1
    }
  }
  return { days, skipped }
}

/**
 * Day-by-day series from `startDay` to `endDay` (inclusive). Averages are seeded at 0 the day before the
 * first day with data (or `startDay`, if later days only), then updated with
 * x = x_prev + (load - x_prev) / tau. Rest days count as 0 load. Form on a day is the PREVIOUS day's
 * Fitness minus Fatigue, so it describes how fresh the rider was walking into that day.
 * Entries before the first load are omitted; `startDay` earlier than the data just trims leading zeros.
 */
export function computeSeries(days, { startDay, endDay, fitnessDays = FITNESS_DAYS, fatigueDays = FATIGUE_DAYS } = {}) {
  const keys = Object.keys(days || {}).sort()
  if (!keys.length || !endDay) return []
  const first = keys[0]
  let ctl = 0
  let atl = 0
  const out = []
  for (let d = first; d <= endDay; d = addDays(d, 1)) {
    const entry = days[d]
    const load = entry?.load ?? 0
    const form = ctl - atl
    ctl += (load - ctl) / fitnessDays
    atl += (load - atl) / fatigueDays
    if (!startDay || d >= startDay) {
      out.push({
        day: d,
        load: round1(load),
        estimatedLoad: round1(entry?.estimatedLoad ?? 0),
        fitness: round1(ctl),
        fatigue: round1(atl),
        form: round1(form),
      })
    }
  }
  return out
}

/** Fitness gained per week: today's Fitness minus the value 7 days earlier (null if not enough data). */
export function rampRate(series) {
  if (!series || series.length < 8) return null
  return round1(series[series.length - 1].fitness - series[series.length - 8].fitness)
}

/** null | 'high' (>= 5/wk, build carefully) | 'warning' (> 8/wk, rapid ramp). */
export function rampLevel(ramp) {
  if (ramp === null || ramp === undefined) return null
  if (ramp > RAMP_WARN_PER_WEEK) return 'warning'
  if (ramp >= RAMP_HIGH_PER_WEEK) return 'high'
  return null
}

/** True while less than ~6 weeks separate the first data day and `today` (values still settling). */
export function isBuildingBaseline(firstDay, today) {
  if (!firstDay || !today) return false
  return daysBetween(firstDay, today) < BASELINE_DAYS
}

/** Plain-language label for a Form value. */
export function formStatus(form) {
  if (form === null || form === undefined || !Number.isFinite(form)) return { key: 'unknown', label: 'No data yet' }
  if (form > 25) return { key: 'detraining', label: 'Very fresh - fitness may be fading' }
  if (form > 5) return { key: 'fresh', label: 'Fresh - ready to race' }
  if (form >= -10) return { key: 'neutral', label: 'Neutral' }
  if (form >= -30) return { key: 'productive', label: 'Productive training load' }
  return { key: 'overreaching', label: 'Very tired - risk of overreaching' }
}

/** Share (0-1) of the load in the series that came from HR estimates; null with no load. */
export function estimateShare(series) {
  let total = 0
  let est = 0
  for (const p of series || []) {
    total += p.load
    est += p.estimatedLoad
  }
  return total > 0 ? est / total : null
}

/** Today's snapshot for the dashboard card. `today` is a local day key. */
export function fitnessSummary(days, today, firstDay = null) {
  const series = computeSeries(days, { endDay: today })
  const last = series[series.length - 1]
  if (!last) return { empty: true, series: [] }
  const ramp = rampRate(series)
  const recent = series.filter((p) => daysBetween(p.day, today) < 42)
  return {
    empty: false,
    series,
    fitness: last.fitness,
    fatigue: last.fatigue,
    form: last.form,
    status: formStatus(last.form),
    ramp,
    rampLevel: rampLevel(ramp),
    building: isBuildingBaseline(firstDay || Object.keys(days).sort()[0], today),
    estimateShare: estimateShare(recent),
  }
}

/** Activity rows for the series, newest window only (`days` + warm-up), paginated past the 1000-row cap. */
export async function fetchFitnessActivities(client, { userId, days = 365, now = new Date(), pageSize = 1000 } = {}) {
  if (!userId) return { data: [], firstDay: null, error: null }
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days - WARMUP_DAYS).toISOString()
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('activities')
      .select(FITNESS_ACTIVITY_COLUMNS)
      .eq('user_id', userId)
      .eq('activity_type', 'ride')
      .gte('activity_date', since)
      .order('activity_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) return { data: [], firstDay: null, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  const { data: earliest, error: firstError } = await client
    .from('activities')
    .select('activity_date')
    .eq('user_id', userId)
    .eq('activity_type', 'ride')
    .order('activity_date', { ascending: true })
    .limit(1)
  if (firstError) return { data: [], firstDay: null, error: firstError }
  return { data: rows, firstDay: earliest?.[0] ? localDayKey(earliest[0].activity_date) : null, error: null }
}
