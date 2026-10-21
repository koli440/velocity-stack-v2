import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStravaProvider } from '../server/stravaProvider.js'
import { syncConnection } from '../server/intervalsSync.js'
import { loadExistingActivityFingerprints } from '../activityDuplicates.js'

const NOW = new Date('2026-10-21T12:00:00Z')
const DAY = 86400000

// 260 rides, one every ~1.4 days over the last year, plus a non-ride activity in between every 10th.
function makeActivities(n = 260) {
  const out = []
  for (let i = 0; i < n; i++) {
    const start = new Date(NOW.getTime() - (i + 1) * 1.4 * DAY)
    out.push({ id: 1000 + i, type: i % 10 === 5 ? 'Run' : 'Ride', name: `Ride ${i}`, start_date: start.toISOString(), start_date_local: start.toISOString().replace('Z', ''), moving_time: 3600, elapsed_time: 3700, distance: 30000 })
  }
  return out
}

// Mimics Strava: `after` => oldest-first, otherwise newest-first (with `before` an exclusive upper bound).
function fakeStrava(all, { ascendingAlways = false, log = [] } = {}) {
  return async (url) => {
    const u = new URL(url)
    const q = u.searchParams
    log.push(u.search)
    const per = Number(q.get('per_page'))
    const page = Number(q.get('page'))
    const t = (a) => Date.parse(a.start_date) / 1000
    let list = all.filter((a) => (!q.get('after') || t(a) > Number(q.get('after'))) && (!q.get('before') || t(a) < Number(q.get('before'))))
    list = [...list].sort((a, b) => (q.get('after') || ascendingAlways ? t(a) - t(b) : t(b) - t(a)))
    return new Response(JSON.stringify(list.slice((page - 1) * per, page * per)), { status: 200 })
  }
}

function harness(all, conn, fetchImpl, { quotaFor } = {}) {
  const imported = new Map()
  const service = {
    from: () => ({ select: () => ({ eq: () => Object.assign(Promise.resolve({ data: [...imported.keys()].map((id) => ({ external_source: 'strava', external_id: id })), error: null }), {}) }) }),
    rpc: async (name, a) => {
      if (name === 'record_connection_result_for' && a.p_synced_at && !a.p_fatal) conn.last_synced_at = a.p_synced_at
      if (name === 'record_backfill_progress') {
        conn.backfill_cursor = a.p_cursor ?? conn.backfill_cursor
        conn.backfill_complete = a.p_complete ?? conn.backfill_complete
      }
      return { error: null }
    },
  }
  const deps = {
    now: () => NOW,
    createProvider: async () => createStravaProvider({ accessToken: 't', fetchImpl }),
    importFn: async ({ externalId }) => { imported.set(String(externalId), true); return { status: 'imported' } },
    repairFn: async () => ({}),
  }
  const turn = (extra = {}) => syncConnection(service, conn, { ...deps, maxBackfillRides: quotaFor?.() ?? 10, ...extra })
  return { imported, turn }
}

async function runToCompletion(h, conn, max = 100) {
  for (let i = 0; i < max && !(conn.backfill_complete && conn.last_synced_at); i++) await h.turn()
}

const rideIds = (all, oldestIso) => all.filter((a) => a.type === 'Ride' && Date.parse(a.start_date) >= Date.parse(oldestIso)).map((a) => String(a.id))

{
  test('Strava 1-year backfill imports every ride (no gap)', async () => {
    const all = makeActivities()
    const conn = { provider: 'strava', user_id: 'u', external_athlete_id: '1', last_synced_at: null, backfill_cursor: null, backfill_complete: false, backfill_days: 365 }
    const h = harness(all, conn, fakeStrava(all))
    await runToCompletion(h, conn)
    assert.equal(conn.backfill_complete, true)
    const expected = rideIds(all, '2025-10-21T00:00:00Z')
    assert.ok(expected.length > 200)
    assert.deepEqual([...h.imported.keys()].sort(), expected.sort())
  })
}

test('listWindow never sends `after` and returns newest-first pages that walk back through the window', async () => {
  const all = makeActivities()
  const log = []
  const p = createStravaProvider({ accessToken: 't', fetchImpl: fakeStrava(all, { log }) })
  const first = await p.listWindow({ oldest: '2025-10-21' })
  assert.ok(!log[0].includes('after='))
  assert.equal(first.exhausted, false)
  const ids = first.rides.map((r) => String(r.id))
  assert.equal(ids[0], '1000')
  const second = await p.listWindow({ oldest: '2025-10-21', before: first.nextBefore })
  assert.ok(Date.parse(second.rides[0].start_time) <= Date.parse(first.nextBefore))
  assert.ok(second.rides.length > 0)
})

test('listWindow ignores response order and trims rides older than the window', async () => {
  const all = makeActivities(30)
  const p = createStravaProvider({ accessToken: 't', fetchImpl: fakeStrava(all, { ascendingAlways: true }) })
  const r = await p.listWindow({ oldest: '2026-09-01' })
  assert.equal(r.exhausted, true)
  assert.ok(r.rides.every((x) => Date.parse(x.start_time) >= Date.parse('2026-09-01T00:00:00Z')))
  assert.equal(r.nextBefore, all.map((a) => a.start_date).sort()[0])
})

test('quota stops mid-page keep the cursor inside the window and later turns resume without gaps', async () => {
  const all = makeActivities()
  const conn = { provider: 'strava', user_id: 'u', external_athlete_id: '1', last_synced_at: null, backfill_cursor: null, backfill_complete: false, backfill_days: 365 }
  const h = harness(all, conn, fakeStrava(all), { quotaFor: () => 7 })
  const first = await h.turn()
  assert.equal(first.more, true)
  assert.equal(conn.backfill_complete, false)
  assert.equal(h.imported.size, 7)
  await runToCompletion(h, conn, 200)
  assert.deepEqual([...h.imported.keys()].sort(), rideIds(all, '2025-10-21T00:00:00Z').sort())
})

test('a re-opened (previously gapped) backfill imports only the missing rides', async () => {
  const all = makeActivities()
  const expected = rideIds(all, '2025-10-21T00:00:00Z')
  const conn = { provider: 'strava', user_id: 'u', external_athlete_id: '1', last_synced_at: NOW.toISOString(), backfill_cursor: null, backfill_complete: false, backfill_days: 365 }
  const h = harness(all, conn, fakeStrava(all))
  // old behaviour: newest 30 days and oldest ~100 rides present
  expected.slice(0, 20).concat(expected.slice(-100)).forEach((id) => h.imported.set(id, true))
  const before = h.imported.size
  await runToCompletion(h, conn, 200)
  assert.deepEqual([...h.imported.keys()].sort(), expected.slice().sort())
  assert.ok(h.imported.size > before)
})

test('loadExistingActivityFingerprints pages past the 1000-row limit', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0') }))
  const mkQuery = () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null }),
    }
    return q
  }
  const res = await loadExistingActivityFingerprints({ from: mkQuery }, 'u')
  assert.equal(res.length, 2500)
})
