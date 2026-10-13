import test from 'node:test'
import assert from 'node:assert/strict'
import { createRng } from '../prng.mjs'
import { PERSONAS } from '../personas.mjs'
import { generateRide, decideRide, fitnessFactor } from '../generate-ride.mjs'
import { best200m } from '../lib.mjs'

test('rng is deterministic per seed', () => {
  assert.equal(createRng('a').next(), createRng('a').next())
  assert.notEqual(createRng('a').next(), createRng('b').next())
})

test('ride decision and content are deterministic', () => {
  for (const p of PERSONAS) {
    const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    const a = dates.map((d) => generateRide(p, d))
    const b = dates.map((d) => generateRide(p, d))
    assert.deepEqual(a.map((r) => r && r.records.length), b.map((r) => r && r.records.length))
    assert.ok(a.some((r) => r), `${p.key} rides at least once in 14 days`)
    assert.ok(a.some((r) => !r), `${p.key} rests at least once in 14 days`)
    assert.equal(decideRide(p, dates[0]), a[0] !== null)
  }
})

test('records are physically plausible', () => {
  const p = PERSONAS[0]
  let ride = null
  for (let d = 1; d < 29 && !ride; d++) ride = generateRide(p, `2026-10-${String(d).padStart(2, '0')}`)
  assert.ok(ride.records.length > 600)
  for (const r of ride.records) {
    assert.ok(r.power >= 0 && r.power <= p.peakPower * 1.5)
    assert.ok(r.cadence >= 0 && r.cadence <= p.cadenceCap)
    assert.ok(r.speedMs >= 0 && r.speedMs < 25)
  }
  const last = ride.records.at(-1)
  assert.ok(last.distance > 3000)
  assert.ok(best200m(ride.records).sec > 8)
})

test('fitness trend follows weeklyGain', () => {
  const p = { ...PERSONAS[2], key: 'trendtest' }
  const early = Array.from({ length: 30 }, (_, i) => fitnessFactor(p, `2026-02-${String(i % 28 + 1).padStart(2, '0')}`))
  const late = Array.from({ length: 30 }, (_, i) => fitnessFactor(p, `2026-10-${String(i % 28 + 1).padStart(2, '0')}`))
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length
  assert.ok(avg(late) > avg(early))
})
