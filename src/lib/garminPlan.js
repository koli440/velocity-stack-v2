// src/lib/garminPlan.js
//
// Pure converter from a planned workout (see plannedWorkouts.js) to a Garmin Connect Training API workout (#310),
// mirroring wahooPlan.js: nothing is dropped silently, whatever Garmin cannot express becomes a warning.
//
// Mapping (single-sided bands use their bound as the target):
//  - %FTP / %LT2 / %LT1 / power zones -> absolute watts from the rider's Velocity Stack FTP, LT1/LT2 and zone setup (without any the step keeps its length only),
//    W -> the rider's power target type (default POWER_LAP = interval average), rpm -> CADENCE, bpm -> HEART_RATE, km/h -> SPEED (m/s).
//  - %HRmax, %LT1HR, %LT2HR, W/kg and best-effort steps have no reliable Garmin target: the step keeps its length.
//  - Distance steps use DISTANCE (metres). Warm-up / cool-down are duration-only steps.
// Workouts without steps (free text, fixed track patterns) cannot be sent: Garmin workouts need at least one step.

import { basisFromFtp, bandToWatts, MISSING_POWER_NOTE, withBasis, hashBase } from './pushPower.js'
import { parseStructure } from './plannedWorkouts.js'

/** Bump when the output format changes so already pushed workouts are seen as out of date. */
export const GARMIN_CONVERTER_VERSION = 4
// Provider and source id: 20 characters at most, and the source id should equal the provider (Training API V2).
export const GARMIN_PROVIDER_NAME = 'VelocityStack'
// Training API V2 power target types: what the Edge shows as the step's power field and compares to the range.
export const GARMIN_POWER_TARGETS = Object.freeze({
  POWER: 'Current power',
  POWER_3S: '3 s average',
  POWER_10S: '10 s average',
  POWER_30S: '30 s average',
  POWER_LAP: 'Lap (interval) average',
})
export const DEFAULT_GARMIN_POWER_TARGET = 'POWER_LAP'
export const normalizePowerTarget = (v) => (Object.hasOwn(GARMIN_POWER_TARGETS, v) ? v : DEFAULT_GARMIN_POWER_TARGET)
const MAX_STEPS = 100 // single-sport workouts
export const GARMIN_PUSH_DISCIPLINES = ['ride', 'track']
const MAX_NAME = 80
const MAX_DESCRIPTION = 1024


const bound = (lo, hi) => {
  const a = lo ?? hi
  const b = hi ?? lo
  return a == null ? null : [Math.min(a, b), Math.max(a, b)]
}
const r1 = (n) => Math.round(n * 10) / 10

/** Target of a step's band -> { target, warning, note } (target null = no usable target). */
function convertTarget(step, { basis, powerTarget }) {
  const { bandType: t, powerMin: lo, powerMax: hi } = step
  const b = bound(lo, hi)
  const out = { target: null, warning: null, note: null }
  if (!b) return out
  if (['pct_ftp', 'pct_lt1', 'pct_lt2', 'zone'].includes(t)) {
    const w = bandToWatts(step, basis)
    if (!w) return { ...out, note: MISSING_POWER_NOTE }
    const wb = bound(w.min, w.max)
    if (!wb) return out
    return { ...out, target: { type: powerTarget, low: Math.round(wb[0]), high: Math.round(wb[1]) }, warning: w.warning }
  }
  switch (t) {
    case 'watts':
      return { ...out, target: { type: powerTarget, low: Math.round(b[0]), high: Math.round(b[1]) } }
    case 'cadence_rpm':
      return { ...out, target: { type: 'CADENCE', low: Math.round(b[0]), high: Math.round(b[1]) } }
    case 'hr_bpm':
      return { ...out, target: { type: 'HEART_RATE', low: Math.round(b[0]), high: Math.round(b[1]) } }
    case 'speed_kmh':
      return { ...out, target: { type: 'SPEED', low: r1(b[0] / 3.6), high: r1(b[1] / 3.6) } }
    default:
      return { ...out, note: 'Heart-rate percentage, W/kg and best-effort targets are not sent to Garmin.' }
  }
}

