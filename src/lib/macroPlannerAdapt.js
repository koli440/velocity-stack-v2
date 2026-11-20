// Macro planner adaptation engine (pure, no I/O): disruptions, B/C races, availability, adherence, lab hints.
// Design: docs/macro-planner.md ("Adapting the plan"). Everything here SUGGESTS: it returns candidate week lists with a
// recomputed projection and feasibility; the coach applies one explicitly (macro_plan_apply) and nothing changes silently.
import { addDays, daysBetween } from './fitnessForm.js'
import {
  DEFAULT_RAMP_CEILING_PCT, RECOVERY_FRACTION, TAPER_FRACTIONS, assessFeasibility, defaultDayShape, projectPlan, weekStartOf, weekdayIndex,
} from './macroPlanner.js'

const round1 = (n) => Math.round(n * 10) / 10
const clip = (s, n) => String(s).slice(0, n)
const MAX_COMPRESS_STEP = 0.12
const SEVERITY_FACTOR = Object.freeze({ mild: 1, moderate: 1.5, severe: 2 })

// Share of the pre-break weekly TL for each return week, by the (severity adjusted) length of the break in days. Illness is
// more conservative than injury at every length. Estimates, not medical advice: the coach decides.
const RETURN_TABLE = Object.freeze({
  illness: [[3, [0.7, 0.9]], [7, [0.5, 0.7, 0.85]], [14, [0.5, 0.6, 0.75, 0.9]], [28, [0.4, 0.55, 0.7, 0.85]], [Infinity, [0.3, 0.45, 0.6, 0.75, 0.9]]],
  injury: [[3, [0.8, 0.95]], [7, [0.6, 0.8, 0.9]], [14, [0.5, 0.7, 0.85]], [28, [0.5, 0.65, 0.8, 0.9]], [Infinity, [0.4, 0.55, 0.7, 0.85]]],
})

/** Length of a disruption in days (open-ended ones run up to `today`). */
export function breakDays(disruption, today) {
  const end = disruption.end_date || today
  return Math.max(1, daysBetween(disruption.start_date, end) + 1)
}

/** Return-to-training fractions of the pre-break weekly TL (the week at 100 % is implicit). */
export function returnFractions(kind, severity, days) {
  const effective = days * (SEVERITY_FACTOR[severity] || 1)
  const table = RETURN_TABLE[kind] || RETURN_TABLE.illness
  return [...table.find(([max]) => effective <= max)[1]]
}

const overlapsDisruption = (ws, disruptions, today) => (disruptions || []).some((d) => d.start_date <= addDays(ws, 6) && (d.end_date || today) >= ws)

/**
 * Typical weekly TL before the break: mean of up to 4 complete weeks before the break week that carry no disruption
 * and some load. Falls back to the planned target of the week before the break, then the first planned week.
 */
export function preBreakTl({ days = {}, startDay, disruptions = [], weeks = [], today }) {
  const breakWeek = weekStartOf(startDay)
  const found = []
  for (let i = 1; i <= 8 && found.length < 4; i += 1) {
    const ws = addDays(breakWeek, -7 * i)
    if (overlapsDisruption(ws, disruptions, today)) continue
    let tl = 0
    for (let d = 0; d < 7; d += 1) tl += days[addDays(ws, d)]?.load || 0
    if (tl > 0) found.push(tl)
  }
  if (found.length) return { tl: Math.round(found.reduce((s, v) => s + v, 0) / found.length), source: 'history' }
  const before = [...weeks].reverse().find((w) => w.week_start < breakWeek && w.kind !== 'taper') || weeks.find((w) => w.kind !== 'taper')
  return { tl: Math.round(Number(before?.target_tl) || 0), source: 'plan' }
}

function overlapDays(ws, start, end) {
  const lo = ws > start ? ws : start
  const we = addDays(ws, 6)
  const hi = we < end ? we : end
  return Math.max(0, daysBetween(lo, hi) + 1)
}

