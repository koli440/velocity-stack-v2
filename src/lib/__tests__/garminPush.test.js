import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase, fakeGarminClient } from './helpers/fakeSupabase.js'
import { pushPlannedWorkoutToGarmin, removePlannedWorkoutFromGarmin, runGarminPushCycle } from '../server/garminPush.js'
import { PushError } from '../server/intervalsEvents.js'
import { garminPushHash } from '../garminPlan.js'
import { buildPowerBasis } from '../pushPower.js'
const B = buildPowerBasis({ ftp: 250 })

const NOW = Date.parse('2026-11-02T10:00:00Z')
const RIDER = 'r1'
const conn = (over = {}) => ({ id: 'c1', user_id: RIDER, provider: 'garmin', status: 'active', external_athlete_id: 'g1', refresh_token: 'rt', access_token: 'at', push_planned_workouts: true, planned_push_attempt_at: null, ...over })
const manifest = { steps: [{ role: 'work', keyBy: 'time', targetDurationSec: 600, bandType: 'pct_ftp', powerMin: 90, powerMax: 95 }] }
const wk = (id, date, over = {}) => ({ id, rider_id: RIDER, workout_date: date, discipline: 'ride', title: `T${id}`, description: '', structure_dsl: null, structure_manifest: manifest, status: 'planned', activity_id: null, ...over })
const db = (over = {}) => fakeSupabase({ connections: [conn()], profiles: [{ id: RIDER, ftp_w: 250 }], planned_workout_garmin_pushes: [], planned_workouts: [], ...over })
const args = (sb, client, workout) => ({ service: sb, workout, now: NOW, conn: conn(), client })

test('push creates workout then schedule and stores the mapping', async () => {
  const sb = db()
  const client = fakeGarminClient()
  const w = wk('w1', '2026-11-04')
  const r = await pushPlannedWorkoutToGarmin(args(sb, client, w))
  assert.equal(r.state, 'pushed')
  assert.deepEqual(client.calls.map((c) => c[0]), ['createWorkout', 'createSchedule'])
  assert.equal(client.calls[0][1].segments[0].steps[0].targetValueHigh, 238)
  assert.equal(client.calls[1][2], '2026-11-04')
  const row = sb.db.planned_workout_garmin_pushes[0]
  assert.equal(row.push_status, 'pushed')
  assert.equal(row.garmin_schedule_id, r.scheduleId)
  assert.equal(row.pushed_hash, garminPushHash(w, undefined, B))
  assert.equal(row.claimed_until, null)
})

test('second push updates the same workout and schedule', async () => {
  const sb = db()
  const client = fakeGarminClient()
  await pushPlannedWorkoutToGarmin(args(sb, client, wk('w1', '2026-11-04')))
  await pushPlannedWorkoutToGarmin(args(sb, client, wk('w1', '2026-11-05', { title: 'new' })))
  assert.equal(client.calls.filter((c) => c[0] === 'createWorkout').length, 1)
  assert.equal(client.calls.filter((c) => c[0] === 'createSchedule').length, 1)
  assert.equal(client.calls.find((c) => c[0] === 'updateSchedule')[3], '2026-11-05')
})

test('workout deleted in Garmin (404) is recreated with a new schedule', async () => {
  const sb = db({ planned_workout_garmin_pushes: [{ workout_id: 'w1', rider_id: RIDER, garmin_workout_id: '5', garmin_schedule_id: '6', push_status: 'pushed', pushed_hash: 'old' }] })
  const client = fakeGarminClient({ updateWorkout: () => { throw new PushError('not_found', 'x', { status: 404 }) } })
  const r = await pushPlannedWorkoutToGarmin(args(sb, client, wk('w1', '2026-11-04')))
  assert.equal(r.recreated, true)
  assert.notEqual(r.workoutId, '5')
  assert.ok(!client.calls.some((c) => c[0] === 'updateSchedule'))
})

test('workout without steps is refused and recorded', async () => {
  const sb = db()
  await assert.rejects(pushPlannedWorkoutToGarmin(args(sb, fakeGarminClient(), wk('w1', '2026-11-04', { structure_manifest: null }))), (e) => e.code === 'unsupported')
  assert.equal(sb.db.planned_workout_garmin_pushes[0].push_status, 'error')
  assert.equal(sb.db.planned_workout_garmin_pushes[0].claimed_until, null)
})