function newCounter() {
  let n = 0
  return () => ++n
}

function simpleStep(next, description, seconds, intensity) {
  return {
    type: 'WorkoutStep',
    stepOrder: next(),
    intensity,
    description,
    durationType: 'TIME',
    durationValue: Math.round(seconds),
    targetType: 'OPEN',
  }
}

function workStep(step, ctx) {
  const t = convertTarget(step, ctx)
  if (t.warning) ctx.warnings.add(t.warning)
  if (t.note) ctx.warnings.add(t.note)
  const byDistance = step.keyBy === 'distance'
  const value = byDistance ? Math.round(step.targetDistanceM) : Math.round(step.targetDurationSec)
  if (!(value > 0)) return null
  const out = {
    type: 'WorkoutStep',
    stepOrder: ctx.next(),
    intensity: step.role === 'recovery' ? 'RECOVERY' : 'INTERVAL',
    description: step.role === 'recovery' ? 'Recovery' : 'Work',
    durationType: byDistance ? 'DISTANCE' : 'TIME',
    durationValue: value,
    ...(byDistance ? { durationValueType: 'METER' } : {}),
    targetType: t.target ? t.target.type : 'OPEN',
  }
  if (t.target) {
    out.targetValueLow = t.target.low
    out.targetValueHigh = t.target.high
  }
  return out
}

const leaves = (items) => items.flatMap((it) => (it.items ? Array.from({ length: it.repeat }, () => leaves(it.items)).flat() : [it]))

function repeatBlock(stepList, times, ctx) {
  if (times <= 1) return stepList.map((s) => workStep(s, ctx)).filter(Boolean)
  const repeatOrder = ctx.next()
  const steps = stepList.map((s) => workStep(s, ctx)).filter(Boolean)
  if (!steps.length) return []
  return [{ type: 'WorkoutRepeatStep', stepOrder: repeatOrder, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue: times, steps }]
}

function mainSteps(manifest, ctx) {
  const reps = Math.max(1, Number(manifest.repeat_count) || 1)
  const sets = Math.max(1, Number(manifest.set_count) || 1)
  const out = []
  for (let set = 0; set < sets; set++) {
    if (set > 0 && manifest.set_recovery) out.push(...repeatBlock([manifest.set_recovery], 1, ctx))
    if (reps > 1 || !Array.isArray(manifest.structure) || !manifest.structure.length) {
      out.push(...repeatBlock(manifest.steps, reps, ctx))
    } else {
      let plain = []
      const flush = () => {
        out.push(...repeatBlock(plain, 1, ctx))
        plain = []
      }
      for (const it of manifest.structure) {
        if (!it.items) plain.push(it)
        else {
          flush()
          out.push(...repeatBlock(leaves(it.items), Math.max(1, it.repeat), ctx))
        }
      }
      flush()
    }
  }
  return out
}

/** Seconds of a (nested) step list; distance steps are unknown and skipped. */
export function stepsSeconds(list) {
  return list.reduce((sum, s) => {
    if (s.type === 'WorkoutRepeatStep') return sum + stepsSeconds(s.steps || []) * Number(s.repeatValue)
    return sum + (s.durationType === 'TIME' ? Number(s.durationValue) : 0)
  }, 0)
}

function manifestOf(workout, warnings) {
  const dsl = String(workout.structure_dsl ?? '').trim()
  let manifest = null
  if (dsl) {
    manifest = parseStructure(dsl).manifest
    if (!manifest) warnings.add('The workout definition could not be read, so it cannot be sent to Garmin.')
  }
  return manifest || (workout.structure_manifest && typeof workout.structure_manifest === 'object' ? workout.structure_manifest : null)
}

