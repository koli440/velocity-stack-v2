import test from 'node:test'
import assert from 'node:assert/strict'
import {
  signState, verifyState, buildAuthorizeUrl, hasRequiredScope, tokenNeedsRefresh, tokensToColumns, isRevokedGrant,
  isStravaRide, filterStravaRides, resampleToSeconds, stravaStreamsToList, afterEpoch, parseWebhookEvent,
  validateSubscriptionRequest, parseRateLimit, isRateLimitNear, isStravaConfigured,
} from '../strava.js'
import { analyzeStreams } from '../streamAnalysis.js'
import { selectNewRides, classifySyncError, pickDueConnections } from '../syncPlan.js'
import { syncConnection } from '../server/intervalsSync.js'
import { createStravaProvider, StravaRateLimitError, StravaAuthError } from '../server/stravaProvider.js'
import { handleStravaEvent } from '../server/stravaWebhook.js'

const SECRET = 'test-secret'
const now = Date.parse('2026-10-14T12:00:00Z')

test('state: round trip, tampering, expiry, wrong secret', () => {
  const state = signState({ userId: 'u1', secret: SECRET, now })
  assert.deepEqual(verifyState({ state, secret: SECRET, now: now + 1000 }), { ok: true, userId: 'u1' })
  assert.equal(verifyState({ state, secret: SECRET, now: now + 11 * 60 * 1000 }).reason, 'expired')
  assert.equal(verifyState({ state, secret: 'other', now }).reason, 'bad_signature')
  const [payload, sig] = state.split('.')
  const forged = Buffer.from(JSON.stringify({ u: 'u2', e: 9999999999, n: 'x' })).toString('base64url')
  assert.equal(verifyState({ state: `${forged}.${sig}`, secret: SECRET, now }).reason, 'bad_signature')
  assert.equal(verifyState({ state: 'garbage', secret: SECRET, now }).reason, 'malformed')
  assert.equal(verifyState({ state: undefined, secret: SECRET }).ok, false)
  assert.ok(payload)
})

test('authorize URL and scope check', () => {
  const url = new URL(buildAuthorizeUrl({ clientId: 123, redirectUri: 'https://x.app/cb', state: 's' }))
  assert.equal(url.searchParams.get('scope'), 'activity:read_all')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x.app/cb')
  assert.equal(hasRequiredScope('read,activity:read_all'), true)
  assert.equal(hasRequiredScope('read'), false)
  assert.equal(hasRequiredScope(null), false)
  assert.equal(isStravaConfigured({ STRAVA_CLIENT_ID: '1' }), false)
  assert.equal(isStravaConfigured({ STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 's' }), true)
})

test('token expiry decision and token mapping', () => {
  assert.equal(tokenNeedsRefresh(null, now), true)
  assert.equal(tokenNeedsRefresh('bad', now), true)
  assert.equal(tokenNeedsRefresh(new Date(now + 60_000).toISOString(), now), true)
  assert.equal(tokenNeedsRefresh(new Date(now + 3600_000).toISOString(), now), false)
  assert.deepEqual(tokensToColumns({ access_token: 'a', refresh_token: 'r', expires_at: 1_800_000_000 }), {
    access_token: 'a', refresh_token: 'r', token_expires_at: new Date(1_800_000_000_000).toISOString(),
  })
  assert.equal(tokensToColumns({ access_token: 'a' }), null)
  assert.equal(isRevokedGrant(400, {}), true)
  assert.equal(isRevokedGrant(500, {}), false)
})

test('rides are filtered and mapped from the Strava list', () => {
  const rides = filterStravaRides([
    { id: 1, sport_type: 'Ride', name: 'A', start_date: '2026-10-01T08:00:00Z', start_date_local: '2026-10-01T10:00:00Z', elapsed_time: 3600 },
    { id: 2, type: 'Run' },
    { id: 3, sport_type: 'VirtualRide' },
  ])
  assert.deepEqual(rides.map((r) => r.id), [1, 3])
  assert.equal(rides[0].start_date_local, '2026-10-01T10:00:00')
  assert.equal(rides[0].start_time, '2026-10-01T08:00:00Z')
  assert.equal(isStravaRide({ type: 'Swim' }), false)
})