function disruptionPrefix({ startWeek, start, end, kind, severity, preTl, fractions }) {
  const label = kind === 'illness' ? 'Illness' : 'Injury'
  const prefix = []
  let k = 0
  for (let ws = startWeek, guard = 0; guard < 60; ws = addDays(ws, 7), guard += 1) {
    const brk = overlapDays(ws, start, end)
    if (brk > 0) {
      const free = 7 - brk
      let tl = (preTl * free) / 7
      if (addDays(ws, 6) > end && free > 0) tl *= fractions[k++] ?? 1
      prefix.push(free === 0
        ? { week_start: ws, kind: 'recovery', target_tl: 0, focus: label, day_shape: 'RRRRRRR', note: `${label}: no training.` }
        : { week_start: ws, kind: 'recovery', target_tl: Math.round(tl), focus: `${label} / return`, day_shape: defaultDayShape('recovery'), note: `${label} during this week; reduced load.` })
    } else if (k < fractions.length) {
      prefix.push({ week_start: ws, kind: 'recovery', target_tl: Math.round(preTl * fractions[k]), focus: 'Return to training', day_shape: defaultDayShape('recovery'), note: `Return to training at ${Math.round(fractions[k] * 100)} % of the pre-break load.` })
      k += 1
    } else break
  }
  return prefix
}

/**
 * Weeks from `startWeek` to the race week: optional prefix (break / return weeks), then the usual build/recovery cycle
 * starting at `preTl` with the given weekly step, then the taper anchored to the race. Taper weeks that still fall inside
 * the prefix take the lower of the two loads.
 */
export function composeAdaptedWeeks({ startWeek, raceDate, raceLength, buildWeeks, recoveryWeeks, preTl, step, prefix = [] }) {
  const raceWeek = weekStartOf(raceDate)
  const total = Math.floor(daysBetween(startWeek, raceWeek) / 7) + 1
  if (total < 1) return []
  const fractions = TAPER_FRACTIONS[raceLength] || TAPER_FRACTIONS.medium
  const taperN = Math.min(fractions.length, total)
  const mainN = total - taperN
  const cycle = buildWeeks + recoveryWeeks
  const out = []
  let lastBuild = null
  let peak = 0
  for (let i = 0; i < mainN; i += 1) {
    const p = prefix[i]
    if (p) {
      out.push({ ...p, tl_overridden: false })
      continue
    }
    const j = i - prefix.length
    const isBuild = j % cycle < buildWeeks
    if (isBuild) {
      const tl = lastBuild === null ? preTl : lastBuild * (1 + step)
      lastBuild = tl
      peak = Math.max(peak, tl)
      out.push({ week_start: addDays(startWeek, 7 * i), kind: 'build', target_tl: Math.round(tl), focus: 'Build', note: '', day_shape: defaultDayShape('build'), tl_overridden: false })
    } else {
      out.push({ week_start: addDays(startWeek, 7 * i), kind: 'recovery', target_tl: Math.round((lastBuild ?? preTl) * RECOVERY_FRACTION), focus: 'Recovery', note: '', day_shape: defaultDayShape('recovery'), tl_overridden: false })
    }
  }
  // A recovery block right before the taper would only delay the peak: make it build instead (never touches the prefix).
  for (let i = out.length - 1; i >= prefix.length && out[i].focus === 'Recovery'; i -= 1) {
    const prev = out.slice(0, i).reverse().find((w) => w.kind === 'build')
    const tl = prev ? prev.target_tl * (1 + step) : preTl
    out[i] = { ...out[i], kind: 'build', target_tl: Math.round(tl), focus: 'Build', day_shape: defaultDayShape('build') }
    peak = Math.max(peak, tl)
  }
  if (!peak) peak = preTl * RECOVERY_FRACTION
  const raceWeekday = weekdayIndex(raceDate)
  for (let j = 0; j < taperN; j += 1) {
    const i = mainN + j
    const isRaceWeek = j === taperN - 1
    let tl = Math.round(peak * fractions[fractions.length - taperN + j])
    const p = prefix[i]
    if (p) tl = Math.min(tl, p.target_tl)
    out.push({
      week_start: addDays(startWeek, 7 * i),
      kind: 'taper',
      target_tl: tl,
      focus: p && p.target_tl < tl + 1 && p.focus !== 'Return to training' ? p.focus : isRaceWeek ? 'Race week' : 'Taper',
      note: p ? p.note : '',
      day_shape: p && p.day_shape === 'RRRRRRR' ? p.day_shape : defaultDayShape('taper', { raceWeekday: isRaceWeek ? raceWeekday : null }),
      tl_overridden: false,
    })
  }
  return out
}

