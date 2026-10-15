// Run with: node --test src/lib/__tests__/intervalDsl.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIntervalManifest, manifestToDslInput, parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'

test('parses a repeated %FTP-banded work/recovery template', () => {
  const { repeatCount, steps, errors } = parseIntervalDsl(
    '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP'
  )
  assert.deepEqual(errors, [])
  assert.equal(repeatCount, 4)
  assert.equal(steps.length, 2)
  assert.deepEqual(steps[0], {
    role: 'work',
    keyBy: 'duration',
    targetDurationSec: 180,
    targetDistanceM: null,
    durationTolerancePct: 30,
    bandType: 'pct_ftp',
    bestMetric: null,
    powerMin: 90,
    powerMax: 110,
  })
  assert.deepEqual(steps[1], {
    role: 'recovery',
    keyBy: 'duration',
    targetDurationSec: 120,
    targetDistanceM: null,
    durationTolerancePct: 50,
    bandType: 'pct_ftp',
    bestMetric: null,
    powerMin: null,
    powerMax: 55,
  })
})

test('parses a one-shot "best" pattern with no recovery line', () => {
  const { repeatCount, steps, errors } = parseIntervalDsl('1x\nwork 5min ±40% @ best')
  assert.deepEqual(errors, [])
  assert.equal(repeatCount, 1)
  assert.equal(steps.length, 1)
  assert.deepEqual(steps[0], {
    role: 'work',
    keyBy: 'duration',
    targetDurationSec: 300,
    targetDistanceM: null,
    durationTolerancePct: 40,
    bandType: 'best',
    bestMetric: 'power',
    powerMin: null,
    powerMax: null,
  })
})

test('parses an absolute-watts band (range, min-only, max-only)', () => {
  const { steps, errors } = parseIntervalDsl(
    '3x\nwork 30sec ±20% @ 250-300W\nrecovery 90sec ±50% @ <150W'
  )
  assert.deepEqual(errors, [])
  assert.equal(steps[0].bandType, 'watts')
  assert.equal(steps[0].powerMin, 250)
  assert.equal(steps[0].powerMax, 300)
  assert.equal(steps[1].bandType, 'watts')
  assert.equal(steps[1].powerMax, 150)

  const { steps: steps2, errors: errors2 } = parseIntervalDsl('1x\nwork 20sec ±10% @ >400W')
  assert.deepEqual(errors2, [])
  assert.equal(steps2[0].powerMin, 400)
  assert.equal(steps2[0].powerMax, null)
})

test('each invalid-syntax case produces a line-numbered error', () => {
  const missingRepeat = parseIntervalDsl('work 3min ±30% @ 90-110%FTP')
  assert.equal(missingRepeat.errors.length > 0, true)
  assert.equal(missingRepeat.errors[0].line, 1)

  const badRepeat = parseIntervalDsl('0x\nwork 3min ±30% @ 90-110%FTP')
  assert.ok(badRepeat.errors.some((e) => e.line === 1))

  const badStep = parseIntervalDsl('4x\nwork three minutes @ fast')
  assert.ok(badStep.errors.some((e) => e.line === 2))

  const badBand = parseIntervalDsl('4x\nwork 3min ±30% @ somewhere-fast')
  assert.ok(badBand.errors.some((e) => e.line === 2 && /band/i.test(e.message)))

  const badTolerance = parseIntervalDsl('4x\nwork 3min ±150% @ 90-110%FTP')
  assert.ok(badTolerance.errors.some((e) => e.line === 2 && /tolerance/i.test(e.message)))

  const badRangeOrder = parseIntervalDsl('4x\nwork 3min ±30% @ 110-90%FTP')
  assert.ok(badRangeOrder.errors.some((e) => e.line === 2 && /less than/i.test(e.message)))

  const noWorkStep = parseIntervalDsl('4x\nrecovery 2min ±50% @ <55%FTP')
  assert.ok(noWorkStep.errors.some((e) => /at least one "work"/i.test(e.message)))
})

