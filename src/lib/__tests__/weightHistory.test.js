// Run with: node --test src/lib/__tests__/weightHistory.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateWeightEntry, resolveWeightAt, weightAt, weightFromActivity } from '../weightHistory.js'
import { wattsPerKg, formatWkg, curveToWkg } from '../wkg.js'
import { buildActivityInsert } from '../activityRecord.js'
import { evaluateTemplate } from '../templateEngine.js'
import { applySummaryMetrics, attachWkg, withDefaultMetrics } from '../summaryMetrics.js'

const history = [
  { effective_from: '2026-01-01', weight_kg: 72 },
  { effective_from: '2026-06-01', weight_kg: 70.5 },
]

test('resolveWeightAt / weightAt pick the entry valid on the date', () => {
  assert.equal(resolveWeightAt(history, '2025-12-31'), null)
  assert.equal(weightAt(history, '2026-03-01T10:00:00Z'), 72)
  assert.equal(weightAt(history, '2026-06-01'), 70.5)
  assert.equal(weightAt([], '2026-06-01'), null)
  assert.equal(weightAt(history, 'bad'), null)
})

test('weightFromActivity', () => {
  assert.equal(weightFromActivity({ weight_at_activity_kg: '71.5' }), 71.5)
  assert.equal(weightFromActivity({ weight_at_activity_kg: null }), null)
  assert.equal(weightFromActivity({ weight_at_activity_kg: 0 }), null)
  assert.equal(weightFromActivity(null), null)
})

test('validateWeightEntry', () => {
  assert.deepEqual(validateWeightEntry({ effective_from: '2026-01-01', weight_kg: '72,34' }).entry, { effective_from: '2026-01-01', weight_kg: 72.3 })
  assert.ok(validateWeightEntry({ effective_from: '2026-01-01', weight_kg: '5' }).error)
  assert.ok(validateWeightEntry({ effective_from: '2026-01-01', weight_kg: '' }).error)
  assert.ok(validateWeightEntry({ effective_from: '2026-01-01', weight_kg: '400' }).error)
  assert.ok(validateWeightEntry({ effective_from: 'nope', weight_kg: 70 }).error)
})

test('wkg helpers', () => {
  assert.equal(wattsPerKg(300, 75), 4)
  assert.equal(wattsPerKg(250, 70), 3.57)
  assert.equal(wattsPerKg(250, null), null)
  assert.equal(wattsPerKg(null, 70), null)
  assert.equal(wattsPerKg(250, 0), null)
  assert.equal(formatWkg(250, 70), '3.57 W/kg')
  assert.equal(formatWkg(250, null), '—')
  assert.deepEqual(curveToWkg({ '5s': 700, '1m': 350 }, 70), { '5s': 10, '1m': 5 })
  assert.deepEqual(curveToWkg({ '5s': 700 }, null), {})
})

test('buildActivityInsert snapshots weight at the activity date', () => {
  const s = { start_time: '2026-03-10T10:00:00Z' }
  assert.equal(buildActivityInsert(s, { title: 't', userId: 'u', weightHistory: history }).weight_at_activity_kg, 72)
  assert.equal(buildActivityInsert({ start_time: '2026-08-01T00:00:00Z' }, { title: 't', userId: 'u', weightHistory: history }).weight_at_activity_kg, 70.5)
  assert.equal(buildActivityInsert({ start_time: '2025-01-01T00:00:00Z' }, { title: 't', userId: 'u', weightHistory: history }).weight_at_activity_kg, null)
  assert.equal(buildActivityInsert(s, { title: 't', userId: 'u' }).weight_at_activity_kg ?? null, null)
})

const ts = { watts: Array(10).fill(280) }

test('summary W/kg metrics require a weight', () => {
  const effort = { start_sec: 0, end_sec: 10, avg_power: 280 }
  const r = { efforts: [effort], summary: {} }
  const withKg = applySummaryMetrics([{ id: 'avg_wkg' }, { id: 'max_wkg' }], r, ts, null, null, 70)
  assert.equal(withKg.efforts[0].avg_wkg, 4)
  assert.equal(withKg.efforts[0].max_wkg, 4)
  const without = applySummaryMetrics([{ id: 'avg_wkg' }], r, ts, null, null, null)
  assert.equal(without.efforts[0].avg_wkg ?? null, null)
})

test('attachWkg adds W/kg context only with a weight and never overwrites', () => {
  const r = { efforts: [{ role: 'work', avg_power: 280 }, { role: 'work', avg_power: 140, avg_wkg: 9 }], summary: {} }
  assert.equal(attachWkg(r, null), r)
  const out = attachWkg(r, 70)
  assert.equal(out.efforts[0].avg_wkg, 4)
  assert.equal(out.efforts[1].avg_wkg, 9)
  assert.equal(out.summary.ftp_wkg, undefined)
  assert.equal(out.summary.lt1_wkg, undefined)
  assert.equal(out.summary.lt2_wkg, undefined)
  assert.equal(r.efforts[0].avg_wkg, undefined)
})

test('evaluateTemplate without weight is unchanged (backward compatible)', () => {
  const tpl = { manifest: { pattern: 'custom_intervals', dsl: 'work 10s' } }
  const a = evaluateTemplate(tpl, ts, 250)
  const b = evaluateTemplate(tpl, ts, 250, null, null, null)
  assert.deepEqual(a, b)
  for (const e of a.efforts || []) assert.equal(e.avg_wkg, undefined)
})

test('weight migration is idempotent and snapshot-based', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261106000000_weight_history.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists/i)
  assert.match(sql, /weight_at_activity_kg/)
  assert.match(sql, /create or replace function/i)
  assert.match(sql, /drop trigger if exists/i)
})

test('default per-run metrics are added without a metrics line; no static athlete W/kg keys', () => {
  const watts = Array(60).fill(280)
  const r = { efforts: [{ role: 'work', start_sec: 0, end_sec: 60, avg_power: 280 }], summary: {} }
  const out = applySummaryMetrics(withDefaultMetrics([]), r, { watts, heartrate: Array(60).fill(150), cadence: Array(60).fill(90) }, 250, null, 70)
  const e = out.efforts[0]
  assert.equal(e.avg_wkg, 4)
  assert.equal(e.avg_hr_bpm, 150)
  assert.equal(e.avg_cadence_rpm, 90)
  assert.equal(e.np_w, 280)
  assert.equal(e.avg_speed_kmh, undefined)
  assert.equal(out.summary.avg_hr_bpm, 150)
  assert.equal(e.max_power, undefined)
  for (const k of ['ftp_wkg', 'lt1_wkg', 'lt2_wkg']) assert.equal(out.summary[k], undefined)
})
