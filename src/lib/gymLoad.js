// src/lib/gymLoad.js
//
// PROTOTYPE (issue #336): training LOAD of a completed gym session, meant to feed CTL/ATL/TSB
// (src/lib/fitnessForm.js) later. Pure calculation: nothing is stored, nothing reads this yet.
// Design, constants and open questions: docs/gym-load.md.
//
// Per working set: stress = reps x intensity^K, intensity = %e1RM. No user RPE / RIR / session-RPE is used.
// Intensity source, in order:
//   1. history  - weight / the rider's own best e1RM for the same name_key (needs >= MIN_HISTORY_SESSIONS prior sessions)
//   2. reps     - rep-implied intensity (Epley inverse), a CEILING (a set of 10 may be far from failure)
//   3. velocity - only with a per-exercise load-velocity profile (constants.velocityProfiles[name_key] = { v0, slope });
//                 a fast set then lowers the rep ceiling (never raises it). No generic cross-exercise table: velocities
//                 differ hugely by exercise (leg press ~0.2 m/s vs box squat ~0.55 m/s at similar effort).
// Velocity loss % is a fatigue FLAG, not extra load. A small clamped HR multiplier and a work-density multiplier
// are applied to the session total.

import { activeSets, estimate1RM } from './gymDetail.js'

export const GYM_LOAD_CONSTANTS = Object.freeze({
  /** Intensity exponent: stress grows faster than linearly with %1RM. */
  K: 2,
  /** Scale to a roughly TSS-comparable number (20 working sets x 6 reps at ~80% -> ~55-60). */
  SCALE: 0.7,
  MIN_HISTORY_SESSIONS: 3,
  INTENSITY_MIN: 0.3,
  INTENSITY_MAX: 1.05,
  /** Fixed intensity for dynamic / jump / bodyweight / unloaded sets (stress per rep = DYNAMIC_INTENSITY^K). */
  DYNAMIC_INTENSITY: 0.5,
  /** Jump height (catalogue exercises with metrics.height_cm): intensity = DYNAMIC_INTENSITY x (1 + SLOPE x (h / REF - 1)), clamped. */
  HEIGHT_REF_CM: 50,
  HEIGHT_SLOPE: 0.3,
  HEIGHT_INTENSITY_MIN: 0.4,
  HEIGHT_INTENSITY_MAX: 0.65,
  /** Reps-equivalent per second for timed sets without reps (planks...). */
  SECONDS_PER_REP_EQUIV: 4,
  /** Unilateral assumption: recorded reps are the TOTAL over both sides when reps > UNILATERAL_REPS_ABOVE or the name matches UNILATERAL_NAME. */
  UNILATERAL_REPS_ABOVE: 10,
  /** Rep-implied intensity is unreliable above this many reps PER SIDE: it is floored at HIGH_REP_FLOOR instead of following Epley down. */
  HIGH_REP_THRESHOLD: 12,
  HIGH_REP_FLOOR: 0.6,
  /** How far a velocity estimate may pull the rep ceiling DOWN, and the share of the gap that is used. */
  VELOCITY_MAX_DROP: 0.15,
  VELOCITY_SHARE: 0.5,
  VELOCITY_LOSS_FLAG_PCT: 20,
  /** Density: working sets per minute of session vs. a reference, square-rooted and clamped. */
  DENSITY_REF_SETS_PER_MIN: 0.2,
  DENSITY_MIN: 0.85,
  DENSITY_MAX: 1.15,
  /** HR tie-breaker: 1 + HR_GAIN x (avgHr / typicalHr - 1), clamped. Needs >= MIN_HR_SESSIONS prior gym sessions with HR. */
  HR_GAIN: 0.5,
  HR_MIN: 0.88,
  HR_MAX: 1.12,
  MIN_HR_SESSIONS: 3,
})

const UNILATERAL_NAME = /lunge|split squat|step[- ]?up|bulgarian|single[- ]?leg|one[- ]?leg|pistol/i
const DYNAMIC_NAME = /jump|hop|bound|plyo|skip|throw|slam|sprint|burpee/i
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Same normalisation as gym_exercises.name_key. */
export const nameKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const keyOf = (ex) => ex?.name_key || nameKey(ex?.name)
/** History key: the catalogue link when present (aliases and typos collapse), else the normalised name. */
const histKeyOf = (ex) => (ex?.catalogue_id || ex?.catalogue?.id ? `c:${ex.catalogue_id || ex.catalogue.id}` : keyOf(ex))

const loadedKg = (s) => ((s.load_mode || 'weighted') === 'weighted' && isNum(s.weight_kg) ? s.weight_kg : 0)
const isWorking = (s) => s.kind !== 'warmup'

