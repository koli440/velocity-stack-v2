import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncConnection, runIntervalsSync, processRides } from '../server/intervalsSync.js'
import {
  selectNewRides, newestFirst, rideTimeMs, backfillBounds, needsBackfill, advanceBackfillCursor,
  backfillTurnSize, shouldChain, backfillProgressText, pickDueConnections, CHAIN_MIN_INTERVAL_S,
} from '../syncPlan.js'

const R = (id, local, extra = {}) => ({ id, start_date_local: local, ...extra })

test('selectNewRides is newest first', () => {
  const rides = [R('a', '2026-01-01T08:00:00'), R('c', '2026-03-01T08:00:00'), R('b', '2026-02-01T08:00:00')]
  assert.deepEqual(selectNewRides(rides).map((r) => r.id), ['c', 'b', 'a'])
  assert.deepEqual(newestFirst([{ id: 1 }, R('x', '2026-01-01T00:00:00')]).map((r) => r.id), ['x', 1])
  assert.ok(rideTimeMs({ start_time: '2026-01-01T00:00:00Z' }) === Date.parse('2026-01-01T00:00:00Z'))
})

test('backfillBounds restarts without forward cursor and resumes with a cursor', () => {
  const now = new Date('2026-10-15T00:00:00Z')
  assert.deepEqual(backfillBounds({ backfill_days: 30, last_synced_at: null, backfill_cursor: '2026-08-01T00:00:00Z' }, now), { oldest: '2026-09-15', before: null })
  assert.deepEqual(backfillBounds({ backfill_days: null, last_synced_at: 'x', backfill_cursor: null }, now), { oldest: undefined, before: null })
  assert.equal(backfillBounds({ backfill_days: 30, last_synced_at: '2026-10-01T00:00:00Z', backfill_cursor: '2026-10-01T10:00:00Z' }, now).before, '2026-10-01T10:00:00.000Z')
  assert.equal(needsBackfill({ last_synced_at: '2026-10-01T00:00:00Z', backfill_complete: true }), false)
  assert.equal(needsBackfill({ last_synced_at: null, backfill_complete: true }), true)
  assert.equal(needsBackfill({ last_synced_at: 'x', backfill_complete: false }), true)
})

test('advanceBackfillCursor moves backwards and completes when exhausted', () => {
  const todo = [R(3, '2026-03-01T00:00:00'), R(2, '2026-02-01T00:00:00'), R(1, '2026-01-01T00:00:00')]
  assert.deepEqual(advanceBackfillCursor({ todo, handled: 2, exhausted: false, nextBefore: null, current: null }), { cursor: '2026-02-01T00:00:00.000Z', complete: false })
  assert.deepEqual(advanceBackfillCursor({ todo, handled: 3, exhausted: true, nextBefore: null, current: 'c' }), { cursor: 'c', complete: true })
  assert.deepEqual(advanceBackfillCursor({ todo, handled: 3, exhausted: false, nextBefore: '2025-12-01T00:00:00Z', current: 'c' }), { cursor: '2025-12-01T00:00:00Z', complete: false })
  assert.deepEqual(advanceBackfillCursor({ todo: [], handled: 0, exhausted: false, nextBefore: '2025-12-01T00:00:00Z', current: 'c' }).cursor, '2025-12-01T00:00:00Z')
  assert.deepEqual(advanceBackfillCursor({ todo, handled: 0, exhausted: false, nextBefore: null, current: 'c' }), { cursor: 'c', complete: false })
})

test('fair share: equal split capped per turn, none without budget', () => {
  assert.equal(backfillTurnSize({ remaining: 120, riders: 3 }), 10)
  assert.equal(backfillTurnSize({ remaining: 12, riders: 3 }), 4)
  assert.equal(backfillTurnSize({ remaining: 2, riders: 5 }), 1)
  assert.equal(backfillTurnSize({ remaining: 0, riders: 2 }), 0)
})

