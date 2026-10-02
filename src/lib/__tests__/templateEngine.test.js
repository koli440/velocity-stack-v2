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
