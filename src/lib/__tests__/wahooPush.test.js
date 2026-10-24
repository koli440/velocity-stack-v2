import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase, fakeWahooClient } from './helpers/fakeSupabase.js'
import { pushPlannedWorkoutToWahoo, removePlannedWorkoutFromWahoo, runWahooPushCycle } from '../server/wahooPush.js'
import { PushError } from '../server/intervalsEvents.js'
import { wahooPushHash, wahooExternalId } from '../wahooPlan.js'

const NOW = Date.parse('2027-01-11T10:00:00Z')
const RIDER = 'r1'
const conn = (over = {}) => ({ id: 'c1', user_id: RIDER, provider: 'wahoo', status: 'active', external_athlete_id: '7', refresh_token: 'rt', access_token: 'at', push_planned_workouts: true, planned_push_attempt_at: null, ...over })
const manifest = { steps: [{ role: 'work', keyBy: 'time', targetDurationSec: 600, bandType: 'pct_ftp', powerMin: 90, powerMax: 95 }] }
const wk = (id, date, over = {}) => ({ id, rider_id: RIDER, workout_date: date, discipline: 'ride', title: `T${id}`, description: '', structure_dsl: null, structure_manifest: manifest, status: 'planned', activity_id: null, ...over })
const db = (over = {}) => fakeSupabase({ connections: [conn()], profiles: [{ id: RIDER, ftp_w: 250 }], planned_workout_wahoo_pushes: [], planned_workouts: [], ...over })
const args = (sb, client, workout) => ({ service: sb, workout, now: NOW, conn: conn(), client })

test('push creates plan then workout and stores the mapping', async () => {
  const sb = db()
  const client = fakeWahooClient()
  const w = wk('w1', '2027-01-13', { structure_dsl: null })
  const r = await pushPlannedWorkoutToWahoo(args(sb, client, w))
  assert.equal(r.state, 'pushed')
  const names = client.calls.map((c) => c[0])
  assert.deepEqual(names.slice(names.indexOf('createPlan')), ['createPlan', 'createWorkout'])
  assert.equal(client.calls.find((c) => c[0] === 'createPlan')[2], wahooExternalId('w1'))
  assert.equal(client.calls.find((c) => c[0] === 'createWorkout')[1]['workout[plan_id]'], r.planId)
  const row = sb.db.planned_workout_wahoo_pushes[0]
  assert.equal(row.push_status, 'pushed')
  assert.equal(row.wahoo_workout_id, r.workoutId)
  assert.equal(row.pushed_hash, wahooPushHash(w))
  assert.equal(row.claimed_until, null)
})

test('second push updates the same plan and workout', async () => {
  const sb = db()
  const client = fakeWahooClient()
  await pushPlannedWorkoutToWahoo(args(sb, client, wk('w1', '2027-01-13')))
  await pushPlannedWorkoutToWahoo(args(sb, client, wk('w1', '2027-01-14', { title: 'new' })))
  assert.equal(client.calls.filter((c) => c[0] === 'createWorkout').length, 1)
  assert.equal(client.calls.filter((c) => c[0] === 'createPlan').length, 1)
  assert.ok(client.calls.some((c) => c[0] === 'updatePlan'))
  assert.equal(client.calls.find((c) => c[0] === 'updateWorkout')[2]['workout[starts]'], '2027-01-14T12:00:00.000Z')
})

test('workout deleted in Wahoo (404) is recreated', async () => {
  const sb = db({ planned_workout_wahoo_pushes: [{ workout_id: 'w1', rider_id: RIDER, wahoo_plan_id: '8', wahoo_workout_id: '5', push_status: 'pushed', pushed_hash: 'old' }] })
  const client = fakeWahooClient({ updateWorkout: () => { throw new PushError('not_found', 'x', { status: 404 }) } })
  const r = await pushPlannedWorkoutToWahoo(args(sb, client, wk('w1', '2027-01-13')))
  assert.equal(r.recreated, true)
  assert.notEqual(sb.db.planned_workout_wahoo_pushes[0].wahoo_workout_id, '5')
})

test('lost response: adopts the plan with our external id', async () => {
  const sb = db()
  const client = fakeWahooClient({ findPlanByExternalId: () => '321' })
  const r = await pushPlannedWorkoutToWahoo(args(sb, client, wk('w1', '2027-01-13')))
  assert.ok(!client.calls.some((c) => c[0] === 'createPlan'))
  assert.equal(r.planId, '321')
})

test('workout without steps is scheduled without a plan', async () => {
  const sb = db()
  const client = fakeWahooClient()
  const r = await pushPlannedWorkoutToWahoo(args(sb, client, wk('w1', '2027-01-13', { structure_manifest: null })))
  assert.equal(r.planId, null)
  assert.ok(!client.calls.some((c) => c[0] === 'createPlan'))
  assert.equal(client.calls.find((c) => c[0] === 'createWorkout')[1]['workout[plan_id]'], undefined)
})