/**
 * @param {object} workout planned workout row
 * @param {{ ftp?: number|null, basis?: object|null, powerTarget?: string }} [opts] rider power basis (buildPowerBasis: FTP, LT1/LT2, zones; ftp = FTP-only fallback); power target type (see GARMIN_POWER_TARGETS)
 * @returns {{ workout: object|null, minutes: number, warnings: string[], structured: boolean }}
 */
export function buildGarminWorkout(workout, { ftp = null, basis = null, powerTarget = DEFAULT_GARMIN_POWER_TARGET } = {}) {
  const warnings = new Set()
  const next = newCounter()
  const ctx = { basis: basis || basisFromFtp(ftp), powerTarget: normalizePowerTarget(powerTarget), warnings, next }
  const manifest = manifestOf(workout, warnings)
  const name = String(workout.title ?? '').trim().slice(0, MAX_NAME) || 'Workout'
  const description = String(workout.description ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_DESCRIPTION)

  const steps = []
  if (manifest && Array.isArray(manifest.steps) && manifest.steps.length) {
    if (manifest.warmup_sec > 0) steps.push(simpleStep(next, 'Warmup', manifest.warmup_sec, 'WARMUP'))
    steps.push(...mainSteps(manifest, ctx))
    if (manifest.cooldown_sec > 0) steps.push(simpleStep(next, 'Cooldown', manifest.cooldown_sec, 'COOLDOWN'))
  } else if (manifest) {
    warnings.add(`The fixed pattern "${String(manifest.pattern || 'unknown').replace(/_/g, ' ')}" has no steps, so it cannot be sent to Garmin.`)
  }

  const seconds = stepsSeconds(steps)
  const minutes = seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0
  if (!steps.length) return { workout: null, minutes, warnings: [...warnings], structured: false }
  const count = (list) => list.reduce((n, s) => n + 1 + (s.steps ? count(s.steps) : 0), 0)
  if (count(steps) > MAX_STEPS) {
    warnings.add(`Garmin accepts at most ${MAX_STEPS} steps in a workout; this one is too long to send.`)
    return { workout: null, minutes, warnings: [...warnings], structured: false }
  }

  const body = {
    workoutName: name,
    sport: 'CYCLING',
    workoutProvider: GARMIN_PROVIDER_NAME,
    workoutSourceId: GARMIN_PROVIDER_NAME,
    isSessionTransitionEnabled: false,
    segments: [{ segmentOrder: 1, sport: 'CYCLING', steps }],
  }
  if (description) body.description = description
  return { workout: body, minutes, warnings: [...warnings], structured: true }
}

// 53-bit string hash (cyrb53): change detection only. Same algorithm as the Intervals and Wahoo pushes.
function cyrb53(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Hash of what the rider edits (plus the converter version and the rider's power target type). */
export function garminPushHash(workout, powerTarget = DEFAULT_GARMIN_POWER_TARGET, basis = null) {
  return withBasis(cyrb53(
    JSON.stringify([
      GARMIN_CONVERTER_VERSION,
      normalizePowerTarget(powerTarget),
      String(workout.workout_date).slice(0, 10),
      workout.discipline || 'ride',
      String(workout.title ?? '').trim(),
      String(workout.description ?? '').trim(),
      String(workout.structure_dsl ?? '').replace(/\r\n?/g, '\n').trim(),
    ])
  ), basis)
}

/** Push state for the UI from a planned_workout_garmin_pushes row: 'not_pushed' | 'pushed' | 'out_of_date' | 'error'. */
export function garminPushState(workout, row, ctx = null) {
  if (!row || row.push_status === 'pending_delete') return 'not_pushed'
  if (row.push_status === 'error' && row.last_error) return 'error'
  if (!row.garmin_workout_id) return 'not_pushed'
  return hashBase(row.pushed_hash) === garminPushHash(workout, ctx?.power_target) ? 'pushed' : 'out_of_date'
}

export const GARMIN_PUSH_STATE_LABELS = Object.freeze({
  not_pushed: 'Not in Garmin',
  pushed: 'In Garmin',
  out_of_date: 'Changed since pushed',
  error: 'Push failed',
})
