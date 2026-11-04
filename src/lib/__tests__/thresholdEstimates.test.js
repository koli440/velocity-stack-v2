// Run with: node --test src/lib/__tests__/thresholdEstimates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FTP_PROTOCOLS,
  bestWindow,
  decouplingPct,
  defaultProtocol,
  estimateDelta,
  protocolsFor,
  thresholdEstimate,
} from '../thresholdEstimates.js'
import { evaluateTemplate } from '../templateEngine.js'
import { THRESHOLD_TEST_TEMPLATES, buildLtManifest } from '../systemTemplates.js'
import { THRESHOLD_ESTIMATES_KEY } from '../summaryMetrics.js'
import { parseIntervalDsl, stringifyIntervalDsl, manifestToDslInput, buildIntervalManifest } from '../intervalDsl.js'

const rep = (n, v) => Array.from({ length: n }, () => v)
const hrFor = (watts, base = 120, slope = 0.08) => watts.map((w) => Math.round(base + w * slope))

/** warm-up, a test effort of `testW` for `testSec`, cool-down */
function testRide({ warm = 900, testSec, testW, warmW = 140, coolSec = 300, hr = true }) {
  const watts = [...rep(warm, warmW), ...(typeof testW === 'function' ? Array.from({ length: testSec }, (_, i) => testW(i)) : rep(testSec, testW)), ...rep(coolSec, 90)]
  return { watts, hr: hr ? hrFor(watts) : [], start: warm, end: warm + testSec }
}

const codes = (est) => est.warnings.map((w) => w.code)

test('FTP protocols: factors', () => {
  assert.equal(FTP_PROTOCOLS['20min'].factor, 0.95)
  assert.equal(FTP_PROTOCOLS['8min'].factor, 0.9)
  assert.equal(FTP_PROTOCOLS.ramp.factor, 0.75)
  assert.equal(FTP_PROTOCOLS['30min'].factor, 1)
})

test('20 min test: FTP = 95%, LT2 power = FTP, LT2 HR = window average', () => {
  const r = testRide({ testSec: 1200, testW: 300 })
  const s = { watts: r.watts, hr: r.hr }
  const ftp = thresholdEstimate('estimated_ftp', '20min', s, r.start, r.end)
  assert.equal(ftp.value, 285)
  assert.equal(ftp.confidence, 'high')
  assert.deepEqual(ftp.window, { start_sec: 900, end_sec: 2100, duration_sec: 1200 })
  assert.ok(ftp.assumptions.length >= 2)
  assert.equal(thresholdEstimate('estimated_lt2_power', '20min', s, r.start, r.end).value, 285)
  assert.equal(thresholdEstimate('estimated_lt2_hr', '20min', s, r.start, r.end).value, 144)
})

test('default protocol is the first allowed one', () => {
  assert.equal(defaultProtocol('estimated_ftp'), '20min')
  assert.equal(defaultProtocol('estimated_lt1_power'), 'steady')
  const r = testRide({ testSec: 1200, testW: 300 })
  assert.equal(thresholdEstimate('estimated_ftp', null, { watts: r.watts, hr: r.hr }, r.start, r.end).protocol, '20min')
  assert.deepEqual(protocolsFor('estimated_lt2_hr'), ['20min', '30min', '60min'])
})

test('8 min test: FTP = 90%, no LT2 HR from it', () => {
  const r = testRide({ testSec: 480, testW: 400 })
  const s = { watts: r.watts, hr: r.hr }
  assert.equal(thresholdEstimate('estimated_ftp', '8min', s, r.start, r.end).value, 360)
  const hr = thresholdEstimate('estimated_lt2_hr', '8min', s, r.start, r.end)
  assert.equal(hr.value, null)
  assert.ok(codes(hr).includes('hr_unsupported'))
})