/**
 * B race = mini-taper (race week at 75 %) plus a recovery week after; C race = train through (load unchanged, race day hard).
 * Returns { weeks, ignored: [{ race, reason }] }. Races in the past, on/after the A race, inside the A taper, outside the
 * plan or sharing a week with a higher-priority race are ignored with the reason.
 */
export function applyMinorRaces(weeks, races, { raceDate, today }) {
  const out = (weeks || []).map((w) => ({ ...w }))
  const ignored = []
  const firstTaper = out.find((w) => w.kind === 'taper')?.week_start || null
  const claimed = new Map()
  const sorted = [...(races || [])].sort((a, b) => (a.priority === b.priority ? (a.race_date < b.race_date ? -1 : 1) : a.priority === 'B' ? -1 : 1))
  for (const race of sorted) {
    const d = race.race_date
    const ws = weekStartOf(d)
    const idx = out.findIndex((w) => w.week_start === ws)
    if (d <= today) ignored.push({ race, reason: 'past' })
    else if (d >= raceDate) ignored.push({ race, reason: 'after_a_race' })
    else if (idx < 0) ignored.push({ race, reason: 'outside_plan' })
    else if (firstTaper && ws >= firstTaper) ignored.push({ race, reason: 'in_taper' })
    else if (claimed.has(ws)) ignored.push({ race, reason: 'same_week' })
    else {
      claimed.set(ws, race)
      const w = out[idx]
      const rw = weekdayIndex(d)
      const shape = (/^[HER]{7}$/.test(w.day_shape || '') ? w.day_shape : 'RHEHEHE').split('')
      if (race.priority === 'B') {
        if (w.kind === 'build') w.target_tl = Math.round(w.target_tl * 0.75)
        w.focus = clip(`B race: ${race.name}`, 40)
        w.day_shape = defaultDayShape(w.kind, { raceWeekday: rw })
        w.note = clip(w.note ? `${w.note} B race: mini-taper.` : 'B race: mini-taper this week, recovery next.', 500)
        const next = out[idx + 1]
        if (next && next.kind !== 'taper' && !claimed.has(next.week_start)) {
          out[idx + 1] = { ...next, kind: 'recovery', target_tl: Math.min(next.target_tl, Math.round(next.target_tl * RECOVERY_FRACTION)), focus: 'Recovery after B race', note: clip(next.note || 'Recover after the B race.', 500) }
        }
      } else {
        shape[rw] = 'H'
        if (rw > 0 && shape[rw - 1] === 'H') shape[rw - 1] = 'E'
        w.day_shape = shape.join('')
        w.focus = clip(`C race: ${race.name}`, 40)
        w.note = clip(w.note ? `${w.note} C race: train through.` : 'C race: train through, no taper.', 500)
      }
    }
  }
  return { weeks: out, ignored }
}

function evaluate(weeks, ctx) {
  const { days, today, raceDate, startWeeklyTl, baselineStatus, sustained, rampCeilingPct, buildWeeks, recoveryWeeks, goalCtl } = ctx
  const projection = projectPlan({ weeks, days, today, raceDate, startWeeklyTl, baselineStatus })
  const peakCtl = (projection.plan || []).reduce((m, p) => Math.max(m, p.fitness), 0)
  const goalReachable = Number(goalCtl) > 0 ? peakCtl >= Number(goalCtl) : null
  const feasibility = assessFeasibility({ weeks, projection, sustained, rampCeilingPct, buildWeeks, recoveryWeeks, goalCtl, goalReachable })
  return { projection, raceDay: projection.raceDay, feasibility, peakCtl: round1(peakCtl) }
}

const peakTl = (weeks) => weeks.filter((w) => w.kind !== 'taper').reduce((m, w) => Math.max(m, Number(w.target_tl)), 0)
const sameWeeks = (a, b) => a.length === b.length && a.every((w, i) => w.week_start === b[i].week_start && w.target_tl === b[i].target_tl && w.kind === b[i].kind)

