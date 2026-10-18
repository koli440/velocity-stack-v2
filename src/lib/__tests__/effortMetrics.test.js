// Run with: node --test src/lib/__tests__/effortMetrics.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEffortMetrics,
  describeDelta,
  fastestTimeToCover,
  formatRaceTime,
  formatResultValue,
  isLowerBetterKey,
  timeToCover,
} from '../effortMetrics.js'
import { evaluateTemplate } from '../templateEngine.js'
import { computeBaselines } from '../templateBaselines.js'
import { aggregateTemplateStats } from '../templateStats.js'
import { buildPbPrefillFromEffort } from '../pbVault.js'

const fill = (v, n) => new Array(n).fill(v)

test('timeToCover interpolates inside the boundary sample', () => {
  // 36 km/h = 10 m/s. 95 m takes 9.5 s.
  assert.equal(timeToCover(fill(36, 20), 0, 95), 9.5)
  // start offset is respected, and a stream that is too short yields null
  assert.equal(timeToCover([0, 0, ...fill(36, 20)], 2, 100), 10)
  assert.equal(timeToCover(fill(36, 5), 0, 1000), null)
})

test('timeToCover handles a speed change mid-window', () => {
  // 10 s @ 36 km/h = 100 m, then 18 km/h = 5 m/s: 150 m = 10 s + 10 s
  assert.equal(timeToCover([...fill(36, 10), ...fill(18, 20)], 0, 150), 20)
  assert.equal(timeToCover([...fill(36, 10), ...fill(18, 20)], 0, 125), 15)
})

test('fastestTimeToCover finds the best window with fractional start', () => {
  // slow 5 s, then 72 km/h (20 m/s) for 20 s, slow again: 200 m flying takes exactly 10 s
  const speed = [...fill(18, 5), ...fill(72, 20), ...fill(18, 5)]
  assert.equal(fastestTimeToCover(speed, 0, speed.length, 200), 10)
  assert.equal(fastestTimeToCover(speed, 0, speed.length, 100000), null)
})

test('custom distance-keyed effort reports exact interpolated elapsed time', () => {
  // 1000 m at 36 km/h would take exactly 100 s; the matched window is 105 s long (+-10%)
  const speed = [...fill(5, 20), ...fill(36, 105), ...fill(5, 20)]
  const watts = [...fill(100, 20), ...fill(300, 105), ...fill(100, 20)]
  const template = {
    slug: 't',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 1,
      steps: [{ role: 'work', keyBy: 'distance', targetDistanceM: 1000, durationTolerancePct: 10, bandType: 'best', bestMetric: 'speed' }],
    },
  }
  const r = evaluateTemplate(template, { watts, speed })
  const e = r.efforts[0]
  assert.equal(e.keyed_by, 'distance')
  assert.equal(e.elapsed_time_sec, 100)
  assert.equal(e.estimated_time_sec, 100)
  assert.equal(r.summary.best_time_sec, 100)
  assert.equal(r.summary.avg_time_sec, 100)
  assert.equal(r.summary.total_time_sec, 100)
  assert.equal(r.summary.best_distance_m, undefined)
})

test('custom time-keyed effort reports distance covered and average speed', () => {
  // 120 s @ 30 km/h = 1000 m
  const watts = [...fill(100, 20), ...fill(300, 120), ...fill(100, 20)]
  const speed = [...fill(5, 20), ...fill(30, 120), ...fill(5, 20)]
  const template = {
    slug: 't',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 1,
      steps: [{ role: 'work', targetDurationSec: 120, durationTolerancePct: 0, bandType: 'best', bestMetric: 'power' }],
    },
  }
  const r = evaluateTemplate(template, { watts, speed })
  const e = r.efforts[0]
  assert.equal(e.keyed_by, 'time')
  assert.equal(e.distance_m, 1000)
  assert.equal(e.avg_speed_kmh, 30)
  assert.equal(r.summary.best_distance_m, 1000)
  assert.equal(r.summary.total_distance_m, 1000)
})

test('time-keyed effort without a speed stream is flagged, not given a fake distance', () => {
  const watts = [...fill(100, 20), ...fill(300, 120), ...fill(100, 20)]
  const template = {
    slug: 't',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 1,
      steps: [{ role: 'work', targetDurationSec: 120, durationTolerancePct: 0, bandType: 'best', bestMetric: 'power' }],
    },
  }
  const r = evaluateTemplate(template, { watts })
  assert.equal(r.efforts[0].no_speed_data, true)
  assert.equal(r.efforts[0].distance_m, undefined)
  assert.equal(r.summary.best_distance_m, undefined)
})

