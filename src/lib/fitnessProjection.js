// Fitness projection from planned workouts (issue #348). Pure: continues the CTL/ATL/TSB formulas of
// fitnessForm.js from today's real values over the planned loads of FUTURE days (day > today).
// Rules (owner decisions): empty future days, skipped workouts and workouts without a load estimate count
// as zero load; the past only ever uses real activities. Planned load = workoutSummary().load ("~TL").
// Nothing is stored. `today` is the single local day key used by the fitness series (localDayKey).

import { computeSeries, addDays, daysBetween, formStatus } from './fitnessForm.js'
import { workoutSummary } from './plannedWorkouts.js'

export const PROJECTION_HORIZONS = Object.freeze([
  { key: '2w', label: '2 weeks', days: 14 },
  { key: '4w', label: '4 weeks', days: 28 },
  { key: '6w', label: '6 weeks', days: 42 },
  { key: '8w', label: '8 weeks', days: 56 },
])
export const PROJECTION_MIN_DAYS = 14
export const PROJECTION_MAX_DAYS = 56

/** Estimated load of one planned workout: number >= 0, or null when it has no estimate. */
export function plannedLoad(workout) {
  const load = workoutSummary(workout)?.load
  return Number.isFinite(load) && load >= 0 ? load : null
}

/**
 * @param daily   dailyLoads().days of real activities
 * @param planned planned_workouts rows ({ workout_date, title, status, activity_id, ... })
 * @param races   optional calendar races ({ race_date, name, ... }) inside the horizon
 * @returns { empty, series, noEstimate, planned, raceForms }
 *  series: forecast days today+1..today+horizon, same shape as computeSeries plus
 *    { projected: true, plannedLoad, workouts: [{ id, title, load|null }] }
 *  noEstimate: planned (not skipped) future workouts in the horizon without a load estimate
 */
export function projectFitness(daily, { today, planned = [], races = [], horizonDays = 28 } = {}) {
  const horizon = Math.min(PROJECTION_MAX_DAYS, Math.max(PROJECTION_MIN_DAYS, Math.round(horizonDays) || 28))
  if (!today || !Object.keys(daily || {}).length) return { empty: true, series: [], noEstimate: 0, planned: 0, raceForms: [] }
  const endDay = addDays(today, horizon)
  const byDay = {}
  let noEstimate = 0
  let plannedCount = 0
  for (const w of planned || []) {
    const day = w?.workout_date
    if (!day || day <= today || day > endDay) continue
    if (w.activity_id || w.status === 'skipped') continue
    const load = plannedLoad(w)
    const d = (byDay[day] ||= { load: 0, workouts: [] })
    d.workouts.push({ id: w.id, title: w.title || 'Workout', load })
    plannedCount += 1
    if (load === null) noEstimate += 1
    else d.load += load
  }
  const merged = {}
  for (const [k, v] of Object.entries(daily)) if (k <= today) merged[k] = v
  for (const [k, v] of Object.entries(byDay)) merged[k] = { load: v.load, estimatedLoad: 0 }
  const series = computeSeries(merged, { startDay: addDays(today, 1), endDay }).map((p) => ({
    ...p,
    projected: true,
    plannedLoad: p.load,
    workouts: byDay[p.day]?.workouts || [],
  }))
  const raceForms = (races || [])
    .filter((r) => r?.race_date > today && r.race_date <= endDay)
    .map((r) => {
      const p = series.find((s) => s.day === r.race_date)
      return p ? { race: r, day: p.day, daysAway: daysBetween(today, p.day), form: p.form, fitness: p.fitness, fatigue: p.fatigue, status: formStatus(p.form) } : null
    })
    .filter(Boolean)
  return { empty: series.length === 0, series, noEstimate, planned: plannedCount, raceForms }
}

/** "Partial forecast" note text, or '' when every planned workout has a load estimate. */
export function partialForecastNote(noEstimate) {
  if (!noEstimate) return ''
  return `Partial forecast: ${noEstimate} planned workout${noEstimate === 1 ? ' has' : 's have'} no load estimate (counted as zero).`
}

/** Projected form on a race day from today's real data; null when out of horizon or no data. */
export function raceDayForm(daily, race, { today, planned = [] } = {}) {
  if (!race?.race_date || !today) return null
  const horizonDays = daysBetween(today, race.race_date)
  if (horizonDays < 1 || horizonDays > PROJECTION_MAX_DAYS) return null
  return projectFitness(daily, { today, planned, races: [race], horizonDays }).raceForms[0] || null
}
