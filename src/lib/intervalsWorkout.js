// src/lib/intervalsWorkout.js
//
// Pure converter from a planned workout (date + title + notes + DSL snapshot, see plannedWorkouts.js) to an
// Intervals.icu calendar event whose description is in Intervals.icu's workout syntax
// (https://forum.intervals.icu/t/workout-builder/1163):
//
//   Warmup
//   - Warmup 15m
//
//   Main set 4x
//   - Work 5m 90-110%
//   - Recovery 2m 55%
//
// Our DSL describes what a template DETECTS in a ride (windows with a tolerance), so for a planned workout
// we use the step target (duration/distance and the band) and ignore the detection tolerance. Whatever
// Intervals.icu cannot express is never dropped silently: it is listed as a warning and written as plain
// text under the steps, so the rider still sees it in Intervals.icu.
//
// Mapping choices (single-sided bands use their bound as the target: "<55%FTP" -> 55%, ">80%FTP" -> 80%):
//  - %FTP -> "lo-hi%"; W -> "lo-hiw"; %HRmax -> "lo-hi% HR"; %LT2HR -> "lo-hi% LTHR"; rpm -> "lo-hirpm".
//  - %LT2 -> %FTP (LT2 power is approximated by FTP), %LT1 -> 75% of that, like the zone model's FTP fallback.
//  - Power zones Z1-Z6 use a different model than Intervals.icu's zones, so they are converted to %FTP with
//    the default zone model (powerZones.js, LT1 = 75% FTP, LT2 = FTP) and a warning is added.
//  - W/kg needs the rider's weight (`weightKg`); without it the target is a note.
//  - best/max, bpm, %LT1HR and km/h bands have no Intervals.icu target: the step keeps its duration and the
//    target becomes a note.
//  - Distance steps: Intervals.icu would need the rider's pace settings, so a distance step is only pushed when a
//    km/h band lets us estimate its duration (distance / mid-speed); otherwise it is left out with a note.
//  - Sets are written as consecutive "Main set Nx" blocks (Intervals.icu has no nested repeats).
//  - Warm-up / cool-down lines become duration-only steps (the DSL has no target for them).
//  - Fixed track patterns (repeated_bursts, ...) have no step list: the event gets a plain-text description.

import { DEFAULT_ZONE_PCTS, FTP_LT1_FRACTION, FTP_LT2_FRACTION } from './powerZones.js'
import { parseStructure } from './plannedWorkouts.js'

/** Bump when the output format changes so already pushed workouts are seen as out of date. */
export const CONVERTER_VERSION = 1
export const EXTERNAL_ID_PREFIX = 'velocity-stack:'
export const MAX_DESCRIPTION_CHARS = 8000

const EVENT_TYPES = { ride: 'Ride', track: 'Ride', gym: 'WeightTraining', other: 'Workout' }

export const externalIdFor = (workoutId) => `${EXTERNAL_ID_PREFIX}${workoutId}`

const num = (n) => String(Math.round(n * 10) / 10)

