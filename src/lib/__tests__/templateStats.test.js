import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateTemplateStats, runMetrics, orderMetricKeys, parseRunsParams, escapeLike, mapRunRow, buildStatRows } from '../templateStats.js'

const row = (id, tpl, date, summary, title = 'Ride') => ({
  id, template_id: tpl, activity_id: `act-${id}`, summary, created_at: '2020-01-01T00:00:00Z',
  activities: { title, activity_date: date },
})

test('aggregates count, avg, best, last run and sorted runs', () => {
  const s = aggregateTemplateStats([
    row('1', 't', '2026-01-01T10:00:00Z', { avg_power: 300, avg_hr_bpm: 150, dropoff_pct: 5 }),
    row('2', 't', '2026-02-01T10:00:00Z', { avg_power: 340, avg_hr_bpm: 160, dropoff_pct: 9 }),
    row('3', 'u', '2026-01-05T10:00:00Z', { avg_power: 100 }),
  ])
  assert.equal(s.t.count, 2)
  assert.equal(s.t.last_run_at, '2026-02-01T10:00:00Z')
  assert.deepEqual(s.t.metrics.avg_power, { avg: 320, n: 2, best: 340 })
  assert.equal(s.t.metrics.dropoff_pct.best, null)
  assert.equal(s.t.runs, undefined)
  assert.equal(s.u.count, 1)
})

test('legacy static keys and non-numeric values are excluded', () => {
  const m = runMetrics({ ftp_wkg: 4, lt1_wkg: 3, lt2_wkg: 3.5, avg_wkg: 3.2, avg_power: null, foo: 1, np_w: 'x', hr_recovery_60s: 20 })
  assert.deepEqual(m, { avg_wkg: 3.2, hr_recovery_60s: 20 })
  const s = aggregateTemplateStats([row('1', 't', '2026-01-01', { ftp_wkg: 4, avg_wkg: 3 })])
  assert.deepEqual(Object.keys(s.t.metrics), ['avg_wkg'])
})

test('handles missing activity, null summary and empty input', () => {
  assert.deepEqual(aggregateTemplateStats(null), {})
  const s = aggregateTemplateStats([{ id: '1', template_id: 't', activity_id: 'a', summary: null, created_at: '2026-03-01', activities: null }])
  const r = mapRunRow({ id: '1', activity_id: 'a', summary: null, created_at: '2026-03-01', activities: null })
  assert.equal(r.title, null)
  assert.equal(r.date, '2026-03-01')
  assert.deepEqual(s.t.metrics, {})
})

test('orders default keys first', () => {
  assert.deepEqual(orderMetricKeys(['work_kj', 'avg_hr_bpm', 'avg_wkg']), ['avg_wkg', 'avg_hr_bpm', 'work_kj'])
})

test('parseRunsParams clamps and validates', () => {
  assert.deepEqual(parseRunsParams(new URLSearchParams()), { limit: 25, offset: 0, sort: 'date', dir: 'desc', q: '' })
  const p = parseRunsParams(new URLSearchParams('limit=9999&offset=-4&sort=avg_power&dir=asc&q=%20hill%20'))
  assert.deepEqual(p, { limit: 100, offset: 0, sort: 'avg_power', dir: 'asc', q: 'hill' })
  assert.equal(parseRunsParams({ sort: 'summary);drop', limit: '0' }).sort, 'date')
  assert.equal(parseRunsParams({ limit: '0' }).limit, 1)
})

test('escapeLike escapes wildcards', () => {
  assert.equal(escapeLike('50%_a\\b'), '50\\%\\_a\\\\b')
})

test('mapRunRow shapes a row', () => {
  const r = mapRunRow(row('7', 't', '2026-05-01', { avg_power: 250, foo: 1 }, 'Hill'))
  assert.deepEqual(r, { id: '7', activity_id: 'act-7', title: 'Hill', date: '2026-05-01', metrics: { avg_power: 250 }, by_coach: false, run_by_coach_id: null })
})

test('buildStatRows merges identical distance rows and keeps single values', () => {
  const m = (avg, best, n = 3) => ({ avg, best, n })
  const keys = ['avg_hr_bpm', 'avg_distance_m', 'best_distance_m', 'total_distance_m']
  let rows = buildStatRows(keys, { avg_hr_bpm: m(150, 150, 1), avg_distance_m: m(5, 5), best_distance_m: m(5, 5), total_distance_m: m(5, 5) })
  assert.deepEqual(rows.map((r) => r.label), ['Avg HR (bpm)', 'Distance'])
  assert.equal(rows[0].best, null)
  rows = buildStatRows(keys, { avg_hr_bpm: m(150, 160), avg_distance_m: m(5, 8), best_distance_m: m(5, 8), total_distance_m: m(15, 24) })
  assert.deepEqual(rows.map((r) => r.label), ['Avg HR (bpm)', 'Distance avg / best', 'Total distance'])
  rows = buildStatRows(keys, { avg_hr_bpm: m(1, 1), avg_distance_m: m(5, 8), best_distance_m: m(9, 9), total_distance_m: m(15, 24) })
  assert.equal(rows.length, 4)
})
