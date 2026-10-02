// Run with: node --test src/lib/__tests__/effortDetectionEngine.test.js
//
// Note: this sliding-window detector matches on average power within a
// duration-tolerant range, so a found window's exact start can shift by a
// sample or two at segment boundaries (a slightly contaminated window can
// still land inside the power band). Assertions below check structural
// properties and reasonable ranges rather than exact boundary offsets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectCustomIntervalSequence } from '../effortDetectionEngine.js'

function repeatWatts(value, count) {
  return new Array(count).fill(value)
}

// warmup(20s@100W) + 2x [work(60s@220/230W) + recovery(30s@80/90W)] + cooldown(20s@100W)
function buildTwoCycleStream() {
  return [
    ...repeatWatts(100, 20),
    ...repeatWatts(220, 60),
    ...repeatWatts(80, 30),
    ...repeatWatts(230, 60),
    ...repeatWatts(90, 30),
    ...repeatWatts(100, 20),
  ]
}

// Same shape but with 3 complete work/recovery cycles present.
function buildThreeCycleStream() {
  return [
    ...repeatWatts(100, 20),
    ...repeatWatts(220, 60),
    ...repeatWatts(80, 30),
    ...repeatWatts(230, 60),
    ...repeatWatts(90, 30),
    ...repeatWatts(225, 60),
    ...repeatWatts(85, 30),
    ...repeatWatts(100, 20),
  ]
}

const WORK_STEP_PCT_FTP = {
  role: 'work',
  targetDurationSec: 60,
  durationTolerancePct: 10,
  bandType: 'pct_ftp',
  powerMin: 90,
  powerMax: 110,
}

const RECOVERY_STEP_PCT_FTP = {
  role: 'recovery',
  targetDurationSec: 30,
  durationTolerancePct: 20,
  bandType: 'pct_ftp',
  powerMin: null,
  powerMax: 55,
}

test('detectCustomIntervalSequence: full match of all configured reps', () => {
  const watts = buildTwoCycleStream()
  const result = detectCustomIntervalSequence({
    watts,
    steps: [WORK_STEP_PCT_FTP, RECOVERY_STEP_PCT_FTP],
    repeatCount: 2,
    ftpAtActivityW: 220,
  })

  assert.equal(result.pattern, 'custom_intervals')
  assert.equal(result.efforts.length, 4) // 2 reps x (work + recovery)

  const roles = result.efforts.map((e) => e.role)
  assert.deepEqual(roles, ['work', 'recovery', 'work', 'recovery'])

  const [work1, rec1, work2, rec2] = result.efforts
  assert.ok(work1.avg_power >= 198 && work1.avg_power <= 242, `work1 avg_power ${work1.avg_power} in band`)
  assert.ok(rec1.avg_power <= 121, `rec1 avg_power ${rec1.avg_power} under 55% FTP`)
  assert.ok(work2.avg_power >= 198 && work2.avg_power <= 242)
  assert.ok(rec2.avg_power <= 121)

  // Reps progress forward through the stream (no reuse/overlap of windows).
  assert.ok(work1.end_sec <= rec1.start_sec + 1)
  assert.ok(rec1.end_sec <= work2.start_sec + 1)
  assert.ok(work2.end_sec <= rec2.start_sec + 1)

  assert.equal(work1.band_type, 'pct_ftp')
  assert.equal(work1.pct_of_ftp, Math.round((work1.avg_power / 220) * 1000) / 10)
})

test('detectCustomIntervalSequence: partial "at least N" match (3 of 4 configured reps)', () => {
  const watts = buildThreeCycleStream()
  const result = detectCustomIntervalSequence({
    watts,
    steps: [WORK_STEP_PCT_FTP, RECOVERY_STEP_PCT_FTP],
    repeatCount: 4, // configured for 4, but the stream only contains 3 complete cycles
    ftpAtActivityW: 220,
  })

  // 3 complete reps found (work+recovery each) = 6 efforts; a partial match
  // is a valid result, not a failure.
  assert.equal(result.efforts.length, 6)
  const workEfforts = result.efforts.filter((e) => e.role === 'work')
  const recoveryEfforts = result.efforts.filter((e) => e.role === 'recovery')
  assert.equal(workEfforts.length, 3)
  assert.equal(recoveryEfforts.length, 3)
})

test('detectCustomIntervalSequence: "best" band locates the single highest-power window', () => {
  const watts = [...repeatWatts(100, 40), ...repeatWatts(300, 30), ...repeatWatts(100, 30)]
  const result = detectCustomIntervalSequence({
    watts,
    steps: [
      { role: 'work', targetDurationSec: 30, durationTolerancePct: 50, bandType: 'best', powerMin: null, powerMax: null },
    ],
    repeatCount: 1,
    ftpAtActivityW: null,
  })

  assert.equal(result.efforts.length, 1)
  const effort = result.efforts[0]
  assert.equal(effort.role, 'work')
  assert.equal(effort.band_type, 'best')
  // Any window landing fully inside the 300W plateau is the unique maximum;
  // partially-overlapping windows average below 300.
  assert.equal(effort.avg_power, 300)
  assert.ok(effort.start_sec >= 40 && effort.end_sec <= 70)
  assert.equal(effort.pct_of_ftp, undefined) // no ftpAtActivityW supplied
})

test('detectCustomIntervalSequence: pct_ftp band vs watts band behave independently', () => {
  const watts = buildTwoCycleStream()
  const workStepWatts = {
    role: 'work',
    targetDurationSec: 60,
    durationTolerancePct: 10,
    bandType: 'watts',
    powerMin: 200,
    powerMax: 250,
  }

  // Watts band: matches both work reps regardless of FTP (none supplied).
  const wattsResult = detectCustomIntervalSequence({
    watts,
    steps: [workStepWatts],
    repeatCount: 2,
    ftpAtActivityW: null,
  })
  assert.equal(wattsResult.efforts.filter((e) => e.role === 'work').length, 2)
  assert.equal(wattsResult.efforts[0].pct_of_ftp, undefined)

  // pct_ftp band: with a mismatched (much higher) FTP snapshot, 220-230W no
  // longer reaches the 90-110% band, so no window qualifies at all.
  const pctFtpResult = detectCustomIntervalSequence({
    watts,
    steps: [WORK_STEP_PCT_FTP],
    repeatCount: 2,
    ftpAtActivityW: 500,
  })
  assert.equal(pctFtpResult.efforts.length, 0)
})