test('streams are resampled to 1 Hz and mapped for analyzeStreams', () => {
  assert.deepEqual(resampleToSeconds([0, 1, 4], [10, 20, 30]), [10, 20, 20, 20, 30])
  const list = stravaStreamsToList({
    time: { data: [0, 1, 2, 3] },
    watts: { data: [100, 200, 300, 400] },
    cadence: { data: [80, 80, 90, 90] },
    velocity_smooth: { data: [8, 8, 9, 9] },
    latlng: { data: [[1, 2], [1, 2], [1.1, 2.1], [1.2, 2.2]] },
  })
  assert.deepEqual(list.map((s) => s.type), ['watts', 'cadence', 'velocity_smooth', 'latlng'])
  assert.deepEqual(list.find((s) => s.type === 'latlng').data2, [2, 2, 2.1, 2.2])
  const out = analyzeStreams(list, { chainring: 50, cog: 15 })
  assert.equal(out.summary.avg_power_w, 250)
  assert.equal(out.summary.speed_source, 'sensor')
  assert.equal(stravaStreamsToList(null).length, 0)
})

test('afterEpoch converts the window start', () => {
  assert.equal(afterEpoch('2026-10-14'), Date.parse('2026-10-14T00:00:00Z') / 1000)
  assert.equal(afterEpoch(undefined), undefined)
})

test('webhook event parsing', () => {
  assert.deepEqual(parseWebhookEvent({ object_type: 'activity', aspect_type: 'create', object_id: 9, owner_id: 5 }), {
    kind: 'activity', aspect: 'create', activityId: '9', athleteId: '5',
  })
  assert.deepEqual(parseWebhookEvent({ object_type: 'athlete', aspect_type: 'update', owner_id: 5, updates: { authorized: 'false' } }), {
    kind: 'deauthorized', athleteId: '5',
  })
  assert.equal(parseWebhookEvent({ object_type: 'athlete', owner_id: 5, updates: { title: 'x' } }).kind, 'ignore')
  assert.equal(parseWebhookEvent({ object_type: 'activity', aspect_type: 'weird', object_id: 1, owner_id: 1 }).kind, 'ignore')
  assert.equal(parseWebhookEvent(null).kind, 'ignore')
})

test('subscription validation echoes the challenge only for the right token', () => {
  const ok = validateSubscriptionRequest({ mode: 'subscribe', token: 'abc', challenge: 'c1' }, 'abc')
  assert.deepEqual(ok, { 'hub.challenge': 'c1' })
  assert.equal(validateSubscriptionRequest({ mode: 'subscribe', token: 'abd', challenge: 'c1' }, 'abc'), null)
  assert.equal(validateSubscriptionRequest({ mode: 'subscribe', token: 'abc', challenge: 'c1' }, null), null)
  assert.equal(validateSubscriptionRequest({ mode: 'other', token: 'abc', challenge: 'c1' }, 'abc'), null)
})

test('rate limit parsing and threshold', () => {
  const rl = parseRateLimit(new Headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '98,10' }))
  assert.deepEqual(rl, { limit: [100, 1000], usage: [98, 10] })
  assert.equal(isRateLimitNear(rl), true)
  assert.equal(isRateLimitNear({ limit: [100, 1000], usage: [10, 10] }), false)
  assert.equal(parseRateLimit(new Headers()), null)
})

test('selectNewRides: Strava rides duplicating an Intervals ride are dropped, other copies upgraded', () => {
  const rides = [
    { id: 1, start_date_local: '2026-10-01T08:00:00', start_time: '2026-10-01T08:00:00Z', elapsed_time_s: 3600 },
    { id: 2, start_date_local: '2026-10-02T08:00:00', start_time: '2026-10-02T08:00:00Z', elapsed_time_s: 1800 },
  ]
  const existing = [
    { id: 'a', source: 'intervals', start_time: '2026-10-01T08:00:02Z', elapsed_time_s: 3601 },
    { id: 'b', source: 'strava', start_time: '2026-10-02T08:00:00Z', elapsed_time_s: 1800 },
  ]
  assert.deepEqual(selectNewRides(rides, existing, 'strava').map((r) => r.id), [])
  const manual = [{ id: 'c', source: 'manual', start_time: '2026-10-02T08:00:00Z', elapsed_time_s: 1800 }]
  // Manual uploads are never replaced, so a Strava copy of the same ride is not fetched either.
  assert.deepEqual(selectNewRides(rides, manual, 'strava').map((r) => r.id), [1])
})

test('Strava error classification and due selection', () => {
  assert.equal(classifySyncError(new StravaAuthError(), 'strava').fatal, true)
  assert.equal(classifySyncError({ status: 403 }, 'strava').fatal, false)
  assert.equal(classifySyncError(new StravaRateLimitError(), 'strava').fatal, false)
  const rows = [{ status: 'active', refresh_token: 'r', external_athlete_id: '1', last_attempt_at: null }]
  assert.equal(pickDueConnections(rows).length, 1)
})

