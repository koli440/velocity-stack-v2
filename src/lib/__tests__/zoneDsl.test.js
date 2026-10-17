// Run with: node --test src/lib/__tests__/zoneDsl.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIntervalDsl, stringifyIntervalDsl, buildIntervalManifest, manifestToDslInput } from '../intervalDsl.js'
import { evaluateTemplate } from '../templateEngine.js'
import { computeZones, zonesFromActivity } from '../powerZones.js'
import { applySummaryMetrics, SUMMARY_METRIC_IDS, summaryMetricKey } from '../summaryMetrics.js'

const rep = (v, n) => new Array(n).fill(v)
// LT1 200 W, LT2 300 W -> bounds 150 / 200 / 300 / 315 / 360
const ZONES = computeZones({ lt: { lt1Power: 200, lt2Power: 300 } })

function tpl(dsl) {
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [], dsl)
  return { slug: 't', manifest: buildIntervalManifest(p) }
}

test('parses single zone, range, below and above bands and round-trips', () => {
  const cases = [
    ['Z3', 3, 3],
    ['Z2-Z3', 2, 3],
    ['<Z2', null, 2],
    ['>Z4', 4, null],
    ['Z1', 1, 1],
    ['Z6', 6, 6],
  ]
  for (const [band, min, max] of cases) {
    const text = `1x\nwork 15min ±3% @ ${band}`
    const p = parseIntervalDsl(text)
    assert.deepEqual(p.errors, [], band)
    assert.equal(p.steps[0].bandType, 'zone')
    assert.equal(p.steps[0].powerMin, min)
    assert.equal(p.steps[0].powerMax, max)
    assert.equal(stringifyIntervalDsl(p), text)
    // manifest round trip
    const again = stringifyIntervalDsl(manifestToDslInput(buildIntervalManifest(p)))
    assert.equal(again, text)
  }
})

test('is case-insensitive, tolerates spaces and normalises on stringify', () => {
  const p = parseIntervalDsl('1x\nwork 5min ±3% @ z2 - z3\nrecovery 2min ±20% @ < z2')
  assert.deepEqual(p.errors, [])
  assert.equal(stringifyIntervalDsl(p), '1x\nwork 5min ±3% @ Z2-Z3\nrecovery 2min ±20% @ <Z2')
})

test('works in sets, set recovery and "then" steps', () => {
  const dsl = '2 sets of 3x\nwork 4min ±5% @ Z3\nthen work 1min ±5% @ Z4\nrecovery 2min ±30% @ <Z2\nset recovery 5min ±30% @ Z1-Z2'
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [])
  assert.equal(stringifyIntervalDsl(p), dsl)
})

test('validation errors: unknown zones, bad ranges, impossible comparisons', () => {
  const err = (band) => parseIntervalDsl(`1x\nwork 5min ±3% @ ${band}`).errors.map((e) => e.message).join(' | ')
  assert.match(err('Z7'), /Unknown zone "Z7".*Z1 to Z6/)
  assert.match(err('Z0'), /Unknown zone "Z0"/)
  assert.match(err('Z2-Z9'), /Unknown zone "Z9"/)
  assert.match(err('Z4-Z2'), /lower to the higher/)
  assert.match(err('<Z1'), /nothing/)
  assert.match(err('>Z6'), /nothing/)
  assert.match(err('Zone3'), /Unrecognised band/)
  assert.match(err('Z'), /Unrecognised band/)
})

test('existing bands are unaffected', () => {
  for (const [b, t] of [['90-110%FTP', 'pct_ftp'], ['250-300W', 'watts'], ['95-105%LT2', 'pct_lt2'], ['3W/kg', 'wkg']]) {
    const p = parseIntervalDsl(`1x\nwork 5min ±10% @ ${b}`)
    assert.deepEqual(p.errors, [])
    assert.equal(p.steps[0].bandType, t)
  }
})

// 10min @100 | 10min @250 (Z3) | 10min @100 | 10min @330 (Z5) | 10min @100. Detection returns the
// earliest window whose average is in the band, so a start is "at or just before" its block.
const streams = () => ({ watts: [...rep(100, 600), ...rep(250, 600), ...rep(100, 600), ...rep(330, 600), ...rep(100, 600)] })
const run = (band, zones = ZONES, ftp = null) =>
  evaluateTemplate(tpl(`1x\nwork 5min ±0% @ ${band}`), streams(), ftp, null, null, null, zones)
const near = (e, blockStart) => e.start_sec >= blockStart - 100 && e.start_sec <= blockStart + 300

test('@ Z3 finds the Z3 block using zone watts, independent of FTP', () => {
  for (const ftp of [null, 100, 999]) {
    const r = run('Z3', ZONES, ftp)
    assert.equal(r.efforts.length, 1)
    assert.ok(near(r.efforts[0], 600))
    assert.equal(r.efforts[0].avg_zone, 3)
    assert.equal(r.efforts[0].target_zone, 'Z3')
    assert.equal(r.efforts[0].band_type, 'zone')
  }
})

test('zone ranges, > and < comparisons', () => {
  assert.ok(run('Z2-Z3').efforts[0].start_sec >= 300 && run('Z2-Z3').efforts[0].start_sec <= 900)
  assert.ok(near(run('Z5').efforts[0], 1800))
  assert.equal(run('Z5').efforts[0].avg_zone, 5)
  assert.ok(near(run('>Z3').efforts[0], 1800)) // above Z3 -> Z4+, the 330 W block
  assert.equal(run('>Z5').efforts.length, 0)
  assert.equal(run('<Z3').efforts[0].start_sec, 0) // below Z3 -> the 100 W start
  assert.equal(run('Z6').efforts.length, 0)
  assert.equal(run('Z1').efforts[0].start_sec, 0)
})