test('parses distance-keyed steps (km/m) requiring an explicit best metric', () => {
  const pursuit = parseIntervalDsl('4x\nwork 1km ±5% @ best power\nrecovery 2min ±50% @ <55%FTP')
  assert.deepEqual(pursuit.errors, [])
  assert.deepEqual(pursuit.steps[0], {
    role: 'work',
    keyBy: 'distance',
    targetDurationSec: null,
    targetDistanceM: 1000,
    durationTolerancePct: 5,
    bandType: 'best',
    bestMetric: 'power',
    powerMin: null,
    powerMax: null,
  })
  // The recovery step is still duration-keyed - both kinds can coexist.
  assert.equal(pursuit.steps[1].keyBy, 'duration')

  const flying200 = parseIntervalDsl('1x\nwork 200m ±10% @ best speed')
  assert.deepEqual(flying200.errors, [])
  assert.deepEqual(flying200.steps[0], {
    role: 'work',
    keyBy: 'distance',
    targetDurationSec: null,
    targetDistanceM: 200,
    durationTolerancePct: 10,
    bandType: 'best',
    bestMetric: 'speed',
    powerMin: null,
    powerMax: null,
  })

  // Bare "best"/"max" is ambiguous for a distance-keyed step and must error.
  const ambiguous = parseIntervalDsl('1x\nwork 200m ±10% @ best')
  assert.ok(ambiguous.errors.some((e) => /requires? a metric/i.test(e.message)))
  // It still defaults to "power" in the parsed output so downstream code has a usable manifest.
  assert.equal(ambiguous.steps[0].bestMetric, 'power')
})

test('parses a km/h speed band on power-free steps', () => {
  const { steps, errors } = parseIntervalDsl('1x\nwork 200m ±10% @ >45km/h')
  assert.deepEqual(errors, [])
  assert.equal(steps[0].bandType, 'speed_kmh')
  assert.equal(steps[0].powerMin, 45)
  assert.equal(steps[0].powerMax, null)
})

test('stringify . parse round-trip is stable', () => {
  const cases = [
    { repeatCount: 4, steps: parseIntervalDsl('4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP').steps },
    { repeatCount: 1, steps: parseIntervalDsl('1x\nwork 5min ±40% @ best').steps },
    { repeatCount: 3, steps: parseIntervalDsl('3x\nwork 30sec ±20% @ 250-300W\nrecovery 90sec ±50% @ <150W').steps },
    { repeatCount: 4, steps: parseIntervalDsl('4x\nwork 1km ±5% @ best power\nrecovery 2min ±50% @ <55%FTP').steps },
    { repeatCount: 1, steps: parseIntervalDsl('1x\nwork 200m ±10% @ best speed').steps },
    { repeatCount: 1, steps: parseIntervalDsl('1x\nwork 200m ±10% @ >45km/h').steps },
  ]

  for (const manifest of cases) {
    const text = stringifyIntervalDsl(manifest)
    const reparsed = parseIntervalDsl(text)
    assert.deepEqual(reparsed.errors, [])
    assert.equal(reparsed.repeatCount, manifest.repeatCount)
    assert.deepEqual(reparsed.steps, manifest.steps)

    // A second round-trip must reproduce identical text (stable serialisation).
    const text2 = stringifyIntervalDsl({ repeatCount: reparsed.repeatCount, steps: reparsed.steps })
    assert.equal(text2, text)
  }
})

test('parses heart-rate (bpm, %HRmax) and cadence (rpm) bands: range, min-only, max-only', () => {
  const cases = [
    ['150-165bpm', 'hr_bpm', 150, 165],
    ['<120bpm', 'hr_bpm', null, 120],
    ['>170bpm', 'hr_bpm', 170, null],
    ['80-90%HRmax', 'pct_hrmax', 80, 90],
    ['<70%HRmax', 'pct_hrmax', null, 70],
    ['>85%hrmax', 'pct_hrmax', 85, null],
    ['90-100rpm', 'cadence_rpm', 90, 100],
    ['<60rpm', 'cadence_rpm', null, 60],
    ['>110RPM', 'cadence_rpm', 110, null],
  ]
  for (const [band, bandType, min, max] of cases) {
    const { steps, errors } = parseIntervalDsl(`1x\nwork 5min ±10% @ ${band}`)
    assert.deepEqual(errors, [], band)
    assert.equal(steps[0].bandType, bandType, band)
    assert.equal(steps[0].powerMin, min, band)
    assert.equal(steps[0].powerMax, max, band)
    assert.equal(steps[0].bestMetric, null)
  }
})

test('hr/cadence band validation reuses min<max and non-negative rules', () => {
  assert.ok(parseIntervalDsl('1x\nwork 5min ±10% @ 165-150bpm').errors.length > 0)
  assert.ok(parseIntervalDsl('1x\nwork 5min ±10% @ 100-100rpm').errors.length > 0)
  assert.ok(parseIntervalDsl('1x\nwork 5min ±10% @ 150bpm').errors.length > 0)
})