test('ramp test: best 1 min x 0.75', () => {
  const ramp = (i) => 100 + i * 0.5
  const r = testRide({ testSec: 600, testW: ramp })
  const s = { watts: r.watts, hr: r.hr }
  const est = thresholdEstimate('estimated_ftp', 'ramp', s, r.start, r.end)
  const lastMinute = (ramp(540) + ramp(599)) / 2
  assert.equal(est.value, Math.round(lastMinute * 0.75))
  assert.equal(est.window.duration_sec, 60)
  assert.equal(est.window.end_sec, r.end)
  assert.ok(!codes(est).includes('ramp_peak_early'))
  assert.equal(thresholdEstimate('estimated_lt2_hr', 'ramp', s, r.start, r.end).value, null)
})

test('ramp whose peak is early warns', () => {
  const r = testRide({ testSec: 600, testW: (i) => (i < 100 ? 350 : 150) })
  const est = thresholdEstimate('estimated_ftp', 'ramp', { watts: r.watts, hr: r.hr }, r.start, r.end)
  assert.ok(codes(est).includes('ramp_peak_early'))
})

test('30 min test: FTP = average, LT2 HR = average of the last 20 min', () => {
  const r = testRide({ testSec: 1800, testW: (i) => (i < 600 ? 280 : 300) })
  const s = { watts: r.watts, hr: r.hr }
  const est = thresholdEstimate('estimated_ftp', '30min', s, r.start, r.end)
  assert.equal(est.value, Math.round((280 * 600 + 300 * 1200) / 1800))
  const hr = thresholdEstimate('estimated_lt2_hr', '30min', s, r.start, r.end)
  assert.equal(hr.value, Math.round(120 + 300 * 0.08))
  assert.match(hr.assumptions.join(' '), /last 20 min/)
})

test('best protocol-length stretch is found inside a longer window', () => {
  const watts = [...rep(600, 200), ...rep(1200, 320), ...rep(600, 200)]
  const est = thresholdEstimate('estimated_ftp', '20min', { watts, hr: hrFor(watts) }, 0, watts.length)
  assert.equal(est.value, 304)
  assert.deepEqual([est.window.start_sec, est.window.end_sec], [600, 1800])
})

test('60 min test: FTP = best 60 min average', () => {
  const r = testRide({ testSec: 3600, testW: 250 })
  assert.equal(thresholdEstimate('estimated_ftp', '60min', { watts: r.watts, hr: r.hr }, r.start, r.end).value, 250)
})

test('too short window yields no value and an error warning', () => {
  const r = testRide({ testSec: 600, testW: 300 })
  const est = thresholdEstimate('estimated_ftp', '20min', { watts: r.watts, hr: r.hr }, r.start, r.end)
  assert.equal(est.value, null)
  assert.equal(est.confidence, null)
  assert.ok(codes(est).includes('too_short'))
})

test('no power stream', () => {
  const est = thresholdEstimate('estimated_ftp', '20min', { watts: [], hr: [] }, 0, 1200)
  assert.equal(est.value, null)
  assert.ok(codes(est).includes('no_power'))
})

test('missing heart rate: LT2 HR is null with a warning, FTP still estimated', () => {
  const r = testRide({ testSec: 1200, testW: 300, hr: false })
  const s = { watts: r.watts, hr: [] }
  const hr = thresholdEstimate('estimated_lt2_hr', '20min', s, r.start, r.end)
  assert.equal(hr.value, null)
  assert.ok(codes(hr).includes('no_hr'))
  const ftp = thresholdEstimate('estimated_ftp', '20min', s, r.start, r.end)
  assert.equal(ftp.value, 285)
  assert.ok(codes(ftp).includes('no_hr'))
  assert.equal(ftp.confidence, 'medium')
})

test('partial heart rate warns', () => {
  const r = testRide({ testSec: 1200, testW: 300 })
  const hr = r.hr.map((v, i) => (i >= 1000 && i < 1400 ? 0 : v))
  const est = thresholdEstimate('estimated_lt2_hr', '20min', { watts: r.watts, hr }, r.start, r.end)
  assert.ok(codes(est).includes('partial_hr'))
  assert.equal(est.value, 144)
})

