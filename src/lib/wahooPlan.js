// src/lib/wahooPlan.js
//
// Pure converter from a planned workout (see plannedWorkouts.js) to what Wahoo Cloud needs (#311):
//  - a plan file (https://cloud-api.wahooligan.com/docs/plan-json-format.pdf, version 1.0.0) with the steps, and
//  - the parent workout record (name, day, duration) that schedules it.
// Like intervalsWorkout.js nothing is dropped silently: whatever Wahoo cannot express becomes a warning.
//
// Mapping (single-sided bands use their bound as the target):
//  - %FTP -> "ftp" target (needs the rider's FTP in the header; without it the step keeps its duration only),
//    W -> "watts", rpm -> "rpm", bpm -> "hr", km/h -> "speed" (m/s).
//  - %LT2 -> %FTP, %LT1 -> 75% of that, power zones -> %FTP via the default zone model (all with a warning).
//  - %HRmax, %LT1HR, %LT2HR, W/kg and best-effort steps have no reliable plan target: the step keeps its length.
//  - Distance steps use Wahoo's distance trigger. Warm-up / cool-down are duration-only steps.
//  - Wahoo bike computers only show the first target of an interval.
// Workouts without steps (free text, fixed track patterns) are scheduled without a plan.

import { FTP_LT1_FRACTION } from './powerZones.js'
import { parseStructure } from './plannedWorkouts.js'
import { zoneBoundsPctFtp } from './intervalsWorkout.js'

/** Bump when the output format changes so already pushed workouts are seen as out of date. */
export const WAHOO_CONVERTER_VERSION = 1
export const WAHOO_EXTERNAL_ID_PREFIX = 'velocity-stack:'
export const WAHOO_BIKING_TYPE_ID = 0
export const WAHOO_PLAN_VERSION = '1.0.0'
export const WAHOO_PUSH_DISCIPLINES = ['ride', 'track']
const MAX_DESCRIPTION = 5000
const DEFAULT_MINUTES = 60
// Noon UTC keeps the scheduled day stable for riders in any common timezone; day_code carries the date itself.
const DAY_CODE_EPOCH = Date.UTC(2020, 0, 1)

export const wahooExternalId = (workoutId) => `${WAHOO_EXTERNAL_ID_PREFIX}${workoutId}`

const r3 = (n) => Math.round(n * 1000) / 1000

/** Days since 2020-01-01 for 'YYYY-MM-DD'. */
export function wahooDayCode(date) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - DAY_CODE_EPOCH) / 86400000)
}

const bound = (lo, hi) => {
  const a = lo ?? hi
  const b = hi ?? lo
  return a == null ? null : [Math.min(a, b), Math.max(a, b)]
}

/** Target of a step's band -> { target, warning, note } (target null = no usable plan target). */
function convertTarget(step, { ftp }) {
  const { bandType: t, powerMin: lo, powerMax: hi } = step
  const b = bound(lo, hi)
  const out = { target: null, warning: null, note: null }
  if (!b) return out
  const rel = (type, scale, warning) => {
    if (!ftp) return { ...out, note: 'Set your FTP in your profile to send power targets as % of FTP.' }
    return { ...out, target: { type, low: r3(b[0] * scale), high: r3(b[1] * scale) }, warning: warning || null }
  }
  switch (t) {
    case 'pct_ftp':
      return rel('ftp', 0.01)
    case 'pct_lt2':
      return rel('ftp', 0.01, 'LT2 power targets were sent as % of FTP (LT2 is approximated by FTP).')
    case 'pct_lt1':
      return rel('ftp', 0.01 * FTP_LT1_FRACTION, 'LT1 power targets were sent as % of FTP (LT1 is approximated by 75% of FTP).')
    case 'zone': {
      const min = lo == null ? null : hi == null ? zoneBoundsPctFtp(lo)[1] : zoneBoundsPctFtp(lo)[0]
      const max = hi == null ? null : lo == null ? zoneBoundsPctFtp(hi)[0] : zoneBoundsPctFtp(hi)[1]
      const zb = bound(min, max)
      if (!zb) return out
      if (!ftp) return { ...out, note: 'Set your FTP in your profile to send power zones as targets.' }
      return {
        ...out,
        target: { type: 'ftp', low: r3(zb[0] / 100), high: r3(zb[1] / 100) },
        warning: 'Power zones were sent as % of FTP using the default zone model (your custom zones are not applied).',
      }
    }
    case 'watts':
      return { ...out, target: { type: 'watts', low: Math.round(b[0]), high: Math.round(b[1]) } }
    case 'cadence_rpm':
      return { ...out, target: { type: 'rpm', low: Math.round(b[0]), high: Math.round(b[1]) } }
    case 'hr_bpm':
      return { ...out, target: { type: 'hr', low: Math.round(b[0]), high: Math.round(b[1]) } }
    case 'speed_kmh':
      return { ...out, target: { type: 'speed', low: r3(b[0] / 3.6), high: r3(b[1] / 3.6) } }
    default:
      return { ...out, note: 'Heart-rate percentage, W/kg and best-effort targets are not sent to Wahoo.' }
  }
}