test('hr/cadence bands round-trip through stringify canonically', () => {
  const src = '3x\nwork 10min ±10% @ 150-165bpm\nrecovery 5min ±30% @ <70%hrmax\nrecovery 1min ±30% @ >90RPM'
  const p = parseIntervalDsl(src)
  assert.deepEqual(p.errors, [])
  const text = stringifyIntervalDsl(p)
  assert.equal(text, '3x\nwork 10min ±10% @ 150-165bpm\nrecovery 5min ±30% @ <70%HRmax\nrecovery 1min ±30% @ >90rpm')
  assert.equal(stringifyIntervalDsl(parseIntervalDsl(text)), text)
})

// ---- warm-up / cool-down exclusion and multi-step blocks (issue #124) ----

test('parses warmup/cooldown lines (min/sec, hyphen variants, any position after repeat line)', () => {
  const p = parseIntervalDsl('3x\nwarmup 15min\nwork 10min ±10% @ 90-100%FTP\nCool-Down 90sec\nrecovery 5min ±30% @ <55%FTP')
  assert.deepEqual(p.errors, [])
  assert.equal(p.warmupSec, 900)
  assert.equal(p.cooldownSec, 90)
  assert.equal(p.steps.length, 2)
  assert.equal(parseIntervalDsl('1x\nwork 5min ±10% @ best').warmupSec, null)
})

test('warmup/cooldown validation: zero, duplicates, distance units', () => {
  assert.ok(parseIntervalDsl('1x\nwarmup 0min\nwork 5min ±10% @ best').errors.length > 0)
  assert.ok(parseIntervalDsl('1x\nwarmup 5min\nwarmup 6min\nwork 5min ±10% @ best').errors.length > 0)
  assert.ok(parseIntervalDsl('1x\ncooldown 5km\nwork 5min ±10% @ best').errors.length > 0)
  assert.ok(parseIntervalDsl('1x\nwarmup 5min').errors.length > 0) // still needs a work step
})

test('stringify emits warmup/cooldown canonically and round-trips; legacy output unchanged', () => {
  const p = parseIntervalDsl('2x\ncooldown 10min\nwarm-up 20min\nwork 5min ±10% @ best')
  const text = stringifyIntervalDsl(p)
  assert.equal(text, '2x\nwarmup 20min\ncooldown 10min\nwork 5min ±10% @ best')
  assert.equal(stringifyIntervalDsl(parseIntervalDsl(text)), text)
  const legacy = '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP'
  assert.equal(stringifyIntervalDsl(parseIntervalDsl(legacy)), legacy)
})

test('multi-step blocks: several work/recovery lines per repeat keep order and round-trip', () => {
  const src = '3x\nwork 2min ±10% @ 95-100%FTP\nwork 1min ±10% @ 105-110%FTP\nrecovery 3min ±30% @ <55%FTP'
  const p = parseIntervalDsl(src)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.steps.map((s) => s.role), ['work', 'work', 'recovery'])
  assert.equal(stringifyIntervalDsl(p), src)
})

test('buildIntervalManifest omits optional fields so legacy manifests are unchanged; manifestToDslInput inverts it', () => {
  const legacy = parseIntervalDsl('4x\nwork 3min ±30% @ 90-110%FTP')
  assert.deepEqual(buildIntervalManifest(legacy), { pattern: 'custom_intervals', repeat_count: 4, steps: legacy.steps })
  const p = parseIntervalDsl('4x\nwarmup 10min\ncooldown 5min\nwork 3min ±30% @ 90-110%FTP')
  const m = buildIntervalManifest(p)
  assert.equal(m.warmup_sec, 600)
  assert.equal(m.cooldown_sec, 300)
  assert.equal(stringifyIntervalDsl(manifestToDslInput(m)), stringifyIntervalDsl(p))
})

// ---- over-unders, pyramids, ramps: contiguous ("then") steps (issue #125) ----

test('"then" marks a step contiguous with the previous one; absent otherwise (legacy step shape unchanged)', () => {
  const p = parseIntervalDsl('4x\nwork 2min ±5% @ 95-100%FTP\nthen work 1min ±5% @ 105-110%FTP\nthen work 2min ±5% @ 95-100%FTP\nrecovery 4min ±30% @ <55%FTP')
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.steps.map((s) => s.contiguous), [undefined, true, true, undefined])
  assert.ok(!('contiguous' in p.steps[0]))
  assert.ok(!('contiguous' in parseIntervalDsl('1x\nwork 5min ±10% @ best').steps[0]))
})

