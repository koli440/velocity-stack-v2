import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase, fakeEventsClient } from './helpers/fakeSupabase.js'
import { pushPlannedWorkout, removePlannedWorkoutPush, runPlannedPushCycle } from '../server/plannedPush.js'
import { PushError } from '../server/intervalsEvents.js'
import { plannedPushHash, externalIdFor } from '../intervalsWorkout.js'

const NOW = Date.parse('2026-12-01T10:00:00Z')
const RIDER = 'r1'
const conn = (over = {}) => ({ id: 'c1', user_id: RIDER, provider: 'intervals', external_athlete_id: 'i9', api_key: 'KEY', status: 'active', backfill_days: 30, push_planned_workouts: true, planned_push_attempt_at: null, ...over })
const wk = (id, date, over = {}) => ({ id, rider_id: RIDER, workout_date: date, discipline: 'ride', title: `T${id}`, description: '', structure_dsl: null, structure_manifest: null, status: 'planned', activity_id: null, ...over })
const mk = (client) => () => client
const quiet = { deadline: Date.now() + 60000 }

test('push creates an event and stores the mapping', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [], planned_workouts: [] })
  const client = fakeEventsClient()
  const r = await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(client) })
  assert.equal(r.state, 'pushed')
  assert.equal(client.calls.find((c) => c[0] === 'create')[1].external_id, externalIdFor('w1'))
  const row = sb.db.planned_workout_pushes[0]
  assert.equal(row.push_status, 'pushed')
  assert.equal(row.pushed_hash, plannedPushHash(wk('w1', '2026-12-05')))
  assert.equal(row.claimed_until, null)
})

test('second push updates the same event', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [], planned_workouts: [] })
  const client = fakeEventsClient()
  await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(client) })
  await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-06', { title: 'new' }), now: NOW, makeClient: mk(client) })
  assert.equal(client.calls.filter((c) => c[0] === 'create').length, 1)
  const upd = client.calls.find((c) => c[0] === 'update')
  assert.equal(upd[2].start_date_local, '2026-12-06T00:00:00')
})

test('remote event deleted in Intervals (404 on update) is recreated', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [{ workout_id: 'w1', rider_id: RIDER, intervals_event_id: '5', push_status: 'pushed', pushed_hash: 'old' }], planned_workouts: [] })
  const client = fakeEventsClient({ update: () => { throw new PushError('not_found', 'x', { status: 404 }) } })
  const r = await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(client) })
  assert.equal(r.recreated, true)
  assert.notEqual(sb.db.planned_workout_pushes[0].intervals_event_id, '5')
})

test('lost response: adopts the event with our external id instead of duplicating', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [], planned_workouts: [] })
  const client = fakeEventsClient({ find: () => '321' })
  await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(client) })
  assert.ok(!client.calls.some((c) => c[0] === 'create'))
  assert.equal(sb.db.planned_workout_pushes[0].intervals_event_id, '321')
})

test('not connected / disconnected / error connection is refused with an actionable message', async () => {
  for (const connections of [[], [conn({ status: 'disconnected', api_key: null })], [conn({ status: 'error' })]]) {
    const sb = fakeSupabase({ connections, planned_workout_pushes: [], planned_workouts: [], profile_secrets: [] })
    const client = fakeEventsClient()
    const e = await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(client) }).catch((x) => x)
    assert.equal(e.code, 'not_connected')
    assert.match(e.message, /Settings/)
    assert.equal(client.calls.length, 0)
  }
})

test('API failure stores a readable last_error, keeps the mapping, never the key', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [{ workout_id: 'w1', rider_id: RIDER, intervals_event_id: '5', push_status: 'pushed', pushed_hash: 'old' }], planned_workouts: [] })
  const client = fakeEventsClient({ update: () => { throw new PushError('forbidden', 'read-only key', { fatal: true }) } })
  await assert.rejects(pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(client) }))
  const row = sb.db.planned_workout_pushes[0]
  assert.equal(row.push_status, 'error')
  assert.equal(row.last_error, 'read-only key')
  assert.equal(row.intervals_event_id, '5')
  assert.ok(!JSON.stringify(row).includes('KEY'))
})

