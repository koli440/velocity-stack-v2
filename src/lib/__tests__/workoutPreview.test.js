import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPreview, scalePower, formatElapsed, timeTicks, valueTicks, previewSummaryText } from '../workoutPreview.js'
import { parseStructure } from '../plannedWorkouts.js'

const DSL = '3x\nwork 5min ±30% @ 90-100%FTP\nrecovery 2min ±50% @ <55%FTP'
const manifest = (dsl) => parseStructure(dsl).manifest

test('segments are laid out in time order with reps', () => {
  const p = buildPreview(manifest(DSL), { ftp: 200 })
  assert.equal(p.segments.length, 6)
  assert.equal(p.durationS, 3 * 7 * 60)
  assert.deepEqual(p.segments.map((s) => s.role), ['work', 'recovery', 'work', 'recovery', 'work', 'recovery'])
  assert.equal(p.segments[1].startS, 300)
  assert.equal(p.unit, 'w')
  assert.equal(scalePower(p.segments[0].hi, p), 200)
  assert.equal(scalePower(p.segments[0].lo, p), 180)
  assert.equal(p.segments[1].lo, 0)
})

test('without FTP the axis is %FTP', () => {
  const p = buildPreview(manifest(DSL), {})
  assert.equal(p.unit, 'pct')
  assert.equal(scalePower(p.segments[0].hi, p), 100)
})

test('warm-up and cool-down are ramps; sets add set recovery', () => {
  const m = { pattern: 'custom_intervals', repeat_count: 2, set_count: 2, warmup_sec: 600, cooldown_sec: 300,
    steps: [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, bandType: 'watts', powerMin: 300, powerMax: 320 }],
    set_recovery: { role: 'recovery', keyBy: 'duration', targetDurationSec: 120, bandType: 'pct_ftp', powerMin: 40, powerMax: 50 } }
  const p = buildPreview(m, { ftp: 250 })
  assert.equal(p.segments[0].role, 'warmup')
  assert.ok(p.segments[0].ramp)
  assert.equal(p.segments.filter((s) => s.role === 'setRecovery').length, 1)
  assert.equal(p.segments.at(-1).role, 'cooldown')
  assert.equal(p.durationS, 600 + 4 * 60 + 120 + 300)
  assert.equal(scalePower(p.segments[1].hi, p), 320)
})

test('distance steps are skipped and flagged partial; watts without FTP are approximate', () => {
  const m = { pattern: 'custom_intervals', repeat_count: 2, steps: [
    { role: 'work', keyBy: 'distance', targetDistanceM: 1000, bandType: 'pct_ftp', powerMin: 100, powerMax: 110 },
    { role: 'recovery', keyBy: 'duration', targetDurationSec: 60, bandType: 'watts', powerMin: 100, powerMax: 120 }] }
  const p = buildPreview(m, {})
  assert.equal(p.partial, true)
  assert.equal(p.untimed, 2)
  assert.equal(p.segments.length, 2)
  assert.equal(p.segments[0].approx, true)
  assert.match(previewSummaryText(p), /distance step/)
})

test('zone bands and empty input', () => {
  const m = { repeat_count: 1, steps: [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, bandType: 'zone', powerMin: 3, powerMax: 3 }] }
  const p = buildPreview(m, { ftp: 100 })
  assert.equal(scalePower(p.segments[0].hi, p), 90)
  assert.equal(buildPreview(null), null)
  assert.equal(buildPreview({ pattern: 'x', steps: [] }), null)
  assert.equal(previewSummaryText(null), 'No workout preview')
})

test('axis helpers', () => {
  assert.equal(formatElapsed(500), '8:20')
  assert.equal(formatElapsed(3900), '1:05:00')
  assert.deepEqual(timeTicks(0), [0])
  assert.deepEqual(timeTicks(1200), [0, 300, 600, 900, 1200])
  assert.ok(timeTicks(7 * 3600).length <= 8)
  const { ticks, top } = valueTicks(330)
  assert.equal(ticks[0], 0)
  assert.ok(top >= 330)
  assert.ok(ticks.length <= 7)
})