function finish(key, label, description, keepWeeks, composed, ctx, extra = {}) {
  const merged = ctx.races?.length ? applyMinorRaces([...keepWeeks, ...composed], ctx.races, { raceDate: ctx.raceDate, today: ctx.today }).weeks : [...keepWeeks, ...composed]
  return { key, label, description, weeks: merged, goalCtl: ctx.goalCtl ?? null, ...extra, ...evaluate(merged, ctx) }
}

/**
 * Replan options after a disruption: { current, options[], startWeek, preTl, preSource, fractions, assumedEnd, ongoing }.
 * `current` is the plan as it stands (with the real loads so far). Options (all suggestions):
 *  - shift: return ramp, then continue the normal progression at the ramp ceiling (fewer build weeks left before the taper),
 *  - compress: return ramp, then climb faster (up to 12 %/week) to reach the original peak TL; feasibility flags the risk,
 *  - lower_goal: return ramp, then a gentler ramp (half the ceiling) and a lower goal CTL equal to what that reaches.
 */
export function suggestDisruptionOptions({ weeks, disruption, disruptions = [], today, raceDate, raceLength, buildWeeks = 3, recoveryWeeks = 1, rampCeilingPct = DEFAULT_RAMP_CEILING_PCT, goalCtl = null, days = {}, startWeeklyTl = 0, baselineStatus = 'history', sustained = null, races = [] }) {
  if (!weeks?.length || !disruption?.start_date) return { current: null, options: [], startWeek: null }
  const ctx = { days, today, raceDate, startWeeklyTl, baselineStatus, sustained, rampCeilingPct, buildWeeks, recoveryWeeks, goalCtl, races }
  const ongoing = !disruption.end_date
  const assumedEnd = disruption.end_date || today
  const startWeek = weekStartOf(disruption.start_date) > weeks[0].week_start ? weekStartOf(disruption.start_date) : weeks[0].week_start
  const raceWeek = weekStartOf(raceDate)
  const current = evaluate(weeks, ctx)
  if (startWeek > raceWeek) return { current, options: [], startWeek, ongoing, assumedEnd }
  const keep = weeks.filter((w) => w.week_start < startWeek)
  const { tl: preTl, source: preSource } = preBreakTl({ days, startDay: disruption.start_date, disruptions: disruptions.filter((d) => d !== disruption && d.id !== disruption.id), weeks, today })
  if (!(preTl > 0)) return { current, options: [], startWeek, preTl, preSource, ongoing, assumedEnd }
  const len = breakDays(disruption, today)
  const fractions = returnFractions(disruption.kind, disruption.severity, len)
  const prefix = disruptionPrefix({ startWeek, start: disruption.start_date, end: assumedEnd, kind: disruption.kind, severity: disruption.severity, preTl, fractions })
  const ceiling = Math.min(Math.max(Number(rampCeilingPct) || 0, 0), 15) / 100
  const base = { startWeek, raceDate, raceLength, buildWeeks, recoveryWeeks, preTl, prefix }
  const originalPeak = peakTl(weeks)
  const options = []
  const shiftWeeks = composeAdaptedWeeks({ ...base, step: ceiling })
  options.push(finish('shift', 'Shift forward', `Return gradually, then continue at the ramp ceiling (${Math.round(ceiling * 1000) / 10} %/week). Fewer build weeks remain, so the peak load is lower.`, keep, shiftWeeks, ctx))

  let step = ceiling
  let compressed = shiftWeeks
  while (step < MAX_COMPRESS_STEP - 1e-9 && peakTl(compressed) < originalPeak) {
    step = Math.min(MAX_COMPRESS_STEP, step + 0.005)
    compressed = composeAdaptedWeeks({ ...base, step })
  }
  if (!sameWeeks(compressed, shiftWeeks)) {
    options.push(finish('compress', 'Compress', `Return gradually, then climb at ${Math.round(step * 1000) / 10} %/week to get back to the original peak load. Higher risk: check the feasibility result.`, keep, compressed, ctx))
  }

  const lowerWeeks = composeAdaptedWeeks({ ...base, step: ceiling / 2 })
  if (!sameWeeks(lowerWeeks, shiftWeeks)) {
    const lowerCtx = { ...ctx }
    const lowered = evaluate([...keep, ...lowerWeeks], lowerCtx)
    const newGoal = Number(goalCtl) > 0 ? Math.round(Math.min(Number(goalCtl), lowered.peakCtl)) : null
    options.push(finish('lower_goal', 'Lower the goal', `Return gradually, then a gentler ramp (${Math.round(ceiling * 500) / 10} %/week) and a lower goal CTL${newGoal ? ` (${newGoal})` : ''}.`, keep, lowerWeeks, { ...ctx, goalCtl: newGoal }, { goalCtl: newGoal }))
  }
  return { current, options, startWeek, preTl, preSource, fractions, assumedEnd, ongoing, breakDays: len }
}