/**
 * Per-exercise summary of the rider's PRIOR sessions: { ['c:<catalogue_id>' | name_key]: { sessions, bestE1rm } }.
 * @param {Array<{ activity_id: string, name?: string, name_key?: string, sets: object[] }>} priorExercises
 */
export function summarizeHistory(priorExercises) {
  const acc = {}
  for (const ex of priorExercises || []) {
    const key = histKeyOf(ex)
    if (!key) continue
    const entry = (acc[key] ||= { activities: new Set(), bestE1rm: null })
    entry.activities.add(ex.activity_id ?? Symbol())
    for (const s of activeSets(ex)) {
      if (!isWorking(s)) continue
      const e = estimate1RM(loadedKg(s), s.reps)
      if (e != null && (entry.bestE1rm == null || e > entry.bestE1rm)) entry.bestE1rm = e
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { sessions: v.activities.size, bestE1rm: v.bestE1rm }]))
}

/** The rider's typical gym avg HR (median) from prior sessions' avg_hr values, or null when too few. */
export function typicalGymHr(priorAvgHrs, c = GYM_LOAD_CONSTANTS) {
  const v = (priorAvgHrs || []).filter((h) => isNum(h) && h > 0).sort((a, b) => a - b)
  if (v.length < c.MIN_HR_SESSIONS) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Rep-implied %e1RM (inverse Epley): 1 rep ~ 97%, 3 ~ 91%, 10 ~ 75%. A ceiling, not a measurement. */
export const repImpliedIntensity = (reps) => 1 / (1 + reps / 30)

/** Per-exercise load-velocity line: intensity = 1 - (v - v0) * slope, v0 = mean velocity at 1RM. Only used to LOWER the rep ceiling. */
export const velocityImpliedIntensity = (v, profile) => 1 - (v - profile.v0) * profile.slope

function setIntensity(set, hist, c, profile, reps) {
  const kg = loadedKg(set)
  const v = set.metrics?.mean_velocity_ms
  if (hist && hist.sessions >= c.MIN_HISTORY_SESSIONS && hist.bestE1rm > 0 && kg > 0) {
    return { intensity: clamp(kg / hist.bestE1rm, c.INTENSITY_MIN, c.INTENSITY_MAX), source: 'history' }
  }
  const ceiling = reps > c.HIGH_REP_THRESHOLD ? Math.max(repImpliedIntensity(reps), c.HIGH_REP_FLOOR) : repImpliedIntensity(reps)
  if (profile && isNum(v) && v > 0) {
    const drop = clamp(c.VELOCITY_SHARE * (velocityImpliedIntensity(v, profile) - ceiling), -c.VELOCITY_MAX_DROP, 0)
    if (drop < -0.005) return { intensity: clamp(ceiling + drop, c.INTENSITY_MIN, c.INTENSITY_MAX), source: 'velocity' }
  }
  return { intensity: clamp(ceiling, c.INTENSITY_MIN, c.INTENSITY_MAX), source: 'reps' }
}

/**
 * @param {object} p
 * @param {Array<{ name: string, name_key?: string, sets: object[] }>} p.exercises - shape of fetchGymDetail()
 * @param {number|null} [p.durationS] - session elapsed (or moving) time
 * @param {number|null} [p.avgHr]
 * @param {Record<string, {sessions:number, bestE1rm:number|null}>} [p.history] - summarizeHistory() of PRIOR sessions
 * @param {number|null} [p.typicalHr] - typicalGymHr() of prior sessions
 * @param {object} [p.constants] - overrides of GYM_LOAD_CONSTANTS (tuning / tests)
 * @returns {{ load: number, breakdown: object[], density: object, flags: string[], inputsUsed: object }}
 */
export function computeGymLoad({ exercises = [], durationS = null, avgHr = null, history = {}, typicalHr = null, constants = {} } = {}) {
  const c = { ...GYM_LOAD_CONSTANTS, ...constants }
  const flags = []
  const breakdown = []
  let rawStress = 0
  let workingSets = 0
  let workingTimeS = 0
  let restS = 0
  const used = { history: false, reps: false, velocity: false, dynamic: false, height: false, hr: false, density: false }

  for (const ex of exercises) {
    const key = keyOf(ex)
    const cat = ex.catalogue || null
    const hist = history[histKeyOf(ex)] ?? history[key]
    const dynamicByName = cat ? cat.movement_type !== 'strength' : DYNAMIC_NAME.test(ex.name || '')
    const row = { name: ex.name, name_key: key, catalogue_id: cat?.id ?? null, workingSets: 0, intensity: null, source: null, stress: 0 }
    let wReps = 0
    let wIntensity = 0
    const sources = new Set()
    const sets = ex.sets || []
    sets.forEach((s) => {
      if (s.set_type === 'rest') {
        if (isNum(s.duration_s)) restS += s.duration_s
        return
      }
      if (!isWorking(s)) return
      if (isNum(s.rest_s)) restS += s.rest_s
      const lossPct = s.metrics?.velocity_loss_pct
      if (isNum(lossPct) && lossPct >= c.VELOCITY_LOSS_FLAG_PCT) flags.push(`velocity_loss_high:${ex.name}`)
      const hasReps = isNum(s.reps) && s.reps > 0
      const dynamic = dynamicByName || loadedKg(s) <= 0
      const reps = hasReps ? s.reps : dynamic && isNum(s.duration_s) ? s.duration_s / c.SECONDS_PER_REP_EQUIV : 0
      if (!(reps > 0)) {
        flags.push(`set_skipped_no_reps:${ex.name}`)
        return
      }
      workingSets++
      row.workingSets++
      if (isNum(s.duration_s)) workingTimeS += s.duration_s
      let intensity
      let source
      if (dynamic) {
        if (dynamicByName && loadedKg(s) > 0 && cat?.movement_type !== 'jump') flags.push(`dynamic_with_weight:${ex.name}`)
        intensity = c.DYNAMIC_INTENSITY
        const h = s.metrics?.height_cm
        if (cat && isNum(h) && h > 0) {
          intensity = clamp(c.DYNAMIC_INTENSITY * (1 + c.HEIGHT_SLOPE * (h / c.HEIGHT_REF_CM - 1)), c.HEIGHT_INTENSITY_MIN, c.HEIGHT_INTENSITY_MAX)
          used.height = true
        }
        source = 'dynamic'
        used.dynamic = true
      } else {
        const unilateral = cat ? !!cat.unilateral : reps > c.UNILATERAL_REPS_ABOVE || UNILATERAL_NAME.test(ex.name || '')
        const perSide = unilateral ? reps / 2 : reps
        ;({ intensity, source } = setIntensity(s, hist, c, c.velocityProfiles?.[key], perSide))
        if (unilateral) {
          if (!cat) flags.push(`assumed_unilateral:${ex.name}`)
          row.assumedUnilateral = !cat
          row.unilateral = true
        }
        if (perSide > c.HIGH_REP_THRESHOLD && source !== 'history') flags.push(`high_rep_floor:${ex.name}`)
        used[source === 'history' ? 'history' : source === 'velocity' ? 'velocity' : 'reps'] = true
      }
      sources.add(source)
      const stress = reps * intensity ** c.K
      row.stress += stress
      wReps += reps
      wIntensity += reps * intensity
    })
    if (!row.workingSets) continue
    row.intensity = round(wIntensity / wReps)
    row.source = sources.size === 1 ? [...sources][0] : 'mixed'
    row.sources = [...sources]
    row.stress = round(row.stress)
    if (sources.has('reps') || sources.has('velocity')) flags.push(`ceiling_intensity:${ex.name}`)
    rawStress += row.stress
    breakdown.push(row)
  }
  if (used.dynamic) flags.push('dynamic_sets_fixed_stress')
  if (!workingSets) flags.push('no_working_sets')

  const density = { workingSets, totalTimeS: isNum(durationS) ? durationS : null, workingTimeS: round(workingTimeS, 0), restS: round(restS, 0), setsPerMin: null, multiplier: 1 }
  if (workingSets && isNum(durationS) && durationS >= 300) {
    density.setsPerMin = round(workingSets / (durationS / 60), 3)
    density.multiplier = round(clamp(Math.sqrt(density.setsPerMin / c.DENSITY_REF_SETS_PER_MIN), c.DENSITY_MIN, c.DENSITY_MAX), 3)
    used.density = true
  }

  let hrMultiplier = 1
  if (isNum(avgHr) && avgHr > 0 && isNum(typicalHr) && typicalHr > 0) {
    hrMultiplier = round(clamp(1 + c.HR_GAIN * (avgHr / typicalHr - 1), c.HR_MIN, c.HR_MAX), 3)
    used.hr = true
  } else if (isNum(avgHr) && avgHr > 0) {
    flags.push('hr_skipped_no_reference')
  }

  const load = workingSets ? round(rawStress * c.SCALE * density.multiplier * hrMultiplier, 1) : 0
  return {
    load,
    breakdown,
    density,
    flags: [...new Set(flags)],
    inputsUsed: { ...used, hrMultiplier, rawStress: round(rawStress), scale: c.SCALE, rpe: false },
  }
}