test('very uneven pacing lowers confidence', () => {
  const r = testRide({ testSec: 1200, testW: (i) => (i < 600 ? 380 : 230) })
  const est = thresholdEstimate('estimated_ftp', '20min', { watts: r.watts, hr: r.hr }, r.start, r.end)
  assert.ok(codes(est).includes('uneven_pacing'))
  assert.notEqual(est.confidence, 'high')
})

test('coasting / dropouts warn', () => {
  const r = testRide({ testSec: 1200, testW: (i) => (i % 10 < 2 ? 0 : 360) })
  const est = thresholdEstimate('estimated_ftp', '20min', { watts: r.watts, hr: r.hr }, r.start, r.end)
  assert.ok(codes(est).includes('coasting'))
})

test('window at the start / end of the activity', () => {
  const watts = rep(1200, 300)
  const est = thresholdEstimate('estimated_ftp', '20min', { watts, hr: hrFor(watts) }, 0, 1200)
  assert.ok(codes(est).includes('early_window'))
  const atEnd = est.warnings.find((w) => w.code === 'window_at_end')
  assert.equal(atEnd.severity, 'info')
})

test('very low power does not look maximal', () => {
  const r = testRide({ testSec: 1200, testW: 60 })
  const est = thresholdEstimate('estimated_ftp', '20min', { watts: r.watts, hr: r.hr }, r.start, r.end)
  assert.ok(codes(est).includes('low_power'))
})

test('HR drift warns for LT2 HR', () => {
  const watts = [...rep(900, 140), ...rep(1200, 300)]
  const hr = [...rep(900, 120), ...rep(600, 150), ...rep(600, 175)]
  const est = thresholdEstimate('estimated_lt2_hr', '20min', { watts, hr }, 900, 2100)
  assert.ok(codes(est).includes('hr_drift'))
})

// LT1 steady-state tests
function steadyRide({ sec = 3600, w = 180, driftAfter = Infinity, driftPerSec = 0 }) {
  const watts = rep(sec, w)
  const hr = watts.map((x, i) => Math.round(110 + x * 0.1 + Math.max(0, i - driftAfter) * driftPerSec))
  return { watts, hr }
}

test('LT1 steady: low decoupling -> LT1 power and HR of the effort', () => {
  const { watts, hr } = steadyRide({})
  const p = thresholdEstimate('estimated_lt1_power', 'steady', { watts, hr }, 0, 3600)
  const h = thresholdEstimate('estimated_lt1_hr', 'steady', { watts, hr }, 0, 3600)
  assert.equal(p.value, 180)
  assert.equal(h.value, 128)
  assert.equal(p.fallback, false)
  assert.equal(p.confidence, 'high')
  assert.equal(p.window.duration_sec, 3600)
})

test('LT1 steady: late drift uses the shorter stretch below 5% decoupling', () => {
  const { watts, hr } = steadyRide({ driftAfter: 2400, driftPerSec: 0.03 })
  assert.ok(decouplingPct(watts, hr, 0, 3600) > 5)
  const p = thresholdEstimate('estimated_lt1_power', 'steady', { watts, hr }, 0, 3600)
  assert.equal(p.value, 180)
  assert.ok(p.window.duration_sec < 3600 && p.window.duration_sec >= 1800)
  assert.ok(codes(p).includes('late_drift'))
  assert.ok(decouplingPct(watts, hr, 0, p.window.duration_sec) < 5)
})

test('LT1 steady: always above LT1 (decoupling everywhere) gives no value', () => {
  const { watts, hr } = steadyRide({ driftAfter: 0, driftPerSec: 0.02 })
  const p = thresholdEstimate('estimated_lt1_power', 'steady', { watts, hr }, 0, 3600)
  assert.equal(p.value, null)
  assert.ok(codes(p).includes('decoupling_high'))
})

test('LT1 steady: too short or no HR', () => {
  const { watts, hr } = steadyRide({ sec: 1500 })
  assert.ok(codes(thresholdEstimate('estimated_lt1_power', 'steady', { watts, hr }, 0, 1500)).includes('too_short'))
  const long = steadyRide({})
  const noHr = thresholdEstimate('estimated_lt1_power', 'steady', { watts: long.watts, hr: [] }, 0, 3600)
  assert.equal(noHr.value, null)
  assert.ok(codes(noHr).includes('no_hr'))
})