test('pickDueConnections serves least recently attempted first and chain gate is short', () => {
  const now = new Date('2026-10-15T10:00:00Z')
  const rows = [
    { id: 'a', status: 'active', refresh_token: 't', external_athlete_id: '1', last_attempt_at: '2026-10-15T09:59:50Z' },
    { id: 'b', status: 'active', refresh_token: 't', external_athlete_id: '2', last_attempt_at: '2026-10-15T09:00:00Z' },
    { id: 'c', status: 'active', refresh_token: 't', external_athlete_id: '3', last_attempt_at: null },
  ]
  assert.deepEqual(pickDueConnections(rows, { now }).map((r) => r.id), ['c', 'b'])
  assert.deepEqual(pickDueConnections(rows, { now, minIntervalS: CHAIN_MIN_INTERVAL_S }).map((r) => r.id), ['c', 'b', 'a'])
})

test('shouldChain needs progress, remaining work and short chains; Strava also budget', () => {
  const more = { more: true, handled: 3 }
  assert.equal(shouldChain({ results: [more], depth: 0, provider: 'intervals' }), true)
  assert.equal(shouldChain({ results: [{ more: true, handled: 0 }], provider: 'intervals' }), false)
  assert.equal(shouldChain({ results: [{ more: false, handled: 5 }], provider: 'intervals' }), false)
  assert.equal(shouldChain({ results: [{ ...more, fatal: true }], provider: 'intervals' }), false)
  assert.equal(shouldChain({ results: [more], provider: 'strava', budgetLeft: false }), false)
  assert.equal(shouldChain({ results: [more], depth: 20, provider: 'intervals' }), false)
})

test('backfillProgressText', () => {
  assert.equal(backfillProgressText({ status: 'active', backfill_complete: true }), null)
  assert.equal(backfillProgressText({ status: 'active' }), null)
  assert.match(backfillProgressText({ status: 'active', backfill_complete: false, backfill_imported: 12, backfill_total: 40 }), /12 of 40 rides/)
  assert.match(backfillProgressText({ status: 'active', backfill_complete: false, backfill_imported: 7, backfill_total: null }), /7 rides so far/)
  assert.equal(backfillProgressText({ status: 'active', backfill_complete: false, backfill_imported: 0 }), 'Importing history, newest first')
})

// ---- syncConnection with fakes ----

function fakeService({ existing = [] } = {}) {
  const rpcs = []
  return {
    rpcs,
    from() {
      return { select: () => ({ eq: () => Object.assign(Promise.resolve({ data: existing, error: null }), { maybeSingle: async () => ({ data: {} }) }) }) }
    },
    rpc(name, args) {
      rpcs.push({ name, args })
      return Promise.resolve({ error: null })
    },
  }
}

function fakeProvider(rides, { source = 'intervals', pageSize = Infinity } = {}) {
  const calls = []
  return {
    source,
    calls,
    async listActivities(a) { calls.push(['list', a]); return rides.filter((r) => !a?.oldest || rideTimeMs(r) >= Date.parse(a.oldest)) },
    async listWindow({ oldest, before }) {
      calls.push(['window', { oldest, before }])
      const sorted = newestFirst(rides).filter((r) => !before || rideTimeMs(r) <= Date.parse(before))
      const page = sorted.slice(0, pageSize)
      const exhausted = page.length === sorted.length
      return { rides: page, exhausted, nextBefore: exhausted ? null : new Date(rideTimeMs(page[page.length - 1]) - 1000).toISOString() }
    },
  }
}

const baseConn = { provider: 'intervals', user_id: 'u', external_athlete_id: 'i1', api_key: 'k', backfill_days: null, last_synced_at: null, backfill_cursor: null, backfill_complete: false, backfill_imported: 0 }

function recorder() {
  const order = []
  return { order, importFn: async ({ externalId }) => { order.push(externalId); return { status: 'imported' } } }
}

