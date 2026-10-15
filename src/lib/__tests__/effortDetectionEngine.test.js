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

test('detectCustomIntervalSequence: repeated "best" step finds N non-overlapping efforts, even when the best is last', () => {
  const watts = [
    ...repeatWatts(100, 20), ...repeatWatts(250, 30),
    ...repeatWatts(100, 20), ...repeatWatts(280, 30),
    ...repeatWatts(100, 20), ...repeatWatts(300, 30),
    ...repeatWatts(100, 20),
  ]
  const result = detectCustomIntervalSequence({
    watts,
    steps: [{ role: 'work', targetDurationSec: 30, durationTolerancePct: 0, bandType: 'best', powerMin: null, powerMax: null }],
    repeatCount: 3,
  })
  assert.equal(result.efforts.length, 3)
  assert.deepEqual(result.efforts.map((e) => e.avg_power), [250, 280, 300])
  for (let i = 1; i < 3; i++) assert.ok(result.efforts[i].start_sec >= result.efforts[i - 1].end_sec)
})

test('detectCustomIntervalSequence: repeated "best" stops when no room remains', () => {
  const result = detectCustomIntervalSequence({
    watts: repeatWatts(200, 70),
    steps: [{ role: 'work', targetDurationSec: 30, durationTolerancePct: 0, bandType: 'best', powerMin: null, powerMax: null }],
    repeatCount: 5,
  })
  assert.equal(result.efforts.length, 2)
})

// ---- HR / cadence bands (issue #123) ----

test('hr_bpm band matches work/recovery on a synthetic heart-rate stream', () => {
  const hr = [...repeatWatts(100, 20), ...repeatWatts(160, 60), ...repeatWatts(110, 30), ...repeatWatts(162, 60), ...repeatWatts(105, 30)]
  const steps = [
    { role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 10, bandType: 'hr_bpm', powerMin: 150, powerMax: 170 },
    { role: 'recovery', keyBy: 'duration', targetDurationSec: 30, durationTolerancePct: 10, bandType: 'hr_bpm', powerMin: null, powerMax: 120 },
  ]
  const { efforts } = detectCustomIntervalSequence({ heartrate: hr, steps, repeatCount: 2 })
  assert.equal(efforts.length, 4)
  assert.deepEqual(efforts.map((e) => e.role), ['work', 'recovery', 'work', 'recovery'])
  assert.ok(efforts[0].start_sec >= 5 && efforts[0].start_sec <= 22)
  assert.ok(efforts[0].avg_hr_bpm >= 150 && efforts[0].avg_hr_bpm <= 170)
  assert.equal(efforts[0].avg_power, null)
})

test('pct_hrmax uses the supplied max HR, falling back to the stream max', () => {
  const hr = [...repeatWatts(100, 30), ...repeatWatts(180, 60)]
  const steps = [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 10, bandType: 'pct_hrmax', powerMin: 90, powerMax: 100 }]
  // stream max = 180, so 180bpm = 100%
  assert.equal(detectCustomIntervalSequence({ heartrate: hr, steps, repeatCount: 1 }).efforts.length, 1)
  // with HRmax 200 the 180bpm effort is only 90% (still in band); with 220 it is 82% (out of band)
  assert.equal(detectCustomIntervalSequence({ heartrate: hr, steps, repeatCount: 1, hrMaxBpm: 200 }).efforts.length, 1)
  assert.equal(detectCustomIntervalSequence({ heartrate: hr, steps, repeatCount: 1, hrMaxBpm: 220 }).efforts.length, 0)
})

test('cadence_rpm band matches on the cadence stream, independent of power', () => {
  const cadence = [...repeatWatts(60, 20), ...repeatWatts(100, 60), ...repeatWatts(60, 20)]
  const watts = repeatWatts(200, 100)
  const steps = [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 10, bandType: 'cadence_rpm', powerMin: 95, powerMax: 105 }]
  const { efforts } = detectCustomIntervalSequence({ watts, cadence, steps, repeatCount: 1 })
  assert.equal(efforts.length, 1)
  assert.ok(efforts[0].avg_cadence_rpm >= 95 && efforts[0].avg_cadence_rpm <= 105)
  assert.equal(efforts[0].avg_power, 200)
})

test('hr/cadence steps report a message instead of throwing when the stream is missing', () => {
  const hrStep = [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 10, bandType: 'hr_bpm', powerMin: 100, powerMax: null }]
  const r1 = detectCustomIntervalSequence({ watts: repeatWatts(200, 100), steps: hrStep, repeatCount: 1 })
  assert.deepEqual(r1.efforts, [])
  assert.match(r1.message, /heart rate/)
  const cadStep = [{ ...hrStep[0], bandType: 'cadence_rpm' }]
  const r2 = detectCustomIntervalSequence({ watts: repeatWatts(200, 100), steps: cadStep, repeatCount: 1 })
  assert.match(r2.message, /cadence/)
})