test('LT1 steady: uneven power warns', () => {
  const watts = Array.from({ length: 3600 }, (_, i) => (Math.floor(i / 300) % 2 ? 150 : 210))
  const p = thresholdEstimate('estimated_lt1_power', 'steady', { watts, hr: rep(3600, 130) }, 0, 3600)
  assert.ok(codes(p).includes('not_steady'))
})

test('LT1 fallback from an FTP protocol is labeled, low confidence', () => {
  const r = testRide({ testSec: 1200, testW: 300 })
  const s = { watts: r.watts, hr: r.hr }
  const p = thresholdEstimate('estimated_lt1_power', '20min', s, r.start, r.end)
  const h = thresholdEstimate('estimated_lt1_hr', '20min', s, r.start, r.end)
  assert.equal(p.value, Math.round(285 * 0.75))
  assert.equal(h.value, Math.round(144 * 0.85))
  assert.equal(p.fallback, true)
  assert.equal(p.confidence, 'low')
  assert.match(p.assumptions[0], /FALLBACK/)
})

test('unknown metric or protocol returns null', () => {
  assert.equal(thresholdEstimate('avg_power', null, { watts: [1] }, 0, 1), null)
  assert.equal(thresholdEstimate('estimated_ftp', 'bogus', { watts: [1] }, 0, 1), null)
})

test('bestWindow and estimateDelta', () => {
  assert.deepEqual(bestWindow([1, 1, 5, 5, 1], 0, 5, 2), { start: 2, end: 4, avg: 5 })
  assert.equal(bestWindow([1, 2], 0, 2, 5), null)
  assert.deepEqual(estimateDelta(285, 270), { current: 270, delta: 15, pct: 5.6 })
  assert.deepEqual(estimateDelta(285, null), { current: null, delta: null, pct: null })
})

// DSL / manifest
test('DSL: protocol argument parses, round-trips and is stored in the manifest', () => {
  const dsl = '1x\nwork 20min ±0% @ best\nmetrics estimated_ftp(ramp), estimated_lt2_hr, estimated_lt1_hr(steady)'
  const parsed = parseIntervalDsl(dsl)
  assert.deepEqual(parsed.errors, [])
  assert.equal(stringifyIntervalDsl(parsed), dsl)
  const manifest = buildIntervalManifest(parsed)
  assert.deepEqual(manifest.summary_metrics, [{ id: 'estimated_ftp', protocol: 'ramp' }, { id: 'estimated_lt2_hr' }, { id: 'estimated_lt1_hr', protocol: 'steady' }])
  assert.equal(stringifyIntervalDsl(manifestToDslInput(manifest)), dsl)
})

test('DSL: window syntax maps to a protocol; invalid protocols and duplicates are errors', () => {
  assert.deepEqual(parseIntervalDsl('1x\nwork 20min @ best\nmetrics estimated_ftp(30min)').metrics, [{ id: 'estimated_ftp', windowSec: null, protocol: '30min' }])
  const bad = parseIntervalDsl('1x\nwork 20min @ best\nmetrics estimated_lt2_hr(ramp), estimated_ftp(foo), estimated_ftp(20min), estimated_ftp(8min)')
  assert.equal(bad.errors.length, 3)
  assert.match(bad.errors[0].message, /does not support protocol "ramp"/)
  assert.match(bad.errors[2].message, /listed twice/)
  assert.match(parseIntervalDsl('1x\nwork 20min @ best\nmetrics avg_power(5min)').errors[0].message, /does not take a window/)
})

// End to end through the template engine with each system template
const tpl = (slug) => {
  const t = THRESHOLD_TEST_TEMPLATES.find((x) => x.slug === slug)
  return { slug, manifest: buildLtManifest(t.dsl) }
}

test('system threshold templates are well formed', () => {
  assert.equal(THRESHOLD_TEST_TEMPLATES.length, 5)
  for (const t of THRESHOLD_TEST_TEMPLATES) {
    const parsed = parseIntervalDsl(t.dsl)
    assert.deepEqual(parsed.errors, [], t.slug)
    assert.equal(stringifyIntervalDsl(parsed), t.dsl)
  }
})

