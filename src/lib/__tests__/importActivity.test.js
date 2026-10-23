import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planImport, importActivity } from '../server/importActivity.js'
import { analyzeStreams, computeDurationalCurve, computeNormalizedPower } from '../streamAnalysis.js'
import { filterRides } from '../server/intervalsProvider.js'

const T = '2026-10-01T10:00:00Z'

test('planImport: no match inserts', () => {
  assert.equal(planImport({ source: 'intervals', externalId: '1', startTime: T, elapsedTimeS: 100 }, []).action, 'insert')
})

test('planImport: same external id skips', () => {
  const ex = [{ id: 'a', source: 'intervals', external_source: 'intervals', external_id: '1' }]
  assert.equal(planImport({ source: 'intervals', externalId: 1 }, ex).action, 'skip')
})

test('planImport: intervals upgrades strava copy, strava skips intervals/manual', () => {
  const strava = [{ id: 's', source: 'strava', start_time: T, elapsed_time_s: 100 }]
  const cand = { startTime: T, elapsedTimeS: 102 }
  const up = planImport({ ...cand, source: 'intervals', externalId: '9' }, strava)
  assert.equal(up.action, 'upgrade')
  assert.equal(up.existing.id, 's')
  const intervals = [{ id: 'i', source: 'intervals', start_time: T, elapsed_time_s: 100 }]
  assert.equal(planImport({ ...cand, source: 'strava', externalId: '9' }, intervals).action, 'skip')
  assert.equal(planImport({ ...cand, source: 'intervals', externalId: '9' }, [{ ...strava[0], source: 'intervals' }]).action, 'skip')
})

function fakeSupabase({ existing = [], insertError = null, curveError = null } = {}) {
  const calls = { inserts: [], deletes: [], rpcs: [] }
  const client = {
    calls,
    rpc(name, args) {
      calls.rpcs.push({ name, args })
      return Promise.resolve({ data: 1, error: null })
    },
    from(table) {
      return {
        select() {
          return { eq: () => Promise.resolve({ data: table === 'activities' ? existing : [], error: null }), }
        },
        insert(rows) {
          calls.inserts.push({ table, rows })
          const chain = {
            select: () => ({ single: () => Promise.resolve(insertError ? { data: null, error: insertError } : { data: { id: 'new1' }, error: null }) }),
            then: (r) => r({ error: table === 'activity_curves' ? curveError : null }),
          }
          return chain
        },
        delete() {
          return { eq: (_c, id) => { calls.deletes.push({ table, id }); return Promise.resolve({ error: null }) } }
        },
      }
    },
  }
  return client
}

const provider = {
  source: 'intervals',
  fetchActivity: async () => ({
    title: 'Ride',
    startDateLocal: '2026-10-01T12:00:00',
    summary: { start_time: T, elapsed_time_s: 100, avg_power_w: 200 },
    curves: { Power: { '5s': 300 } },
    time_series: {},
  }),
}
const profile = { default_chainring: 50, default_cog: 15 }

test('importActivity inserts activity and curves', async () => {
  const supabase = fakeSupabase()
  const r = await importActivity({ supabase, userId: 'u1', provider, externalId: '42', profile })
  assert.equal(r.status, 'imported')
  assert.equal(supabase.calls.inserts[0].table, 'activities')
  assert.equal(supabase.calls.inserts[0].rows[0].user_id, 'u1')
  assert.equal(supabase.calls.inserts[0].rows[0].external_id, '42')
  assert.equal(supabase.calls.inserts[1].table, 'activity_curves')
})

test('importActivity upgrades: inserts new then deletes lower-priority copy', async () => {
  const supabase = fakeSupabase({ existing: [{ id: 'old', source: 'strava', start_time: T, elapsed_time_s: 100 }] })
  const r = await importActivity({ supabase, userId: 'u1', provider, externalId: '42', profile })
  assert.equal(r.status, 'upgraded')
  assert.equal(r.replacedId, 'old')
  assert.deepEqual(supabase.calls.deletes, [{ table: 'activities', id: 'old' }])
})

test('importActivity upgrade moves planned workout links to the replacement before deleting (#284)', async () => {
  const supabase = fakeSupabase({ existing: [{ id: 'old', source: 'strava', start_time: T, elapsed_time_s: 100 }] })
  await importActivity({ supabase, userId: 'u1', provider, externalId: '42', profile })
  assert.deepEqual(supabase.calls.rpcs, [{ name: 'planned_workouts_relink_activity', args: { p_old: 'old', p_new: 'new1' } }])
})

test('importActivity skips duplicates without inserting', async () => {
  const supabase = fakeSupabase({ existing: [{ id: 'old', source: 'manual', start_time: T, elapsed_time_s: 100 }] })
  // manual (1) < intervals (3) would upgrade; use an equal-priority copy instead
  supabase.calls.inserts.length = 0
  const s2 = fakeSupabase({ existing: [{ id: 'old', source: 'intervals', start_time: T, elapsed_time_s: 100 }] })
  const r = await importActivity({ supabase: s2, userId: 'u1', provider, externalId: '43', profile })
  assert.equal(r.status, 'skipped')
  assert.equal(s2.calls.inserts.length, 0)
})

test('importActivity maps unique violation to skipped and rejects missing user', async () => {
  const supabase = fakeSupabase({ insertError: { code: '23505', message: 'dup' } })
  const r = await importActivity({ supabase, userId: 'u1', provider, externalId: '1', profile })
  assert.equal(r.status, 'skipped')
  await assert.rejects(importActivity({ supabase, userId: null, provider, externalId: '1', profile }), { status: 401 })
})