test('watts-only templates ignore hr/cadence streams (unchanged behaviour)', () => {
  const steps = [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 10, bandType: 'watts', powerMin: 190, powerMax: 210 }]
  const base = detectCustomIntervalSequence({ watts: repeatWatts(200, 100), steps, repeatCount: 1 })
  const withExtras = detectCustomIntervalSequence({ watts: repeatWatts(200, 100), heartrate: repeatWatts(150, 500), cadence: repeatWatts(90, 500), steps, repeatCount: 1 })
  assert.deepEqual(withExtras, base)
})

// ---- warm-up / cool-down exclusion (issue #124) ----

const W = (min, max, tol, band = 'watts') => ({ role: 'work', keyBy: 'duration', targetDurationSec: min, durationTolerancePct: tol, bandType: band, powerMin: max[0], powerMax: max[1] })

test('warmup exclusion ignores a matching block inside the warm-up, cooldown ignores one at the end', () => {
  // 60s@300W (a decoy "effort" in the warm-up) + 300s@150W + 60s@300W (decoy in cooldown)
  const watts = [...repeatWatts(300, 60), ...repeatWatts(150, 300), ...repeatWatts(300, 60)]
  const steps = [W(60, [290, 310], 0)]
  const all = detectCustomIntervalSequence({ watts, steps, repeatCount: 2 })
  assert.equal(all.efforts.length, 2)

  const noWarm = detectCustomIntervalSequence({ watts, steps, repeatCount: 2, warmupSec: 60 })
  assert.equal(noWarm.efforts.length, 1)
  assert.ok(noWarm.efforts[0].start_sec >= 350)

  const noCool = detectCustomIntervalSequence({ watts, steps, repeatCount: 2, cooldownSec: 60 })
  assert.equal(noCool.efforts.length, 1)
  assert.ok(noCool.efforts[0].end_sec <= 60)

  const none = detectCustomIntervalSequence({ watts, steps, repeatCount: 2, warmupSec: 60, cooldownSec: 60 })
  assert.deepEqual(none.efforts, [])
})

test('warmup/cooldown also bound "best" searches (single and ranked) and distance steps', () => {
  const watts = [...repeatWatts(400, 60), ...repeatWatts(200, 240), ...repeatWatts(250, 60), ...repeatWatts(450, 60)]
  const best = [{ role: 'work', keyBy: 'duration', targetDurationSec: 60, durationTolerancePct: 0, bandType: 'best', bestMetric: 'power', powerMin: null, powerMax: null }]
  const r = detectCustomIntervalSequence({ watts, steps: best, repeatCount: 1, warmupSec: 60, cooldownSec: 60 })
  assert.equal(r.efforts[0].start_sec, 300)
  assert.equal(r.efforts[0].avg_power, 250)

  const speed = [...repeatWatts(50, 100), ...repeatWatts(20, 100), ...repeatWatts(30, 100)]
  const dist = [{ role: 'work', keyBy: 'distance', targetDistanceM: 500, durationTolerancePct: 10, bandType: 'best', bestMetric: 'speed', powerMin: null, powerMax: null }]
  const d = detectCustomIntervalSequence({ watts: repeatWatts(200, 300), speed, steps: dist, repeatCount: 1, warmupSec: 100 })
  assert.ok(d.efforts[0].start_sec >= 100)
  assert.ok(d.efforts[0].avg_speed_kmh <= 31)
})

test('exclusion consuming the whole activity yields no efforts without throwing', () => {
  const r = detectCustomIntervalSequence({ watts: repeatWatts(300, 100), steps: [W(30, [200, 400], 10)], repeatCount: 1, warmupSec: 60, cooldownSec: 60 })
  assert.deepEqual(r.efforts, [])
})

test('without warmup/cooldown results are identical to the legacy call shape', () => {
  const watts = buildTwoCycleStream()
  const steps = [W(60, [200, 240], 15), { ...W(30, [null, 100], 20), role: 'recovery' }]
  assert.deepEqual(
    detectCustomIntervalSequence({ watts, steps, repeatCount: 2, warmupSec: 0, cooldownSec: null }),
    detectCustomIntervalSequence({ watts, steps, repeatCount: 2 })
  )
})

// ---- multi-step blocks (issue #124) ----

test('multi-step block: two work steps + recovery per repeat are matched in order', () => {
  // 2 x [ 60s@200 , 30s@300 , 60s@80 ]
  const block = [...repeatWatts(200, 60), ...repeatWatts(300, 30), ...repeatWatts(80, 60)]
  const watts = [...block, ...block]
  const steps = [
    W(60, [190, 210], 0),
    W(30, [290, 310], 0),
    { ...W(60, [null, 90], 0), role: 'recovery' },
  ]
  const { efforts } = detectCustomIntervalSequence({ watts, steps, repeatCount: 2 })
  assert.equal(efforts.length, 6)
  assert.deepEqual(efforts.map((e) => e.role), ['work', 'work', 'recovery', 'work', 'work', 'recovery'])
  assert.deepEqual(efforts.map((e) => e.avg_power).slice(0, 3), [200, 300, 80])
  for (let i = 1; i < efforts.length; i++) assert.ok(efforts[i].start_sec >= efforts[i - 1].end_sec)
})
