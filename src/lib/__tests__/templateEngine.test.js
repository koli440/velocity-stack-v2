// Run with: node --test src/lib/__tests__/templateEngine.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTemplate } from '../templateEngine.js'

function repeatWatts(value, count) {
  return new Array(count).fill(value)
}

function buildTwoCycleStream() {
  return [
    ...repeatWatts(100, 20),
    ...repeatWatts(220, 60),
    ...repeatWatts(80, 30),
    ...repeatWatts(180, 60), // deliberately weaker 2nd rep to produce a measurable drop-off
    ...repeatWatts(90, 30),
    ...repeatWatts(100, 20),
  ]
}

function customTemplate(overrides = {}) {
  return {
    slug: 'tpl_custom_test',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 2,
      steps: [
        { role: 'work', targetDurationSec: 60, durationTolerancePct: 15, bandType: 'pct_ftp', powerMin: 70, powerMax: 110 },
        { role: 'recovery', targetDurationSec: 30, durationTolerancePct: 20, bandType: 'pct_ftp', powerMin: null, powerMax: 55 },
      ],
      ...overrides,
    },
  }
}

test('evaluateTemplate (custom_intervals): computes reps_detected/target and dropoff across work reps only', () => {
  const timeSeries = { watts: buildTwoCycleStream() }
  const result = evaluateTemplate(customTemplate(), timeSeries, 220)

  assert.equal(result.summary.reps_target, 2)
  assert.equal(result.summary.reps_detected, 2)
  assert.ok(result.summary.avg_power > 0)
  // Rep 2's work avg (180W) is weaker than rep 1's (220W) -> positive dropoff.
  assert.ok(result.summary.dropoff_pct > 0, `expected positive dropoff, got ${result.summary.dropoff_pct}`)

  const workEfforts = result.efforts.filter((e) => e.role === 'work')
  assert.equal(workEfforts.length, 2)
  assert.equal(workEfforts[0].rep, 1)
  assert.equal(workEfforts[1].rep, 2)
  assert.ok(workEfforts.every((e) => e.pacing_index === null || typeof e.pacing_index === 'number'))
})

test('evaluateTemplate (custom_intervals): reps_target reflects configured count even on a partial match', () => {
  const timeSeries = { watts: buildTwoCycleStream() }
  const result = evaluateTemplate(customTemplate({ repeat_count: 5 }), timeSeries, 220)

  assert.equal(result.summary.reps_target, 5)
  assert.equal(result.summary.reps_detected, 2) // only 2 complete cycles exist in the stream
})

test('evaluateTemplate (custom_intervals): watts band works without an ftpAtActivityW', () => {
  const timeSeries = { watts: buildTwoCycleStream() }
  const template = customTemplate({
    steps: [{ role: 'work', targetDurationSec: 60, durationTolerancePct: 15, bandType: 'watts', powerMin: 150, powerMax: 260 }],
  })

  const result = evaluateTemplate(template, timeSeries, null)
  assert.equal(result.summary.reps_detected, 2)
  assert.equal(result.efforts.every((e) => e.pct_of_ftp === undefined), true)
})

// --- Distance-keyed steps (issue #43) --------------------------------------

function repeatSpeed(value, count) {
  return new Array(count).fill(value)
}

test('evaluateTemplate (custom_intervals): distance-keyed "best power" surfaces distance/speed summary fields', () => {
  // 20s warmup + 100s @ 36km/h (10m/s -> 1000m) @ 300W + 20s cooldown.
  const timeSeries = {
    watts: [...repeatWatts(100, 20), ...repeatWatts(300, 100), ...repeatWatts(100, 20)],
    speed: [...repeatSpeed(5, 20), ...repeatSpeed(36, 100), ...repeatSpeed(5, 20)],
  }
  const template = {
    slug: 'tpl_pursuit_test',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 1,
      steps: [
        {
          role: 'work',
          keyBy: 'distance',
          targetDistanceM: 1000,
          durationTolerancePct: 10,
          bandType: 'best',
          bestMetric: 'power',
        },
      ],
    },
  }

  const result = evaluateTemplate(template, timeSeries, null)
  assert.equal(result.summary.reps_detected, 1)
  assert.equal(result.summary.target_distance_m, 1000)
  assert.ok(result.summary.avg_speed_kmh >= 32 && result.summary.avg_speed_kmh <= 40)
  assert.equal(result.summary.avg_power, 300)

  const effort = result.efforts[0]
  assert.equal(effort.target_distance_m, 1000)
  assert.ok(effort.distance_m >= 900 && effort.distance_m <= 1100)
  assert.equal(typeof effort.estimated_time_sec, 'number')
})