test('"then" is rejected on the first step of a repeat and is case-insensitive elsewhere', () => {
  const bad = parseIntervalDsl('1x\nthen work 5min ±10% @ best')
  assert.equal(bad.errors.length, 1)
  assert.equal(bad.errors[0].line, 2)
  assert.deepEqual(parseIntervalDsl('1x\nwork 1min ±5% @ >100%FTP\nTHEN recovery 1min ±5% @ <55%FTP').errors, [])
})

test('over-unders, pyramid and ramp round-trip stably', () => {
  const cases = [
    '3x\nwork 2min ±5% @ 95-100%FTP\nthen work 1min ±5% @ 105-110%FTP\nthen work 2min ±5% @ 95-100%FTP\nrecovery 4min ±30% @ <55%FTP',
    '2x\nwork 1min ±5% @ 100-105%FTP\nthen work 2min ±5% @ 105-110%FTP\nthen work 3min ±5% @ 110-115%FTP\nthen work 2min ±5% @ 105-110%FTP\nthen work 1min ±5% @ 100-105%FTP\nrecovery 5min ±30% @ <55%FTP',
    '1x\nwork 1min ±5% @ 50-60%FTP\nthen work 1min ±5% @ 60-70%FTP\nthen work 1min ±5% @ 70-80%FTP\nthen work 1min ±5% @ >80%FTP',
  ]
  for (const src of cases) {
    const p = parseIntervalDsl(src)
    assert.deepEqual(p.errors, [])
    const text = stringifyIntervalDsl(p)
    assert.equal(text, src)
    assert.deepEqual(parseIntervalDsl(text).steps, p.steps)
  }
})

// ---- sets (issue #126) ----

test('sets: "3 sets of 5x" with set recovery parses and round-trips', () => {
  const src = '3 sets of 5x\nwork 30sec ±20% @ 120-140%FTP\nrecovery 30sec ±50% @ <55%FTP\nset recovery 5min ±30% @ <55%FTP'
  const p = parseIntervalDsl(src)
  assert.deepEqual(p.errors, [])
  assert.equal(p.setCount, 3)
  assert.equal(p.repeatCount, 5)
  assert.equal(p.steps.length, 2)
  assert.equal(p.setRecovery.targetDurationSec, 300)
  assert.equal(stringifyIntervalDsl(p), src)
  assert.equal(stringifyIntervalDsl(parseIntervalDsl(stringifyIntervalDsl(p))), src)
})

test('sets: set recovery is optional; "set of"/spacing variants normalise', () => {
  const p = parseIntervalDsl('2 set of 4X\nwork 1min ±10% @ best')
  assert.deepEqual(p.errors, [])
  assert.equal(p.setCount, 2)
  assert.equal(p.setRecovery, null)
  assert.equal(stringifyIntervalDsl(p), '2 sets of 4x\nwork 1min ±10% @ best')
})

test('sets: legacy documents are unaffected (no set fields, identical manifest)', () => {
  const p = parseIntervalDsl('4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP')
  assert.equal(p.setCount, null)
  assert.equal(p.setRecovery, null)
  const m = buildIntervalManifest(p)
  assert.deepEqual(Object.keys(m), ['pattern', 'repeat_count', 'steps'])
})

test('sets: validation errors', () => {
  assert.ok(parseIntervalDsl('0 sets of 3x\nwork 1min ±5% @ best').errors.length)
  assert.ok(parseIntervalDsl('3x\nwork 1min ±5% @ best\nset recovery 1min ±5% @ <55%FTP').errors.length)
  assert.ok(parseIntervalDsl('2 sets of 3x\nwork 1min ±5% @ best\nset work 1min ±5% @ best').errors.length)
  assert.ok(
    parseIntervalDsl('2 sets of 3x\nwork 1min ±5% @ best\nset recovery 1min ±5% @ <55%FTP\nset recovery 1min ±5% @ <55%FTP').errors.length
  )
})

test('sets: manifest builder/inverse round-trip', () => {
  const src = '2 sets of 3x\nwarmup 10min\nwork 1min ±5% @ 100-120%FTP\nset recovery 4min ±20% @ <55%FTP'
  const p = parseIntervalDsl(src)
  const m = buildIntervalManifest(p)
  assert.equal(m.set_count, 2)
  assert.equal(m.set_recovery.role, 'recovery')
  assert.equal(stringifyIntervalDsl(manifestToDslInput(m)), stringifyIntervalDsl(p))
})
