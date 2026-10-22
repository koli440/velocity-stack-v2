// Coach view of Fitness / Fatigue / Form (issue #290, phase 2). Pure helpers + the batched read.
// Data comes ONLY from the coach_fitness_activities() RPC (supabase/migrations/20261229000000_*): it is
// gated by is_coach_of (active, not blocked, checked per call), returns load inputs only and carries the
// ATHLETE's thresholds (stored training_load uses the athlete's FTP on the ride date; `lthr` is the athlete's
// LT2 heart rate). A coach never reads the raw activities table. One call serves every athlete (no N+1).

import { dailyLoads, fitnessSummary, WARMUP_DAYS, FITNESS_DAYS } from './fitnessForm.js'

export const COACH_DASHBOARD_DAYS = WARMUP_DAYS + FITNESS_DAYS
export const FORM_VERY_NEGATIVE = -30
export const ESTIMATE_HEAVY_SHARE = 0.5

/** Pages through the RPC (the API caps a response at 1000 rows). `riderIds` null = every active athlete. */
export async function fetchCoachFitnessRows(client, { riderIds = null, days = COACH_DASHBOARD_DAYS, pageSize = 1000 } = {}) {
  if (Array.isArray(riderIds) && riderIds.length === 0) return { rows: [], error: null }
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .rpc('coach_fitness_activities', { p_riders: riderIds, p_days: days })
      .range(from, from + pageSize - 1)
    if (error) return { rows: [], error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return { rows, error: null }
}

/** Groups RPC rows by athlete: Map(riderId -> { rides, firstActivityAt }). Rides use the shape activityLoad() reads. */
export function groupFitnessRows(rows) {
  const byRider = new Map()
  for (const r of rows || []) {
    if (!r?.rider_id) continue
    const g = byRider.get(r.rider_id) || { rides: [], firstActivityAt: r.first_activity_at || null }
    g.rides.push({
      id: r.id,
      activity_date: r.activity_date,
      training_load: r.training_load,
      moving_time_s: r.moving_time_s,
      elapsed_time_s: r.elapsed_time_s,
      duration_sec: r.duration_sec,
      avg_hr: r.avg_hr,
      lt2_hr_at_activity: r.lthr,
    })
    byRider.set(r.rider_id, g)
  }
  return byRider
}

/** Flags worth a coach's attention, most severe first: [{ key, level: 'alert'|'warn'|'info', label }]. */
export function fitnessFlags(summary) {
  if (!summary || summary.empty) return [{ key: 'no-data', level: 'info', label: 'No training load' }]
  const flags = []
  if (summary.form < FORM_VERY_NEGATIVE) flags.push({ key: 'very-tired', level: 'alert', label: 'Very negative form' })
  if (summary.rampLevel === 'warning') flags.push({ key: 'ramp-fast', level: 'alert', label: 'Ramp too fast' })
  else if (summary.rampLevel === 'high') flags.push({ key: 'ramp-high', level: 'warn', label: 'Ramp high' })
  if (summary.building) flags.push({ key: 'building', level: 'info', label: 'Building baseline' })
  if (summary.estimateShare !== null && summary.estimateShare > ESTIMATE_HEAVY_SHARE) {
    flags.push({ key: 'estimated', level: 'info', label: 'Mostly HR estimates' })
  }
  return flags
}

/** Summary + flags of one athlete's grouped rows. `today` is a local day key. */
export function athleteFitnessSummary(group, today) {
  const { days } = dailyLoads(group?.rides || [])
  const firstDay = group?.firstActivityAt ? localDay(group.firstActivityAt) : null
  const summary = fitnessSummary(days, today, firstDay)
  return { ...summary, flags: fitnessFlags(summary) }
}

function localDay(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Summaries for every athlete id (athletes without rows get the empty summary). Series is dropped to keep the list light. */
export function summarizeAthletes(rows, riderIds, today) {
  const groups = groupFitnessRows(rows)
  const out = new Map()
  for (const id of riderIds) {
    const { series, ...rest } = athleteFitnessSummary(groups.get(id), today)
    out.set(id, rest)
  }
  return out
}

export const FITNESS_SORTS = Object.freeze([
  { key: 'activity', label: 'Last activity' },
  { key: 'name', label: 'Name' },
  { key: 'fitness', label: 'Fitness' },
  { key: 'fatigue', label: 'Fatigue' },
  { key: 'form', label: 'Form (most tired first)' },
  { key: 'ramp', label: 'Ramp (fastest first)' },
  { key: 'flags', label: 'Needs attention' },
])

const LEVEL_RANK = { alert: 3, warn: 2, info: 0 }
const attention = (s) => (s && !s.empty ? s.flags.reduce((n, f) => n + (LEVEL_RANK[f.level] || 0), 0) : 0)

/**
 * Sorts dashboard items ({ name, lastActivityAt, fitness: summary|null }) without mutating. Missing values go last;
 * ties fall back to name so the order is stable.
 */
export function sortAthletes(items, key) {
  const val = {
    name: (a) => (a.name || '').toLowerCase(),
    activity: (a) => (a.lastActivityAt ? -new Date(a.lastActivityAt).getTime() : null),
    fitness: (a) => (a.fitness && !a.fitness.empty ? -a.fitness.fitness : null),
    fatigue: (a) => (a.fitness && !a.fitness.empty ? -a.fitness.fatigue : null),
    form: (a) => (a.fitness && !a.fitness.empty ? a.fitness.form : null),
    ramp: (a) => (a.fitness && !a.fitness.empty && a.fitness.ramp !== null ? -a.fitness.ramp : null),
    flags: (a) => -attention(a.fitness),
  }[key] || ((a) => (a.name || '').toLowerCase())
  const nameOf = (a) => (a.name || '').toLowerCase()
  return [...items].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    if (x === null && y !== null) return 1
    if (y === null && x !== null) return -1
    if (x !== null && y !== null && x !== y) return x < y ? -1 : 1
    return nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0
  })
}