test('plan failure is recorded and the claim released', async () => {
  const sb = db()
  const client = fakeWahooClient({ createPlan: () => { throw new PushError('scope', 'Reconnect Wahoo', { status: 409, fatal: true }) } })
  await assert.rejects(pushPlannedWorkoutToWahoo(args(sb, client, wk('w1', '2027-01-13'))), (e) => e.code === 'scope')
  const row = sb.db.planned_workout_wahoo_pushes[0]
  assert.equal(row.push_status, 'error')
  assert.equal(row.claimed_until, null)
})

test('gym workouts are refused', async () => {
  await assert.rejects(pushPlannedWorkoutToWahoo(args(db(), fakeWahooClient(), wk('w1', '2027-01-13', { discipline: 'gym' }))), (e) => e.code === 'unsupported')
})

test('disconnected Wahoo is refused with an actionable message', async () => {
  const sb = db({ connections: [conn({ status: 'disconnected', refresh_token: null })] })
  await assert.rejects(pushPlannedWorkoutToWahoo({ service: sb, workout: wk('w1', '2027-01-13'), now: NOW, client: fakeWahooClient() }), (e) => e.code === 'not_connected')
})

test('a running claim blocks a concurrent push', async () => {
  const sb = db({ planned_workout_wahoo_pushes: [{ workout_id: 'w1', rider_id: RIDER, push_status: 'pending', claimed_until: new Date(NOW + 60000).toISOString() }] })
  await assert.rejects(pushPlannedWorkoutToWahoo(args(sb, fakeWahooClient(), wk('w1', '2027-01-13'))), (e) => e.code === 'busy')
})

test('remove deletes workout and plan and forgets the mapping', async () => {
  const sb = db({ planned_workout_wahoo_pushes: [{ workout_id: 'w1', rider_id: RIDER, wahoo_plan_id: '8', wahoo_workout_id: '5', push_status: 'pending_delete' }] })
  const client = fakeWahooClient()
  const r = await removePlannedWorkoutFromWahoo({ service: sb, riderId: RIDER, workoutId: 'w1', now: NOW, conn: conn(), client })
  assert.equal(r.removed, true)
  assert.deepEqual(client.calls.map((c) => c[0]), ['deleteWorkout', 'deletePlan'])
  assert.equal(sb.db.planned_workout_wahoo_pushes.length, 0)
})

test('cron cycle pushes new workouts, skips unchanged ones and processes tombstones', async () => {
  const unchanged = wk('w2', '2027-01-14')
  const sb = db({
    planned_workouts: [wk('w1', '2027-01-13'), unchanged],
    planned_workout_wahoo_pushes: [
      { workout_id: 'w2', rider_id: RIDER, wahoo_plan_id: '1', wahoo_workout_id: '2', push_status: 'pushed', pushed_hash: wahooPushHash(unchanged) },
      { workout_id: 'gone', rider_id: RIDER, wahoo_plan_id: '3', wahoo_workout_id: '4', push_status: 'pending_delete' },
    ],
  })
  const client = fakeWahooClient()
  const t = await runWahooPushCycle({ service: sb, now: NOW, makeClient: async () => client })
  assert.equal(t.riders, 1)
  assert.equal(t.pushed, 1)
  assert.equal(t.removed, 1)
  assert.equal(sb.db.planned_workout_wahoo_pushes.some((r) => r.workout_id === 'gone'), false)
  assert.equal(sb.db.connections[0].planned_push_error, null)
})

test('cron cycle stops a rider on a fatal error and records it on the connection', async () => {
  const sb = db({ planned_workouts: [wk('w1', '2027-01-13'), wk('w2', '2027-01-14')] })
  const client = fakeWahooClient({ createPlan: () => { throw new PushError('scope', 'Reconnect Wahoo', { status: 409, fatal: true }) } })
  const t = await runWahooPushCycle({ service: sb, now: NOW, makeClient: async () => client })
  assert.equal(t.pushed, 0)
  assert.equal(client.calls.filter((c) => c[0] === 'createPlan').length, 1)
  assert.equal(sb.db.connections[0].planned_push_error, 'Reconnect Wahoo')
})

test('cron cycle ignores riders without the auto push', async () => {
  const sb = db({ connections: [conn({ push_planned_workouts: false })], planned_workouts: [wk('w1', '2027-01-13')] })
  const t = await runWahooPushCycle({ service: sb, now: NOW, makeClient: async () => fakeWahooClient() })
  assert.equal(t.riders, 0)
})