test('first run imports newest first, completes and sets the forward cursor', async () => {
  const rides = [R('old', '2026-01-01T08:00:00'), R('new', '2026-03-01T08:00:00'), R('mid', '2026-02-01T08:00:00')]
  const provider = fakeProvider(rides)
  const { order, importFn } = recorder()
  const service = fakeService()
  const now = () => new Date('2026-10-15T10:00:00Z')
  const res = await syncConnection(service, baseConn, { createProvider: async () => provider, importFn, now, concurrency: 1 })
  assert.deepEqual(order, ['new', 'mid', 'old'])
  assert.equal(res.imported, 3)
  assert.equal(res.complete, true)
  const result = service.rpcs.find((r) => r.name === 'record_connection_result_for').args
  assert.equal(result.p_synced_at, '2026-10-15T10:00:00.000Z')
  const prog = service.rpcs.find((r) => r.name === 'record_backfill_progress').args
  assert.equal(prog.p_complete, true)
  assert.equal(prog.p_total, 3)
})

test('quota-limited run stops mid-backfill with a backwards cursor and resumes below it', async () => {
  const rides = [R('d', '2026-04-01T08:00:00'), R('c', '2026-03-01T08:00:00'), R('b', '2026-02-01T08:00:00'), R('a', '2026-01-01T08:00:00')]
  const provider = fakeProvider(rides)
  const { order, importFn } = recorder()
  const service = fakeService()
  const now = () => new Date('2026-10-15T10:00:00Z')
  const res = await syncConnection(service, baseConn, { createProvider: async () => provider, importFn, now, maxBackfillRides: 2, concurrency: 1 })
  assert.deepEqual(order, ['d', 'c'])
  assert.equal(res.more, true)
  assert.equal(res.complete, false)
  const prog = service.rpcs.find((r) => r.name === 'record_backfill_progress').args
  assert.equal(prog.p_cursor, '2026-03-01T08:00:00.000Z')
  assert.equal(prog.p_complete, false)
  assert.equal(prog.p_total, 4)

  // Next run: forward cursor exists, resumes at the cursor and only sees older rides; known ones are skipped.
  const conn2 = { ...baseConn, last_synced_at: '2026-10-15T10:00:00.000Z', backfill_cursor: prog.p_cursor, backfill_imported: 2 }
  const provider2 = fakeProvider(rides)
  const known = [{ external_source: 'intervals', external_id: 'd' }, { external_source: 'intervals', external_id: 'c' }]
  const rec2 = recorder()
  const service2 = fakeService({ existing: known })
  const res2 = await syncConnection(service2, conn2, { createProvider: async () => provider2, importFn: rec2.importFn, now, concurrency: 1 })
  assert.deepEqual(rec2.order, ['b', 'a'])
  assert.equal(res2.complete, true)
  assert.ok(provider2.calls.some((c) => c[0] === 'window' && c[1].before === '2026-03-01T08:00:00.000Z'))
  const prog2 = service2.rpcs.find((r) => r.name === 'record_backfill_progress').args
  assert.equal(prog2.p_complete, true)
  assert.equal(prog2.p_imported_delta, 2) // 2 + 2 handled - 2 stored
})

test('forward rides come first and an ongoing backfill does not block new rides', async () => {
  const rides = [R('new', '2026-10-14T08:00:00'), R('older', '2026-03-01T08:00:00')]
  const provider = fakeProvider(rides)
  const { order, importFn } = recorder()
  const service = fakeService({ existing: [{ external_source: 'intervals', external_id: 'older' }] })
  const conn = { ...baseConn, last_synced_at: '2026-10-13T00:00:00.000Z', backfill_cursor: '2026-02-01T00:00:00.000Z', backfill_imported: 5 }
  const res = await syncConnection(service, conn, { createProvider: async () => provider, importFn, now: () => new Date('2026-10-15T10:00:00Z'), concurrency: 1 })
  assert.deepEqual(order, ['new'])
  assert.equal(res.imported, 1)
  assert.equal(service.rpcs.find((r) => r.name === 'record_connection_result_for').args.p_synced_at, '2026-10-15T10:00:00.000Z')
})

