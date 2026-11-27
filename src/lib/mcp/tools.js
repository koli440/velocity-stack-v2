// MCP tools of Velocity Stack (docs/mcp.md): definitions, input validation, scope checks and thin handlers over a
// `data` adapter (src/lib/server/mcpData.js for Supabase; in-memory fakes in the tests). No I/O of its own.

import {
  PLANNED_DISCIPLINES, PLANNED_TITLE_MAX, PLANNED_DESCRIPTION_MAX, isDayKey, parseStructure, validatePlanned,
  plannedStatus, plannedToEvent, workoutSummary,
} from '../plannedWorkouts.js'
import { RACE_DISCIPLINES, RACE_PRIORITIES, RACE_NAME_MAX, RACE_LOCATION_MAX, RACE_NOTES_MAX, validateRace } from '../calendarRaces.js'
import { NOTE_TITLE_MAX, NOTE_BODY_MAX, validateNote } from '../calendarNotes.js'
import { textResult } from './protocol.js'

export class ToolError extends Error {}
const fail = (message) => { throw new ToolError(message) }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_RANGE_DAYS = 366
export const MAX_ACTIVITY_RANGE_DAYS = 366
export const MAX_ACTIVITIES = 100
export const MAX_FITNESS_DAYS = 365

// ---- Input helpers -----------------------------------------------------------------------------

/** Rejects unknown argument names (typos would otherwise silently do nothing). */
function onlyKeys(args, allowed) {
  for (const k of Object.keys(args || {})) if (!allowed.includes(k)) fail(`Unknown argument: ${k}`)
}

export function uuidArg(v, name, { optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null
    fail(`${name} is required`)
  }
  if (typeof v !== 'string' || !UUID_RE.test(v)) fail(`${name} must be a UUID`)
  return v.toLowerCase()
}

export function dayArg(v, name, { optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null
    fail(`${name} is required (YYYY-MM-DD)`)
  }
  if (!isDayKey(v)) fail(`${name} must be a date YYYY-MM-DD`)
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail(`${name} is not a valid date`)
  if (v < '2000-01-01' || v > '2100-12-31') fail(`${name} is out of range`)
  return v
}

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

export function rangeArgs(args, maxDays) {
  const from = dayArg(args.from, 'from')
  const to = dayArg(args.to, 'to')
  if (to < from) fail('to must not be before from')
  if (dayDiff(from, to) > maxDays) fail(`The range is limited to ${maxDays} days`)
  return { from, to }
}

