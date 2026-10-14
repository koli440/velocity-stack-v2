import test from 'node:test'
import assert from 'node:assert/strict'
import {
  syncWindowStart, selectNewRides, classifySyncError, pickDueConnections, manualCooldownRemaining, describeSyncResult,
} from '../syncPlan.js'
import { syncConnection } from '../server/intervalsSync.js'
import { ImportError } from '../server/importErrors.js'

const now = new Date('2026-10-14T12:00:00Z')

test('syncWindowStart: backfill on first run, cursor minus overlap afterwards', () => {
  assert.equal(syncWindowStart({ lastSyncedAt: null, backfillDays: 30, now }), '2026-09-14')
  assert.equal(syncWindowStart({ lastSyncedAt: null, backfillDays: null, now }), undefined)
  assert.equal(syncWindowStart({ lastSyncedAt: '2026-10-13T10:00:00Z', backfillDays: 30, now }), '2026-10-11')
})

test('selectNewRides drops known external ids and sorts oldest first', () => {
  const rides = [
    { id: 'b', start_date_local: '2026-10-02T08:00:00' },
    { id: 'a', start_date_local: '2026-10-01T08:00:00' },
    { id: 'c', start_date_local: '2026-10-03T08:00:00' },
  ]
  const existing = [{ external_source: 'intervals', external_id: 'b' }, { external_source: 'strava', external_id: 'c' }]
  assert.deepEqual(selectNewRides(rides, existing).map((r) => r.id), ['a', 'c'])
})

test('classifySyncError: auth errors are fatal', () => {
  assert.equal(classifySyncError(new ImportError('x', 401)).fatal, true)
  assert.equal(classifySyncError(new ImportError('x', 502)).fatal, false)
})

test('pickDueConnections filters, orders and limits', () => {
  const rows = [
    { id: 1, status: 'active', api_key: 'k', external_athlete_id: 'i1', last_attempt_at: '2026-10-14T11:59:00Z' },
    { id: 2, status: 'active', api_key: 'k', external_athlete_id: 'i2', last_attempt_at: '2026-10-14T11:00:00Z' },
    { id: 3, status: 'active', api_key: 'k', external_athlete_id: 'i3', last_attempt_at: null },
    { id: 4, status: 'error', api_key: 'k', external_athlete_id: 'i4', last_attempt_at: null },
  ]
  assert.deepEqual(pickDueConnections(rows, { now }).map((r) => r.id), [3, 2])
  assert.deepEqual(pickDueConnections(rows, { now, limit: 1 }).map((r) => r.id), [3])
})

test('manualCooldownRemaining', () => {
  assert.equal(manualCooldownRemaining(null, now), 0)
  assert.equal(manualCooldownRemaining('2026-10-14T11:59:30Z', now), 30)
  assert.equal(manualCooldownRemaining('2026-10-14T11:58:00Z', now), 0)
})

test('describeSyncResult', () => {
  assert.equal(describeSyncResult({ imported: 2, skipped: 1, complete: false }), '2 imported, 1 already there (more to come)')
  assert.equal(describeSyncResult({}), 'Up to date')
  assert.equal(describeSyncResult({ error: 'boom' }), 'boom')
  assert.equal(describeSyncResult({ imported: 3, error: 'rate limit' }), '3 imported. rate limit')
})

function fakeService() {
  const calls = []
  return { calls, rpc: async (n, a) => { calls.push([n, a]) }, from: () => ({ select: () => ({ eq: () => Object.assign(Promise.resolve({ data: [], error: null }), { maybeSingle: async () => ({ data: {} }) }) }) }) }
}
const conn = { user_id: 'u', external_athlete_id: 'i1', api_key: 'k', backfill_days: 30, last_synced_at: null }

test('syncConnection: imports, caps fetches and keeps a cursor', async () => {
  const svc = fakeService()
  const rides = [1, 2, 3].map((n) => ({ id: String(n), start_date_local: `2026-10-0${n}T08:00:00` }))
  const out = await syncConnection(svc, conn, {
    maxFetches: 2,
    createProvider: () => ({ source: 'intervals', listActivities: async () => rides }),
    importFn: async () => ({ status: 'imported' }),
  })
  assert.equal(out.imported, 2)
  assert.equal(out.complete, false)
  const [, args] = svc.calls[0]
  assert.equal(args.p_synced_at, '2026-10-02T08:00:00.000Z')
  assert.equal(args.p_error, null)
})

test('syncConnection: 401 is fatal and surfaces as error', async () => {
  const svc = fakeService()
  const out = await syncConnection(svc, conn, {
    createProvider: () => ({ source: 'intervals', listActivities: async () => { throw new ImportError('no', 401) } }),
  })
  assert.equal(out.fatal, true)
  assert.equal(svc.calls[0][1].p_fatal, true)
  assert.ok(svc.calls[0][1].p_error)
})

test('syncConnection: a failing ride does not stop the others', async () => {
  const svc = fakeService()
  const rides = [{ id: '1', start_date_local: '2026-10-01T08:00:00' }, { id: '2', start_date_local: '2026-10-02T08:00:00' }]
  let n = 0
  const out = await syncConnection(svc, conn, {
    createProvider: () => ({ source: 'intervals', listActivities: async () => rides }),
    importFn: async () => { if (n++ === 0) throw new Error('bad fit'); return { status: 'imported' } },
  })
  assert.equal(out.failed, 1)
  assert.equal(out.imported, 1)
  assert.equal(svc.calls[0][1].p_fatal, false)
})
