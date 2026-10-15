// Run with: node --test src/lib/__tests__/summaryMetrics.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTemplate } from '../templateEngine.js'
import { buildIntervalManifest, parseIntervalDsl } from '../intervalDsl.js'
import { applySummaryMetrics, normalizedPower, powerHrDecoupling, summaryMetricKey } from '../summaryMetrics.js'

const rep = (v, n) => new Array(n).fill(v)

// 20s warm, 2 x 120s work (250W then 200W), 60s recovery between, 90s tail.
function stream() {
  const watts = [...rep(100, 20), ...rep(250, 120), ...rep(60, 60), ...rep(200, 120), ...rep(60, 90)]
  const hr = [...rep(120, 20), ...rep(150, 60), ...rep(160, 60), ...rep(140, 30), ...rep(130, 30), ...rep(150, 60), ...rep(165, 60), ...rep(135, 30), ...rep(120, 60)]
  const cadence = watts.map((w) => (w > 150 ? 95 : 70))
  const speed = watts.map((w) => w / 10)
  return { watts, heartrate: hr, cadence, speed }
}

function templateFor(extra) {
  const parsed = parseIntervalDsl(`2x\nwarmup 20sec\nwork 120sec ±0% @ 190-260W\nrecovery 60sec ±0% @ <70W\n${extra}`)
  assert.deepEqual(parsed.errors, [])
  return { slug: 't', manifest: buildIntervalManifest(parsed) }
}

test('no metrics line: only default run metrics, no optional extras', () => {
  const plain = evaluateTemplate(templateFor(''), stream(), 250)
  const work = plain.efforts.filter((e) => e.role === 'work')
  assert.equal(work.length, 2)
  assert.equal(work[0].vi, undefined)
  assert.equal(work[0].np_w, 250)
  assert.equal(plain.summary.vi, undefined)
})

test('np/vi/if/avg_hr/max_hr/work_kj per work effort and in summary', () => {
  const r = evaluateTemplate(templateFor('metrics np, vi, if, avg_hr, max_hr, work_kj, avg_cadence, max_cadence, avg_speed, max_speed, max_power'), stream(), 250)
  const [a, b] = r.efforts.filter((e) => e.role === 'work')
  assert.equal(a.np_w, 250)
  assert.equal(a.vi, 1)
  assert.equal(a.intensity_factor, 1)
  assert.equal(b.intensity_factor, 0.8)
  assert.equal(a.avg_hr_bpm, 155)
  assert.equal(a.max_hr_bpm, 160)
  assert.equal(a.work_kj, 30)
  assert.equal(a.avg_cadence_rpm, 95)
  assert.equal(a.avg_speed_kmh, 25)
  assert.equal(a.max_speed_kmh, 25)
  assert.equal(r.summary.np_w, 225)
  assert.equal(r.summary.work_kj, 54)
  assert.equal(r.summary.max_hr_bpm, 165)
  assert.equal(r.summary.max_cadence_rpm, 95)
  assert.equal(r.summary.max_speed_kmh, 25)
  // Recovery efforts do not get the metrics.
  assert.equal(r.efforts.find((e) => e.role === 'recovery').np_w, undefined)
})

test('dropoff: per-effort % below best, summary last vs best', () => {
  const r = evaluateTemplate(templateFor('metrics dropoff'), stream(), 250)
  const work = r.efforts.filter((e) => e.role === 'work')
  assert.equal(work[0].dropoff_pct, 0)
  assert.equal(work[1].dropoff_pct, 20)
  assert.equal(r.summary.dropoff_pct, 20)
})

test('pacing keeps existing per-effort value and adds a summary mean', () => {
  const r = evaluateTemplate(templateFor('metrics pacing'), stream(), 250)
  assert.equal(r.summary.pacing_index, 100)
})

test('hr_recovery: default 60s and custom window; null when the stream ends first', () => {
  const r = evaluateTemplate(templateFor('metrics hr_recovery, hr_recovery(30sec)'), stream(), 250)
  const [a, b] = r.efforts.filter((e) => e.role === 'work')
  // rep 1 ends at 140 (last sample 139: 160 bpm); 60s later 130, 30s later 140
  assert.equal(a.hr_recovery_60s, 30)
  assert.equal(a.hr_recovery_30s, 20)
  assert.equal(b.hr_recovery_60s, 45) // 165 -> 120
  assert.equal(r.summary.hr_recovery_60s, 38) // mean(30, 45) rounded
  assert.equal(applySummaryMetrics([{ id: 'hr_recovery', window_sec: 5000 }], { efforts: [{ start_sec: 0, end_sec: 10 }], summary: {} }, { heartrate: rep(150, 100) }).efforts[0].hr_recovery_5000s, null)
})

test('decoupling: constant W with rising HR gives positive decoupling', () => {
  const watts = rep(200, 600)
  const hr = [...rep(140, 300), ...rep(154, 300)]
  const r = evaluateTemplate(
    { slug: 't', manifest: buildIntervalManifest(parseIntervalDsl('1x\nwork 10min ±0% @ 190-210W\nmetrics decoupling')) },
    { watts, heartrate: hr },
    null
  )
  assert.equal(r.efforts[0].pw_hr_decoupling_pct, 9.1)
  assert.equal(r.summary.pw_hr_decoupling_pct, 9.1)
})

test('metrics needing a missing stream are null, not errors', () => {
  const r = evaluateTemplate(templateFor('metrics avg_hr, decoupling, hr_recovery, if'), { watts: stream().watts }, null)
  const w = r.efforts.find((e) => e.role === 'work')
  assert.equal(w.avg_hr_bpm, null)
  assert.equal(w.pw_hr_decoupling_pct, null)
  assert.equal(w.hr_recovery_60s, null)
  assert.equal(w.intensity_factor, null)
})

test('helpers: NP of a constant is that constant, short slices are null, key naming', () => {
  assert.equal(Math.round(normalizedPower(rep(300, 60))), 300)
  assert.equal(normalizedPower(rep(300, 20)), null)
  assert.equal(powerHrDecoupling(rep(200, 2), rep(100, 2)), null)
  assert.equal(summaryMetricKey({ id: 'hr_recovery', window_sec: 45 }), 'hr_recovery_45s')
  assert.equal(summaryMetricKey({ id: 'nope' }), null)
})

test('legacy patterns accept summary_metrics without changing their own fields', () => {
  const watts = [...rep(100, 30), ...rep(400, 200), ...rep(100, 30)]
  const base = { pattern: 'sustained_tt' }
  const plain = evaluateTemplate({ slug: 'x', manifest: base }, { watts }, null)
  const withM = evaluateTemplate({ slug: 'x', manifest: { ...base, summary_metrics: [{ id: 'np' }] } }, { watts }, null)
  assert.equal(withM.summary.avg_power, plain.summary.avg_power)
  assert.equal(withM.efforts[0].np_w, 400)
  assert.equal(withM.summary.np_w, 400)
})
