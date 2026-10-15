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