function stepInterval(step, label, ctx) {
  const t = convertTarget(step, ctx)
  if (t.warning) ctx.warnings.add(t.warning)
  if (t.note) ctx.warnings.add(t.note)
  const byDistance = step.keyBy === 'distance'
  const value = byDistance ? Math.round(step.targetDistanceM) : Math.round(step.targetDurationSec)
  if (!(value > 0)) return null
  const interval = {
    name: label,
    exit_trigger_type: byDistance ? 'distance' : 'time',
    exit_trigger_value: value,
    intensity_type: step.role === 'recovery' ? 'recover' : 'active',
  }
  if (t.target) interval.targets = [t.target]
  return interval
}

const leaves = (items) => items.flatMap((it) => (it.items ? Array.from({ length: it.repeat }, () => leaves(it.items)).flat() : [it]))
const stepName = (step) => (step.role === 'recovery' ? 'Recovery' : 'Work')

function simpleInterval(name, seconds, intensity) {
  return { name, exit_trigger_type: 'time', exit_trigger_value: Math.round(seconds), intensity_type: intensity }
}

function repeatBlock(name, stepList, times, ctx) {
  const intervals = stepList.map((s) => stepInterval(s, stepName(s), ctx)).filter(Boolean)
  if (!intervals.length) return []
  if (times <= 1) return intervals
  // Wahoo repeats "after the first iteration": value 2 = three iterations.
  return [{ name, exit_trigger_type: 'repeat', exit_trigger_value: times - 1, intervals }]
}

function mainIntervals(manifest, ctx) {
  const steps = manifest.steps
  const reps = Math.max(1, Number(manifest.repeat_count) || 1)
  const sets = Math.max(1, Number(manifest.set_count) || 1)
  const out = []
  for (let set = 0; set < sets; set++) {
    if (set > 0 && manifest.set_recovery) out.push(...repeatBlock('Set recovery', [manifest.set_recovery], 1, ctx))
    if (reps > 1 || !Array.isArray(manifest.structure) || !manifest.structure.length) {
      out.push(...repeatBlock(`Main set ${reps}x`, steps, reps, ctx))
    } else {
      let plain = []
      const flush = () => {
        out.push(...repeatBlock('Main set', plain, 1, ctx))
        plain = []
      }
      for (const it of manifest.structure) {
        if (!it.items) plain.push(it)
        else {
          flush()
          out.push(...repeatBlock(`Main set ${it.repeat}x`, leaves(it.items), Math.max(1, it.repeat), ctx))
        }
      }
      flush()
    }
  }
  return out
}

/** Seconds of a (nested) interval list; distance steps are unknown and skipped. */
export function intervalsSeconds(list) {
  return list.reduce((sum, i) => {
    if (i.exit_trigger_type === 'repeat') return sum + intervalsSeconds(i.intervals || []) * (Number(i.exit_trigger_value) + 1)
    return sum + (i.exit_trigger_type === 'time' ? Number(i.exit_trigger_value) : 0)
  }, 0)
}

function manifestOf(workout, warnings) {
  const dsl = String(workout.structure_dsl ?? '').trim()
  let manifest = null
  if (dsl) {
    manifest = parseStructure(dsl).manifest
    if (!manifest) warnings.add('The workout definition could not be read, so it was sent without steps.')
  }
  return manifest || (workout.structure_manifest && typeof workout.structure_manifest === 'object' ? workout.structure_manifest : null)
}