test('"work 15min ±3% @ Z3" style tolerance matches a steady Z3 effort', () => {
  const watts = [...rep(120, 600), ...rep(240, 15 * 60), ...rep(120, 600)]
  const r = evaluateTemplate(tpl('1x\nwork 15min ±3% @ Z3'), { watts }, null, null, null, null, ZONES)
  assert.equal(r.efforts.length, 1)
  assert.ok(Math.abs(r.efforts[0].duration_sec - 900) <= 27)
})

test('no zones: clear message, no efforts; no power stream: message', () => {
  const r = run('Z3', null)
  assert.equal(r.efforts.length, 0)
  assert.match(r.summary.reason, /No power zones could be derived/)
  assert.match(r.summary.reason, /LT1 and LT2 power \(or an FTP\)/)
  const hr = evaluateTemplate(tpl('1x\nwork 5min ±0% @ Z3'), { heartrate: rep(150, 900), watts: [] }, null, null, null, null, ZONES)
  assert.equal(hr.efforts.length, 0)
})

test('zones follow the activity snapshot: custom boundaries and FTP fallback', () => {
  // Z3 raised to 240-300 W: 250 W block still Z3. Z3 lowered upper bound (LT2 x 0.8 = 240): not Z3 anymore.
  const base = { lt1_power_at_activity_w: 200, lt2_power_at_activity_w: 300 }
  const wide = zonesFromActivity({ ...base, power_zone_pcts_at_activity: [75, 100, 150, 160, 170] }) // Z3 200-450
  assert.ok(near(run('Z3', wide).efforts[0], 600))
  const narrow = zonesFromActivity({ ...base, power_zone_pcts_at_activity: [75, 100, 80, 105, 120] }) // Z3 200-240
  assert.ok(run('Z3', narrow).efforts.every((e) => e.start_sec < 600 || e.start_sec > 1200)) // 250 W steady is Z4 now
  assert.equal(run('Z4', narrow).efforts[0].avg_zone, 4)
  // FTP-only activity: LT1 210, LT2 280 -> Z3 210-280, estimated
  const est = zonesFromActivity({ ftp_at_activity_w: 280 })
  assert.equal(est.estimated, true)
  assert.ok(near(run('Z3', est).efforts[0], 600))
})

test('set recovery in zones keeps avg_zone on the recovery effort', () => {
  const watts = [...rep(250, 300), ...rep(100, 300), ...rep(250, 300), ...rep(100, 300), ...rep(250, 300)]
  const t = tpl('2 sets of 1x\nwork 5min ±0% @ Z3\nset recovery 5min ±0% @ Z1')
  const r = evaluateTemplate(t, { watts }, null, null, null, null, ZONES)
  const rec = r.efforts.find((e) => e.role === 'set_recovery')
  assert.ok(rec)
  assert.equal(rec.avg_zone, 1)
  assert.equal(rec.target_zone, 'Z1')
})

test('time_z1..time_z6 metrics: per effort and summed in the summary', () => {
  assert.equal(SUMMARY_METRIC_IDS.filter((id) => /^time_z[1-6]$/.test(id)).length, 6)
  assert.equal(summaryMetricKey({ id: 'time_z3' }), 'time_z3_s')
  const t = tpl('1x\nwork 10min ±0% @ Z3\nmetrics time_z1, time_z2, time_z3, time_z4, time_z5, time_z6')
  const r = evaluateTemplate(t, streams(), null, null, null, null, ZONES)
  const e = r.efforts[0]
  const total = ['time_z1_s', 'time_z2_s', 'time_z3_s', 'time_z4_s', 'time_z5_s', 'time_z6_s'].reduce((a, k) => a + e[k], 0)
  assert.equal(total, e.duration_sec)
  assert.ok(e.time_z3_s > 0 && e.time_z6_s === 0)
  assert.equal(r.summary.time_z3_s, e.time_z3_s)
})

test('time-in-zone metrics are null without zones and never throw', () => {
  const out = applySummaryMetrics([{ id: 'time_z3' }], { efforts: [{ start_sec: 0, end_sec: 10, role: 'work' }], summary: {} }, { watts: rep(250, 20) }, null, null, null, null)
  assert.equal(out.efforts[0].time_z3_s, null)
  const withZones = applySummaryMetrics([{ id: 'time_z3' }], { efforts: [{ start_sec: 0, end_sec: 10, role: 'work' }], summary: {} }, { watts: rep(250, 20) }, null, null, null, ZONES)
  assert.equal(withZones.efforts[0].time_z3_s, 10)
})

test('metrics line with zone metrics round-trips', () => {
  const dsl = '1x\nwork 10min ±5% @ Z3\nmetrics avg_power, time_z2, time_z3'
  const p = parseIntervalDsl(dsl)
  assert.deepEqual(p.errors, [])
  assert.equal(stringifyIntervalDsl(p), dsl)
})

test('legacy manifests without zones evaluate identically with or without zones', () => {
  const t = tpl('1x\nwork 5min ±0% @ 230-270W')
  assert.deepEqual(evaluateTemplate(t, streams(), null), evaluateTemplate(t, streams(), null, null, null, null, ZONES))
})
