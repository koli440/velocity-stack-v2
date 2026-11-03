import test from 'node:test'
import assert from 'node:assert/strict'
import { computeGymLoad, summarizeHistory, typicalGymHr, repImpliedIntensity, nameKey } from './gymLoad.js'

const set = (reps, weight_kg, extra = {}) => ({ set_type: 'active', kind: 'working', load_mode: 'weighted', reps, weight_kg, metrics: {}, ...extra })
const rep = (n, w, extra) => Array.from({ length: n }, () => set(w.reps, w.kg, extra))
const priorSquat = (id, kg, reps) => ({ activity_id: id, name: 'Back Squat', sets: [set(reps, kg)] })
const richHistory = summarizeHistory([priorSquat('a', 100, 5), priorSquat('b', 110, 5), priorSquat('c', 120, 3)])

test('nameKey matches the SQL normalisation', () => {
  assert.equal(nameKey('  Back   Squat '), 'back squat')
})

test('summarizeHistory counts distinct sessions and best e1RM, ignores warm-ups', () => {
  const h = summarizeHistory([
    priorSquat('a', 100, 5),
    { activity_id: 'a', name: 'back squat', sets: [set(1, 200, { kind: 'warmup' })] },
    priorSquat('b', 120, 3),
  ])
  assert.equal(h['back squat'].sessions, 2)
  assert.equal(h['back squat'].bestE1rm, 132)
})

test('rep-implied intensity follows Epley', () => {
  assert.ok(Math.abs(repImpliedIntensity(3) - 0.909) < 0.001)
  assert.ok(Math.abs(repImpliedIntensity(10) - 0.75) < 0.001)
})

test('heavy triples with history use history intensity', () => {
  const r = computeGymLoad({ exercises: [{ name: 'Back Squat', sets: rep(5, { reps: 3, kg: 130 }) }], durationS: 1800, history: richHistory })
  assert.equal(r.breakdown[0].source, 'history')
  assert.ok(r.breakdown[0].intensity > 0.85 && r.breakdown[0].intensity < 1.01)
  assert.ok(!r.flags.some((f) => f.startsWith('ceiling_intensity')))
  assert.equal(r.inputsUsed.rpe, false)
})

test('history needs at least 3 prior sessions, else rep ceiling', () => {
  const thin = summarizeHistory([priorSquat('a', 100, 5), priorSquat('b', 110, 5)])
  const r = computeGymLoad({ exercises: [{ name: 'Back Squat', sets: rep(4, { reps: 5, kg: 100 }) }], history: thin })
  assert.equal(r.breakdown[0].source, 'reps')
  assert.ok(r.flags.includes('ceiling_intensity:Back Squat'))
})

test('no history: light high-rep set is lower stress per rep than heavy triples', () => {
  const heavy = computeGymLoad({ exercises: [{ name: 'Press', sets: rep(4, { reps: 3, kg: 80 }) }] })
  const light = computeGymLoad({ exercises: [{ name: 'Press', sets: rep(4, { reps: 15, kg: 30 }) }] })
  assert.ok(heavy.breakdown[0].intensity > light.breakdown[0].intensity)
  assert.ok(light.load > 0)
})

test('fast sets lower the rep ceiling (velocity source); slow sets stay at the ceiling', () => {
  const fast = computeGymLoad({ exercises: [{ name: 'Squat', sets: rep(5, { reps: 3, kg: 60 }, { metrics: { mean_velocity_ms: 0.9, velocity_loss_pct: 8 } }) }] })
  const slow = computeGymLoad({ exercises: [{ name: 'Squat', sets: rep(5, { reps: 3, kg: 60 }, { metrics: { mean_velocity_ms: 0.3 } }) }] })
  const plain = computeGymLoad({ exercises: [{ name: 'Squat', sets: rep(5, { reps: 3, kg: 60 }) }] })
  assert.equal(fast.breakdown[0].source, 'velocity')
  assert.ok(fast.breakdown[0].intensity < plain.breakdown[0].intensity)
  assert.ok(fast.breakdown[0].intensity >= plain.breakdown[0].intensity - 0.15 - 1e-9)
  assert.equal(slow.breakdown[0].source, 'reps')
  assert.equal(slow.load, plain.load)
})

