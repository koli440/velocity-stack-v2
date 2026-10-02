// Run with: node --test src/lib/__tests__/intervalDsl.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIntervalDsl, stringifyIntervalDsl } from '../intervalDsl.js'

test('parses a repeated %FTP-banded work/recovery template', () => {
  const { repeatCount, steps, errors } = parseIntervalDsl(
    '4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP'
  )
  assert.deepEqual(errors, [])
  assert.equal(repeatCount, 4)
  assert.equal(steps.length, 2)
  assert.deepEqual(steps[0], {
    role: 'work',
    targetDurationSec: 180,
    durationTolerancePct: 30,
    bandType: 'pct_ftp',
    powerMin: 90,
    powerMax: 110,
  })
  assert.deepEqual(steps[1], {
    role: 'recovery',
    targetDurationSec: 120,
    durationTolerancePct: 50,
    bandType: 'pct_ftp',
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
    targetDurationSec: 300,
    durationTolerancePct: 40,
    bandType: 'best',
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

test('stringify . parse round-trip is stable', () => {
  const cases = [
    { repeatCount: 4, steps: parseIntervalDsl('4x\nwork 3min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP').steps },
    { repeatCount: 1, steps: parseIntervalDsl('1x\nwork 5min ±40% @ best').steps },
    { repeatCount: 3, steps: parseIntervalDsl('3x\nwork 30sec ±20% @ 250-300W\nrecovery 90sec ±50% @ <150W').steps },
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