/** Seconds -> "5m30s" / "90m" / "45s" (Intervals.icu reads m as minutes). */
export function formatStepDuration(sec) {
  const total = Math.max(1, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (!m) return `${s}s`
  return s ? `${m}m${s}s` : `${m}m`
}

function range(lo, hi, suffix) {
  if (lo != null && hi != null) return `${num(lo)}-${num(hi)}${suffix}`
  const bound = hi ?? lo
  return bound == null ? null : `${num(bound)}${suffix}`
}

const withSuffix = (text, word) => (text ? `${text} ${word}` : null)

/** [lower, upper] of zone `n` (1-6) as % of FTP under the default zone model; null = open end. */
function zoneBoundsPctFtp(zone) {
  const [z1, z2, z3, z4, z5] = DEFAULT_ZONE_PCTS
  const b = [z1 * FTP_LT1_FRACTION, z2 * FTP_LT1_FRACTION, z3 * FTP_LT2_FRACTION, z4 * FTP_LT2_FRACTION, z5 * FTP_LT2_FRACTION]
  return [zone <= 1 ? null : b[zone - 2], zone >= 6 ? null : b[zone - 1]]
}

function describeStep(step) {
  const size = step.keyBy === 'distance' ? `${num(step.targetDistanceM)}m` : formatStepDuration(step.targetDurationSec)
  const { bandType: t, powerMin: lo, powerMax: hi } = step
  if (t === 'best') return `${step.role} ${size} @ best${step.bestMetric && step.bestMetric !== 'power' ? ` ${step.bestMetric}` : ''}`
  if (t === 'zone') return `${step.role} ${size} @ ${lo != null && hi != null ? (lo === hi ? `Z${lo}` : `Z${lo}-Z${hi}`) : hi != null ? `<Z${hi}` : `>Z${lo}`}`
  const unit = { pct_ftp: '%FTP', watts: 'W', speed_kmh: 'km/h', pct_hrmax: '%HRmax', hr_bpm: 'bpm', cadence_rpm: 'rpm', pct_lt1: '%LT1', pct_lt2: '%LT2', pct_lt1_hr: '%LT1HR', pct_lt2_hr: '%LT2HR', wkg: 'W/kg' }[t] || ''
  const band = lo != null && hi != null ? `${num(lo)}-${num(hi)}${unit}` : hi != null ? `<${num(hi)}${unit}` : lo != null ? `>${num(lo)}${unit}` : ''
  return `${step.role} ${size}${band ? ` @ ${band}` : ''}`
}

/**
 * Intervals.icu target text of a step's band.
 * @returns {{ target: string|null, cadence: string|null, note: string|null, warning: string|null, estimatedSpeedKmh?: number|null }}
 */
function convertBand(step, { weightKg }) {
  const { bandType: t, powerMin: lo, powerMax: hi } = step
  const none = { target: null, cadence: null, note: null, warning: null }
  const unsupported = (why) => ({ ...none, note: `${describeStep(step)} (${why})` })
  switch (t) {
    case 'pct_ftp':
      return { ...none, target: range(lo, hi, '%') }
    case 'watts':
      return { ...none, target: range(lo, hi, 'w') }
    case 'pct_hrmax':
      return { ...none, target: withSuffix(range(lo, hi, '%'), 'HR') }
    case 'pct_lt2_hr':
      return { ...none, target: withSuffix(range(lo, hi, '%'), 'LTHR') }
    case 'cadence_rpm':
      return { ...none, cadence: range(lo, hi, 'rpm') }
    case 'pct_lt2':
      return { ...none, target: range(lo, hi, '%'), warning: 'LT2 power targets were sent as % of FTP (LT2 is approximated by FTP).' }
    case 'pct_lt1':
      return {
        ...none,
        target: range(lo != null ? lo * FTP_LT1_FRACTION : null, hi != null ? hi * FTP_LT1_FRACTION : null, '%'),
        warning: 'LT1 power targets were sent as % of FTP (LT1 is approximated by 75% of FTP).',
      }
    case 'zone': {
      // "<Zk" is below the lower edge of zone k, ">Zk" above its upper edge.
      const min = lo == null ? null : hi == null ? zoneBoundsPctFtp(lo)[1] : zoneBoundsPctFtp(lo)[0]
      const max = hi == null ? null : lo == null ? zoneBoundsPctFtp(hi)[0] : zoneBoundsPctFtp(hi)[1]
      return {
        ...none,
        target: range(min, max, '%'),
        warning: 'Power zones were sent as % of FTP using the default zone model (your custom zones are not applied).',
      }
    }
    case 'wkg':
      if (!(weightKg > 0)) return unsupported('W/kg needs your body weight, so no target was sent')
      return { ...none, target: range(lo != null ? Math.round(lo * weightKg) : null, hi != null ? Math.round(hi * weightKg) : null, 'w') }
    case 'speed_kmh':
      return { ...none, estimatedSpeedKmh: hi != null && lo != null ? (lo + hi) / 2 : hi ?? lo, note: `${describeStep(step)} (speed targets are not supported by Intervals.icu)` }
    case 'best':
      return unsupported('a best-effort step has no fixed target')
    case 'hr_bpm':
      return unsupported('absolute heart-rate targets are not supported by Intervals.icu')
    case 'pct_lt1_hr':
      return unsupported('LT1 heart-rate targets are not supported by Intervals.icu')
    default:
      return unsupported('unknown target')
  }
}

/**
 * Converts one DSL step to a workout line, or null when it cannot be expressed.
 * @returns {{ line: string|null, notes: string[], warnings: string[] }}
 */
function convertStep(step, label, ctx) {
  const notes = []
  const warnings = []
  const band = convertBand(step, ctx)
  let seconds = step.keyBy === 'duration' ? step.targetDurationSec : null

  if (step.keyBy === 'distance') {
    if (band.estimatedSpeedKmh > 0) {
      seconds = (step.targetDistanceM / 1000 / band.estimatedSpeedKmh) * 3600
      warnings.push(`A distance step (${describeStep(step)}) was converted to a duration using its mid speed.`)
    } else {
      notes.push(`${describeStep(step)} (distance steps are not supported without a speed target, so this step was left out)`)
      return { line: null, notes, warnings }
    }
  } else if (band.note) {
    notes.push(band.note)
  }
  if (band.warning) warnings.push(band.warning)
  if (!(seconds > 0)) return { line: null, notes, warnings }

  const parts = [label, formatStepDuration(seconds), band.target, band.cadence].filter(Boolean)
  return { line: `- ${parts.join(' ')}`, notes, warnings }
}

const roleLabel = (role) => (role === 'recovery' ? 'Recovery' : 'Work')

/** Notes are free text: a leading "-" would be read as a workout step, so neutralise it. */
function safeNotes(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd().replace(/^\s*[-*]\s+/, '• '))
    .join('\n')
    .trim()
}

