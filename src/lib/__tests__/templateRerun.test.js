import test from 'node:test'
import assert from 'node:assert/strict'
import { hasTimeSeries, processRun, runBatches } from '../server/templateRerun.js'

const ts = { time: [0, 1, 2], power: [100, 200, 300] }
const result = { efforts: [{ rep: 1, avg_power: 300 }, { rep: 2, avg_power: 290 }], summary: { avg_power: 295, dropoff_pct: 3, rep_analysis: { v: 1 } } }

// In-memory stand-in for the SQL functions: same rules as template_rerun_apply / batch / retry.
function makeStore({ runs, activities = {}, templates = { t1: { id: 't1' } }, failActivity = new Set() }) {
  const db = new Map(runs.map((r) => [r.execution_id, { ...r, attempts: 0 }]))
  const backups = new Map()
  const items = new Map()
  const store = {
    db, backups, items,
    async batch(after, limit, dry) {
      return [...db.values()]
        .filter((r) => (after == null || r.execution_id > after) && !items.has(`${r.execution_id}:${dry}`) && !backups.has(r.execution_id))
        .sort((a, b) => (a.execution_id < b.execution_id ? -1 : 1))
        .slice(0, limit)
        .map((r) => ({ ...r }))
    },
    async retryBatch(after, limit) {
      return [...db.values()].filter((r) => { const i = items.get(`${r.execution_id}:false`); return i?.status === 'failed' && i.attempts < 3 && !backups.has(r.execution_id) }).slice(0, limit).map((r) => ({ ...r, attempts: items.get(`${r.execution_id}:false`).attempts }))
    },
    async progress() {},
    async getTemplate(id) { return templates[id] || null },
    async getActivity(id) {
      if (failActivity.has(id)) throw new Error('boom')
      return activities[id] || null
    },
    async apply({ id, efforts, summary, expectedUpdatedAt }) {
      const r = db.get(id)
      if (!r) return 'missing'
      if (backups.has(id)) return 'already_done'
      if (expectedUpdatedAt && r.updated_at !== expectedUpdatedAt) return 'changed'
      backups.set(id, { efforts: r.efforts, summary: r.summary })
      r.efforts = efforts
      r.summary = summary
      return 'done'
    },
    async record(item) { items.set(`${item.execution_id}:${item.dry_run}`, item) },
  }
  return store
}

const baseRun = (id, extra = {}) => ({
  execution_id: id, activity_id: `a-${id}`, template_id: 't1', user_id: 'u1', by_coach: false, template_slug: 'ladder',
  updated_at: '2026-01-01T00:00:00Z', efforts: [{ avg_power: 300 }], summary: { avg_power: 300 }, ...extra,
})
const evaluate = () => result

test('hasTimeSeries recognises empty and missing series', () => {
  assert.equal(hasTimeSeries(null), false)
  assert.equal(hasTimeSeries({}), false)
  assert.equal(hasTimeSeries({ power: [] }), false)
  assert.equal(hasTimeSeries(ts), true)
})

test('re-runs a run, backs up the previous efforts and keeps the rest of the row', async () => {
  const run = baseRun('r1', { by_coach: true })
  const store = makeStore({ runs: [run], activities: { 'a-r1': { time_series: ts } } })
  const out = await runBatches(store, { evaluate })
  assert.deepEqual(out.counts, { done: 1, skipped: 0, failed: 0 })
  const row = store.db.get('r1')
  assert.equal(row.summary.rep_analysis.v, 1)
  assert.equal(row.summary.dropoff_pct, 3)
  assert.equal(row.by_coach, true)
  assert.equal(row.updated_at, '2026-01-01T00:00:00Z')
  assert.deepEqual(store.backups.get('r1').summary, { avg_power: 300 })
  assert.equal(store.items.get('r1:false').had_rep_analysis_before, false)
})

test('idempotent: a second pass changes and creates nothing', async () => {
  const store = makeStore({ runs: [baseRun('r1'), baseRun('r2')], activities: { 'a-r1': { time_series: ts }, 'a-r2': { time_series: ts } } })
  await runBatches(store, { evaluate })
  const snapshot = JSON.stringify([...store.db.entries()])
  const again = await runBatches(store, { evaluate })
  assert.equal(again.processed, 0)
  assert.equal(JSON.stringify([...store.db.entries()]), snapshot)
  assert.equal(store.db.size, 2)
  assert.equal(await store.apply({ id: 'r1', efforts: [], summary: {}, expectedUpdatedAt: null }), 'already_done')
})