test('gym workouts and disconnected riders are refused', async () => {
  await assert.rejects(pushPlannedWorkoutToGarmin(args(db(), fakeGarminClient(), wk('w1', '2026-11-04', { discipline: 'gym' }))), (e) => e.code === 'unsupported')
  const sb = db({ connections: [conn({ status: 'disconnected', refresh_token: null })] })
  await assert.rejects(pushPlannedWorkoutToGarmin({ service: sb, workout: wk('w1', '2026-11-04'), now: NOW, client: fakeGarminClient() }), (e) => e.code === 'not_connected')
})

test('a running claim blocks a concurrent push', async () => {
  const sb = db({ planned_workout_garmin_pushes: [{ workout_id: 'w1', rider_id: RIDER, push_status: 'pending', claimed_until: new Date(NOW + 60000).toISOString() }] })
  await assert.rejects(pushPlannedWorkoutToGarmin(args(sb, fakeGarminClient(), wk('w1', '2026-11-04'))), (e) => e.code === 'busy')
})

test('remove deletes schedule and workout and forgets the mapping', async () => {
  const sb = db({ planned_workout_garmin_pushes: [{ workout_id: 'w1', rider_id: RIDER, garmin_workout_id: '5', garmin_schedule_id: '6', push_status: 'pending_delete' }] })
  const client = fakeGarminClient()
  const r = await removePlannedWorkoutFromGarmin({ service: sb, riderId: RIDER, workoutId: 'w1', now: NOW, conn: conn(), client })
  assert.equal(r.removed, true)
  assert.deepEqual(client.calls.map((c) => c[0]), ['deleteSchedule', 'deleteWorkout'])
  assert.equal(sb.db.planned_workout_garmin_pushes.length, 0)
})

test('cron cycle pushes new workouts, skips unchanged ones and processes tombstones', async () => {
  const unchanged = wk('w2', '2026-11-05')
  const sb = db({
    planned_workouts: [wk('w1', '2026-11-04'), unchanged],
    planned_workout_garmin_pushes: [
      { workout_id: 'w2', rider_id: RIDER, garmin_workout_id: '1', garmin_schedule_id: '2', push_status: 'pushed', pushed_hash: garminPushHash(unchanged, undefined, B) },
      { workout_id: 'gone', rider_id: RIDER, garmin_workout_id: '3', garmin_schedule_id: '4', push_status: 'pending_delete' },
    ],
  })
  const client = fakeGarminClient()
  const t = await runGarminPushCycle({ service: sb, now: NOW, makeClient: async () => client })
  assert.equal(t.riders, 1)
  assert.equal(t.pushed, 1)
  assert.equal(t.removed, 1)
  assert.equal(sb.db.connections[0].planned_push_error, null)
})

test('cron cycle stops a rider on a fatal error and ignores riders without auto push', async () => {
  const sb = db({ planned_workouts: [wk('w1', '2026-11-04'), wk('w2', '2026-11-05')] })
  const client = fakeGarminClient({ createWorkout: () => { throw new PushError('scope', 'Reconnect Garmin', { status: 409, fatal: true }) } })
  const t = await runGarminPushCycle({ service: sb, now: NOW, makeClient: async () => client })
  assert.equal(t.pushed, 0)
  assert.equal(client.calls.filter((c) => c[0] === 'createWorkout').length, 1)
  assert.equal(sb.db.connections[0].planned_push_error, 'Reconnect Garmin')
  const off = db({ connections: [conn({ push_planned_workouts: false })], planned_workouts: [wk('w1', '2026-11-04')] })
  assert.equal((await runGarminPushCycle({ service: off, now: NOW, makeClient: async () => fakeGarminClient() })).riders, 0)
})

test('push uses the connection power target and stores a matching hash', async () => {
  const sb = db()
  const client = fakeGarminClient()
  const w = wk('w1', '2026-11-04')
  await pushPlannedWorkoutToGarmin({ service: sb, workout: w, now: NOW, conn: conn({ push_power_target: 'POWER_10S' }), client })
  assert.equal(client.calls[0][1].segments[0].steps[0].targetType, 'POWER_10S')
  assert.equal(sb.db.planned_workout_garmin_pushes[0].pushed_hash, garminPushHash(w, 'POWER_10S', B))
})
