// Pure logic and data helpers for planned workouts (supabase/migrations/20261206000000_planned_workouts.sql):
// single workouts planned on a rider's calendar by the rider or the rider's active coach.
// The database enforces access, limits, stamps and the template snapshot; this module validates input for
// friendly errors, derives status / labels, suggests activity matches and builds the readable structure summary.

import { addDays, dayKey, parseDayKey } from './calendar.js'
import { BAND_SUFFIXES, buildIntervalManifest, parseIntervalDsl } from './intervalDsl.js'

export const PLANNED_TITLE_MAX = 80
export const PLANNED_DESCRIPTION_MAX = 2000
export const PLANNED_PER_DAY_MAX = 20
export const PLANNED_DSL_MAX = 4000
export const PLANNED_DISCIPLINES = Object.freeze(['ride', 'track', 'gym', 'other'])
export const PLANNED_DISCIPLINE_LABELS = Object.freeze({ ride: 'Ride', track: 'Track', gym: 'Gym', other: 'Other' })
export const PLANNED_COLUMNS =
  'id, rider_id, workout_date, discipline, title, description, structure_dsl, structure_manifest, source_template_name, status, activity_id, created_by, updated_by, set_by_coach, created_at, updated_at'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDayKey = (v) => typeof v === 'string' && DAY_RE.test(v)

/** Trims and validates a draft; returns { value } or { error }. */
export function validatePlanned({ title, description, discipline, day, hasTemplate = false } = {}) {
  const t = String(title ?? '').trim()
  const d = String(description ?? '').trim()
  if (!t && !hasTemplate) return { error: 'Add a title.' }
  if (t.length > PLANNED_TITLE_MAX) return { error: `Title is limited to ${PLANNED_TITLE_MAX} characters.` }
  if (d.length > PLANNED_DESCRIPTION_MAX) return { error: `Notes are limited to ${PLANNED_DESCRIPTION_MAX} characters.` }
  const disc = discipline ?? 'ride'
  if (!PLANNED_DISCIPLINES.includes(disc)) return { error: 'Pick a discipline.' }
  if (day !== undefined && !isDayKey(day)) return { error: 'Pick a day.' }
  return { value: { title: t, description: d, discipline: disc, ...(day !== undefined ? { day } : {}) } }
}

// --- Status ---------------------------------------------------------------------------------

/**
 * completed (linked to an activity) | skipped | missed (past day, not linked, not skipped) | planned.
 * "Missed" is derived, never stored; today is still "planned".
 */
export function plannedStatus(workout, today = new Date()) {
  if (!workout) return 'planned'
  if (workout.activity_id) return 'completed'
  if (workout.status === 'skipped') return 'skipped'
  if (isDayKey(workout.workout_date) && workout.workout_date < dayKey(today)) return 'missed'
  return 'planned'
}

export const PLANNED_STATUS_LABELS = Object.freeze({ planned: 'Planned', completed: 'Completed', skipped: 'Skipped', missed: 'Missed' })

// --- Labels ---------------------------------------------------------------------------------

/** "planned by You", "planned by coach Amy", "planned by former coach". `names` maps profile id -> name. */
export function plannedByLabel(workout, names = {}, viewerId = null) {
  if (!workout) return ''
  if (!workout.set_by_coach) {
    if (viewerId && workout.created_by === viewerId) return 'planned by You'
    return 'planned by rider'
  }
  const name = workout.created_by ? names[workout.created_by] : null
  if (viewerId && workout.created_by === viewerId) return 'planned by You (coach)'
  return name ? `planned by coach ${name}` : 'planned by former coach'
}

/** Extra "edited by X" label when someone other than the author last changed the workout. */
export function plannedEditedLabel(workout, names = {}, viewerId = null) {
  if (!workout || workout.updated_by === workout.created_by) return null
  if (workout.updated_by && viewerId && workout.updated_by === viewerId) return 'edited by You'
  const name = workout.updated_by ? names[workout.updated_by] : null
  if (name) return `edited by ${name}`
  // updated_by NULL: the editor's account is gone; only a coach can then differ from a rider author.
  return workout.updated_by ? 'edited' : workout.set_by_coach ? null : 'edited by former coach'
}