/**
 * @param {object} workout planned workout row
 * @param {{ ftp?: number|null }} [opts] rider FTP in watts (profiles.ftp_w)
 * @returns {{ plan: object|null, minutes: number, warnings: string[], structured: boolean }}
 */
export function buildWahooWorkout(workout, { ftp = null } = {}) {
  const warnings = new Set()
  const ctx = { ftp: ftp > 0 ? Math.round(ftp) : null, warnings }
  const manifest = manifestOf(workout, warnings)
  const name = String(workout.title ?? '').trim().slice(0, 80) || 'Workout'
  const description = String(workout.description ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_DESCRIPTION)

  let intervals = []
  if (manifest && Array.isArray(manifest.steps) && manifest.steps.length) {
    if (manifest.warmup_sec > 0) intervals.push(simpleInterval('Warmup', manifest.warmup_sec, 'wu'))
    intervals.push(...mainIntervals(manifest, ctx))
    if (manifest.cooldown_sec > 0) intervals.push(simpleInterval('Cooldown', manifest.cooldown_sec, 'cd'))
  } else if (manifest) {
    warnings.add(`The fixed pattern "${String(manifest.pattern || 'unknown').replace(/_/g, ' ')}" has no steps, so it was sent without a plan.`)
  }

  const seconds = intervalsSeconds(intervals)
  const minutes = seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : DEFAULT_MINUTES
  if (!intervals.length) return { plan: null, minutes, warnings: [...warnings], structured: false }

  const header = {
    name,
    version: WAHOO_PLAN_VERSION,
    workout_type_family: WAHOO_BIKING_TYPE_ID,
    workout_type_location: 0,
  }
  if (description) header.description = description
  if (ctx.ftp) header.ftp = ctx.ftp
  return { plan: { header, intervals }, minutes, warnings: [...warnings], structured: true }
}

/** Form fields for POST/PUT /v1/workouts (the plan id is added once the plan exists). */
export function wahooWorkoutFields(workout, { minutes, planId = null }) {
  const date = String(workout.workout_date).slice(0, 10)
  const fields = {
    'workout[name]': String(workout.title ?? '').trim().slice(0, 80) || 'Workout',
    'workout[workout_token]': String(workout.id),
    'workout[workout_type_id]': String(WAHOO_BIKING_TYPE_ID),
    'workout[starts]': `${date}T12:00:00.000Z`,
    'workout[day_code]': String(wahooDayCode(date)),
    'workout[minutes]': String(minutes),
  }
  if (planId != null) fields['workout[plan_id]'] = String(planId)
  return fields
}

/** `data:` URI Wahoo expects for plan[file]. */
export function planFileDataUri(plan) {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(plan)).toString('base64')}`
}

// 53-bit string hash (cyrb53): change detection only. Same algorithm as the Intervals push.
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

/** Hash of what the rider edits (plus the converter version). The FTP used for % targets is read at push time, so an FTP change shows up on the next edit. */
export function wahooPushHash(workout) {
  return cyrb53(
    JSON.stringify([
      WAHOO_CONVERTER_VERSION,
      String(workout.workout_date).slice(0, 10),
      workout.discipline || 'ride',
      String(workout.title ?? '').trim(),
      String(workout.description ?? '').trim(),
      String(workout.structure_dsl ?? '').replace(/\r\n?/g, '\n').trim(),
    ])
  )
}

/** Push state for the UI from a planned_workout_wahoo_pushes row: 'not_pushed' | 'pushed' | 'out_of_date' | 'error'. */
export function wahooPushState(workout, row) {
  if (!row || row.push_status === 'pending_delete') return 'not_pushed'
  if (row.push_status === 'error' && row.last_error) return 'error'
  if (!row.wahoo_workout_id) return 'not_pushed'
  return row.pushed_hash === wahooPushHash(workout) ? 'pushed' : 'out_of_date'
}

export const WAHOO_PUSH_STATE_LABELS = Object.freeze({
  not_pushed: 'Not in Wahoo',
  pushed: 'In Wahoo',
  out_of_date: 'Changed since pushed',
  error: 'Push failed',
})
