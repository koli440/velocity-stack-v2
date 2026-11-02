import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase, fakeGarminClient } from './helpers/fakeSupabase.js'
import { pushPlannedForSync } from '../server/syncPush.js'
import { pushGarminRider } from '../server/garminPush.js'
import { PushError } from '../server/intervalsEvents.js'
import { describeSyncResult, describePlannedPush } from '../syncPlan.js'

const NOW = Date.parse('2026-11-02T10:00:00Z')
const RIDER = 'r1'
const conn = { id: 'c1', user_id: RIDER, provider: 'garmin', status: 'active', refresh_token: 'rt', push_planned_workouts: false }
const manifest = { steps: [{ role: 'work', keyBy: 'time', targetDurationSec: 600, bandType: 'pct_ftp', powerMin: 90, powerMax: 95 }] }
const wk = (id, date) => ({ id, rider_id: RIDER, workout_date: date, discipline: 'ride', title: id, description: '', structure_dsl: null, structure_manifest: manifest, status: 'planned', activity_id: null })

test('sync pushes planned workouts even when auto-push is off, and is idempotent', async () => {
  const sb = fakeSupabase({ connections: [conn], profiles: [{ id: RIDER, ftp_w: 250 }], planned_workout_garmin_pushes: [], planned_workouts: [wk('w1', '2026-11-04'), wk('w2', '2026-11-05'), wk('old', '2026-10-01')] })
  const client = fakeGarminClient()
  const runners = { garmin: { run: ({ service, userId, now, deadline }) => pushGarminRider({ service, riderId: userId, conn, client, now, deadline, autoPush: true }) } }
  const first = await pushPlannedForSync({ service: sb, provider: 'garmin', userId: RIDER, now: NOW, runners })
  assert.equal(first.pushed, 2)
  assert.equal(client.calls.filter((c) => c[0] === 'createWorkout').length, 2)
  const second = await pushPlannedForSync({ service: sb, provider: 'garmin', userId: RIDER, now: NOW, runners })
  assert.equal(second.pushed, 0)
  assert.equal(client.calls.filter((c) => c[0] === 'createWorkout').length, 2)
  assert.equal(sb.db.connections[0].planned_push_error, null)
})

test('push problems are reported, recorded and never thrown', async () => {
  const sb = fakeSupabase({ connections: [conn] })
  const stopped = { run: async () => ({ pushed: 1, removed: 0, failed: 1, stopped: new PushError('rate_limited', 'Garmin rate limit reached, try later.', { status: 429 }) }) }
  const r = await pushPlannedForSync({ service: sb, provider: 'garmin', userId: RIDER, runners: { garmin: stopped } })
  assert.equal(r.pushed, 1)
  assert.equal(r.message, 'Garmin rate limit reached, try later.')
  assert.equal(sb.db.connections[0].planned_push_error, 'Garmin rate limit reached, try later.')
  const boom = { run: async () => { throw new PushError('not_connected', 'Reconnect Garmin.', { status: 409, fatal: true }) } }
  const b = await pushPlannedForSync({ service: sb, provider: 'garmin', userId: RIDER, runners: { garmin: boom } })
  assert.deepEqual([b.failed, b.message], [1, 'Reconnect Garmin.'])
  const odd = { run: async () => { throw new Error('secret') } }
  assert.equal((await pushPlannedForSync({ service: sb, provider: 'garmin', userId: RIDER, runners: { garmin: odd } })).message, 'Could not send workouts.')
})

test('providers without workout push (Strava) are skipped', async () => {
  assert.equal(await pushPlannedForSync({ service: fakeSupabase({}), provider: 'strava', userId: RIDER }), null)
})

test('sync summary includes the push result', () => {
  assert.equal(describePlannedPush({ pushed: 2, removed: 1, failed: 0 }), '2 workouts sent, 1 removed')
  assert.equal(describePlannedPush({ pushed: 0, failed: 0 }), '')
  assert.equal(describeSyncResult({ imported: 1, planned: { pushed: 1, failed: 0 } }), '1 imported. 1 workout sent')
  assert.equal(describeSyncResult({ planned: { pushed: 0, failed: 1, message: 'Reconnect Garmin.' } }), 'Up to date. Reconnect Garmin.')
  assert.equal(describeSyncResult({ imported: 1 }), '1 imported')
})