test('computeDurationalCurve / computeNormalizedPower', () => {
  assert.deepEqual(computeDurationalCurve([1, 2, 3, 4, 5], [1, 2]), { '1s': 5, '2s': 4.5 })
  assert.equal(computeNormalizedPower([200, 200], 30), null)
  assert.equal(computeNormalizedPower(new Array(60).fill(200)), 200)
})

test('analyzeStreams builds summary from streams; null when empty', () => {
  assert.equal(analyzeStreams([]), null)
  const n = 40
  const r = analyzeStreams(
    [
      { type: 'watts', data: new Array(n).fill(250) },
      { type: 'cadence', data: new Array(n).fill(90) },
      { type: 'velocity_smooth', data: new Array(n).fill(10) },
    ],
    {}
  )
  assert.equal(r.summary.avg_power_w, 250)
  assert.equal(r.summary.speed_source, 'sensor')
  assert.equal(r.summary.elapsed_time_s, n - 1)
  assert.ok(r.curves.Power['5s'] === 250)
})

test('analyzeStreams derives speed from cadence for fixed gear, else unavailable', () => {
  const streams = [{ type: 'cadence', data: new Array(10).fill(100) }]
  assert.equal(analyzeStreams(streams, { chainring: 50, cog: 15, isFixedGear: true }).summary.speed_source, 'derived_from_cadence')
  assert.equal(analyzeStreams(streams, {}).summary.speed_source, 'unavailable')
})

test('filterRides keeps only rides', () => {
  const out = filterRides([{ id: 1, type: 'Ride' }, { id: 2, type: 'Run' }, { id: 3, type: 'VirtualRide' }])
  assert.deepEqual(out.map((r) => r.id), [1, 3])
})

test('importActivity: curve insert failure rolls the activity back and throws', async () => {
  const supabase = fakeSupabase({ curveError: { message: 'permission denied for table activity_curves' } })
  await assert.rejects(
    importActivity({ supabase, userId: 'u1', provider, externalId: '42', profile }),
    /Saving curves failed: permission denied/
  )
  assert.deepEqual(supabase.calls.deletes, [{ table: 'activities', id: 'new1' }])
})

test('analyzeStreams: emits heartrate in time_series and a HeartRate curve (same shape as analyze.py)', () => {
  const n = 120
  const r = analyzeStreams([
    { type: 'watts', data: Array.from({ length: n }, (_, i) => 200 + (i % 10)) },
    { type: 'cadence', data: Array.from({ length: n }, () => 90) },
    { type: 'heartrate', data: Array.from({ length: n }, (_, i) => 120 + (i % 30)) },
    { type: 'velocity_smooth', data: Array.from({ length: n }, () => 10) },
  ])
  assert.equal(r.time_series.heartrate.length, n)
  assert.ok(r.curves.HeartRate['1m'] > 120)
  for (const k of ['Power', 'Cadence', 'Speed', 'Torque', 'HeartRate']) assert.ok(r.curves[k]['15s'] > 0, k)
  const none = analyzeStreams([{ type: 'watts', data: [100, 100] }])
  assert.deepEqual(none.time_series.heartrate, [])
})

test('importActivity applies no gear when the rider has no saved default', async () => {
  const supabase = fakeSupabase()
  let seen
  const spy = { ...provider, fetchActivity: async (id, opts) => { seen = opts.gearing; return provider.fetchActivity() } }
  await importActivity({ supabase, userId: 'u1', provider: spy, externalId: '50', profile: {} })
  assert.equal(seen.chainring, null)
  assert.equal(seen.cog, null)
  const row = supabase.calls.inserts[0].rows[0]
  assert.equal(row.chainring, null)
  assert.equal(row.cog, null)
})

test('importActivity auto-links the same-day planned workout by the provider local day', async () => {
  const supabase = fakeSupabase()
  const baseFrom = supabase.from.bind(supabase)
  const planned = { id: 'pw1', rider_id: 'u1', workout_date: '2026-10-01', discipline: 'ride', status: 'planned', activity_id: null, auto_link_suppressed: false }
  const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: [planned], error: null }) }
  supabase.from = (t) => (t === 'planned_workouts' ? q : baseFrom(t))
  const wrapped = { ...supabase, from: supabase.from }
  const p = { ...provider, fetchActivity: async () => ({ ...(await provider.fetchActivity()), startDateLocal: '2026-10-01T23:30:00' }) }
  // the mocked insert returns { id: 'new1' } without user_id, so give the pipeline one
  const from = wrapped.from
  wrapped.from = (t) => {
    const base = from(t)
    if (t !== 'activities') return base
    return { ...base, insert: (rows) => ({ ...base.insert(rows), select: () => ({ single: () => Promise.resolve({ data: { id: 'new1', user_id: 'u1' }, error: null }) }) }) }
  }
  wrapped.calls = supabase.calls
  wrapped.rpc = supabase.rpc
  const r = await importActivity({ supabase: wrapped, userId: 'u1', provider: p, externalId: '42', profile })
  assert.equal(r.status, 'imported')
  assert.deepEqual(supabase.calls.rpcs, [{ name: 'planned_workout_auto_link', args: { p_workout: 'pw1', p_activity: 'new1', p_local_date: '2026-10-01' } }])
})
