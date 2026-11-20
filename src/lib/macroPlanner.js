// Macro planner engine (pure, no I/O). Design: docs/macro-planner.md.
// Load is the platform's total TL (see fitnessForm.js); weeks run Monday to Sunday on local day keys.
import { addDays, computeSeries, daysBetween, formStatus, RAMP_HIGH_PER_WEEK, RAMP_WARN_PER_WEEK } from './fitnessForm.js'

export const TEMPLATES = Object.freeze({
  '3+1': { build: 3, recovery: 1 },
  '2+1': { build: 2, recovery: 1 },
  '4+1': { build: 4, recovery: 1 },
})
export const DEFAULT_RAMP_CEILING_PCT = 7
export const RECOVERY_FRACTION = 0.7
export const TAPER_FRACTIONS = Object.freeze({
  short: [0.6],
  medium: [0.75, 0.55],
  long: [0.7, 0.5],
  ultra: [0.8, 0.6, 0.45],
})
export const DAY_WEIGHTS = Object.freeze({ H: 2, E: 1, R: 0 })
export const MAX_PLAN_WEEKS = 60
const MIN_BASELINE_WEEKS = 6
const MAX_BASELINE_WEEKS = 12
const SUSTAINED_MIN_WEEKS = 10
const LOW_FRACTION = 0.4
const HIGH_FRACTION = 1.75
const round1 = (n) => Math.round(n * 10) / 10

