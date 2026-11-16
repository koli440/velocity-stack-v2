// Lab test runs (docs/lab/protocol-runner.md). All reads/writes go through the lab_* RPCs
// (supabase/migrations/20270158000000_lab_runs.sql); the table is not client accessible.
import { LAB_PROTOCOLS, computeProtocolResult, pickBestCandidate, protocolDescription, validateLabResult } from './labProtocols.js'
import { parseStructure } from './plannedWorkouts.js'
import { addDays, parseDayKey, dayKey } from './calendar.js'

export const LAB_ERROR_MESSAGES = [
  [/not enabled/i, 'The lab is not available for your account yet.'],
  [/rider not found|no such test/i, 'You do not have access to this athlete.'],
  [/not authenticated/i, 'Please sign in again.'],
  [/no longer be changed|only a/i, 'This test can no longer be changed.'],
]

export function labErrorMessage(error) {
  const msg = String(error?.message || error || '')
  for (const [re, text] of LAB_ERROR_MESSAGES) if (re.test(msg)) return text
  return msg || 'Something went wrong'
}

/** Arguments of lab_run_create for a protocol on a day; { error } when the structure does not parse. */
export function buildCreateArgs({ athleteId, protocol, day }) {
  const p = LAB_PROTOCOLS[protocol]
  if (!p) return { error: 'Unknown protocol' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return { error: 'Pick a date' }
  const parsed = parseStructure(p.dsl)
  if (parsed.errors.length || !parsed.manifest) return { error: 'Could not build the workout' }
  return {
    args: {
      p_athlete: athleteId,
      p_protocol: protocol,
      p_date: day,
      p_title: p.label,
      p_description: protocolDescription(protocol),
      p_dsl: parsed.dsl,
      p_manifest: parsed.manifest,
    },
  }
}

export async function createLabRun(client, { athleteId, protocol, day }) {
  const built = buildCreateArgs({ athleteId, protocol, day })
  if (built.error) return { error: { message: built.error } }
  const { data, error } = await client.rpc('lab_run_create', built.args)
  return { run: data || null, error }
}

export async function fetchLabRuns(client, athleteId) {
  const { data, error } = await client.rpc('lab_runs_list', { p_athlete: athleteId })
  return { runs: error ? [] : data || [], error }
}

export async function submitLabRun(client, { runId, activityId, result }) {
  const v = validateLabResult(result)
  if (v.error) return { error: { message: v.error } }
  const { data, error } = await client.rpc('lab_run_submit', { p_run: runId, p_activity: activityId, p_result: result })
  return { run: data || null, error }
}

export async function markLabRunApplied(client, { runId, applied }) {
  const { data, error } = await client.rpc('lab_run_mark_applied', { p_run: runId, p_applied: applied })
  return { run: data || null, error }
}

export async function cancelLabRun(client, runId) {
  const { error } = await client.rpc('lab_run_cancel', { p_run: runId })
  return { error }
}

/** Window [from, to] (day keys) in which a ride may count for a test planned on `day`. */
export function detectionWindow(day, before = 1, after = 2) {
  const d = parseDayKey(day)
  return { from: dayKey(addDays(d, -before)), to: dayKey(addDays(d, after)) }
}

/** Computes the result of every candidate ride and picks the strongest. */
export function detectFromActivities(protocol, activities) {
  const candidates = (activities || []).map((activity) => ({
    activity,
    result: computeProtocolResult(protocol, activity?.time_series?.watts),
  }))
  return { candidates, best: pickBestCandidate(candidates) }
}

/** Rides around the planned day (own or coached athlete: RLS decides) with their streams. */
export async function fetchDetectionActivities(client, { athleteId, day }) {
  const { from, to } = detectionWindow(day)
  const { data, error } = await client
    .from('activities')
    .select('id, title, activity_date, time_series')
    .eq('user_id', athleteId)
    .gte('activity_date', `${from}T00:00:00`)
    .lt('activity_date', `${dayKey(addDays(parseDayKey(to), 1))}T00:00:00`)
    .order('activity_date', { ascending: true })
    .limit(10)
  return { activities: error ? [] : data || [], error }
}