test('skips and reports runs whose time series, activity or template are gone', async () => {
  const store = makeStore({
    runs: [baseRun('r1'), baseRun('r2'), baseRun('r3', { template_id: null }), baseRun('r4', { template_id: 'gone' })],
    activities: { 'a-r1': { time_series: {} } },
  })
  const out = await runBatches(store, { evaluate })
  assert.deepEqual(out.counts, { done: 0, skipped: 4, failed: 0 })
  assert.match(store.items.get('r1:false').reason, /time series/)
  assert.match(store.items.get('r2:false').reason, /activity/)
  assert.match(store.items.get('r3:false').reason, /template/)
  assert.match(store.items.get('r4:false').reason, /template/)
  assert.equal(store.backups.size, 0)
  assert.equal(store.db.get('r1').summary.avg_power, 300)
})

test('dry run reports but writes nothing to the runs', async () => {
  const store = makeStore({ runs: [baseRun('r1'), baseRun('r2')], activities: { 'a-r1': { time_series: ts } } })
  const out = await runBatches(store, { dryRun: true, evaluate })
  assert.deepEqual(out.counts, { done: 1, skipped: 1, failed: 0 })
  assert.equal(store.backups.size, 0)
  assert.equal(store.db.get('r1').summary.rep_analysis, undefined)
  assert.equal(store.items.get('r1:true').reason, 'would re-run')
  assert.equal(store.items.has('r1:false'), false)
  assert.equal(out.finished, true)
})

test('a run edited by its owner meanwhile is not overwritten', async () => {
  const store = makeStore({ runs: [baseRun('r1')], activities: { 'a-r1': { time_series: ts } } })
  const row = (await store.batch(null, 5, false))[0]
  store.db.get('r1').updated_at = '2026-02-02T00:00:00Z'
  const outcome = await processRun(row, store, { evaluate })
  assert.equal(outcome.status, 'skipped')
  assert.equal(store.backups.size, 0)
})

test('runs that already have current per-effort data are skipped', async () => {
  const store = makeStore({ runs: [baseRun('r1', { summary: { rep_analysis: { v: 1 } } })], activities: { 'a-r1': { time_series: ts } } })
  const out = await runBatches(store, { evaluate })
  assert.equal(out.counts.skipped, 1)
})

test('failures are recorded, retried up to three attempts, and do not stop the batch', async () => {
  const store = makeStore({ runs: [baseRun('r1'), baseRun('r2')], activities: { 'a-r1': { time_series: ts }, 'a-r2': { time_series: ts } }, failActivity: new Set(['a-r1']) })
  const out = await runBatches(store, { evaluate })
  assert.equal(store.db.get('r2').summary.rep_analysis.v, 1)
  assert.equal(store.items.get('r1:false').status, 'failed')
  assert.equal(store.items.get('r1:false').attempts, 3)
  assert.equal(out.counts.done, 1)
  assert.equal(out.finished, true)
})

test('warns when current detection finds fewer or no efforts, still applying with a backup', async () => {
  const store = makeStore({ runs: [baseRun('r1', { efforts: [{}, {}, {}] }), baseRun('r2')], activities: { 'a-r1': { time_series: ts }, 'a-r2': { time_series: ts } } })
  const fewer = await processRun({ ...store.db.get('r1') }, store, { evaluate })
  assert.match(fewer.warning, /fewer efforts/)
  const none = await processRun({ ...store.db.get('r2') }, store, { evaluate: () => ({ efforts: [], summary: {} }) })
  assert.match(none.warning, /no efforts/)
  assert.equal(store.backups.size, 2)
})

test('resumes from the cursor and stops at the time budget', async () => {
  const runs = ['r1', 'r2', 'r3', 'r4'].map((id) => baseRun(id))
  const activities = Object.fromEntries(runs.map((r) => [r.activity_id, { time_series: ts }]))
  const store = makeStore({ runs, activities })
  let t = 0
  const first = await runBatches(store, { evaluate, batchSize: 2, budgetMs: 4, now: () => (t += 1) })
  assert.equal(first.finished, false)
  assert.ok(first.processed >= 1 && first.processed < 4)
  const second = await runBatches(store, { evaluate, cursor: first.cursor })
  assert.equal(first.processed + second.processed, 4)
  assert.equal(second.finished, true)
  assert.equal(store.backups.size, 4)
})