test('evaluateTemplate (custom_intervals): distance-keyed step reports no match without a speed stream', () => {
  const timeSeries = { watts: [...repeatWatts(100, 20), ...repeatWatts(300, 100), ...repeatWatts(100, 20)] }
  const template = {
    slug: 'tpl_pursuit_no_speed',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 1,
      steps: [
        {
          role: 'work',
          keyBy: 'distance',
          targetDistanceM: 1000,
          durationTolerancePct: 10,
          bandType: 'best',
          bestMetric: 'power',
        },
      ],
    },
  }

  const result = evaluateTemplate(template, timeSeries, null)
  assert.equal(result.efforts.length, 0)
  assert.equal(result.summary.reps_detected, 0)
})

test('evaluateTemplate (custom_intervals): heart-rate-banded template works on an HR-only activity', () => {
  const heartrate = [...repeatWatts(100, 20), ...repeatWatts(160, 60), ...repeatWatts(110, 30), ...repeatWatts(160, 60), ...repeatWatts(110, 30)]
  const template = {
    slug: 'hr',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 2,
      steps: [
        { role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 10, bandType: 'pct_hrmax', powerMin: 85, powerMax: 100 },
        { role: 'recovery', keyBy: 'duration', targetDurationSec: 30, durationTolerancePct: 10, bandType: 'hr_bpm', powerMin: null, powerMax: 120 },
      ],
    },
  }
  const result = evaluateTemplate(template, { heartrate }, null, 180)
  assert.equal(result.summary.reps_detected, 2)
  assert.equal(result.efforts.filter((e) => e.role === 'work').length, 2)
})

test('evaluateTemplate (custom_intervals): manifest warmup_sec/cooldown_sec exclude the head and tail', () => {
  const watts = [...repeatWatts(300, 60), ...repeatWatts(100, 200), ...repeatWatts(300, 60)]
  const step = { role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 0, bandType: 'watts', powerMin: 290, powerMax: 310 }
  const base = { pattern: 'custom_intervals', repeat_count: 2, steps: [step] }
  assert.equal(evaluateTemplate({ slug: 'a', manifest: base }, { watts }).summary.reps_detected, 2)
  assert.equal(evaluateTemplate({ slug: 'a', manifest: { ...base, warmup_sec: 60 } }, { watts }).summary.reps_detected, 1)
  assert.equal(evaluateTemplate({ slug: 'a', manifest: { ...base, warmup_sec: 60, cooldown_sec: 60 } }, { watts }).summary.reps_detected, 0)
})

test('evaluateTemplate (custom_intervals): multi-step blocks get step_index, per-step summaries and rep-level drop-off', () => {
  const block = (a, b) => [...repeatWatts(a, 60), ...repeatWatts(b, 30), ...repeatWatts(80, 60)]
  const watts = [...block(200, 300), ...block(180, 270)]
  const mk = (role, dur, min, max) => ({ role, keyBy: 'duration', targetDurationSec: dur, durationTolerancePct: 0, bandType: 'watts', powerMin: min, powerMax: max })
  const template = {
    slug: 'ms',
    manifest: {
      pattern: 'custom_intervals',
      repeat_count: 2,
      steps: [mk('work', 60, 170, 210), mk('work', 30, 260, 310), mk('recovery', 60, null, 90)],
    },
  }
  const r = evaluateTemplate(template, { watts })
  assert.equal(r.summary.reps_detected, 2)
  assert.deepEqual(r.efforts.map((e) => [e.rep, e.step_index]), [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]])
  assert.equal(r.summary.step_summaries.length, 3)
  assert.equal(r.summary.step_summaries[1].avg_power, 285)
  // rep power = (200*60+300*30)/90 = 233 vs (180*60+270*30)/90 = 210 -> drop-off ~9.9%
  assert.ok(r.summary.dropoff_pct > 9 && r.summary.dropoff_pct < 11)
})