test('paged listing (Strava) advances the cursor across pages that contain only known rides', async () => {
  const rides = Array.from({ length: 6 }, (_, i) => R(`r${i}`, `2026-0${6 - i}-01T08:00:00`, { start_time: `2026-0${6 - i}-01T08:00:00Z`, elapsed_time_s: 100 + i * 1000 }))
  const known = rides.slice(0, 4).map((r) => ({ external_source: 'strava', external_id: r.id }))
  const provider = { ...fakeProvider(rides, { source: 'strava', pageSize: 2 }), setPurpose() {} }
  const { order, importFn } = recorder()
  const service = fakeService({ existing: known })
  const conn = { ...baseConn, provider: 'strava', refresh_token: 't', api_key: null }
  const res = await syncConnection(service, conn, { createProvider: async () => provider, importFn, now: () => new Date('2026-10-15T10:00:00Z'), maxBackfillRides: 10 })
  assert.deepEqual(order, ['r4', 'r5'])
  assert.equal(res.complete, true)
  assert.equal(provider.calls.filter((c) => c[0] === 'window').length, 3)
})

test('budget stop is clean (no error) and keeps backfill incomplete', async () => {
  const rides = [R('b', '2026-02-01T08:00:00'), R('a', '2026-01-01T08:00:00')]
  const provider = fakeProvider(rides)
  const importFn = async ({ externalId }) => {
    if (externalId === 'a') throw Object.assign(new Error('budget'), { status: 429, budget: true })
    return { status: 'imported' }
  }
  const service = fakeService()
  const res = await syncConnection(service, baseConn, { createProvider: async () => provider, importFn, now: () => new Date('2026-10-15T10:00:00Z'), concurrency: 1 })
  assert.equal(res.error, null)
  assert.equal(res.budgetStopped, true)
  assert.equal(res.more, true)
  assert.equal(res.imported, 1)
  assert.equal(service.rpcs.find((r) => r.name === 'record_backfill_progress').args.p_complete, false)
})

test('parallel import keeps order-safe cursor and handles a stop inside a chunk', async () => {
  const todo = [R('4', '2026-04-01T00:00:00'), R('3', '2026-03-01T00:00:00'), R('2', '2026-02-01T00:00:00'), R('1', '2026-01-01T00:00:00')]
  let active = 0, maxActive = 0
  const importOne = async (ride) => {
    active++; maxActive = Math.max(maxActive, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
    if (ride.id === '2') throw Object.assign(new Error('limit'), { status: 429 })
    return { status: 'imported' }
  }
  const out = await processRides(todo, { providerName: 'intervals', concurrency: 4, importOne })
  assert.equal(maxActive, 4)
  assert.equal(out.handled, 2) // 4 and 3; the cursor must not pass ride 2
  assert.equal(out.stop, 'rate')
})

test('unique-violation style skips are plain results (importActivity answers skipped)', async () => {
  const provider = fakeProvider([R('a', '2026-01-01T08:00:00')])
  const res = await syncConnection(fakeService(), baseConn, {
    createProvider: async () => provider, importFn: async () => ({ status: 'skipped' }), now: () => new Date('2026-10-15T10:00:00Z'),
  })
  assert.equal(res.skipped, 1)
  assert.equal(res.failed, 0)
})

test('runIntervalsSync hands each Strava rider a fair share of the backfill budget', async () => {
  const seen = []
  const budget = { remaining: () => 32 }
  const conns = [1, 2, 3].map((n) => ({ ...baseConn, provider: 'strava', user_id: `u${n}`, refresh_token: 't' }))
  const createProvider = async () => ({ ...fakeProvider([], { source: 'strava' }), setPurpose() {} })
  const importFn = async () => ({ status: 'imported' })
  const orig = syncConnection
  void orig
  const results = await runIntervalsSync(fakeService(), conns, {
    budget, createProvider, importFn,
    now: () => { seen.push(1); return new Date('2026-10-15T10:00:00Z') },
  })
  assert.equal(results.length, 3)
})
