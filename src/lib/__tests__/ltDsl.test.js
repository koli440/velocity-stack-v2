// Run with: node --test src/lib/__tests__/ltDsl.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseIntervalDsl, stringifyIntervalDsl, buildIntervalManifest } from '../intervalDsl.js'
import { evaluateTemplate } from '../templateEngine.js'
import { secondsInLtZone } from '../lactateThresholds.js'
import { LT_SYSTEM_TEMPLATES, buildLtManifest } from '../systemTemplates.js'

const rep = (v, n) => new Array(n).fill(v)
const LT = { lt1Power: 150, lt1Hr: 130, lt2Power: 250, lt2Hr: 165 }

test('parses all four LT band suffixes with range, min and max', () => {
  const cases = [
    ['95-105%LT2', 'pct_lt2', 95, 105],
    ['<100%LT1', 'pct_lt1', null, 100],
    ['>100%LT2HR', 'pct_lt2_hr', 100, null],
    ['85-95%LT1HR', 'pct_lt1_hr', 85, 95],
  ]
  for (const [band, type, min, max] of cases) {
    const p = parseIntervalDsl(`1x\nwork 5min ±10% @ ${band}`)
    assert.deepEqual(p.errors, [], band)
    assert.equal(p.steps[0].bandType, type)
    assert.equal(p.steps[0].powerMin, min)
    assert.equal(p.steps[0].powerMax, max)
    assert.equal(stringifyIntervalDsl(p), `1x\nwork 5min ±10% @ ${band}`)
  }
})

test('existing bands still parse unchanged', () => {
  for (const [b, t] of [['90-110%FTP', 'pct_ftp'], ['250-300W', 'watts'], ['150-165bpm', 'hr_bpm'], ['80-90%HRmax', 'pct_hrmax']]) {
    const p = parseIntervalDsl(`1x\nwork 5min ±10% @ ${b}`)
    assert.deepEqual(p.errors, [])
    assert.equal(p.steps[0].bandType, t)
  }
})

function tpl(dsl) {
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [])
  return { slug: 't', manifest: buildIntervalManifest(p) }
}
const streams = () => ({
  watts: [...rep(100, 30), ...rep(250, 300), ...rep(100, 60), ...rep(255, 300), ...rep(100, 120)],
  heartrate: [...rep(110, 30), ...rep(165, 300), ...rep(120, 60), ...rep(166, 300), ...rep(110, 120)],
})

test('%LT2 power band matches using the LT snapshot, ignoring ftp', () => {
  const t = tpl('2x\nwork 5min ±0% @ 99-103%LT2\nrecovery 1min ±0% @ <100%LT1')
  const r = evaluateTemplate(t, streams(), 999, null, LT)
  assert.equal(r.efforts.filter((e) => e.role !== 'recovery').length, 2)
  const r2 = evaluateTemplate(t, streams(), 100, null, LT)
  assert.equal(r2.efforts.length, r.efforts.length)
})

test('HR LT band matches', () => {
  const t = tpl('2x\nwork 5min ±10% @ 97-103%LT2HR')
  const r = evaluateTemplate(t, streams(), null, null, LT)
  assert.ok(r.efforts.length >= 2)
})

test('missing LT reports a message instead of efforts', () => {
  const t = tpl('2x\nwork 5min ±10% @ 95-105%LT2')
  const r = evaluateTemplate(t, streams(), null, null, null)
  assert.equal(r.efforts.length, 0)
  assert.match(r.summary.reason, /LT2 power/)
})

test('time-in-zone summary metrics', () => {
  const t = tpl('1x\nwork 5min ±0% @ 247-260W\nmetrics time_below_lt1, time_lt1_lt2, time_above_lt2, time_lt1_lt2_hr')
  const r = evaluateTemplate(t, streams(), null, null, LT)
  const e = r.efforts[0]
  assert.ok(e.time_above_lt2_s >= 290)
  assert.ok(e.time_below_lt1_s <= 10)
  assert.ok(e.time_lt1_lt2_s <= 10)
})

test('secondsInLtZone semantics and nulls', () => {
  const s = [100, 150, 200, 250, 300]
  assert.equal(secondsInLtZone(s, 'below_lt1', 150, 250), 1)
  assert.equal(secondsInLtZone(s, 'lt1_lt2', 150, 250), 2)
  assert.equal(secondsInLtZone(s, 'above_lt2', 150, 250), 2)
  assert.equal(secondsInLtZone(s, 'above_lt2', 150, null), null)
  assert.equal(secondsInLtZone([], 'below_lt1', 150, 250), null)
})

test('LT system templates parse, round-trip and match the migration', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261104000000_lactate_threshold_templates.sql', import.meta.url), 'utf8')
  assert.match(sql, /ON CONFLICT \(slug\) DO UPDATE/)
  for (const t of LT_SYSTEM_TEMPLATES) {
    const p = parseIntervalDsl(t.dsl)
    assert.deepEqual(p.errors, [], t.slug)
    assert.equal(stringifyIntervalDsl(p), t.dsl)
    assert.ok(sql.includes(`$q$${t.slug}$q$`))
    assert.ok(sql.includes(`$q$${JSON.stringify(buildLtManifest(t.dsl))}$q$::jsonb`))
    assert.ok(sql.includes(`$q$${t.dsl}$q$`))
  }
})
