import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairStravaActivities } from '../server/stravaRepair.js'
import { stravaStreamsToList } from '../strava.js'
import { analyzeStreams } from '../streamAnalysis.js'

// Minimal chainable stand-in for the PostgREST builder.
function fakeService({ rides = [], hrGaps = [], curveRows = [] } = {}) {
  const log = { inserts: [], deletes: [], updates: [] }
  const service = {
    log,
    from(table) {
      const q = { table, filters: {} }
      const b = {
        select: () => b,
        eq: (c, v) => (c === 'activity_id' || c === 'id' ? ((q.eqId = v), b) : b),
        in: () => Promise.resolve({ data: curveRows, error: null }),
        is: () => ((q.hr = true), b),
        order: () => b,
        limit: () => Promise.resolve({ data: q.hr ? hrGaps : rides, error: null }),
        maybeSingle: () => Promise.resolve({ data: { time_series: { watts: [1] } }, error: null }),
        insert: (rows) => (log.inserts.push({ table, rows }), Promise.resolve({ error: null })),
        delete: () => ({ eq: (_c, id) => (log.deletes.push({ table, id }), Promise.resolve({ error: null })) }),
        update: (patch) => ({ eq: (_c, id) => (log.updates.push({ table, id, patch }), Promise.resolve({ error: null })) }),
      }
      return b
    },
  }
  return service
}

test('repair rebuilds missing curve rows from curves_data without calling Strava', async () => {
  const service = fakeService({ rides: [{ id: 'a1', curves_data: { Power: { '5s': 300 } } }] })
  const provider = { analyzeStreamsFor: () => assert.fail('no Strava call expected') }
  const out = await repairStravaActivities(service, { userId: 'u', provider })
  assert.equal(out.curvesRebuilt, 1)
  assert.deepEqual(service.log.inserts[0].rows, [{ activity_id: 'a1', curve_type: 'Power', data: { '5s': 300 } }])
})

test('repair re-analyses rides lacking heartrate and rewrites time_series + curves', async () => {
  const service = fakeService({ hrGaps: [{ id: 'a2', external_id: '99', chainring: 58, cog: 14 }] })
  const n = 90
  const list = stravaStreamsToList({
    time: { data: Array.from({ length: n }, (_, i) => i) },
    watts: { data: Array.from({ length: n }, () => 250) },
    heartrate: { data: Array.from({ length: n }, () => 150) },
    cadence: { data: Array.from({ length: n }, () => 95) },
  })
  const provider = { setPurpose() {}, analyzeStreamsFor: async () => analyzeStreams(list) }
  const out = await repairStravaActivities(service, { userId: 'u', provider })
  assert.equal(out.reanalyzed, 1)
  assert.equal(service.log.updates[0].patch.time_series.heartrate.length, n)
  assert.ok(service.log.inserts[0].rows.some((r) => r.curve_type === 'HeartRate'))
})

test('repair stops on budget and marks rides without streams', async () => {
  const hrGaps = [{ id: 'x', external_id: '1' }]
  const budgetErr = Object.assign(new Error('budget'), { budget: true, status: 429 })
  let out = await repairStravaActivities(fakeService({ hrGaps }), {
    userId: 'u',
    provider: { setPurpose() {}, analyzeStreamsFor: async () => { throw budgetErr } },
  })
  assert.equal(out.stop, 'budget')

  const service = fakeService({ hrGaps })
  out = await repairStravaActivities(service, {
    userId: 'u',
    provider: { setPurpose() {}, analyzeStreamsFor: async () => { throw Object.assign(new Error('none'), { status: 404 }) } },
  })
  assert.deepEqual(service.log.updates[0].patch.time_series.heartrate, [])
})
