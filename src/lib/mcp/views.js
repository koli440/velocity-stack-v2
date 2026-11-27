// Pure output shaping for the MCP tools (docs/mcp.md): compact, GPS-free views of activities, splits, template
// results and fitness. No I/O.

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

export const ACTIVITY_SUMMARY_COLUMNS =
  'id, title, description, activity_date, activity_type, ride_type, track_id, elapsed_time_s, moving_time_s, duration_sec, distance_m, ' +
  'avg_speed_kmh, max_speed_kmh, avg_power_w, max_power_w, normalized_power_w, intensity_factor, training_load, avg_hr, max_hr, ' +
  'avg_cadence_rpm, elevation_gain_m, calories, ftp_at_activity_w, weight_at_activity_kg, source'

/** One activity row -> compact summary (units in the key names). */
export function activitySummaryView(a, linked = null) {
  if (!a) return null
  const date = typeof a.activity_date === 'string' ? a.activity_date : a.activity_date ? new Date(a.activity_date).toISOString() : null
  return {
    id: a.id,
    title: a.title,
    description: a.description || null,
    start: date,
    date: date ? date.slice(0, 10) : null,
    type: a.activity_type || 'ride',
    ride_type: a.ride_type || null,
    on_track: !!a.track_id,
    source: a.source || null,
    elapsed_time_s: round(num(a.elapsed_time_s) ?? num(a.duration_sec)),
    moving_time_s: round(num(a.moving_time_s)),
    distance_km: num(a.distance_m) == null ? null : round(num(a.distance_m) / 1000, 2),
    avg_speed_kmh: round(num(a.avg_speed_kmh), 1),
    max_speed_kmh: round(num(a.max_speed_kmh), 1),
    avg_power_w: round(num(a.avg_power_w)),
    normalized_power_w: round(num(a.normalized_power_w)),
    max_power_w: round(num(a.max_power_w)),
    intensity_factor: round(num(a.intensity_factor), 2),
    training_load: round(num(a.training_load)),
    avg_hr_bpm: round(num(a.avg_hr)),
    max_hr_bpm: round(num(a.max_hr)),
    avg_cadence_rpm: round(num(a.avg_cadence_rpm)),
    elevation_gain_m: round(num(a.elevation_gain_m)),
    calories_kcal: round(num(a.calories)),
    ftp_at_activity_w: round(num(a.ftp_at_activity_w)),
    weight_at_activity_kg: round(num(a.weight_at_activity_kg), 1),
    planned_workout: linked ? { id: linked.id, title: linked.title, date: linked.workout_date } : null,
  }
}

const meanOf = (arr) => {
  let s = 0
  let n = 0
  for (const v of arr) {
    const x = num(v)
    if (x == null) continue
    s += x
    n++
  }
  return n ? s / n : null
}
const maxOf = (arr) => {
  let m = null
  for (const v of arr) {
    const x = num(v)
    if (x != null && (m == null || x > m)) m = x
  }
  return m
}

export const MAX_SPLITS = 120

/**
 * Fixed-length blocks over the ~1 Hz streams: [{ start_s, duration_s, avg_power_w, max_power_w, avg_hr_bpm,
 * avg_cadence_rpm, avg_speed_kmh }]. The block grows when the ride would give more than MAX_SPLITS blocks.
 */
export function computeSplits(timeSeries, splitMinutes = 5) {
  const ts = timeSeries && typeof timeSeries === 'object' ? timeSeries : {}
  const streams = { watts: ts.watts, heartrate: ts.heartrate, cadence: ts.cadence, speed: ts.speed }
  const n = Math.max(0, ...Object.values(streams).map((s) => (Array.isArray(s) ? s.length : 0)))
  if (!n) return { split_s: null, splits: [] }
  let block = Math.max(60, Math.round(splitMinutes * 60))
  while (Math.ceil(n / block) > MAX_SPLITS) block *= 2
  const splits = []
  for (let start = 0; start < n; start += block) {
    const end = Math.min(n, start + block)
    const part = (s) => (Array.isArray(s) ? s.slice(start, end) : [])
    splits.push({
      start_s: start,
      duration_s: end - start,
      avg_power_w: round(meanOf(part(streams.watts))),
      max_power_w: round(maxOf(part(streams.watts))),
      avg_hr_bpm: round(meanOf(part(streams.heartrate))),
      avg_cadence_rpm: round(meanOf(part(streams.cadence))),
      avg_speed_kmh: round(meanOf(part(streams.speed)), 1),
    })
  }
  return { split_s: block, splits }
}

export const PEAK_LABELS = Object.freeze(['5s', '15s', '30s', '1m', '5m', '10m', '20m', '30m', '1h'])

/** Durational curves ({ Power: { '5s': 900, ... }, HeartRate: ... }) -> selected peaks. */
export function peaksView(curves) {
  const pick = (c) => {
    if (!c || typeof c !== 'object') return null
    const out = {}
    for (const k of PEAK_LABELS) if (num(c[k]) != null) out[k] = round(num(c[k]))
    return Object.keys(out).length ? out : null
  }
  return { power_w: pick(curves?.Power), heart_rate_bpm: pick(curves?.HeartRate) }
}

/** Keeps the scalar fields of an object (drops arrays / nested streams); caps the number of keys. */
export function scalars(obj, maxKeys = 40) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (Object.keys(out).length >= maxKeys) break
    if (v == null || typeof v === 'string' || typeof v === 'boolean') out[k] = typeof v === 'string' ? v.slice(0, 200) : v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100
  }
  return out
}

export const MAX_EFFORTS = 40

/** A template_executions row -> { id, template_id, template, by_coach, created_at, summary, efforts }. */
export function templateRunView(run) {
  const efforts = Array.isArray(run?.efforts) ? run.efforts : []
  return {
    id: run?.id ?? null,
    template_id: run?.template_id ?? null,
    template: run?.template_name || run?.analysis_templates?.name || null,
    by_coach: !!run?.by_coach,
    created_at: run?.created_at ?? null,
    summary: scalars(run?.summary),
    efforts: efforts.slice(0, MAX_EFFORTS).map((e) => scalars(e, 30)),
    efforts_total: efforts.length,
  }
}

/** fitnessSummary() result -> today's values plus the last `days` of the series. */
export function fitnessView(summary, days) {
  if (!summary || summary.empty) return { empty: true, fitness: null, fatigue: null, form: null, series: [] }
  const series = (summary.series || []).slice(-days).map((p) => ({ day: p.day, load: p.load, fitness: p.fitness, fatigue: p.fatigue, form: p.form }))
  return {
    empty: false,
    fitness: summary.fitness,
    fatigue: summary.fatigue,
    form: summary.form,
    form_status: summary.status?.label || null,
    ramp_per_week: summary.ramp,
    ramp_level: summary.rampLevel,
    building_baseline: !!summary.building,
    hr_estimated_share: summary.estimateShare == null ? null : Math.round(summary.estimateShare * 100) / 100,
    series,
  }
}

/** Day after a YYYY-MM-DD key (UTC arithmetic). */
export function nextDay(key) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Text filter for ilike: strips wildcard / filter characters. */
export const safeLike = (q) => String(q || '').replace(/[%_*,()\\]/g, ' ').trim().slice(0, 80)