function fakeService() {
  const rpcs = []
  return { rpcs, rpc: async (name, args) => { rpcs.push({ name, args }); return {} }, from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) }
}

test('syncConnection records a non-fatal rate limit for Strava and fatal auth errors', async () => {
  const conn = { provider: 'strava', user_id: 'u', last_synced_at: null, backfill_days: 30 }
  const svc = fakeService()
  const deps = (err) => ({
    createProvider: () => ({ source: 'strava', listActivities: async () => { throw err }, listWindow: async () => { throw err } }),
    loadExisting: undefined,
  })
  // existing fingerprints are loaded via service.from(...).select().eq(); stub through a richer fake
  const service = {
    ...svc,
    from: () => ({ select: () => ({ eq: () => Object.assign(Promise.resolve({ data: [], error: null }), { maybeSingle: async () => ({ data: {} }) }) }) }),
  }
  const soft = await syncConnection(service, conn, deps(new StravaRateLimitError()))
  assert.equal(soft.fatal, false)
  assert.match(soft.error, /Strava rate limit/)
  const hard = await syncConnection(service, conn, deps(new StravaAuthError()))
  assert.equal(hard.fatal, true)
  assert.deepEqual(service.rpcs.filter((r) => r.name === 'record_connection_result_for').map((r) => [r.args.p_provider, r.args.p_fatal]), [['strava', false], ['strava', true]])
})

test('Strava provider: 429 and 401 map to rate-limit / auth errors; headers throttle further calls', async () => {
  const mk = (status, headers = {}) => async () => new Response('[]', { status, headers })
  await assert.rejects(createStravaProvider({ accessToken: 't', fetchImpl: mk(429) }).listActivities(), StravaRateLimitError)
  await assert.rejects(createStravaProvider({ accessToken: 't', fetchImpl: mk(401) }).listActivities(), StravaAuthError)
  let calls = 0
  const near = createStravaProvider({
    accessToken: 't',
    fetchImpl: async () => { calls++; return new Response('[]', { headers: { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '99,5' } }) },
  })
  await near.listActivities()
  await assert.rejects(near.listActivities(), StravaRateLimitError)
  assert.equal(calls, 1)
})

test('Strava provider fetchActivity maps start/elapsed from the detail and rejects non-rides', async () => {
  const detail = { id: 7, name: 'Morning', sport_type: 'Ride', start_date: '2026-10-01T08:00:00Z', start_date_local: '2026-10-01T10:00:00Z', elapsed_time: 5 }
  const streams = { time: { data: [0, 1, 2] }, watts: { data: [100, 100, 100] } }
  const fetchImpl = async (url) => new Response(JSON.stringify(String(url).includes('/streams') ? streams : detail))
  const out = await createStravaProvider({ accessToken: 't', fetchImpl }).fetchActivity(7, {})
  assert.equal(out.summary.start_time, '2026-10-01T08:00:00Z')
  assert.equal(out.summary.elapsed_time_s, 5)
  assert.equal(out.title, 'Morning')
  const runFetch = async () => new Response(JSON.stringify({ ...detail, sport_type: 'Run' }))
  await assert.rejects(createStravaProvider({ accessToken: 't', fetchImpl: runFetch }).fetchActivity(7, {}), { status: 422 })
})

test('webhook: activity create triggers a sync once; unknown athletes and deletes are ignored', async () => {
  const updates = []
  const service = {
    from(table) {
      const q = {
        select: () => q, eq: () => q, neq: () => q, limit: () => q,
        update: (v) => { updates.push([table, v]); return q },
        then: (res) => res(table === 'connections' ? { data: [{ id: 'c1', user_id: 'u1' }], error: null } : { data: [], error: null }),
      }
      return q
    },
  }
  const triggered = []
  const triggerSync = async (u) => triggered.push(u)
  const ev = { object_type: 'activity', aspect_type: 'create', object_id: 9, owner_id: 5 }
  assert.equal((await handleStravaEvent(service, ev, { triggerSync })).handled, 'sync_triggered')
  assert.deepEqual(triggered, ['u1'])
  assert.equal((await handleStravaEvent(service, { ...ev, aspect_type: 'delete' }, { triggerSync })).handled, 'ignored')
  assert.equal(triggered.length, 1)
})