/**
 * Intervals.icu workout text for a manifest (the `custom_intervals` shape of buildIntervalManifest).
 * @returns {{ text: string, structured: boolean, notes: string[], warnings: string[] }}
 */
export function manifestToIntervalsText(manifest, { weightKg = null } = {}) {
  const warnings = []
  const notes = []
  const steps = Array.isArray(manifest?.steps) ? manifest.steps : []
  if (!steps.length) {
    return { text: '', structured: false, notes, warnings: [`The fixed pattern "${String(manifest?.pattern || 'unknown').replace(/_/g, ' ')}" has no steps, so only a text description was sent.`] }
  }
  const ctx = { weightKg }
  const blocks = []

  const block = (header, stepList, labels) => {
    const lines = []
    stepList.forEach((s, i) => {
      const r = convertStep(s, labels[i], ctx)
      notes.push(...r.notes)
      warnings.push(...r.warnings)
      if (r.line) lines.push(r.line)
    })
    if (lines.length) blocks.push([header, ...lines].join('\n'))
  }

  if (manifest.warmup_sec > 0) blocks.push(`Warmup\n- Warmup ${formatStepDuration(manifest.warmup_sec)}`)

  const reps = Math.max(1, Number(manifest.repeat_count) || 1)
  const sets = Math.max(1, Number(manifest.set_count) || 1)
  const labels = steps.map((s) => roleLabel(s.role))
  for (let set = 0; set < sets; set++) {
    if (set > 0 && manifest.set_recovery) block('Set recovery', [manifest.set_recovery], ['Recovery'])
    block(reps > 1 ? `Main set ${reps}x` : 'Main set', steps, labels)
    // Notes/warnings of a repeated set are identical; keep them once.
  }
  if (manifest.cooldown_sec > 0) blocks.push(`Cooldown\n- Cooldown ${formatStepDuration(manifest.cooldown_sec)}`)

  return {
    text: blocks.join('\n\n'),
    structured: blocks.some((b) => /^- /m.test(b)),
    notes: [...new Set(notes)],
    warnings: [...new Set(warnings)],
  }
}

