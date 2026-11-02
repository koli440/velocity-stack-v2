import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase } from './helpers/fakeSupabase.js'
import {
  parseGarminPush,
  isGarminHost,
  matchesWebhookToken,
  classifyGarminSport,
  localStampFromSeconds,
  permissionFlags,
  buildAuthorizeUrl,
  createPkcePair,
  tokensToColumns,
  tokenNeedsRefresh,
  garminRedirectUri,
  garminUserApiBase,
  classifyGarminActivityType,
  GARMIN_TOKEN_REFRESH_SKEW_S,
  NO_ACTIVITY_PERMISSION_MESSAGE,
  NO_WORKOUT_PERMISSION_MESSAGE,
} from '../garmin.js'
import { handleGarminPush } from '../server/garminWebhook.js'
import { buildGarminWorkout, garminPushState, garminPushHash } from '../garminPlan.js'
import { createGarminPlanClient } from '../server/garminPlans.js'
import { createGarminProvider } from '../server/garminProvider.js'
import { sourcePriority } from '../activityDuplicates.js'

test('redirect URI matches the registered Garmin callback', () => {
  assert.equal(garminRedirectUri({}), 'https://www.velocity-stack.app/api/connections/garmin/callback')
})

test('authorize URL carries PKCE S256 and state', () => {
  const { verifier, challenge } = createPkcePair('v'.repeat(43))
  const u = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 's', codeChallenge: challenge }))
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('code_challenge'), challenge)
  assert.equal(u.searchParams.get('state'), 's')
  assert.notEqual(verifier, challenge)
})

