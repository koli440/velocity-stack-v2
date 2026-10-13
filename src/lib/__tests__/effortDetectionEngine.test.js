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

// --- Distance-keyed steps (issue #43) --------------------------------------
//
// speed is per-second km/h; distance is derived by integrating speed/3.6.
// 36 km/h == 10 m/s, so a 90s window at constant 36 km/h covers exactly 900m.

function repeatSpeed(value, count) {
  return new Array(count).fill(value)
}

// 20s warmup (5km/h, 100W) + 100s work plateau (36km/h, 300W) + 20s cooldown (5km/h, 100W).
// The 100s plateau covers 1000m at a constant 10 m/s.
function buildDistancePlateauStream() {
  return {
    watts: [...repeatWatts(100, 20), ...repeatWatts(300, 100), ...repeatWatts(100, 20)],
    speed: [...repeatSpeed(5, 20), ...repeatSpeed(36, 100), ...repeatSpeed(5, 20)],
  }
}

test('detectCustomIntervalSequence (distance-keyed): "best power" locates the highest-power ~1km window', () => {
  const { watts, speed } = buildDistancePlateauStream()
  const step = {
    role: 'work',
    keyBy: 'distance',
    targetDistanceM: 1000,
    durationTolerancePct: 10,
    bandType: 'best',
    bestMetric: 'power',
  }

  const result = detectCustomIntervalSequence({ watts, speed, steps: [step], repeatCount: 1, ftpAtActivityW: null })
  assert.equal(result.efforts.length, 1)
  const effort = result.efforts[0]
  assert.equal(effort.band_type, 'best')
  assert.equal(effort.best_metric, 'power')
  assert.equal(effort.avg_power, 300) // the full 300W plateau is the unique max
  assert.equal(effort.target_distance_m, 1000)
  // 10% tolerance -> acceptable distance range is 900-1100m.
  assert.ok(effort.distance_m >= 900 && effort.distance_m <= 1100, `distance_m ${effort.distance_m} in tolerance`)
  assert.ok(effort.avg_speed_kmh >= 32 && effort.avg_speed_kmh <= 40)
})

test('detectCustomIntervalSequence (distance-keyed): "best speed" picks the faster of two equal-distance windows', () => {
  // Two back-to-back ~1km windows: first slower (30km/h), second faster (45km/h).
  const watts = [...repeatWatts(100, 10), ...repeatWatts(250, 120), ...repeatWatts(250, 80), ...repeatWatts(100, 10)]
  const speed = [...repeatSpeed(5, 10), ...repeatSpeed(30, 120), ...repeatSpeed(45, 80), ...repeatSpeed(5, 10)]
  const step = {
    role: 'work',
    keyBy: 'distance',
    targetDistanceM: 1000,
    durationTolerancePct: 10,
    bandType: 'best',
    bestMetric: 'speed',
  }

  const result = detectCustomIntervalSequence({ watts, speed, steps: [step], repeatCount: 1, ftpAtActivityW: null })
  assert.equal(result.efforts.length, 1)
  const effort = result.efforts[0]
  // The 45km/h segment is fully inside the faster plateau (starts at sec 10+120=130).
  assert.ok(effort.start_sec >= 130, `expected the faster plateau, start_sec=${effort.start_sec}`)
  assert.ok(effort.avg_speed_kmh >= 40)
})

test('detectCustomIntervalSequence (distance-keyed): pct_ftp threshold band matches a window inside tolerance', () => {
  const { watts, speed } = buildDistancePlateauStream()
  const step = {
    role: 'work',
    keyBy: 'distance',
    targetDistanceM: 1000,
    durationTolerancePct: 10,
    bandType: 'pct_ftp',
    powerMin: 90,
    powerMax: 110,
  }

  const result = detectCustomIntervalSequence({ watts, speed, steps: [step], repeatCount: 1, ftpAtActivityW: 300 })
  assert.equal(result.efforts.length, 1)
  const effort = result.efforts[0]
  assert.ok(effort.pct_of_ftp >= 90 && effort.pct_of_ftp <= 110)
  assert.ok(effort.distance_m >= 900 && effort.distance_m <= 1100)
})

test('detectCustomIntervalSequence (distance-keyed): fails gracefully with no speed stream', () => {
  const { watts } = buildDistancePlateauStream()
  const step = {
    role: 'work',
    keyBy: 'distance',
    targetDistanceM: 1000,
    durationTolerancePct: 10,
    bandType: 'best',
    bestMetric: 'power',
  }

  const result = detectCustomIntervalSequence({ watts, speed: [], steps: [step], repeatCount: 1, ftpAtActivityW: null })
  assert.equal(result.efforts.length, 0)
  assert.ok(/speed stream/i.test(result.message))

  // An all-zero speed stream (e.g. a track bike with no speed sensor) behaves the same way.
  const resultZeroSpeed = detectCustomIntervalSequence({
    watts,
    speed: new Array(watts.length).fill(0),
    steps: [step],
    repeatCount: 1,
    ftpAtActivityW: null,
  })
  assert.equal(resultZeroSpeed.efforts.length, 0)
  assert.ok(/speed stream/i.test(resultZeroSpeed.message))
})

test('detectCustomIntervalSequence (distance-keyed): zero-tolerance "best speed" with repeatCount > 1 finds all reps', () => {
  // Regression test: distance accumulates continuously (unlike integer-second
  // durations), so at a tight/zero tolerance the per-second-sampled cumulative
  // distance can jump clean over a narrow [distMin, distMax] window between two
  // consecutive seconds. Three distinct, non-round speeds (39/38/37 km/h) are
  // used so 300m never lands exactly on a whole second, and low-speed gaps keep
  // "best speed" from picking a window that straddles two plateaus.
  const watts = [
    ...repeatWatts(200, 28),
    ...repeatWatts(200, 10),
    ...repeatWatts(200, 29),
    ...repeatWatts(200, 10),
    ...repeatWatts(200, 30),
    ...repeatWatts(200, 10),
  ]
  const speed = [
    ...repeatSpeed(39, 28), // ~303.3m in 28s
    ...repeatSpeed(2, 10),
    ...repeatSpeed(38, 29), // ~306.1m in 29s
    ...repeatSpeed(2, 10),
    ...repeatSpeed(37, 30), // ~308.3m in 30s
    ...repeatSpeed(2, 10),
  ]
  const step = {
    role: 'work',
    keyBy: 'distance',
    targetDistanceM: 300,
    durationTolerancePct: 0,
    bandType: 'best',
    bestMetric: 'speed',
  }

  const result = detectCustomIntervalSequence({ watts, speed, steps: [step], repeatCount: 3, ftpAtActivityW: null })
  assert.equal(result.efforts.length, 3, 'all 3 reps should be found, not starved by distance discretization')

  const speeds = result.efforts.map((e) => e.avg_speed_kmh)
  assert.deepEqual(speeds, [39, 38, 37])
  for (const effort of result.efforts) {
    assert.equal(effort.target_distance_m, 300)
    assert.ok(effort.distance_m >= 300, `distance_m ${effort.distance_m} should meet the 0%-tolerance minimum`)
  }
})
