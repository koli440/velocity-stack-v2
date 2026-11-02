// src/lib/server/garminPlans.js
// Garmin Connect Training API calls for pushing planned workouts: a workout (the steps) plus a schedule entry
// (the day on the rider's Garmin calendar). Needs the rider's WORKOUT_IMPORT permission; without it Garmin answers
// 403 and the rider gets an actionable "reconnect" error. Endpoints and payloads follow the Training API V2 document;
// responses are read tolerantly (workoutId / scheduleId, bare number or object).

import { PushError } from './intervalsEvents.js'
import { garminApiBase } from '../garmin.js'

const RECONNECT = 'Reconnect Garmin in Settings → Connections and allow sending workouts.'

async function snippet(res) {
  try {
    return (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200)
  } catch {
    return ''
  }
}

const idOf = (r, key) => {
  const v = r && typeof r === 'object' ? r[key] ?? r.id : r
  if (v == null || v === '') throw new PushError('garmin_error', 'Garmin did not return an id for the workout.', { status: 502 })
  return String(v)
}

/** @param {{ accessToken: string, fetchImpl?: typeof fetch, base?: string }} args */
export function createGarminPlanClient({ accessToken, fetchImpl = fetch, base = garminApiBase() }) {
  async function request(method, path, body) {
    let res
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new PushError('unreachable', 'Could not reach Garmin. Try again in a moment.', { status: 502 })
    }
    if (res.ok) {
      const text = await res.text()
      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        return text.trim()
      }
    }
    if (res.status === 401) throw new PushError('auth', 'Garmin rejected the connection. Reconnect Garmin in Settings → Connections.', { status: 409, fatal: true })
    if (res.status === 403 || res.status === 412) throw new PushError('scope', RECONNECT, { status: 409, fatal: true })
    if (res.status === 404) throw new PushError('not_found', 'Not found at Garmin.', { status: 404 })
    if (res.status === 429) throw new PushError('rate_limited', 'Garmin rate limit reached. Try again in a few minutes.', { status: 429, retryAfterSec: 300 })
    const s = await snippet(res)
    throw new PushError('garmin_error', `Garmin returned ${res.status}${s ? `: ${s}` : ''}`, { status: 502 })
  }

  return {
    /** @returns {Promise<string>} Garmin workout id */
    async createWorkout(workout) {
      return idOf(await request('POST', '/workoutportal/workout/v2', workout), 'workoutId')
    },
    // Garmin wants the full workout with its workoutId and ownerId on update, so read the owner first.
    async updateWorkout(id, workout) {
      const current = await request('GET', `/training-api/workout/v2/${encodeURIComponent(id)}`)
      const body = { ...workout, workoutId: Number(id) || id, ...(current?.ownerId != null ? { ownerId: current.ownerId } : {}) }
      await request('PUT', `/training-api/workout/v2/${encodeURIComponent(id)}`, body)
      return String(id)
    },
    async deleteWorkout(id) {
      await request('DELETE', `/training-api/workout/v2/${encodeURIComponent(id)}`)
    },
    /** @returns {Promise<string>} schedule id */
    async createSchedule(workoutId, date) {
      return idOf(await request('POST', '/training-api/schedule/', { workoutId: Number(workoutId) || workoutId, date }), 'scheduleId')
    },
    async updateSchedule(id, workoutId, date) {
      await request('PUT', `/training-api/schedule/${encodeURIComponent(id)}`, { scheduleId: Number(id) || id, workoutId: Number(workoutId) || workoutId, date })
      return String(id)
    },
    async deleteSchedule(id) {
      await request('DELETE', `/training-api/schedule/${encodeURIComponent(id)}`)
    },
  }
}