/**
 * The Intervals.icu event for a planned workout.
 * @param {{ id?: string, workout_date: string, title: string, description?: string, discipline?: string,
 *           structure_dsl?: string|null, structure_manifest?: object|null }} workout
 * @param {{ weightKg?: number|null }} [opts]
 * @returns {{ event: { category: 'WORKOUT', type: string, name: string, start_date_local: string, description: string, external_id?: string },
 *             structured: boolean, warnings: string[] }}
 */
export function buildIntervalsEvent(workout, { weightKg = null } = {}) {
  const warnings = []
  let manifest = null
  const dsl = String(workout.structure_dsl ?? '').trim()
  if (dsl) {
    const parsed = parseStructure(dsl)
    manifest = parsed.manifest
    if (!manifest) warnings.push('The workout definition could not be read, so only a text description was sent.')
  }
  manifest = manifest || (workout.structure_manifest && typeof workout.structure_manifest === 'object' ? workout.structure_manifest : null)

  let text = ''
  let structured = false
  let notes = []
  if (manifest) {
    const r = manifestToIntervalsText(manifest, { weightKg })
    text = r.text
    structured = r.structured
    notes = r.notes
    warnings.push(...r.warnings)
  }

  const tail = []
  if (notes.length) tail.push(`Not sent as steps:\n${notes.map((n) => `  ${n}`).join('\n')}`)
  if (manifest && !structured && dsl) tail.push(`Workout (Velocity Stack): ${dsl.split(/\n/).map((l) => l.trim()).filter(Boolean).join(' · ')}`)
  const userNotes = safeNotes(workout.description)
  if (userNotes) tail.push(userNotes)

  let description = [text, ...tail].filter(Boolean).join('\n\n')
  if (description.length > MAX_DESCRIPTION_CHARS) {
    warnings.push('The workout is too long for Intervals.icu, so the description was shortened.')
    description = `${description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
    structured = false
  }

  const event = {
    category: 'WORKOUT',
    type: EVENT_TYPES[workout.discipline] || 'Ride',
    name: String(workout.title ?? '').trim().slice(0, 80) || 'Workout',
    start_date_local: `${String(workout.workout_date).slice(0, 10)}T00:00:00`,
    description,
  }
  if (workout.id) event.external_id = externalIdFor(workout.id)
  return { event, structured, warnings: [...new Set(warnings)] }
}

// 53-bit string hash (cyrb53): change detection only, not security. Pure JS so the browser and the server agree.
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

/** Hash of everything that ends up in the Intervals.icu event (plus the converter version). */
export function plannedPushHash(workout) {
  return cyrb53(
    JSON.stringify([
      CONVERTER_VERSION,
      String(workout.workout_date).slice(0, 10),
      workout.discipline || 'ride',
      String(workout.title ?? '').trim(),
      String(workout.description ?? '').trim(),
      String(workout.structure_dsl ?? '').replace(/\r\n?/g, '\n').trim(),
    ])
  )
}

/**
 * Push state of a workout from its push row (planned_workout_pushes) for the UI:
 * 'not_pushed' | 'pushed' | 'out_of_date' | 'error'.
 */
export function pushState(workout, row) {
  if (!row || row.push_status === 'pending_delete') return 'not_pushed'
  if (row.push_status === 'error' && row.last_error) return 'error'
  if (!row.intervals_event_id) return 'not_pushed'
  return row.pushed_hash === plannedPushHash(workout) ? 'pushed' : 'out_of_date'
}

export const PUSH_STATE_LABELS = Object.freeze({
  not_pushed: 'Not in Intervals.icu',
  pushed: 'In Intervals.icu',
  out_of_date: 'Changed since pushed',
  error: 'Push failed',
})