test('legacy standing_start / sustained_tt report exact time over their distance', () => {
  const eff = { id: 'a', start_sec: 2, end_sec: 62, duration_sec: 60, suggested_distance_m: 1000 }
  const speed = [...fill(0, 2), ...fill(60, 80)] // 60 km/h = 16.667 m/s -> 1000 m in 60 s
  const r = applyEffortMetrics({ efforts: [eff], summary: {} }, { speed }, { pattern: 'standing_start', distance_m: 1000 })
  assert.equal(r.efforts[0].elapsed_time_sec, 60)
  assert.equal(r.efforts[0].target_distance_m, 1000)
  assert.equal(r.efforts[0].avg_speed_kmh, 60)
  assert.equal(r.summary.best_time_sec, 60)
})

test('legacy flying_sprint uses the fastest 200 m inside the detected window', () => {
  const speed = [...fill(30, 10), ...fill(72, 14), ...fill(30, 10)]
  const eff = { id: 'f', start_sec: 10, end_sec: 24, duration_sec: 14 }
  const r = applyEffortMetrics({ efforts: [eff], summary: {} }, { speed }, { pattern: 'flying_sprint', distance_m: 200 })
  assert.equal(r.efforts[0].elapsed_time_sec, 10)
})

test('legacy distance effort without speed gets no_speed_data and no summary time', () => {
  const eff = { id: 'a', start_sec: 0, end_sec: 60, duration_sec: 60, suggested_distance_m: 1000 }
  const r = applyEffortMetrics({ efforts: [eff], summary: {} }, {}, { pattern: 'sustained_tt' })
  assert.equal(r.efforts[0].no_speed_data, true)
  assert.equal(r.efforts[0].elapsed_time_sec, undefined)
  assert.equal(r.summary.best_time_sec, undefined)
})

test('stored results without the new fields pass through untouched', () => {
  assert.deepEqual(applyEffortMetrics({ efforts: [], summary: { a: 1 } }, {}, {}), { efforts: [], summary: { a: 1 } })
  assert.equal(applyEffortMetrics(null, {}, {}), null)
})

test('formatting: race time and result values', () => {
  assert.equal(formatRaceTime(62.34), '1:02.3')
  assert.equal(formatRaceTime(10.57, 2), '0:10.57')
  assert.equal(formatRaceTime(59.96), '1:00.0')
  assert.equal(formatRaceTime(null), '—')
  assert.equal(formatResultValue('best_time_sec', 281.5), '4:41.50')
  assert.equal(formatResultValue('best_distance_m', 7234), '7.23 km')
  assert.equal(formatResultValue('avg_power', 310.4), '310.4')
})

test('deltas: faster (lower) times are good, longer distances are good', () => {
  assert.deepEqual(describeDelta('best_time_sec', 59.5, 60), { diff: -0.5, good: true, text: '0.50s' })
  assert.equal(describeDelta('best_time_sec', 61, 60).good, false)
  assert.equal(describeDelta('avg_power', 310, 300).good, true)
  assert.equal(describeDelta('best_distance_m', 7000, 7500).good, false)
  assert.equal(describeDelta('best_time_sec', 60, 60), null)
  assert.equal(describeDelta('best_time_sec', 60, undefined), null)
  assert.ok(isLowerBetterKey('best_lap_sec'))
  assert.ok(!isLowerBetterKey('time_below_lt1_s'))
})

test('baselines average the new keys and tolerate runs that lack them', () => {
  const history = [
    { activity_id: 'a', created_at: '2026-01-01', summary: { best_time_sec: 62 } },
    { activity_id: 'b', created_at: '2026-01-02', summary: { avg_power: 300 } },
  ]
  const b = computeBaselines(history, { activityId: 'c', runAt: '2026-01-10' })
  assert.equal(b.allTime.summary.best_time_sec, 62)
  assert.equal(b.previous.activity_id, 'b')
})

test('template stats keep race-time keys and report the minimum as best', () => {
  const rows = [
    { template_id: 't', created_at: '2026-01-01', summary: { best_time_sec: 62, best_distance_m: 5000 } },
    { template_id: 't', created_at: '2026-01-02', summary: { best_time_sec: 60, best_distance_m: 5200 } },
    { template_id: 't', created_at: '2026-01-03', summary: { avg_power: 300 } },
  ]
  const m = aggregateTemplateStats(rows).t.metrics
  assert.equal(m.best_time_sec.best, 60)
  assert.equal(m.best_time_sec.avg, 61)
  assert.equal(m.best_distance_m.best, 5200)
})

test('PB prefill uses exact elapsed time and ignores distance covered of time-keyed efforts', () => {
  const discs = [{ name: '1 km TT', distanceM: 1000, minTrackLengthM: null, maxTrackLengthM: null }]
  const dist = buildPbPrefillFromEffort({ keyed_by: 'distance', target_distance_m: 1000, duration_sec: 61, elapsed_time_sec: 60.25 }, {}, discs)
  assert.equal(dist.discipline, '1 km TT')
  assert.equal(dist.minutes, 1)
  assert.equal(dist.seconds, 0.25)
  const timeKeyed = buildPbPrefillFromEffort({ keyed_by: 'time', distance_m: 1000, duration_sec: 120 }, {}, discs)
  assert.equal(timeKeyed.discipline, null)
})
