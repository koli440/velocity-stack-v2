import test from 'node:test'
import assert from 'node:assert/strict'
import { parseActivityIds, runTemplateBatch, ownStore, coachStore } from '../server/templateBatchRun.js'
import { addActivity, removeActivity, escapeLike, chunk, runInChunks, summarizeBatch, searchActivities, MAX_BATCH_ACTIVITIES } from '../templateBatch.js'

const A = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ts = { time: [0, 1], power: [1, 2] }
const evaluate = (_t, series) => (series.power[0] === 99 ? { efforts: [], summary: {} } : { efforts: [{ r: 1 }], summary: { x: 1 } })

function memStore({ activities = {}, runs = new Set(), failSave = new Set() } = {}) {
  const saved = []
  return {
    saved,
    async load(id) { return activities[id] ? { activity: activities[id], replaces: runs.has(id) } : null },
    async save(a, r) { if (failSave.has(a.id)) throw new Error('db down'); saved.push([a.id, r]) },
  }
}

test('parseActivityIds validates, dedupes and caps', () => {
  assert.deepEqual(parseActivityIds([A(1), A(1), A(2).toUpperCase()]).ids, [A(1), A(2)])
  assert.ok(parseActivityIds([]).error)
  assert.ok(parseActivityIds(['x']).error)
  assert.ok(parseActivityIds(Array.from({ length: 11 }, (_, i) => A(i))).error)
})

test('runTemplateBatch reports ok / re-run / no match / skipped / failed', async () => {
  const store = memStore({
    activities: { [A(1)]: { id: A(1), time_series: ts }, [A(2)]: { id: A(2), time_series: ts }, [A(3)]: { id: A(3), time_series: { time: [0], power: [99] } }, [A(4)]: { id: A(4), time_series: null }, [A(6)]: { id: A(6), time_series: ts } },
    runs: new Set([A(2)]), failSave: new Set([A(6)]),
  })
  const items = await runTemplateBatch([A(1), A(2), A(3), A(4), A(5), A(6)], { id: 't' }, store, { evaluate })
  assert.deepEqual(items.map((i) => i.status), ['ok', 'ok', 'no_match', 'skipped', 'skipped', 'failed'])
  assert.equal(items[1].replaced, true)
  assert.equal(items[0].replaced, false)
  assert.deepEqual(store.saved.map(([id]) => id), [A(1), A(2)])
  assert.match(items[5].reason, /db down/)
})

test('existing run is kept when the re-run finds nothing', async () => {
  const store = memStore({ activities: { [A(3)]: { id: A(3), time_series: { time: [0], power: [99] } } }, runs: new Set([A(3)]) })
  const [i] = await runTemplateBatch([A(3)], { id: 't' }, store, { evaluate })
  assert.equal(i.status, 'no_match')
  assert.equal(store.saved.length, 0)
})

test('time budget defers the remaining ids', async () => {
  let t = 0
  const store = memStore({ activities: { [A(1)]: { id: A(1), time_series: ts }, [A(2)]: { id: A(2), time_series: ts } } })
  const items = await runTemplateBatch([A(1), A(2)], { id: 't' }, store, { evaluate, budgetMs: 10, now: () => (t += 10) })
  assert.deepEqual(items.map((i) => i.status), ['deferred', 'deferred'])
})

// Minimal query-builder fake recording filters.
function fakeClient({ activity, existing = [], rpc = {} }) {
  const log = { filters: [], upserts: [], rpcs: [] }
  const builder = (table) => {
    const b = {
      select() { return b }, eq(c, v) { log.filters.push([table, c, v]); return b }, limit() { return b },
      maybeSingle: async () => ({ data: table === 'activities' ? activity : null }),
      then: (res) => res({ data: existing }),
      upsert(row, o) { log.upserts.push([row, o]); return Promise.resolve({ error: null }) },
      update() { return b },
    }
    return b
  }
  return { log, from: builder, rpc: async (fn, args) => { log.rpcs.push([fn, args]); return rpc[fn] ? rpc[fn](args) : { data: null, error: null } } }
}