test('concurrent push is refused while a claim is active', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [{ workout_id: 'w1', rider_id: RIDER, push_status: 'pending', claimed_until: new Date(NOW + 60000).toISOString() }], planned_workouts: [] })
  const e = await pushPlannedWorkout({ service: sb, workout: wk('w1', '2026-12-05'), now: NOW, makeClient: mk(fakeEventsClient()) }).catch((x) => x)
  assert.equal(e.code, 'busy')
})

test('remove deletes our event, leaves foreign events alone, drops the mapping', async () => {
  const mkdb = () => fakeSupabase({ connections: [conn()], planned_workout_pushes: [{ workout_id: 'w1', rider_id: RIDER, intervals_event_id: '5', push_status: 'pushed' }], planned_workouts: [] })
  let sb = mkdb()
  let client = fakeEventsClient({ extId: () => externalIdFor('w1') })
  await removePlannedWorkoutPush({ service: sb, riderId: RIDER, workoutId: 'w1', now: NOW, makeClient: mk(client) })
  assert.ok(client.calls.some((c) => c[0] === 'remove'))
  assert.equal(sb.db.planned_workout_pushes.length, 0)

  sb = mkdb()
  client = fakeEventsClient({ extId: () => 'someone-else' })
  await removePlannedWorkoutPush({ service: sb, riderId: RIDER, workoutId: 'w1', now: NOW, makeClient: mk(client) })
  assert.ok(!client.calls.some((c) => c[0] === 'remove'))
  assert.equal(sb.db.planned_workout_pushes.length, 0)
})

test('another rider cannot remove a mapping they do not own', async () => {
  const sb = fakeSupabase({ connections: [conn()], planned_workout_pushes: [{ workout_id: 'w1', rider_id: RIDER, intervals_event_id: '5', push_status: 'pushed' }], planned_workouts: [] })
  const client = fakeEventsClient()
  const r = await removePlannedWorkoutPush({ service: sb, riderId: 'other', workoutId: 'w1', now: NOW, makeClient: mk(client) })
  assert.equal(r.removed, false)
  assert.equal(client.calls.length, 0)
  assert.equal(sb.db.planned_workout_pushes.length, 1)
})

test('cycle: pushes new/changed in window only, propagates tombstones, skips unchanged', async () => {
  const unchanged = wk('w2', '2026-12-04')
  const sb = fakeSupabase({
    connections: [conn()],
    planned_workouts: [
      wk('w1', '2026-12-03'), // new
      unchanged, // already pushed, same hash
      wk('w3', '2026-12-05', { title: 'edited' }), // changed
      wk('w4', '2027-03-01'), // outside window
      wk('w5', '2026-12-06', { activity_id: 'a1' }), // completed
      wk('w6', '2026-12-07', { status: 'skipped' }), // skipped but pushed -> removed
      wk('w7', '2026-11-20'), // past
    ],
    planned_workout_pushes: [
      { workout_id: 'w2', rider_id: RIDER, intervals_event_id: '2', push_status: 'pushed', pushed_hash: plannedPushHash(unchanged) },
      { workout_id: 'w3', rider_id: RIDER, intervals_event_id: '3', push_status: 'pushed', pushed_hash: 'stale' },
      { workout_id: 'w6', rider_id: RIDER, intervals_event_id: '6', push_status: 'pushed', pushed_hash: 'x' },
      { workout_id: 'gone', rider_id: RIDER, intervals_event_id: '9', push_status: 'pending_delete' },
    ],
  })
  const client = fakeEventsClient({ extId: (id) => (id === '9' ? externalIdFor('gone') : id === '6' ? externalIdFor('w6') : undefined) })
  const t = await runPlannedPushCycle({ service: sb, now: NOW, makeClient: mk(client) })
  assert.deepEqual([t.pushed, t.removed, t.failed], [2, 2, 0])
  const kinds = client.calls.map((c) => c[0] + (c[1]?.name || c[1] || ''))
  assert.ok(client.calls.some((c) => c[0] === 'remove' && c[1] === '9'))
  assert.ok(client.calls.some((c) => c[0] === 'remove' && c[1] === '6'))
  assert.ok(client.calls.some((c) => c[0] === 'update' && c[1] === '3'))
  assert.ok(client.calls.some((c) => c[0] === 'create' && c[1].name === 'Tw1'))
  assert.ok(!kinds.some((k) => /w4|w5|w7/.test(k)))
  assert.equal(sb.db.connections[0].planned_push_error, null)
})