/** Monday (day key) of the week containing `day`. */
export function weekStartOf(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return addDays(day, -dow)
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

function median(values) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Baseline from the last 6-12 complete weeks before `today`. `days` is dailyLoads().days.
 * Weeks under 40 % or over 175 % of the median weekly TL are excluded (sick, off, outlier).
 * status 'history' when at least 6 usable weeks exist, otherwise 'manual' (the coach enters the weekly TL).
 */
export function computeBaseline(days, today, { maxWeeks = MAX_BASELINE_WEEKS } = {}) {
  const keys = Object.keys(days || {}).sort()
  const thisWeek = weekStartOf(today)
  const empty = { status: 'manual', weeks: [], usableWeeks: 0, weeklyTl: null, ctl: null, rampPerWeek: null, sustainedRamp: null, excluded: 0 }
  if (!keys.length) return empty
  const firstWeek = weekStartOf(keys[0])
  const lastDay = addDays(thisWeek, -1)
  const series = computeSeries(days, { endDay: lastDay })
  const ctlOn = new Map(series.map((p) => [p.day, p.fitness]))
  const weeks = []
  for (let i = maxWeeks; i >= 1; i -= 1) {
    const ws = addDays(thisWeek, -7 * i)
    if (ws < firstWeek) continue
    let tl = 0
    for (let d = 0; d < 7; d += 1) tl += days[addDays(ws, d)]?.load || 0
    weeks.push({ week_start: ws, tl: round1(tl), ctl: ctlOn.get(addDays(ws, 6)) ?? 0, excluded: null })
  }
  if (!weeks.length) return empty
  const med = median(weeks.map((w) => w.tl))
  for (const w of weeks) {
    if (w.tl < med * LOW_FRACTION) w.excluded = 'low'
    else if (w.tl > med * HIGH_FRACTION) w.excluded = 'high'
  }
  const usable = weeks.filter((w) => !w.excluded)
  const excluded = weeks.length - usable.length
  if (usable.length < MIN_BASELINE_WEEKS) return { ...empty, weeks, usableWeeks: usable.length, excluded }
  const recent = usable.slice(-4)
  const weeklyTl = Math.round(recent.reduce((s, w) => s + w.tl, 0) / recent.length)
  const last = weeks[weeks.length - 1]
  const back = weeks[Math.max(0, weeks.length - 5)]
  const span = weeks.length - 1 - Math.max(0, weeks.length - 5)
  const rampPerWeek = span > 0 ? round1((last.ctl - back.ctl) / span) : null
  return { status: 'history', weeks, usableWeeks: usable.length, weeklyTl, ctl: last.ctl, rampPerWeek, sustainedRamp: sustainedRamp(weeks), excluded }
}

/** Best 4-week average CTL gain per week over windows without excluded weeks; null with under 10 weeks of history. */
export function sustainedRamp(weeks) {
  if (!weeks || weeks.length < SUSTAINED_MIN_WEEKS) return null
  let best = null
  for (let i = 0; i + 3 < weeks.length; i += 1) {
    const win = weeks.slice(i, i + 4)
    if (win.some((w) => w.excluded)) continue
    const before = i > 0 ? weeks[i - 1] : null
    if (!before || before.excluded) continue
    const gain = (win[3].ctl - before.ctl) / 4
    if (best === null || gain > best) best = gain
  }
  return best === null || best < 1 ? null : round1(best)
}

export function defaultDayShape(kind, { raceWeekday = null } = {}) {
  if (raceWeekday !== null && raceWeekday !== undefined) {
    return Array.from({ length: 7 }, (_, i) => (i === raceWeekday ? 'H' : i === raceWeekday - 1 ? 'R' : 'E')).join('')
  }
  if (kind === 'recovery') return 'REEEEER'
  if (kind === 'taper') return 'REHERER'
  return 'RHEHEHE'
}

/** Daily planned load for every day of `weeks` (race week stops at the race day). */
export function plannedDailyLoads(weeks, raceDate) {
  const days = {}
  for (const w of weeks || []) {
    const shape = /^[HER]{7}$/.test(w.day_shape || '') ? w.day_shape : 'RHEHEHE'
    const upto = raceDate && raceDate >= w.week_start && raceDate <= addDays(w.week_start, 6) ? daysBetween(w.week_start, raceDate) : 6
    let total = 0
    for (let i = 0; i <= upto; i += 1) total += DAY_WEIGHTS[shape[i]]
    if (total <= 0) continue
    for (let i = 0; i <= upto; i += 1) {
      const wt = DAY_WEIGHTS[shape[i]]
      if (wt) days[addDays(w.week_start, i)] = { load: (Number(w.target_tl) * wt) / total }
    }
  }
  return days
}

function seedDays(startDay, startWeeklyTl) {
  // Synthetic steady history when the athlete has none, so CTL/ATL start from the stated weekly TL.
  const out = {}
  const daily = (Number(startWeeklyTl) || 0) / 7
  for (let i = 1; i <= 126; i += 1) out[addDays(startDay, -i)] = { load: daily }
  return out
}

/**
 * Three series to race day: actual (real loads up to today), plan (real before the plan starts, planned after) and
 * forecast (real up to today, planned after). Race-day form is the forecast on race morning: an estimate.
 */
export function projectPlan({ weeks, days = {}, today, raceDate, startWeeklyTl = 0, baselineStatus = 'history' }) {
  if (!weeks?.length || !raceDate) return { actual: [], plan: [], forecast: [], raceDay: null }
  const start = weeks[0].week_start
  const hasHistory = Object.keys(days).some((k) => k < start) && baselineStatus !== 'manual'
  const before = hasHistory ? Object.fromEntries(Object.entries(days).filter(([k]) => k < start)) : seedDays(start, startWeeklyTl)
  const planned = plannedDailyLoads(weeks, raceDate)
  const realRecent = Object.fromEntries(Object.entries(days).filter(([k]) => k >= start && k <= today))
  const from = addDays(start, -14)
  const trim = (s) => s.filter((p) => p.day >= from)

  const planSeries = trim(computeSeries({ ...before, ...planned }, { endDay: raceDate }))
  const actualMap = hasHistory ? { ...before, ...realRecent } : null
  const actual = actualMap && today >= start ? trim(computeSeries(actualMap, { endDay: today > raceDate ? raceDate : today })) : []
  const forecastDays = { ...before }
  for (const [k, v] of Object.entries(planned)) if (k > today) forecastDays[k] = v
  Object.assign(forecastDays, realRecent)
  if (today < start) for (const [k, v] of Object.entries(planned)) forecastDays[k] = v
  const forecast = trim(computeSeries(forecastDays, { endDay: raceDate }))
  const race = forecast.find((p) => p.day === raceDate) || null
  const raceDay = race ? { day: raceDate, fitness: race.fitness, fatigue: race.fatigue, form: race.form, status: formStatus(race.form), estimate: true } : null
  return { actual, plan: planSeries, forecast, raceDay }
}

function buildWeekList({ startWeek, totalWeeks, raceDate, raceLength, buildWeeks, recoveryWeeks, step, baselineTl }) {
  const fractions = TAPER_FRACTIONS[raceLength] || TAPER_FRACTIONS.medium
  const taperN = Math.min(fractions.length, totalWeeks)
  const mainN = totalWeeks - taperN
  const cycle = buildWeeks + recoveryWeeks
  const kinds = Array.from({ length: mainN }, (_, i) => (i % cycle < buildWeeks ? 'build' : 'recovery'))
  // A recovery block right before the taper would only delay the peak: make it build instead.
  for (let i = mainN - 1; i >= 0 && kinds[i] === 'recovery'; i -= 1) kinds[i] = 'build'
  const out = []
  let lastBuild = null
  let peak = baselineTl
  kinds.forEach((kind, i) => {
    let tl
    if (kind === 'build') {
      tl = lastBuild === null ? baselineTl : lastBuild * (1 + step)
      lastBuild = tl
      peak = Math.max(peak, tl)
    } else tl = (lastBuild ?? baselineTl) * RECOVERY_FRACTION
    out.push({ week_start: addDays(startWeek, 7 * i), kind, target_tl: Math.round(tl), focus: kind === 'build' ? 'Build' : 'Recovery', note: '', day_shape: defaultDayShape(kind), tl_overridden: false })
  })
  const raceWeekday = weekdayIndex(raceDate)
  for (let j = 0; j < taperN; j += 1) {
    const isRaceWeek = j === taperN - 1
    out.push({
      week_start: addDays(startWeek, 7 * (mainN + j)),
      kind: 'taper',
      target_tl: Math.round(peak * fractions[fractions.length - taperN + j]),
      focus: isRaceWeek ? 'Race week' : 'Taper',
      note: '',
      day_shape: defaultDayShape('taper', { raceWeekday: isRaceWeek ? raceWeekday : null }),
      tl_overridden: false,
    })
  }
  return out
}

/**
 * Generate the week list. step = ramp ceiling, or (with goalCtl) the smallest step that reaches it, capped at the ceiling.
 * Returns { weeks, step, goalReachable, error }.
 */
export function generatePlan({ today, raceDate, raceLength = 'medium', template = '3+1', buildWeeks, recoveryWeeks, rampCeilingPct = DEFAULT_RAMP_CEILING_PCT, startWeeklyTl, goalCtl = null, days = {}, baselineStatus = 'history' }) {
  const fail = (error) => ({ weeks: [], step: 0, goalReachable: null, error })
  if (!raceDate || !today || raceDate <= today) return fail('The race date must be in the future.')
  if (!(Number(startWeeklyTl) > 0)) return fail('Enter a starting weekly TL.')
  const t = TEMPLATES[template]
  const b = Number(buildWeeks ?? t?.build ?? 3)
  const r = Number(recoveryWeeks ?? t?.recovery ?? 1)
  if (!(b >= 1 && b <= 8) || !(r >= 1 && r <= 3)) return fail('Build weeks must be 1-8 and recovery weeks 1-3.')
  const startWeek = weekStartOf(today)
  const totalWeeks = Math.floor(daysBetween(startWeek, weekStartOf(raceDate)) / 7) + 1
  if (totalWeeks > MAX_PLAN_WEEKS) return fail(`A plan can span at most ${MAX_PLAN_WEEKS} weeks.`)
  const ceiling = Math.min(Math.max(Number(rampCeilingPct) || 0, 0), 15) / 100
  const base = { startWeek, totalWeeks, raceDate, raceLength, buildWeeks: b, recoveryWeeks: r, baselineTl: Number(startWeeklyTl) }
  const make = (step) => buildWeekList({ ...base, step })
  const peakCtl = (weeks) => {
    const s = projectPlan({ weeks, days, today, raceDate, startWeeklyTl, baselineStatus }).plan
    return s.reduce((m, p) => Math.max(m, p.fitness), 0)
  }
  if (!(Number(goalCtl) > 0)) return { weeks: make(ceiling), step: ceiling, goalReachable: null, error: null }
  let step = ceiling
  let reachable = peakCtl(make(ceiling)) >= goalCtl
  if (reachable) {
    for (let s = 0; s <= ceiling + 1e-9; s += 0.0025) {
      if (peakCtl(make(s)) >= goalCtl) {
        step = Math.min(s, ceiling)
        break
      }
    }
  }
  return { weeks: make(step), step, goalReachable: reachable, error: null }
}

/** Planned ramp (peak 4-week average CTL gain per week) vs the sustained ramp, plus override warnings. */
export function assessFeasibility({ weeks, projection, sustained, rampCeilingPct = DEFAULT_RAMP_CEILING_PCT, buildWeeks = 3, recoveryWeeks = 1, goalCtl = null, goalReachable = null }) {
  const ends = []
  const plan = projection?.plan || []
  const byDay = new Map(plan.map((p) => [p.day, p.fitness]))
  for (const w of weeks || []) {
    const v = byDay.get(addDays(w.week_start, 6))
    if (v !== undefined && w.kind !== 'taper') ends.push(v)
  }
  const first = weeks?.length ? byDay.get(addDays(weeks[0].week_start, -1)) : undefined
  const pts = first === undefined ? ends : [first, ...ends]
  let planned = null
  for (let i = 0; i + 4 < pts.length; i += 1) {
    const g = (pts[i + 4] - pts[i]) / 4
    if (planned === null || g > planned) planned = g
  }
  if (planned === null && pts.length > 1) planned = (pts[pts.length - 1] - pts[0]) / (pts.length - 1)
  planned = planned === null ? null : round1(Math.max(planned, 0))
  const reference = sustained ?? RAMP_HIGH_PER_WEEK
  let verdict = 'ok'
  if (planned !== null) {
    if (planned > RAMP_WARN_PER_WEEK || planned > reference * 1.25) verdict = 'unrealistic'
    else if (planned > reference) verdict = 'stretch'
  }
  const warnings = []
  const ceiling = (Number(rampCeilingPct) || 0) / 100
  let prevBuild = null
  let run = 0
  let maxRun = 0
  for (const w of weeks || []) {
    if (w.kind === 'build') {
      if (prevBuild !== null && Number(w.target_tl) > prevBuild * (1 + ceiling) + 1) warnings.push({ type: 'ceiling', week_start: w.week_start })
      prevBuild = Number(w.target_tl)
      run += 1
      maxRun = Math.max(maxRun, run)
    } else run = 0
  }
  if (maxRun > buildWeeks + recoveryWeeks) warnings.push({ type: 'no_recovery', weeks: maxRun })
  const goalMissed = Number(goalCtl) > 0 && goalReachable === false
  return { planned, sustained: sustained ?? null, reference, usedDefault: sustained === null || sustained === undefined, verdict, goalMissed, warnings }
}

/** One row per day for charting: actual / plan / forecast fitness and forecast form. */
export function chartRows(projection) {
  const rows = new Map()
  const put = (series, key, extra) => {
    for (const p of series || []) {
      const row = rows.get(p.day) || { day: p.day }
      row[key] = p.fitness
      if (extra) row[extra] = p.form
      rows.set(p.day, row)
    }
  }
  put(projection?.plan, 'planCtl')
  put(projection?.forecast, 'forecastCtl', 'forecastForm')
  put(projection?.actual, 'actualCtl')
  return [...rows.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
}

/** Actual weekly TL for weeks that have started (null for future weeks). `days` is dailyLoads().days. */
export function actualWeekTl(days, weekStart, today) {
  if (weekStart > today) return null
  let tl = 0
  for (let i = 0; i < 7; i += 1) tl += days?.[addDays(weekStart, i)]?.load || 0
  return Math.round(tl)
}