test('own store filters by owner explicitly and upserts on the run identity', async () => {
  const c = fakeClient({ activity: { id: A(1), time_series: ts }, existing: [{ id: 'r' }] })
  const s = ownStore(c, 'me', 'tpl')
  const loaded = await s.load(A(1))
  assert.equal(loaded.replaces, true)
  assert.ok(c.log.filters.some(([t, col, v]) => t === 'activities' && col === 'user_id' && v === 'me'))
  assert.ok(c.log.filters.some(([t, col, v]) => t === 'template_executions' && col === 'by_coach' && v === false))
  await s.save(loaded.activity, { efforts: [1], summary: {} })
  assert.equal(c.log.upserts[0][1].onConflict, 'activity_id,template_id,coach_key')
  assert.equal(c.log.upserts[0][0].by_coach, false)
})

test('coach store uses RPCs only, rejects other riders and never touches activities', async () => {
  const c = fakeClient({ rpc: { coach_template_run_inputs: ({ p_activity }) => ({ data: { id: p_activity, user_id: p_activity === A(1) ? 'rider' : 'other', time_series: ts }, error: null }) } })
  const s = coachStore(c, 'coach', 'rider', 'tpl')
  assert.ok((await s.load(A(1))).activity)
  assert.equal(await s.load(A(2)), null)
  await s.save({ id: A(1) }, { efforts: [1], summary: {} })
  assert.equal(c.log.rpcs.at(-1)[0], 'coach_save_template_run')
  assert.ok(!c.log.filters.some(([t]) => t === 'activities'))
  assert.ok(c.log.filters.some(([, col, v]) => col === 'run_by_coach_id' && v === 'coach'))
})

test('list helpers: dedupe, cap, remove, escape, chunk', () => {
  let list = []
  list = addActivity(list, { id: 'a', title: 'A' }).list
  assert.equal(addActivity(list, { id: 'a' }).error, 'Already in the list')
  const full = Array.from({ length: MAX_BATCH_ACTIVITIES }, (_, i) => ({ id: String(i) }))
  assert.match(addActivity(full, { id: 'new' }).error, /50/)
  assert.deepEqual(removeActivity(list, 'a'), [])
  assert.equal(escapeLike('50%_a\\'), '50\\%\\_a\\\\')
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]])
})

test('searchActivities filters by owner and escapes the query', async () => {
  const calls = []
  const q = { select: () => q, eq: (c, v) => (calls.push([c, v]), q), ilike: (c, v) => (calls.push([c, v]), q), order: () => q, limit: () => Promise.resolve({ data: [{ id: 1 }], error: null }) }
  const client = { from: (t) => (calls.push(['from', t]), q) }
  await searchActivities(client, { ownerId: 'u', shared: true, query: '50%' })
  assert.deepEqual(calls, [['from', 'shared_activities'], ['user_id', 'u'], ['title', '%50\\%%']])
  assert.deepEqual((await searchActivities(client, { ownerId: null, query: 'x' })).data, [])
})

test('runInChunks: progress, deferred retry, failing chunk isolated', async () => {
  const ids = Array.from({ length: 7 }, (_, i) => A(i))
  const seen = []
  let n = 0
  const out = await runInChunks(ids, async (g) => {
    n += 1
    if (n === 1) return g.map((id) => ({ activity_id: id, status: 'deferred' }))
    if (n === 2) throw new Error('network')
    return g.map((id) => ({ activity_id: id, status: 'ok' }))
  }, { size: 5, onProgress: (p) => seen.push(p.done) })
  assert.equal(out.length, 7)
  assert.deepEqual(summarizeBatch(out), { ok: 2, no_match: 0, skipped: 0, failed: 5, replaced: 0 })
  assert.equal(seen.at(-1), 7)
})

test('runInChunks gives up on endless deferral and honours stop', async () => {
  const out = await runInChunks([A(1)], async (g) => g.map((id) => ({ activity_id: id, status: 'deferred' })))
  assert.equal(out[0].status, 'failed')
  assert.deepEqual(await runInChunks([A(1)], async () => [], { shouldStop: () => true }), [])
})