/** Scale the targets of reduced-availability weeks (from this week on). Returns { weeks, changed }. */
export function applyAvailability(weeks, availability, { today }) {
  const byWeek = new Map((availability || []).map((a) => [a.week_start, a]))
  const from = weekStartOf(today)
  const changed = []
  const out = (weeks || []).map((w) => {
    const a = byWeek.get(w.week_start)
    if (!a || a.availability_pct >= 100 || w.week_start < from) return { ...w }
    const target = Math.round(Number(w.target_tl) * (a.availability_pct / 100))
    let shape = /^[HER]{7}$/.test(w.day_shape || '') ? w.day_shape : 'RHEHEHE'
    if (a.availability_pct === 0) shape = 'RRRRRRR'
    else if (a.availability_pct <= 50) shape = shape.replace(/H/g, 'E')
    changed.push({ week_start: w.week_start, from: Number(w.target_tl), to: target, pct: a.availability_pct, reason: a.reason })
    const tag = `Reduced availability (${a.reason}, ${a.availability_pct} %).`
    return { ...w, target_tl: target, day_shape: shape, tl_overridden: true, note: clip(w.note && !w.note.includes(tag) ? `${w.note} ${tag}` : w.note || tag, 500) }
  })
  return { weeks: out, changed }
}

/** One suggestion that scales the reduced-availability weeks; null when no future week is reduced. */
export function suggestAvailabilityOption({ weeks, availability, today, raceDate, buildWeeks = 3, recoveryWeeks = 1, rampCeilingPct = DEFAULT_RAMP_CEILING_PCT, goalCtl = null, days = {}, startWeeklyTl = 0, baselineStatus = 'history', sustained = null }) {
  const { weeks: next, changed } = applyAvailability(weeks, availability, { today })
  if (!changed.length) return null
  const ctx = { days, today, raceDate, startWeeklyTl, baselineStatus, sustained, rampCeilingPct, buildWeeks, recoveryWeeks, goalCtl }
  return { key: 'availability', label: 'Adapt to availability', description: `Lower the target in ${changed.length} week${changed.length === 1 ? '' : 's'} with reduced availability.`, weeks: next, changed, goalCtl, current: evaluate(weeks, ctx), ...evaluate(next, ctx) }
}

export const ADHERENCE_BANDS = Object.freeze({ green: [0.85, 1.15], amber: [0.7, 1.3] })

/**
 * Planned vs actual TL for every COMPLETED week (week end before today). light: green 85-115 %, amber 70-130 %, otherwise
 * red; 'skip' for weeks without a target or overlapping a logged disruption (not counted against adherence).
 */
export function weekAdherence({ weeks, days = {}, today, disruptions = [] }) {
  const rows = []
  for (const w of weeks || []) {
    const we = addDays(w.week_start, 6)
    if (we >= today) continue
    let actual = 0
    for (let i = 0; i < 7; i += 1) actual += days[addDays(w.week_start, i)]?.load || 0
    actual = Math.round(actual)
    const target = Number(w.target_tl)
    if (!(target > 0)) rows.push({ week_start: w.week_start, target, actual, ratio: null, light: 'skip', reason: 'no_target' })
    else if (overlapsDisruption(w.week_start, disruptions, today)) rows.push({ week_start: w.week_start, target, actual, ratio: null, light: 'skip', reason: 'disruption' })
    else {
      const ratio = actual / target
      const { green, amber } = ADHERENCE_BANDS
      const light = ratio >= green[0] && ratio <= green[1] ? 'green' : ratio >= amber[0] && ratio <= amber[1] ? 'amber' : 'red'
      rows.push({ week_start: w.week_start, target, actual, ratio: round1(ratio * 100) / 100, light, reason: null })
    }
  }
  return rows
}