test('velocity loss is a flag, not load', () => {
  const a = computeGymLoad({ exercises: [{ name: 'Squat', sets: rep(3, { reps: 5, kg: 80 }, { metrics: { velocity_loss_pct: 35 } }) }] })
  const b = computeGymLoad({ exercises: [{ name: 'Squat', sets: rep(3, { reps: 5, kg: 80 }) }] })
  assert.ok(a.flags.includes('velocity_loss_high:Squat'))
  assert.equal(a.load, b.load)
})

test('warm-ups are excluded', () => {
  const r = computeGymLoad({ exercises: [{ name: 'Squat', sets: [set(5, 40, { kind: 'warmup' }), set(5, 100)] }] })
  assert.equal(r.breakdown[0].workingSets, 1)
})

test('no weights / bodyweight / jumps get fixed low-moderate stress', () => {
  const r = computeGymLoad({ exercises: [
    { name: 'Box Jump', sets: rep(3, { reps: 5, kg: null }) },
    { name: 'Push-up', sets: rep(3, { reps: 10, kg: 20 }, { load_mode: 'bodyweight' }) },
  ] })
  assert.deepEqual(r.breakdown.map((b) => b.source), ['dynamic', 'dynamic'])
  assert.equal(r.breakdown[0].stress, 3 * 5 * 0.25)
  assert.ok(r.flags.includes('dynamic_sets_fixed_stress'))
})

test('typical hard ~60 min strength session lands roughly TSS-comparable (45-75)', () => {
  const ex = ['Squat', 'Deadlift', 'Bench', 'Row', 'Press'].map((name) => ({ name, sets: rep(4, { reps: 6, kg: 80 }) }))
  const r = computeGymLoad({ exercises: ex, durationS: 3600 })
  assert.ok(r.load >= 45 && r.load <= 75, `load ${r.load}`)
})

test('HR multiplier: clamped tie-breaker, skipped without reference or HR', () => {
  const exercises = [{ name: 'Squat', sets: rep(4, { reps: 6, kg: 80 }) }]
  const base = computeGymLoad({ exercises })
  const high = computeGymLoad({ exercises, avgHr: 200, typicalHr: 100 })
  const low = computeGymLoad({ exercises, avgHr: 50, typicalHr: 120 })
  const same = computeGymLoad({ exercises, avgHr: 110, typicalHr: 110 })
  assert.equal(high.inputsUsed.hrMultiplier, 1.12)
  assert.equal(low.inputsUsed.hrMultiplier, 0.88)
  assert.equal(same.load, base.load)
  assert.ok(computeGymLoad({ exercises, avgHr: 120 }).flags.includes('hr_skipped_no_reference'))
  assert.equal(base.inputsUsed.hr, false)
})

test('typicalGymHr needs 3 prior values and returns the median', () => {
  assert.equal(typicalGymHr([100, 110]), null)
  assert.equal(typicalGymHr([100, 140, 110, null]), 110)
})

test('density multiplier is clamped and rest is summed', () => {
  const exercises = [{ name: 'Squat', sets: [set(5, 100, { rest_s: 120 }), { set_type: 'rest', duration_s: 60 }, set(5, 100)] }]
  const dense = computeGymLoad({ exercises, durationS: 300 })
  assert.equal(dense.density.multiplier, 1.15)
  assert.equal(dense.density.restS, 180)
  const sparse = computeGymLoad({ exercises, durationS: 7200 })
  assert.equal(sparse.density.multiplier, 0.85)
})

test('empty or unusable sessions give zero load and a flag', () => {
  const r = computeGymLoad({ exercises: [{ name: 'Squat', sets: [set(null, 100)] }] })
  assert.equal(r.load, 0)
  assert.ok(r.flags.includes('no_working_sets'))
})