test('token helpers', () => {
  const now = Date.parse('2026-11-02T00:00:00Z')
  assert.equal(tokensToColumns({ access_token: 'a' }), null)
  assert.equal(tokensToColumns({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, now).token_expires_at, '2026-11-02T01:00:00.000Z')
  assert.equal(tokenNeedsRefresh(null, now), true)
  assert.equal(tokenNeedsRefresh('2026-11-02T01:00:00Z', now), false)
  assert.equal(tokenNeedsRefresh('2026-11-02T00:02:00Z', now), true)
})

test('webhook token comparison', () => {
  assert.equal(matchesWebhookToken('abc', 'abc'), true)
  assert.equal(matchesWebhookToken('abd', 'abc'), false)
  assert.equal(matchesWebhookToken(null, 'abc'), false)
  assert.equal(matchesWebhookToken('abc', ''), false)
})

test('parseGarminPush normalises the three push types and drops manual / non-FIT files', () => {
  const ev = parseGarminPush({
    activityFiles: [
      { userId: 'g1', summaryId: 's1', fileType: 'FIT', callbackURL: 'https://apis.garmin.com/f/1', startTimeInSeconds: 1000, startTimeOffsetInSeconds: 3600 },
      { userId: 'g1', summaryId: 's2', fileType: 'TCX', callbackURL: 'https://apis.garmin.com/f/2' },
      { userId: 'g1', summaryId: 's3', fileType: 'FIT', callbackURL: 'https://apis.garmin.com/f/3', manual: true },
    ],
    deregistrations: [{ userId: 'g2' }],
    userPermissionsChange: [{ userId: 'g3', permissions: ['ACTIVITY_EXPORT'] }],
  })
  assert.deepEqual(ev.map((e) => e.kind), ['activity_file', 'deregistration', 'permissions'])
  assert.equal(ev[0].offsetSeconds, 3600)
  assert.deepEqual(parseGarminPush(null), [])
})

test('only Garmin https hosts are fetched', () => {
  assert.equal(isGarminHost('https://apis.garmin.com/x'), true)
  assert.equal(isGarminHost('http://apis.garmin.com/x'), false)
  assert.equal(isGarminHost('https://evil.com/garmin.com'), false)
  assert.equal(isGarminHost('https://notgarmin.com/x'), false)
})

test('sport classification and local stamp', () => {
  assert.equal(classifyGarminSport({ sport: 'cycling' }), 'ride')
  assert.equal(classifyGarminSport({ activity_type: 'gym', sport: 'training' }), 'gym')
  assert.equal(classifyGarminSport({ sport: 'running' }), 'skip')
  assert.equal(localStampFromSeconds(0, 0), null)
  assert.equal(localStampFromSeconds(1767225600, 3600), '2026-01-01T01:00:00')
})

test('permission flags', () => {
  assert.deepEqual(permissionFlags(['ACTIVITY_EXPORT']), { activities: true, workouts: false })
  assert.deepEqual(permissionFlags(undefined), { activities: true, workouts: true })
})

test('Garmin ties with Intervals.icu and Wahoo and outranks Strava', () => {
  assert.equal(sourcePriority('garmin'), sourcePriority('intervals'))
  assert.ok(sourcePriority('garmin') > sourcePriority('strava'))
})

const gconn = (over = {}) => ({ id: 'c1', user_id: 'u1', provider: 'garmin', status: 'active', external_athlete_id: 'g1', access_token: 'a', refresh_token: 'r', last_error: null, planned_push_error: null, ...over })

test('webhook queues activity files for known users only and triggers a sync once', async () => {
  const sb = fakeSupabase({ connections: [gconn()], garmin_activity_events: [] })
  const synced = []
  const body = {
    activityFiles: [
      { userId: 'g1', summaryId: 's1', fileType: 'FIT', callbackURL: 'https://apis.garmin.com/f/1', startTimeInSeconds: 1000 },
      { userId: 'g1', summaryId: 's2', fileType: 'FIT', callbackURL: 'https://evil.example/f/2' },
      { userId: 'unknown', summaryId: 's3', fileType: 'FIT', callbackURL: 'https://apis.garmin.com/f/3' },
    ],
  }
  const r = await handleGarminPush(sb, body, { triggerSync: async (u) => synced.push(u) })
  assert.equal(r.activities, 1)
  assert.equal(r.ignored, 2)
  assert.equal(sb.db.garmin_activity_events.length, 1)
  assert.equal(sb.db.garmin_activity_events[0].summary_id, 's1')
  assert.deepEqual(synced, ['u1'])
})

test('deregistration disconnects the rider', async () => {
  const sb = fakeSupabase({ connections: [gconn()], garmin_activity_events: [] })
  const r = await handleGarminPush(sb, { deregistrations: [{ userId: 'g1' }] })
  assert.equal(r.deregistrations, 1)
  const c = sb.db.connections[0]
  assert.equal(c.status, 'disconnected')
  assert.equal(c.refresh_token, null)
  assert.equal(c.external_athlete_id, null)
})

test('permission change sets and clears the warnings', async () => {
  const sb = fakeSupabase({ connections: [gconn()], garmin_activity_events: [] })
  await handleGarminPush(sb, { userPermissionsChange: [{ userId: 'g1', permissions: [] }] })
  assert.equal(sb.db.connections[0].last_error, NO_ACTIVITY_PERMISSION_MESSAGE)
  assert.equal(sb.db.connections[0].planned_push_error, NO_WORKOUT_PERMISSION_MESSAGE)
  await handleGarminPush(sb, { userPermissionsChange: [{ userId: 'g1', permissions: ['ACTIVITY_EXPORT', 'WORKOUT_IMPORT'] }] })
  assert.equal(sb.db.connections[0].last_error, null)
  assert.equal(sb.db.connections[0].planned_push_error, null)
})

test('garmin plan: steps, repeats, watts from FTP and warnings', () => {
  const w = {
    id: 'w1', workout_date: '2026-11-04', discipline: 'ride', title: 'Over-unders', description: '',
    structure_manifest: {
      warmup_sec: 600, cooldown_sec: 300, repeat_count: 3,
      steps: [
        { role: 'work', keyBy: 'time', targetDurationSec: 300, bandType: 'pct_ftp', powerMin: 100, powerMax: 100 },
        { role: 'recovery', keyBy: 'time', targetDurationSec: 120, bandType: 'hr_pct', powerMin: 60, powerMax: 70 },
      ],
    },
  }
  const r = buildGarminWorkout(w, { ftp: 200 })
  assert.equal(r.structured, true)
  const steps = r.workout.segments[0].steps
  assert.equal(steps[0].intensity, 'WARMUP')
  assert.equal(steps[1].type, 'WorkoutRepeatStep')
  assert.equal(steps[1].repeatValue, 3)
  assert.equal(steps[1].steps[0].targetType, 'POWER')
  assert.equal(steps[1].steps[0].targetValueLow, 200)
  assert.equal(steps[1].steps[1].targetType, 'OPEN')
  assert.equal(steps.at(-1).intensity, 'COOLDOWN')
  assert.ok(r.warnings.length > 0)
  assert.equal(r.minutes, 10 + 5 + 3 * 7)
  const orders = []
  const walk = (list) => list.forEach((s) => { orders.push(s.stepOrder); if (s.steps) walk(s.steps) })
  walk(steps)
  assert.deepEqual(orders, orders.map((_, i) => i + 1))
})

test('garmin plan: no FTP keeps the length and warns; no steps gives no workout', () => {
  const w = { id: 'w1', workout_date: '2026-11-04', title: 't', structure_manifest: { steps: [{ role: 'work', keyBy: 'time', targetDurationSec: 60, bandType: 'pct_ftp', powerMin: 90, powerMax: 100 }] } }
  const r = buildGarminWorkout(w)
  assert.equal(r.workout.segments[0].steps[0].targetType, 'OPEN')
  assert.ok(r.warnings.some((x) => /FTP/.test(x)))
  assert.equal(buildGarminWorkout({ id: 'w2', title: 'x' }).workout, null)
})

test('garmin push state', () => {
  const w = { id: 'w1', workout_date: '2026-11-04', title: 't' }
  assert.equal(garminPushState(w, null), 'not_pushed')
  assert.equal(garminPushState(w, { garmin_workout_id: '1', pushed_hash: garminPushHash(w), push_status: 'pushed' }), 'pushed')
  assert.equal(garminPushState(w, { garmin_workout_id: '1', pushed_hash: 'x', push_status: 'pushed' }), 'out_of_date')
  assert.equal(garminPushState(w, { push_status: 'error', last_error: 'boom' }), 'error')
})

test('user endpoints use the partner gateway and tokens refresh 600 s early', () => {
  assert.equal(garminUserApiBase({}), 'https://apis.garmin.com/partner-gateway/rest')
  assert.equal(GARMIN_TOKEN_REFRESH_SKEW_S, 600)
})

test('activity types follow the Activity API appendix', () => {
  for (const t of ['CYCLING', 'ROAD_BIKING', 'VIRTUAL_RIDE', 'E_BIKE_MOUNTAIN', 'GRAVEL_CYCLING', 'TRACK_CYCLING']) assert.equal(classifyGarminActivityType(t), 'ride', t)
  assert.equal(classifyGarminActivityType('STRENGTH_TRAINING'), 'gym')
  for (const t of ['RUNNING', 'LAP_SWIMMING', 'HANDCYCLING', 'BOATING_V2']) assert.equal(classifyGarminActivityType(t), 'skip', t)
  assert.equal(classifyGarminActivityType(undefined), null)
})

test('webhook does not queue sports that are never imported', async () => {
  const sb = fakeSupabase({ connections: [gconn()], garmin_activity_events: [] })
  const f = (id, activityType) => ({ userId: 'g1', summaryId: id, fileType: 'FIT', callbackURL: `https://apis.garmin.com/f/${id}`, activityType })
  const r = await handleGarminPush(sb, { activityFiles: [f('a', 'RUNNING'), f('b', 'ROAD_BIKING'), f('c', undefined)] })
  assert.equal(r.activities, 2)
  assert.deepEqual(sb.db.garmin_activity_events.map((e) => e.summary_id), ['b', 'c'])
})

test('provider settles single-use downloads that answer 410 or 412 instead of retrying', async () => {
  for (const status of [410, 412]) {
    const sb = fakeSupabase({ garmin_activity_events: [{ user_id: 'u1', summary_id: 's1', callback_url: 'https://apis.garmin.com/f/1', start_time_s: 1000, attempts: 0, status: 'pending' }] })
    const p = createGarminProvider({ service: sb, userId: 'u1', accessToken: 't', fetchImpl: async () => ({ ok: false, status }) })
    const r = await p.fetchActivity('s1', { analyzeFit: async () => ({ success: true }) })
    assert.equal(r.skip, true)
    assert.equal(sb.db.garmin_activity_events[0].status, 'error')
  }
})

test('Training API client uses the V2 endpoints and sends owner and ids on update', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push([init.method, url, init.body ? JSON.parse(init.body) : null])
    const body = init.method === 'GET' ? { workoutId: 5, ownerId: 99 } : init.method === 'POST' ? { workoutId: 5, scheduleId: 6 } : null
    return { ok: true, status: 200, text: async () => (body ? JSON.stringify(body) : '') }
  }
  const c = createGarminPlanClient({ accessToken: 't', fetchImpl, base: 'https://apis.garmin.com' })
  assert.equal(await c.createWorkout({ workoutName: 'x' }), '5')
  await c.updateWorkout('5', { workoutName: 'y' })
  assert.equal(await c.createSchedule('5', '2026-11-04'), '6')
  await c.updateSchedule('6', '5', '2026-11-05')
  await c.deleteSchedule('6')
  await c.deleteWorkout('5')
  assert.deepEqual(calls.map((x) => `${x[0]} ${x[1].replace('https://apis.garmin.com', '')}`), [
    'POST /workoutportal/workout/v2', 'GET /training-api/workout/v2/5', 'PUT /training-api/workout/v2/5',
    'POST /training-api/schedule/', 'PUT /training-api/schedule/6', 'DELETE /training-api/schedule/6', 'DELETE /training-api/workout/v2/5',
  ])
  assert.equal(calls[2][2].ownerId, 99)
  assert.equal(calls[2][2].workoutId, 5)
  assert.equal(calls[4][2].scheduleId, 6)
})

test('garmin workout provider fields fit the 20 character limit', () => {
  const r = buildGarminWorkout({ id: 'a-very-long-uuid-0000-0000-0000-000000', workout_date: '2026-11-04', title: 't', structure_manifest: { steps: [{ role: 'work', keyBy: 'distance', targetDistanceM: 1000, bandType: 'none' }] } })
  assert.ok(r.workout.workoutProvider.length <= 20 && r.workout.workoutSourceId === r.workout.workoutProvider)
  assert.equal(r.workout.segments[0].steps[0].durationValueType, 'METER')
})
