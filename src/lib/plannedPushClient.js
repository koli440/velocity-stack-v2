// Browser-side helpers for pushing planned workouts to Intervals.icu. Credentials never reach the browser:
// the server route does the work, push rows only hold the mapping/status.
import { getAuthHeader } from './supabase'
import { parseJsonResponse } from './httpJson'

const PUSH_COLUMNS = 'workout_id, intervals_event_id, pushed_hash, pushed_at, push_status, last_error, warnings'

/** Push rows (RLS: rider + active coach only) for the given workouts, as a Map by workout id. */
export async function fetchPushRows(client, workoutIds) {
  if (!workoutIds?.length) return new Map()
  const { data } = await client.from('planned_workout_pushes').select(PUSH_COLUMNS).in('workout_id', workoutIds)
  return new Map((data || []).map((r) => [r.workout_id, r]))
}

/** { connected, auto_enabled, is_self } for the rider; no credentials. Null when it cannot be read. */
export async function fetchPushContext(client, riderId) {
  const { data, error } = await client.rpc('planned_push_context', { p_rider: riderId })
  return error ? null : data
}

async function call(id, method) {
  const res = await fetch(`/api/planned-workouts/${encodeURIComponent(id)}/intervals`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const pushToIntervals = (id) => call(id, 'POST')
export const removeFromIntervals = (id) => call(id, 'DELETE')

export async function setAutoPush(client, enabled) {
  const { error } = await client.rpc('set_planned_push_enabled', { p_enabled: !!enabled })
  return error ? new Error(error.message) : null
}