test('evaluateTemplate (custom_intervals): classic work/recovery output has no multi-step fields (regression)', () => {
  const r = evaluateTemplate(customTemplate(), { watts: buildTwoCycleStream() }, 220)
  assert.equal(r.summary.step_summaries, undefined)
  assert.ok(r.efforts.every((e) => e.step_index === undefined))
})

test('evaluateTemplate (custom_intervals): over-unders from DSL text via the manifest builder', async () => {
  const { parseIntervalDsl, buildIntervalManifest } = await import('../intervalDsl.js')
  const dsl = '2x\nwork 2min ±0% @ 245-255W\nthen work 1min ±0% @ 295-305W\nthen work 2min ±0% @ 245-255W\nrecovery 4min ±0% @ <110W'
  const manifest = buildIntervalManifest(parseIntervalDsl(dsl))
  const rep = [...repeatWatts(250, 120), ...repeatWatts(300, 60), ...repeatWatts(250, 120), ...repeatWatts(100, 240)]
  const r = evaluateTemplate({ slug: 'ou', manifest }, { watts: [...rep, ...rep] })
  assert.equal(r.summary.reps_detected, 2)
  assert.equal(r.efforts.length, 8)
  assert.deepEqual(r.efforts.slice(0, 4).map((e) => e.step_index), [1, 2, 3, 4])
  assert.deepEqual(r.summary.step_summaries.map((s) => s.avg_power), [250, 300, 250, 100])
  assert.equal(r.summary.dropoff_pct, 0)
})

test('evaluateTemplate (custom_intervals): sets summary, set recoveries excluded from work stats', async () => {
  const { parseIntervalDsl, buildIntervalManifest } = await import('../intervalDsl.js')
  const dsl = '2 sets of 3x\nwork 30sec ±0% @ 299-315W\nrecovery 30sec ±0% @ <70W\nset recovery 2min ±0% @ <50W'
  const manifest = buildIntervalManifest(parseIntervalDsl(dsl))
  const setBlock = (w) => [...Array.from({ length: 3 }, () => [...repeatWatts(w, 30), ...repeatWatts(60, 30)]).flat()]
  const watts = [...repeatWatts(100, 30), ...setBlock(300), ...repeatWatts(40, 120), ...setBlock(310)]
  const r = evaluateTemplate({ slug: 'sets', manifest }, { watts })
  assert.equal(r.summary.reps_detected, 6)
  assert.equal(r.summary.reps_target, 6)
  assert.equal(r.summary.sets_target, 2)
  assert.equal(r.summary.sets_detected, 2)
  assert.deepEqual(r.summary.set_summaries.map((s) => [s.set, s.reps_detected, s.avg_power]), [[1, 3, 300], [2, 3, 310]])
  assert.equal(r.summary.avg_power, 305)
  assert.equal(r.efforts.filter((e) => e.role === 'set_recovery').length, 1)
  assert.deepEqual(r.efforts.filter((e) => e.role === 'work').map((e) => e.rep), [1, 2, 3, 4, 5, 6])
  const starts = r.efforts.map((e) => e.start_sec)
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b))
})

test('evaluateTemplate (custom_intervals): no set fields for non-set templates (regression)', () => {
  const r = evaluateTemplate(customTemplate(), { watts: buildTwoCycleStream() }, 220)
  assert.equal(r.summary.sets_target, undefined)
  assert.equal(r.summary.set_summaries, undefined)
})