test('cycle: disabled riders are not pushed but still get tombstones deleted', async () => {
  const sb = fakeSupabase({
    connections: [conn({ push_planned_workouts: false })],
    planned_workouts: [wk('w1', '2026-12-03')],
    planned_workout_pushes: [{ workout_id: 'gone', rider_id: RIDER, intervals_event_id: '9', push_status: 'pending_delete' }],
  })
  const client = fakeEventsClient({ extId: () => externalIdFor('gone') })
  const t = await runPlannedPushCycle({ service: sb, now: NOW, makeClient: mk(client) })
  assert.deepEqual([t.pushed, t.removed], [0, 1])
  assert.ok(!client.calls.some((c) => c[0] === 'create'))
})

test('cycle: a fatal error stops that rider, records it and does not block others', async () => {
  const sb = fakeSupabase({
    connections: [conn({ user_id: 'bad', external_athlete_id: 'ib' }), conn({ user_id: 'good', external_athlete_id: 'ig' })],
    planned_workouts: [wk('a', '2026-12-03', { rider_id: 'bad' }), wk('b', '2026-12-04', { rider_id: 'bad' }), wk('c', '2026-12-03', { rider_id: 'good' })],
    planned_workout_pushes: [],
  })
  let creates = 0
  const makeClient = ({ athleteId }) =>
    fakeEventsClient({ create: () => { creates++; if (athleteId === 'ib') throw new PushError('forbidden', 'read-only key', { fatal: true }); return `e${creates}` } })
  const t = await runPlannedPushCycle({ service: sb, now: NOW, makeClient })
  assert.equal(t.pushed, 1)
  assert.equal(creates, 2, 'bad rider stopped after the first fatal error')
  assert.equal(sb.db.connections.find((c) => c.user_id === 'bad').planned_push_error, 'read-only key')
  assert.equal(sb.db.connections.find((c) => c.user_id === 'good').planned_push_error, null)
})

test('cycle: a failed workout with unchanged content is not retried right away', async () => {
  const w = wk('w1', '2026-12-03')
  const sb = fakeSupabase({
    connections: [conn()],
    planned_workouts: [w],
    planned_workout_pushes: [{ workout_id: 'w1', rider_id: RIDER, push_status: 'error', attempted_hash: plannedPushHash(w), last_error: 'x', last_attempt_at: new Date(NOW - 60000).toISOString() }],
  })
  const client = fakeEventsClient()
  const t = await runPlannedPushCycle({ service: sb, now: NOW, makeClient: mk(client) })
  assert.equal(t.pushed, 0)
  assert.equal(client.calls.length, 0)
})

test('cycle: rider claimed by an overlapping run is skipped', async () => {
  const sb = fakeSupabase({ connections: [conn({ planned_push_attempt_at: new Date(NOW - 1000).toISOString() })], planned_workouts: [wk('w1', '2026-12-03')], planned_workout_pushes: [] })
  const t = await runPlannedPushCycle({ service: sb, now: NOW, makeClient: mk(fakeEventsClient()) })
  assert.equal(t.riders, 0)
})
