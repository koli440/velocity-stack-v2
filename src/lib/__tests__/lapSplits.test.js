// Run with: node --test src/lib/__tests__/lapSplits.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLapSplits, lapSummary } from '../lapSplits.js'
import { buildIntervalManifest, manifestToDslInput, parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'
import { evaluateTemplate } from '../templateEngine.js'

const rep = (v, n) => new Array(n).fill(v)
const KMH = 36 // 10 m/s

test('constant speed gives equal splits; partial laps are dropped', () => {
  const r = computeLapSplits(rep(KMH, 60), 0, 60, 250) // 600 m
  assert.deepEqual(r.lap_splits_sec, [25, 25])
  assert.equal(r.distance_m, 600)
  assert.equal(r.lap_length_m, 250)
})

test('boundaries are interpolated inside a sample', () => {
  // 10 m/s but lap of 125 m -> 12.5 s laps, not whole seconds
  const r = computeLapSplits(rep(KMH, 50), 0, 50, 125)
  assert.deepEqual(r.lap_splits_sec, [12.5, 12.5, 12.5, 12.5])
})

test('a fading effort produces increasing splits', () => {
  const speed = [...rep(54, 20), ...rep(45, 20), ...rep(36, 40)] // 15, 12.5, 10 m/s
  const r = computeLapSplits(speed, 0, speed.length, 250)
  assert.equal(r.distance_m, 950)
  assert.equal(r.lap_splits_sec.length, 3)
  for (let i = 1; i < r.lap_splits_sec.length; i++) assert.ok(r.lap_splits_sec[i] >= r.lap_splits_sec[i - 1])
  assert.equal(r.lap_splits_sec[0], 16.67)
})

test('uses only the effort window', () => {
  const speed = [...rep(0, 30), ...rep(KMH, 50), ...rep(0, 30)]
  assert.deepEqual(computeLapSplits(speed, 30, 80, 250).lap_splits_sec, [25, 25])
})

test('invalid input returns null', () => {
  assert.equal(computeLapSplits(rep(KMH, 10), 0, 10, 0), null)
  assert.equal(computeLapSplits([], 0, 10, 250), null)
  assert.equal(computeLapSplits(rep(KMH, 10), 5, 5, 250), null)
  assert.equal(computeLapSplits([1, 2, null, 4], 0, 4, 1), null)
})

test('distance shorter than one lap gives no splits', () => {
  assert.deepEqual(computeLapSplits(rep(KMH, 10), 0, 10, 250).lap_splits_sec, [])
})

test('lapSummary', () => {
  assert.deepEqual(lapSummary([{ lap_splits_sec: [20, 22] }, null, { lap_splits_sec: [21] }]), {
    lap_count: 3, best_lap_sec: 20, slowest_lap_sec: 22, avg_lap_sec: 21,
  })
  assert.equal(lapSummary([null]).lap_count, 0)
})

// ---- DSL -----------------------------------------------------------------

test('lap line parses, builds, and round-trips for custom intervals', () => {
  const dsl = '1x\nwork 1km ±10% @ best speed\nlap 250m\nmetrics np'
  const parsed = parseIntervalDsl(dsl)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.lapLengthM, 250)
  const manifest = buildIntervalManifest(parsed)
  assert.equal(manifest.lap_length_m, 250)
  assert.equal(stringifyIntervalDsl(parsed), dsl)
  assert.equal(stringifyIntervalDsl(manifestToDslInput(manifest)), dsl)
  assert.equal(parseIntervalDsl('1x\nwork 1km ±10% @ best speed\nlap 0.25km').lapLengthM, 250)
})

test('templates without lap produce byte-identical manifests', () => {
  const m = buildIntervalManifest(parseIntervalDsl('3x\nwork 3min ±30% @ 90-110%FTP'))
  assert.equal('lap_length_m' in m, false)
  assert.equal(parseIntervalDsl('3x\nwork 3min ±30% @ 90-110%FTP').lapLengthM, null)
})

test('lap errors', () => {
  const err = (d) => parseIntervalDsl(d).errors.map((e) => e.message).join('|')
  assert.match(err('1x\nwork 1km ±10% @ best speed\nlap 250m\nlap 125m'), /Only one "lap"/)
  assert.match(err('1x\nwork 1km ±10% @ best speed\nlap 0m'), /greater than 0/)
  assert.match(err('1x\nwork 1km ±10% @ best speed\nlap fast'), /./)
  assert.match(err('1x\nwork 1km ±10% @ best speed\ncount 3'), /needs a first line/)
})

// ---- evaluation on synthetic streams ------------------------------------

function kmStream() {
  // 60 s rest, 1 km at 15 m/s fading to ~11 m/s, rest
  const speed = [...rep(10, 60)]
  const watts = [...rep(100, 60)]
  for (let i = 0; i < 80; i++) { speed.push(54 - i * 0.3); watts.push(500) }
  speed.push(...rep(10, 60)); watts.push(...rep(100, 60))
  return { speed, watts }
}

test('custom intervals report lap splits per work effort and in the summary', () => {
  const ts = kmStream()
  const manifest = buildIntervalManifest(parseIntervalDsl('1x\nwarmup 1min\nwork 1km ±15% @ best speed\nlap 250m'))
  const res = evaluateTemplate({ manifest }, ts, 300)
  const work = res.efforts.find((e) => e.role === 'work')
  assert.ok(work, 'detects the km')
  assert.equal(work.lap_length_m, 250)
  assert.ok(work.lap_splits_sec.length >= 3)
  assert.ok(work.lap_splits_sec[work.lap_splits_sec.length - 1] > work.lap_splits_sec[0], 'fades')
  assert.equal(res.summary.lap_length_m, 250)
  assert.equal(res.summary.lap_count, work.lap_splits_sec.length)
  assert.equal(res.summary.best_lap_sec, Math.min(...work.lap_splits_sec))
})

test('without lap, evaluation output has no lap fields', () => {
  const manifest = buildIntervalManifest(parseIntervalDsl('1x\nwarmup 1min\nwork 1km ±15% @ best speed'))
  const res = evaluateTemplate({ manifest }, kmStream(), 300)
  assert.equal('lap_length_m' in res.summary, false)
  assert.equal(res.efforts.some((e) => 'lap_splits_sec' in e), false)
})

test('no speed stream: lap splits are null, evaluation does not throw', () => {
  const manifest = buildIntervalManifest(parseIntervalDsl('1x\nwork 3min ±10% @ best\nlap 250m'))
  const watts = [...rep(100, 60), ...rep(400, 180), ...rep(100, 60)]
  const res = evaluateTemplate({ manifest }, { watts }, 300)
  assert.equal(res.summary.lap_count, 0)
  for (const e of res.efforts.filter((x) => x.role === 'work')) assert.equal(e.lap_splits_sec, null)
})

test('sustained_tt keeps legacy lap_splits_250m and adds measured splits', () => {
  const watts = [...rep(80, 60), ...rep(450, 240), ...rep(80, 60)]
  const speed = watts.map((w) => (w > 200 ? 54 : 15))
  const res = evaluateTemplate({ manifest: { pattern: 'sustained_tt', lap_length_m: 250 } }, { watts, speed }, 300)
  const e = res.efforts[0]
  assert.ok(Array.isArray(e.lap_splits_250m))
  assert.ok(e.lap_splits_sec.every((s) => Math.abs(s - 16.67) < 0.1))
})