/**
 * Proposes a review when adherence drifts: the last two scored weeks are both red, or the last three are all off-target in
 * the same direction. Returns { propose, week_start, direction, reason } (week_start = last scored week, a Monday).
 */
export function adherenceReview(rows) {
  const scored = (rows || []).filter((r) => r.light !== 'skip')
  const none = { propose: false, week_start: null, direction: null, reason: null }
  if (scored.length < 2) return none
  const last = scored[scored.length - 1]
  const dir = (r) => (r.ratio < 1 ? 'under' : 'over')
  const two = scored.slice(-2)
  if (two.every((r) => r.light === 'red') && dir(two[0]) === dir(two[1])) {
    return { propose: true, week_start: last.week_start, direction: dir(last), reason: `The last 2 weeks were well ${dir(last)} target.` }
  }
  const three = scored.slice(-3)
  if (three.length === 3 && three.every((r) => r.light !== 'green') && three.every((r) => dir(r) === dir(three[0]))) {
    return { propose: true, week_start: last.week_start, direction: dir(last), reason: `The last 3 weeks were all ${dir(last)} target.` }
  }
  return none
}

/** Suggestion after an adherence drift: rebase the rest of the plan on what the athlete actually did (mean of the last 3 scored weeks). */
export function suggestAdherenceOption({ weeks, rows, today, raceDate, raceLength, buildWeeks = 3, recoveryWeeks = 1, rampCeilingPct = DEFAULT_RAMP_CEILING_PCT, goalCtl = null, days = {}, startWeeklyTl = 0, baselineStatus = 'history', sustained = null, races = [] }) {
  const scored = (rows || []).filter((r) => r.light !== 'skip').slice(-3)
  if (!scored.length || !weeks?.length) return null
  const level = Math.round(scored.reduce((s, r) => s + r.actual, 0) / scored.length)
  if (!(level > 0)) return null
  const startWeek = weekStartOf(today)
  if (startWeek > weekStartOf(raceDate)) return null
  const ctx = { days, today, raceDate, startWeeklyTl, baselineStatus, sustained, rampCeilingPct, buildWeeks, recoveryWeeks, goalCtl, races }
  const ceiling = Math.min(Math.max(Number(rampCeilingPct) || 0, 0), 15) / 100
  const composed = composeAdaptedWeeks({ startWeek, raceDate, raceLength, buildWeeks, recoveryWeeks, preTl: level, step: ceiling })
  return { current: evaluate(weeks, ctx), ...finish('rebase', 'Rebase on actual load', `Restart the progression from the load actually done recently (${level} TL/week) at the ramp ceiling.`, weeks.filter((w) => w.week_start < startWeek), composed, ctx), level }
}

const PHENOTYPE_HINTS = Object.freeze({
  sprinter: { label: 'Sprinter', text: 'Strong short-power profile: protect aerobic base and threshold work, and keep a few sharp efforts so top-end power is not lost.' },
  pursuiter: { label: 'Pursuiter', text: 'Strong 1-5 minute power: balance VO2max blocks with enough aerobic volume, and plan the hardest sessions away from recovery weeks.' },
  time_trialist: { label: 'Time trialist', text: 'Strong sustained power: threshold and tempo volume suit this athlete; use short high-intensity focus weeks to round out the profile.' },
  all_rounder: { label: 'All-rounder', text: 'Balanced profile: choose the focus from the demands of the race rather than from a weakness.' },
})
const LENGTH_HINTS = Object.freeze({
  short: 'Short race: include intensity and sharpness in the final build weeks.',
  medium: 'Medium race: threshold and VO2max work in the build weeks.',
  long: 'Long race: lean on aerobic volume and durability.',
  ultra: 'Ultra race: prioritise volume, fuelling practice and durability.',
})

/** Hint only (never changes the plan): { label, text } for the focus labels from the Lab phenotype, or null. */
export function focusHint(phenotype, raceLength) {
  const h = PHENOTYPE_HINTS[phenotype]
  if (!h) return null
  return { label: h.label, text: `${h.text} ${LENGTH_HINTS[raceLength] || ''}`.trim() }
}