test('FTP 20min template end to end', () => {
  const r = testRide({ testSec: 1200, testW: 300 })
  const out = evaluateTemplate(tpl('sys_test_ftp_20min'), { watts: r.watts, heartrate: r.hr })
  assert.equal(out.efforts.length, 1)
  assert.equal(out.summary.estimated_ftp_w, 285)
  assert.equal(out.summary.estimated_lt2_power_w, 285)
  assert.equal(out.summary.estimated_lt2_hr_bpm, 144)
  assert.equal(out.summary.estimated_lt1_power_w, 214)
  const details = out.summary[THRESHOLD_ESTIMATES_KEY]
  assert.equal(details.length, 5)
  assert.equal(details.find((d) => d.id === 'estimated_ftp').protocol, '20min')
  assert.equal(details.find((d) => d.id === 'estimated_lt1_power').fallback, true)
  assert.equal(out.efforts[0].estimated_ftp_w, 285)
})

test('FTP 8min template picks the better of two efforts', () => {
  const watts = [...rep(600, 140), ...rep(480, 380), ...rep(600, 90), ...rep(480, 400), ...rep(300, 90)]
  const out = evaluateTemplate(tpl('sys_test_ftp_8min'), { watts, heartrate: hrFor(watts) })
  assert.equal(out.efforts.length, 2)
  assert.equal(out.summary.estimated_ftp_w, 360)
  assert.equal(out.summary[THRESHOLD_ESTIMATES_KEY][0].value, 360)
})

test('ramp template end to end', () => {
  const ramp = (i) => 120 + i * 0.5
  const r = testRide({ testSec: 900, testW: ramp, warm: 600 })
  const out = evaluateTemplate(tpl('sys_test_ramp'), { watts: r.watts, heartrate: r.hr })
  const lastMinute = (ramp(840) + ramp(899)) / 2
  assert.equal(out.summary.estimated_ftp_w, Math.round(lastMinute * 0.75))
  assert.equal(out.summary.estimated_lt2_power_w, out.summary.estimated_ftp_w)
})

test('30 min template end to end', () => {
  const r = testRide({ testSec: 1800, testW: 290 })
  const out = evaluateTemplate(tpl('sys_test_lt2_30min'), { watts: r.watts, heartrate: r.hr })
  assert.equal(out.summary.estimated_ftp_w, 290)
  assert.equal(out.summary.estimated_lt2_hr_bpm, Math.round(120 + 290 * 0.08))
})

test('LT1 steady template end to end', () => {
  const { watts, hr } = steadyRide({ sec: 5400 })
  const out = evaluateTemplate(tpl('sys_test_lt1_steady'), { watts, heartrate: hr })
  assert.equal(out.summary.estimated_lt1_power_w, 180)
  assert.equal(out.summary.estimated_lt1_hr_bpm, 128)
  assert.equal(out.summary[THRESHOLD_ESTIMATES_KEY][0].fallback, false)
})

test('a too-short ride keeps the run valid and explains why', () => {
  const r = testRide({ testSec: 600, testW: 300, warm: 100, coolSec: 0 })
  const out = evaluateTemplate(tpl('sys_test_ftp_20min'), { watts: r.watts, heartrate: r.hr })
  assert.equal(out.summary.estimated_ftp_w ?? null, null)
})

test('templates without estimate metrics are unchanged (no threshold_estimates key)', () => {
  const r = testRide({ testSec: 1200, testW: 300 })
  const manifest = buildLtManifest('1x\nwork 20min ±0% @ best\nmetrics avg_power')
  const out = evaluateTemplate({ slug: 'x', manifest }, { watts: r.watts, heartrate: r.hr })
  assert.equal(out.summary[THRESHOLD_ESTIMATES_KEY], undefined)
  assert.equal(out.summary.estimated_ftp_w, undefined)
  assert.ok(out.summary.avg_power > 0)
})