function intArg(v, name, { min, max, fallback }) {
  if (v == null || v === '') return fallback
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be an integer between ${min} and ${max}`)
  return n
}

function stringArg(v, name, { max, optional = true } = {}) {
  if (v == null) {
    if (optional) return undefined
    fail(`${name} is required`)
  }
  if (typeof v !== 'string') fail(`${name} must be a string`)
  if (max != null && v.trim().length > max) fail(`${name} is limited to ${max} characters`)
  return v
}

/** DSL text -> { dsl, manifest } (both null for blank), with the parser's first error as the message. */
export function structureArg(v) {
  if (v == null) return undefined
  if (typeof v !== 'string') fail('structure must be a string in the interval DSL')
  const st = parseStructure(v)
  if (st.errors.length) {
    const e = st.errors[0]
    fail(`structure: ${e.line ? `line ${e.line}: ` : ''}${e.message}`)
  }
  return st.empty ? { dsl: null, manifest: null } : { dsl: st.dsl, manifest: st.manifest }
}

// ---- Output views ------------------------------------------------------------------------------

/**
 * A planned_workouts row -> tool output. `loadContext` is the RIDER's { ftpHistory, ltHistory, zoneHistory }
 * (data.loadContext). Summary, duration and load come from the calendar's own code path (workoutSummary /
 * plannedToEvent with the same load context as useRiderLoadContext), so `estimated_load` is the calendar's "~TL".
 */
export function plannedView(w, today = new Date(), loadContext = null) {
  if (!w) return null
  const summary = workoutSummary(w, loadContext)
  const event = plannedToEvent(w, today, loadContext)
  return {
    id: w.id,
    athlete_id: w.rider_id,
    date: w.workout_date,
    discipline: w.discipline,
    title: w.title,
    description: w.description || '',
    status: plannedStatus(w, today),
    structure: w.structure_dsl || null,
    structure_summary: summary ? summary.lines : null,
    estimated_duration_s: summary?.durationS ?? null,
    estimated_load: event.load,
    estimated_load_assumes_thresholds: event.load != null && !!summary?.loadAssumed,
    completed_activity_id: w.activity_id || null,
    planned_by_coach: !!w.set_by_coach,
  }
}

/**
 * Views of planned workouts returned by the (authorizing) wrappers. The load context is fetched for the rider
 * those rows belong to - a rider the wrapper already let the token user see - once per rider.
 */
export async function plannedViews(rows, { data, now }) {
  const list = (rows || []).filter(Boolean)
  const contexts = new Map()
  for (const id of new Set(list.map((w) => w.rider_id).filter(Boolean))) contexts.set(id, await riderLoadContext(data, id))
  return list.map((w) => plannedView(w, now, contexts.get(w.rider_id) || null))
}

async function riderLoadContext(data, riderId) {
  if (typeof data?.loadContext !== 'function') return null
  try {
    return (await data.loadContext(riderId)) || null
  } catch {
    // Like the calendar: estimates fall back (only %FTP bands) when the histories cannot be loaded.
    return null
  }
}

const plannedOne = async (row, ctx) => (row ? (await plannedViews([row], ctx))[0] : null)

export function raceView(r) {
  if (!r) return null
  return {
    id: r.id,
    athlete_id: r.rider_id,
    date: r.race_date,
    time: r.race_time ? String(r.race_time).slice(0, 5) : null,
    name: r.name,
    discipline: r.discipline,
    priority: r.priority,
    location: r.location || null,
    format: r.format_note || null,
    notes: r.notes || '',
    activity_id: r.activity_id || null,
    added_by_coach: !!r.set_by_coach,
  }
}

export function noteView(n) {
  if (!n) return null
  return {
    id: n.id,
    athlete_id: n.rider_id,
    date: n.note_date,
    title: n.title,
    text: n.body || '',
    written_by_coach: !!n.set_by_coach,
    updated_at: n.updated_at || null,
  }
}

/** Race fields given (partial), validated with the app's validateRace against a valid baseline. */
export function raceFields(args, { create = false } = {}) {
  const draft = {}
  if (args.name !== undefined) draft.name = stringArg(args.name, 'name')
  if (args.discipline !== undefined) draft.discipline = args.discipline
  if (args.priority !== undefined) draft.priority = typeof args.priority === 'string' ? args.priority.toUpperCase() : args.priority
  if (args.location !== undefined) draft.location = stringArg(args.location, 'location')
  if (args.notes !== undefined) draft.notes = stringArg(args.notes, 'notes')
  if (create && draft.name === undefined) fail('name is required')
  const v = validateRace({ name: 'x', discipline: 'ride', priority: 'B', ...draft })
  if (v.error) fail(v.error)
  const out = {}
  for (const [k, col] of [['name', 'name'], ['discipline', 'discipline'], ['priority', 'priority'], ['location', 'location'], ['notes', 'notes']]) {
    if (draft[k] !== undefined) out[col] = v.value[col]
  }
  return out
}

/**
 * Note fields: the app's notes have a title (<= 80) and a text (<= 1000). Without a title the first line of
 * the text becomes the title (cut at 80 characters); the full text is kept when it is longer than that.
 */
export function noteFields(args, { create = false } = {}) {
  const draft = {}
  const text = args.text !== undefined ? stringArg(args.text, 'text') : undefined
  if (args.title !== undefined) draft.title = stringArg(args.title, 'title')
  if (text !== undefined) {
    const t = text.trim()
    if (draft.title === undefined && create) {
      const first = t.split('\n')[0].trim()
      if (!first) fail('text must not be empty')
      draft.title = first.length > NOTE_TITLE_MAX ? `${first.slice(0, NOTE_TITLE_MAX - 1).trimEnd()}…` : first
      draft.body = t === draft.title ? '' : t
    } else draft.body = t
  }
  if (create && draft.title === undefined) fail('text is required')
  const v = validateNote({ title: 'x', body: '', ...draft })
  if (v.error) fail(v.error)
  const out = {}
  if (draft.title !== undefined) out.title = v.value.title
  if (draft.body !== undefined) out.body = v.value.body
  return out
}

// ---- Tool definitions --------------------------------------------------------------------------

const athleteIdProp = { type: 'string', description: 'Coaches only: the athlete whose calendar to use (see get_athlete -> coached_athletes). Omit for your own calendar.' }
const dateProp = (d) => ({ type: 'string', format: 'date', description: d })
const STRUCTURE_HELP =
  'Optional interval structure in the Velocity Stack interval DSL, one step per line, e.g. ' +
  '"warmup 15min\\n5x\\nwork 4min @ 105-120%FTP\\nrecovery 4min @ <55%FTP\\ncooldown 10min". ' +
  'Bands: %FTP, W, Z1-Z6, %LT1/%LT2, bpm, %HRmax, rpm, km/h. Durations h/min/sec, distances km/m. ' +
  'Full guide: https://www.velocity-stack.app/dsl-guide'

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
// Every tool that changes stored data is marked destructive (directory review rule), so Claude confirms it.
const WRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

/**
 * name -> { scope, title, description, inputSchema, annotations, write, when?(caps), run(args, ctx) }
 * ctx: { data, caps, now }
 */
export const TOOLS = {
  get_athlete: {
    scope: 'profile:read',
    title: 'Get athlete profile',
    description: 'The athlete\'s current FTP, weight, W/kg, lactate thresholds, power zones (watts), upcoming races (goals) and, for coaches, the athletes they coach.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: RO,
    async run(args, { data, caps }) {
      onlyKeys(args, [])
      const athlete = await data.getAthlete()
      return { ...athlete, coached_athletes: caps?.athletes || [] }
    },
  },

  list_planned_workouts: {
    scope: 'plans:read',
    title: 'List planned workouts',
    description: 'Planned workouts in the calendar between two dates (inclusive, max 366 days) with status (planned, completed, skipped, missed), structure and estimates.',
    inputSchema: {
      type: 'object',
      properties: { from: dateProp('First day, YYYY-MM-DD'), to: dateProp('Last day, YYYY-MM-DD'), athlete_id: athleteIdProp },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: RO,
    async run(args, ctx) {
      onlyKeys(args, ['from', 'to', 'athlete_id'])
      const { from, to } = rangeArgs(args, MAX_RANGE_DAYS)
      const riderId = uuidArg(args.athlete_id, 'athlete_id', { optional: true })
      const rows = await ctx.data.listPlanned({ riderId, from, to })
      return { workouts: await plannedViews(rows, ctx) }
    },
  },

  create_planned_workout: {
    scope: 'plans:write',
    title: 'Plan a workout',
    description: 'Adds a workout to the athlete\'s calendar on a day. Structured ride workouts are pushed automatically to Garmin, Wahoo or Intervals.icu when the athlete enabled that.',
    inputSchema: {
      type: 'object',
      properties: {
        date: dateProp('Day of the workout, YYYY-MM-DD'),
        discipline: { type: 'string', enum: [...PLANNED_DISCIPLINES], description: 'ride, track, gym, run or other' },
        title: { type: 'string', maxLength: PLANNED_TITLE_MAX },
        description: { type: 'string', maxLength: PLANNED_DESCRIPTION_MAX, description: 'Notes for the athlete (purpose, cues, fuelling).' },
        structure: { type: 'string', description: STRUCTURE_HELP },
        athlete_id: athleteIdProp,
      },
      required: ['date', 'discipline', 'title'],
      additionalProperties: false,
    },
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      const { data } = ctx
      onlyKeys(args, ['date', 'discipline', 'title', 'description', 'structure', 'athlete_id'])
      const date = dayArg(args.date, 'date')
      const st = structureArg(args.structure) || { dsl: null, manifest: null }
      const v = validatePlanned({ title: stringArg(args.title, 'title', { optional: false }), description: stringArg(args.description, 'description') ?? '', discipline: args.discipline ?? 'ride', day: date })
      if (v.error) fail(v.error)
      const riderId = uuidArg(args.athlete_id, 'athlete_id', { optional: true })
      const row = await data.createPlanned({ riderId, date, discipline: v.value.discipline, title: v.value.title, description: v.value.description, dsl: st.dsl, manifest: st.manifest })
      return { workout: await plannedOne(row, ctx) }
    },
  },

  update_planned_workout: {
    scope: 'plans:write',
    title: 'Edit a planned workout',
    description: 'Changes title, notes, discipline, day or structure of a planned workout. structure "" removes the structure.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Planned workout id' },
        title: { type: 'string', maxLength: PLANNED_TITLE_MAX },
        description: { type: 'string', maxLength: PLANNED_DESCRIPTION_MAX },
        discipline: { type: 'string', enum: [...PLANNED_DISCIPLINES] },
        date: dateProp('New day, YYYY-MM-DD'),
        structure: { type: 'string', description: STRUCTURE_HELP },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      const { data } = ctx
      onlyKeys(args, ['id', 'title', 'description', 'discipline', 'date', 'structure'])
      const id = uuidArg(args.id, 'id')
      const fields = plainFields(args)
      const st = structureArg(args.structure)
      if (!Object.keys(fields).length && !st) fail('Nothing to update')
      let row = null
      if (Object.keys(fields).length) row = await data.updatePlanned(id, fields)
      if (st) row = await data.setStructure(id, st)
      return { workout: await plannedOne(row, ctx) }
    },
  },

  move_planned_workout: {
    scope: 'plans:write',
    title: 'Move a planned workout',
    description: 'Moves a planned workout to another day.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, date: dateProp('New day, YYYY-MM-DD') }, required: ['id', 'date'], additionalProperties: false },
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      onlyKeys(args, ['id', 'date'])
      const id = uuidArg(args.id, 'id')
      const row = await ctx.data.updatePlanned(id, { workout_date: dayArg(args.date, 'date') })
      return { workout: await plannedOne(row, ctx) }
    },
  },

  skip_planned_workout: {
    scope: 'plans:write',
    title: 'Skip or un-skip a planned workout',
    description: 'Marks a planned workout as skipped (skipped=true, default) or planned again (skipped=false). Completed workouts cannot be skipped.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, skipped: { type: 'boolean', default: true } }, required: ['id'], additionalProperties: false },
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      onlyKeys(args, ['id', 'skipped'])
      const id = uuidArg(args.id, 'id')
      if (args.skipped != null && typeof args.skipped !== 'boolean') fail('skipped must be true or false')
      const row = await ctx.data.updatePlanned(id, { status: args.skipped === false ? 'planned' : 'skipped' })
      return { workout: await plannedOne(row, ctx) }
    },
  },

  delete_planned_workout: {
    scope: 'plans:write',
    title: 'Delete a planned workout',
    description: 'Deletes a planned workout from the calendar (also removes it from connected devices on the next push).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { ...WRITE, idempotentHint: true },
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['id'])
      const id = uuidArg(args.id, 'id')
      await data.deletePlanned(id)
      return { deleted: id }
    },
  },

  list_activities: {
    scope: 'activities:read',
    title: 'List activities',
    description: 'Completed activities (rides, track, runs, gym, ...) between two dates with duration, distance, power, heart rate, training load and the linked planned workout. Newest first.',
    inputSchema: {
      type: 'object',
      properties: { from: dateProp('First day, YYYY-MM-DD'), to: dateProp('Last day, YYYY-MM-DD'), limit: { type: 'integer', minimum: 1, maximum: MAX_ACTIVITIES, default: 50 } },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: RO,
    async run(args, { data }) {
      onlyKeys(args, ['from', 'to', 'limit'])
      const { from, to } = rangeArgs(args, MAX_ACTIVITY_RANGE_DAYS)
      const limit = intArg(args.limit, 'limit', { min: 1, max: MAX_ACTIVITIES, fallback: 50 })
      return { activities: await data.listActivities({ from, to, limit }) }
    },
  },

  get_activity: {
    scope: 'activities:read',
    title: 'Get activity details',
    description: 'One activity: summary, power/heart-rate peaks, time in power zones, splits (average power, HR, cadence, speed per block), the linked planned workout and analysis-template results (intervals found). No GPS.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Activity id' }, split_minutes: { type: 'integer', minimum: 1, maximum: 60, default: 5, description: 'Block length of the splits' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: RO,
    async run(args, { data }) {
      onlyKeys(args, ['id', 'split_minutes'])
      const id = uuidArg(args.id, 'id')
      const splitMinutes = intArg(args.split_minutes, 'split_minutes', { min: 1, max: 60, fallback: 5 })
      const activity = await data.getActivity(id, { splitMinutes })
      if (!activity) fail('Activity not found')
      return activity
    },
  },

  list_templates: {
    scope: 'activities:read',
    title: 'List analysis templates',
    description: 'Analysis templates the athlete can run on an activity (own, public and system templates): id, name, category and DSL.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional name filter' } }, additionalProperties: false },
    annotations: RO,
    async run(args, { data }) {
      onlyKeys(args, ['query'])
      const query = stringArg(args.query, 'query', { max: 80 })
      return { templates: await data.listTemplates({ query: query?.trim() || null }) }
    },
  },

  run_template: {
    scope: 'activities:read',
    title: 'Run an analysis template on an activity',
    description: 'Runs an analysis template (see list_templates) on one of the athlete\'s activities and stores the result like the app does; returns the efforts found (e.g. each interval\'s power, HR, duration).',
    inputSchema: {
      type: 'object',
      properties: { activity_id: { type: 'string' }, template_id: { type: 'string' } },
      required: ['activity_id', 'template_id'],
      additionalProperties: false,
    },
    annotations: { ...WRITE, idempotentHint: true },
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['activity_id', 'template_id'])
      return data.runTemplate({ activityId: uuidArg(args.activity_id, 'activity_id'), templateId: uuidArg(args.template_id, 'template_id') })
    },
  },

  get_fitness: {
    scope: 'activities:read',
    title: 'Get fitness, fatigue and form',
    description: 'Today\'s fitness (CTL, 42-day), fatigue (ATL, 7-day) and form (TSB) from the platform\'s training load, the weekly ramp rate and the daily series of the last `days` days.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 7, maximum: MAX_FITNESS_DAYS, default: 42 } }, additionalProperties: false },
    annotations: RO,
    async run(args, { data }) {
      onlyKeys(args, ['days'])
      return data.getFitness({ days: intArg(args.days, 'days', { min: 7, max: MAX_FITNESS_DAYS, fallback: 42 }) })
    },
  },

  get_macro_plan: {
    scope: 'plans:read',
    title: 'Get the macro (season) plan',
    description: 'The long-term plan towards the A race: planned weeks with target training load, focus and hard/easy/rest shape. Athletes see the plan their coach published; coaches pass athlete_id.',
    inputSchema: { type: 'object', properties: { athlete_id: athleteIdProp }, additionalProperties: false },
    annotations: RO,
    when: (caps) => !!caps?.macro_planner || !!caps?.has_macro_plan,
    async run(args, { data }) {
      onlyKeys(args, ['athlete_id'])
      const plan = await data.getMacroPlan({ riderId: uuidArg(args.athlete_id, 'athlete_id', { optional: true }) })
      return { plan: plan || null }
    },
  },
  list_races: {
    scope: 'plans:read',
    title: 'List races (goals)',
    description: 'Races and events in the calendar between two dates (inclusive, max 366 days): name, priority (A = main goal, B, C), discipline, location, notes.',
    inputSchema: {
      type: 'object',
      properties: { from: dateProp('First day, YYYY-MM-DD'), to: dateProp('Last day, YYYY-MM-DD'), athlete_id: athleteIdProp },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: RO,
    async run(args, { data }) {
      onlyKeys(args, ['from', 'to', 'athlete_id'])
      const { from, to } = rangeArgs(args, MAX_RANGE_DAYS)
      const riderId = uuidArg(args.athlete_id, 'athlete_id', { optional: true })
      return { races: ((await data.listRaces({ riderId, from, to })) || []).map(raceView) }
    },
  },

  create_race: {
    scope: 'plans:write',
    title: 'Add a race (goal)',
    description: 'Adds a race or event to the athlete\'s calendar. priority A = main goal of the season, B = important, C = training race.',
    inputSchema: {
      type: 'object',
      properties: {
        date: dateProp('Race day, YYYY-MM-DD'),
        name: { type: 'string', maxLength: RACE_NAME_MAX },
        discipline: { type: 'string', enum: [...RACE_DISCIPLINES], default: 'ride', description: 'ride (road, gravel, MTB, ...), track or other' },
        priority: { type: 'string', enum: [...RACE_PRIORITIES], default: 'B' },
        location: { type: 'string', maxLength: RACE_LOCATION_MAX },
        notes: { type: 'string', maxLength: RACE_NOTES_MAX },
        athlete_id: athleteIdProp,
      },
      required: ['date', 'name'],
      additionalProperties: false,
    },
    annotations: WRITE,
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['date', 'name', 'discipline', 'priority', 'location', 'notes', 'athlete_id'])
      const date = dayArg(args.date, 'date')
      const fields = { discipline: 'ride', priority: 'B', ...raceFields(args, { create: true }) }
      const riderId = uuidArg(args.athlete_id, 'athlete_id', { optional: true })
      return { race: raceView(await data.createRace({ riderId, date, fields })) }
    },
  },

  update_race: {
    scope: 'plans:write',
    title: 'Edit a race',
    description: 'Changes date, name, discipline, priority, location or notes of a race. Fields left out stay as they are.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Race id (see list_races)' },
        date: dateProp('New day, YYYY-MM-DD'),
        name: { type: 'string', maxLength: RACE_NAME_MAX },
        discipline: { type: 'string', enum: [...RACE_DISCIPLINES] },
        priority: { type: 'string', enum: [...RACE_PRIORITIES] },
        location: { type: 'string', maxLength: RACE_LOCATION_MAX },
        notes: { type: 'string', maxLength: RACE_NOTES_MAX },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: WRITE,
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['id', 'date', 'name', 'discipline', 'priority', 'location', 'notes'])
      const id = uuidArg(args.id, 'id')
      const fields = raceFields(args)
      if (args.date !== undefined) fields.race_date = dayArg(args.date, 'date')
      if (!Object.keys(fields).length) fail('Nothing to update')
      return { race: raceView(await data.updateRace(id, fields)) }
    },
  },

  delete_race: {
    scope: 'plans:write',
    title: 'Delete a race',
    description: 'Deletes a race from the calendar.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['id'])
      const id = uuidArg(args.id, 'id')
      await data.deleteRace(id)
      return { deleted: id }
    },
  },

  list_notes: {
    scope: 'plans:read',
    title: 'List calendar notes',
    description: 'Day notes in the calendar between two dates (inclusive, max 366 days), e.g. sickness, travel, availability. Notes are shared between the athlete and their coach.',
    inputSchema: {
      type: 'object',
      properties: { from: dateProp('First day, YYYY-MM-DD'), to: dateProp('Last day, YYYY-MM-DD'), athlete_id: athleteIdProp },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: RO,
    async run(args, { data }) {
      onlyKeys(args, ['from', 'to', 'athlete_id'])
      const { from, to } = rangeArgs(args, MAX_RANGE_DAYS)
      const riderId = uuidArg(args.athlete_id, 'athlete_id', { optional: true })
      return { notes: ((await data.listNotes({ riderId, from, to })) || []).map(noteView) }
    },
  },

  create_note: {
    scope: 'plans:write',
    title: 'Add a calendar note',
    description: `Adds a note to a day of the calendar (visible to the athlete and their coach). Without a title the first line of the text is the title (max ${NOTE_TITLE_MAX} characters); text up to ${NOTE_BODY_MAX} characters.`,
    inputSchema: {
      type: 'object',
      properties: {
        date: dateProp('Day, YYYY-MM-DD'),
        text: { type: 'string', maxLength: NOTE_BODY_MAX },
        title: { type: 'string', maxLength: NOTE_TITLE_MAX, description: 'Optional short title shown in the calendar cell' },
        athlete_id: athleteIdProp,
      },
      required: ['date', 'text'],
      additionalProperties: false,
    },
    annotations: WRITE,
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['date', 'text', 'title', 'athlete_id'])
      const date = dayArg(args.date, 'date')
      if (args.text == null) fail('text is required')
      const fields = { body: '', ...noteFields(args, { create: true }) }
      const riderId = uuidArg(args.athlete_id, 'athlete_id', { optional: true })
      return { note: noteView(await data.createNote({ riderId, date, fields })) }
    },
  },

  update_note: {
    scope: 'plans:write',
    title: 'Edit a calendar note',
    description: 'Changes the day, title or text of a calendar note. Fields left out stay as they are.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Note id (see list_notes)' },
        date: dateProp('New day, YYYY-MM-DD'),
        title: { type: 'string', maxLength: NOTE_TITLE_MAX },
        text: { type: 'string', maxLength: NOTE_BODY_MAX },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: WRITE,
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['id', 'date', 'title', 'text'])
      const id = uuidArg(args.id, 'id')
      const fields = noteFields(args)
      if (args.date !== undefined) fields.note_date = dayArg(args.date, 'date')
      if (!Object.keys(fields).length) fail('Nothing to update')
      return { note: noteView(await data.updateNote(id, fields)) }
    },
  },

  delete_note: {
    scope: 'plans:write',
    title: 'Delete a calendar note',
    description: 'Deletes a calendar note.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    write: true,
    async run(args, { data }) {
      onlyKeys(args, ['id'])
      const id = uuidArg(args.id, 'id')
      await data.deleteNote(id)
      return { deleted: id }
    },
  },
}

function plainFields(args) {
  const out = {}
  if (args.title !== undefined) {
    const t = stringArg(args.title, 'title', { max: PLANNED_TITLE_MAX }).trim()
    if (!t) fail('title must not be empty')
    out.title = t
  }
  if (args.description !== undefined) out.description = stringArg(args.description, 'description', { max: PLANNED_DESCRIPTION_MAX }).trim()
  if (args.discipline !== undefined) {
    if (!PLANNED_DISCIPLINES.includes(args.discipline)) fail(`discipline must be one of ${PLANNED_DISCIPLINES.join(', ')}`)
    out.discipline = args.discipline
  }
  if (args.date !== undefined) out.workout_date = dayArg(args.date, 'date')
  return out
}

// ---- Listing and dispatch ----------------------------------------------------------------------

const hasScope = (scopes, s) => Array.isArray(scopes) && scopes.includes(s)

/** Tools the token may use (scope granted and, where relevant, feature available). */
export function listTools(scopes, caps = null) {
  return Object.entries(TOOLS)
    .filter(([, t]) => hasScope(scopes, t.scope) && (!t.when || t.when(caps)))
    .map(([name, t]) => ({ name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } }))
}

/** Friendly text for database / data-layer errors (never leaks internals). */
export function toolErrorMessage(err) {
  if (err instanceof ToolError) return err.message
  const msg = String(err?.message || '')
  if (/insufficient_scope/.test(msg)) return 'The connection is missing a permission for this tool. Reconnect Velocity Stack and approve all requested permissions.'
  if (/invalid_token/.test(msg)) return 'The access token is no longer valid. Reconnect Velocity Stack.'
  const known = [
    'Planned workout not found', 'Rider not found', 'Too many planned workouts on this day', 'A completed workout cannot be skipped',
    'Invalid workout values', 'Structure is too long', 'Structure contains invalid characters', 'Invalid structure', 'Pick a range',
    'Macro planner is not enabled', 'You are not coaching this rider', 'Activity not found', 'Template not available', 'Not found',
    'Race not found', 'Too many races on this day', 'Invalid race values', 'Note not found', 'Too many notes on this day', 'Invalid note values',
  ]
  const hit = known.find((k) => msg.includes(k))
  return hit ? msg.slice(msg.indexOf(hit)).split('\n')[0].slice(0, 200) : 'Something went wrong. Please try again.'
}

/**
 * Runs a tool for a token with `scopes`. Returns an MCP CallToolResult, or { unknownTool: true }.
 * ctx: { data, caps, now, onWrite?(name) }
 */
export async function callTool(name, args, { scopes, ...ctx }) {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null
  if (!tool) return { unknownTool: true }
  if (!hasScope(scopes, tool.scope)) return textResult(`This tool needs the ${tool.scope} permission. Reconnect Velocity Stack and approve it.`, { isError: true })
  if (tool.when && !tool.when(ctx.caps)) return textResult('This feature is not available for your account.', { isError: true })
  try {
    const value = await tool.run(args || {}, { now: new Date(), ...ctx })
    if (tool.write && ctx.onWrite) await ctx.onWrite(name)
    return textResult(value)
  } catch (err) {
    if (!(err instanceof ToolError)) console.warn(`mcp tool ${name} failed:`, err?.message)
    return textResult(toolErrorMessage(err), { isError: true })
  }
}