/** Profile ids whose names are needed to label these workouts. */
export function plannedProfileIds(workouts) {
  const ids = new Set()
  for (const w of workouts || []) {
    if (w.created_by) ids.add(w.created_by)
    if (w.updated_by) ids.add(w.updated_by)
  }
  return [...ids]
}

// --- DSL snapshot ---------------------------------------------------------------------------

/**
 * Parses the workout DSL text with the template editor's parser (the same one the database never
 * sees: it only checks size / shape). { empty } for blank text; else { dsl, manifest, errors }.
 * `manifest` is null when there are errors. Errors are { line, message }.
 */
export function parseStructure(text) {
  const dsl = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!dsl) return { empty: true, dsl: '', manifest: null, errors: [] }
  if (dsl.length > PLANNED_DSL_MAX) return { empty: false, dsl, manifest: null, errors: [{ line: 0, message: `The workout is limited to ${PLANNED_DSL_MAX} characters.` }] }
  const parsed = parseIntervalDsl(dsl)
  if (parsed.errors?.length) return { empty: false, dsl, manifest: null, errors: parsed.errors }
  return { empty: false, dsl, manifest: buildIntervalManifest(parsed), errors: [] }
}

// --- Structure summary ----------------------------------------------------------------------

const fmtMin = (sec) => (sec % 3600 === 0 && sec >= 3600 ? `${sec / 3600}h` : sec % 60 === 0 ? `${sec / 60}min` : sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}sec`)

function stepTarget(step) {
  const { bandType, powerMin: lo, powerMax: hi, bestMetric } = step
  if (bandType === 'best') return bestMetric ? `best ${bestMetric}` : 'best'
  if (bandType === 'zone') return lo != null && hi != null ? (lo === hi ? `Z${lo}` : `Z${lo}-Z${hi}`) : hi != null ? `<Z${hi}` : lo != null ? `>Z${lo}` : ''
  const unit = BAND_SUFFIXES[bandType] || ''
  if (lo != null && hi != null) return `${lo}-${hi}${unit}`
  if (hi != null) return `<${hi}${unit}`
  if (lo != null) return `>${lo}${unit}`
  return ''
}

const stepSize = (s) => (s.keyBy === 'distance' && s.targetDistanceM ? (s.targetDistanceM >= 1000 ? `${s.targetDistanceM / 1000}km` : `${s.targetDistanceM}m`) : s.targetDurationSec ? fmtMin(s.targetDurationSec) : '')

function stepText(step) {
  const target = stepTarget(step)
  return `${step.role === 'recovery' ? 'Recovery' : 'Work'} ${stepSize(step)}${target ? ` @ ${target}` : ''}`.trim()
}

/** Summary of a workout, computed from its parsed DSL (falls back to the stored manifest). */
export function workoutSummary(workout) {
  if (!workout) return null
  const parsed = workout.structure_dsl ? parseStructure(workout.structure_dsl) : null
  return summarizeStructure(parsed?.manifest || workout.structure_manifest)
}

/** Mid-point intensity (fraction of FTP) of a %FTP band, or null when it has no usable numbers. */
function ftpFraction(step) {
  if (step.bandType !== 'pct_ftp') return null
  const { powerMin: lo, powerMax: hi } = step
  const pct = lo != null && hi != null ? (lo + hi) / 2 : hi ?? lo
  return pct == null ? null : pct / 100
}

/**
 * Readable summary of a stored manifest (the engine's own fields, nothing new):
 *   { lines, durationS, load, partial }
 * lines: human lines ("4x", "Work 5min @ 90-110%FTP", ...). durationS: total estimate from duration-keyed
 * steps incl. warm-up / cool-down (null when unknown); `partial` when distance-keyed steps were left out.
 * load: rough training-load estimate (TSS-like, 100 = one hour at FTP) from %FTP bands, else null.
 * Legacy fixed patterns (no steps) give just their pattern name.
 */
export function summarizeStructure(manifest) {
  if (!manifest || typeof manifest !== 'object') return null
  const steps = Array.isArray(manifest.steps) ? manifest.steps : []
  if (!steps.length) {
    return manifest.pattern ? { lines: [`Pattern: ${String(manifest.pattern).replace(/_/g, ' ')}`], durationS: null, load: null, partial: false } : null
  }
  const reps = Math.max(1, Number(manifest.repeat_count) || 1)
  const sets = Math.max(1, Number(manifest.set_count) || 1)
  const lines = []
  if (manifest.warmup_sec) lines.push(`Warm-up ${fmtMin(manifest.warmup_sec)}`)
  const tree = Array.isArray(manifest.structure) && manifest.structure.length ? manifest.structure : null
  // Without a repeat header a plain step list (or one with repeated groups) is shown without a "1x" line.
  const pad = tree && reps === 1 && sets === 1 ? '' : '  '
  if (!tree || reps > 1 || sets > 1) lines.push(sets > 1 ? `${sets} sets of ${reps}x` : `${reps}x`)
  const writeItems = (items, indent) => {
    for (const it of items) {
      if (it.items) {
        lines.push(`${indent}${it.repeat}x`)
        writeItems(it.items, `${indent}  `)
      } else lines.push(`${indent}${stepText(it)}`)
    }
  }
  if (tree) writeItems(tree, pad)
  else for (const s of steps) lines.push(`  ${stepText(s)}`)
  if (sets > 1 && manifest.set_recovery) lines.push(`Set recovery ${stepSize(manifest.set_recovery)}${stepTarget(manifest.set_recovery) ? ` @ ${stepTarget(manifest.set_recovery)}` : ''}`)
  if (manifest.cooldown_sec) lines.push(`Cool-down ${fmtMin(manifest.cooldown_sec)}`)

  let seconds = (manifest.warmup_sec || 0) + (manifest.cooldown_sec || 0)
  let loadSum = 0
  let loadKnown = false
  let partial = false
  const perRep = steps.reduce((a, s) => a + (s.keyBy !== 'distance' ? s.targetDurationSec || 0 : 0), 0)
  if (steps.some((s) => s.keyBy === 'distance')) partial = true
  seconds += perRep * reps * sets
  if (sets > 1 && manifest.set_recovery?.targetDurationSec) seconds += manifest.set_recovery.targetDurationSec * (sets - 1)
  for (const s of steps) {
    const f = s.keyBy !== 'distance' ? ftpFraction(s) : null
    if (f != null) {
      loadKnown = true
      loadSum += (s.targetDurationSec / 3600) * f * f * 100 * reps * sets
    }
  }
  return {
    lines,
    durationS: seconds > 0 ? seconds : null,
    load: loadKnown ? Math.round(loadSum) : null,
    partial,
  }
}

// --- Matching planned vs. actual ----------------------------------------------------------

/**
 * Suggests which activities (calendar events of kind 'activity') complete which unlinked planned workouts:
 * same local day and same discipline; one activity per workout and vice versa. When a day has several
 * candidates the closest duration to the planned estimate wins, else the earliest. Returns a Map
 * workoutId -> activityId. It is only a suggestion: the user confirms or links manually.
 */
export function suggestMatches(workouts, activities) {
  const linked = new Set((workouts || []).filter((w) => w.activity_id).map((w) => w.activity_id))
  const free = (activities || []).filter((a) => a && a.kind !== 'planned' && !linked.has(a.id))
  const open = (workouts || []).filter((w) => !w.activity_id && w.status !== 'skipped')
  const taken = new Set()
  const out = new Map()
  const ordered = [...open].sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  for (const w of ordered) {
    const est = workoutSummary(w)?.durationS || null
    const candidates = free
      .filter((a) => !taken.has(a.id) && dayKey(a.date) === w.workout_date && a.discipline === w.discipline)
      .sort((a, b) => (est ? Math.abs((a.durationS || 0) - est) - Math.abs((b.durationS || 0) - est) : 0) || a.date - b.date || String(a.id).localeCompare(String(b.id)))
    if (candidates.length) {
      out.set(w.id, candidates[0].id)
      taken.add(candidates[0].id)
    }
  }
  return out
}

/**
 * Activities the given workout can be linked to: those of the planned DAY only (local day, like the calendar
 * cell), not linked to another workout, whatever their discipline (activities carry no discipline, the
 * calendar derives ride/track from the track). Same-discipline ones first, then by time.
 */
export function linkableActivities(workout, workouts, activities) {
  const linkedElsewhere = new Set((workouts || []).filter((w) => w.activity_id && w.id !== workout.id).map((w) => w.activity_id))
  return (activities || [])
    .filter((a) => a && a.kind !== 'planned' && dayKey(a.date) === workout.workout_date && !linkedElsewhere.has(a.id))
    .sort((a, b) => (b.discipline === workout.discipline) - (a.discipline === workout.discipline) || a.date - b.date || String(a.id).localeCompare(String(b.id)))
}

/** The template run (on the linked activity) that belongs to the planned structure, else null. */
export function runForPlanned(workout, runs) {
  if (!workout?.activity_id) return null
  const onActivity = (runs || []).filter((r) => r.activity_id === workout.activity_id)
  if (!onActivity.length) return null
  const name = workout.source_template_name
  return (name && onActivity.find((r) => (r.template_name || r.name) === name)) || null
}

// --- Day logic: grouping, move, duplicate ---------------------------------------------------

export function groupPlannedByDay(workouts) {
  const map = {}
  for (const w of workouts || []) {
    if (!w || !isDayKey(w.workout_date)) continue
    ;(map[w.workout_date] ||= []).push(w)
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  }
  return map
}

/** Shifts a "YYYY-MM-DD" key by n days (DST-safe). */
export function shiftDayKey(key, n) {
  return dayKey(addDays(parseDayKey(key), n))
}

/** A move is valid to another, well-formed day that has room. `countByDay` maps day key -> existing workouts. */
export function canMoveTo(workout, targetDay, countByDay = {}) {
  if (!workout || !isDayKey(targetDay)) return { ok: false, reason: 'Pick a day.' }
  if (targetDay === workout.workout_date) return { ok: false, reason: 'Already on that day.' }
  if ((countByDay[targetDay] || 0) >= PLANNED_PER_DAY_MAX) return { ok: false, reason: 'That day is full.' }
  return { ok: true }
}

export function countPlannedByDay(workouts) {
  const out = {}
  for (const w of workouts || []) out[w.workout_date] = (out[w.workout_date] || 0) + 1
  return out
}

/** Default target when duplicating: the next day. */
export function defaultDuplicateDay(workout) {
  return shiftDayKey(workout.workout_date, 1)
}

/**
 * Calendar event for a planned workout (see calendar.js event model). `activityDay` is where the day cell
 * puts it; planned events carry their status for styling and open the detail dialog (no href).
 */
export function plannedToEvent(workout, today = new Date()) {
  const summary = workoutSummary(workout)
  return {
    id: workout.id,
    kind: 'planned',
    date: parseDayKey(workout.workout_date),
    title: workout.title,
    discipline: workout.discipline,
    distanceM: 0,
    durationS: summary?.durationS || 0,
    durationPartial: !!summary?.partial,
    metric: summary?.load ? { label: 'TL', value: `~TL ${summary.load}` } : null,
    status: plannedStatus(workout, today),
    plannedId: workout.id,
    activityId: workout.activity_id || null,
    href: null,
  }
}

// --- Data access ----------------------------------------------------------------------------

/** Fetches the rider's planned workouts of the visible grid range (inclusive day keys). RLS limits who gets rows. */
export async function fetchPlannedInRange(client, { riderId, startDay, endDay }) {
  if (!riderId || !isDayKey(startDay) || !isDayKey(endDay)) return { data: [], error: null }
  const { data, error } = await client
    .from('planned_workouts')
    .select(PLANNED_COLUMNS)
    .eq('rider_id', riderId)
    .gte('workout_date', startDay)
    .lte('workout_date', endDay)
    .order('workout_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: [], error }
  return { data: data || [], error: null }
}

const rpcError = (error) => (error ? new Error(error.message || 'Could not save the planned workout.') : null)

/** Creates a workout; `dsl` (may be empty) is the snapshot, `templateName` only labels where it came from. */
export async function createPlanned(client, { riderId, day, discipline, title, description, dsl = '', templateName = null }) {
  const st = parseStructure(dsl)
  if (st.errors.length) return { data: null, error: new Error(st.errors[0].message) }
  const v = validatePlanned({ title, description, discipline, day, hasTemplate: !st.empty && !!templateName })
  if (v.error) return { data: null, error: new Error(v.error) }
  if (!riderId || !day) return { data: null, error: new Error('Pick a day.') }
  const { data, error } = await client.rpc('planned_workout_create', {
    p_rider: riderId,
    p_date: day,
    p_discipline: v.value.discipline,
    p_title: v.value.title,
    p_description: v.value.description,
    p_dsl: st.empty ? null : st.dsl,
    p_manifest: st.empty ? null : st.manifest,
    p_template_name: st.empty ? null : templateName || null,
  })
  return { data: data || null, error: rpcError(error) }
}

/** Updates the plain fields (the structure changes via setPlannedTemplate, the link via link/unlink). */
export async function updatePlanned(client, id, fields) {
  const patch = {}
  if ('day' in fields || 'workout_date' in fields) {
    const day = fields.day ?? fields.workout_date
    if (!isDayKey(day)) return { data: null, error: new Error('Pick a day.') }
    patch.workout_date = day
  }
  if ('title' in fields || 'description' in fields || 'discipline' in fields) {
    const v = validatePlanned({ title: fields.title ?? 'x', description: fields.description, discipline: fields.discipline })
    if (v.error) return { data: null, error: new Error(v.error) }
    if ('title' in fields) patch.title = v.value.title
    if ('description' in fields) patch.description = v.value.description
    if ('discipline' in fields) patch.discipline = v.value.discipline
  }
  if ('status' in fields) {
    if (!['planned', 'skipped'].includes(fields.status)) return { data: null, error: new Error('Invalid status.') }
    patch.status = fields.status
  }
  if (!id || !Object.keys(patch).length) return { data: null, error: new Error('Nothing to update.') }
  const { data, error } = await client.from('planned_workouts').update(patch).eq('id', id).select(PLANNED_COLUMNS).maybeSingle()
  if (!error && !data) return { data: null, error: new Error('Workout not found or no longer editable.') }
  return { data, error }
}

export const movePlanned = (client, id, day) => updatePlanned(client, id, { day })
export const setPlannedSkipped = (client, id, skipped) => updatePlanned(client, id, { status: skipped ? 'skipped' : 'planned' })

export async function deletePlanned(client, id) {
  const { data, error } = await client.from('planned_workouts').delete().eq('id', id).select('id')
  if (!error && !(data || []).length) return { error: new Error('Workout not found or no longer editable.') }
  return { error }
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  return { data: data || null, error: rpcError(error) }
}

export const duplicatePlanned = (client, id, day) =>
  isDayKey(day) ? rpc(client, 'planned_workout_duplicate', { p_id: id, p_date: day }) : Promise.resolve({ data: null, error: new Error('Pick a day.') })
/** Replaces the DSL snapshot (blank clears it). */
export function setPlannedStructure(client, id, { dsl = '', templateName = null } = {}) {
  const st = parseStructure(dsl)
  if (st.errors.length) return Promise.resolve({ data: null, error: new Error(st.errors[0].message) })
  return rpc(client, 'planned_workout_set_structure', {
    p_id: id,
    p_dsl: st.empty ? null : st.dsl,
    p_manifest: st.empty ? null : st.manifest,
    p_template_name: st.empty ? null : templateName || null,
  })
}
export const linkPlannedActivity = (client, id, activityId) => rpc(client, 'planned_workout_link', { p_id: id, p_activity: activityId })
export const unlinkPlannedActivity = (client, id) => rpc(client, 'planned_workout_unlink', { p_id: id })
