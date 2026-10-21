import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveGears, primaryGear, validateGearConfig, removeGear, moveGear, assignSegment, gearAt,
  deriveSpeedWithSegments, summarizeSegments, expandSegments, gearForRange, withSegmentSpeed, nextGearId, toGearPayload,
} from '../gearSegments.js'
import { deriveSpeedFromCadence } from '../trackGearing.js'
import { effectiveRideType, rideTypeHasGear, rideTypeLabel } from '../rideType.js'

const G1 = { id: 'g1', chainring: 58, cog: 14, note: '' }
const G2 = { id: 'g2', chainring: 52, cog: 15, note: 'warmup' }

test('ride type: unset is road, only track has gear UI', () => {
  assert.equal(effectiveRideType(null), 'road')
  assert.equal(effectiveRideType(''), 'road')
  assert.equal(rideTypeHasGear(null), false)
  assert.equal(rideTypeHasGear('road'), false)
  assert.equal(rideTypeHasGear('track'), true)
  assert.equal(rideTypeLabel('track'), 'Track')
  assert.equal(rideTypeLabel('gravel'), 'gravel')
})

test('resolveGears falls back to the legacy chainring/cog as a virtual primary', () => {
  assert.deepEqual(resolveGears({ chainring: 58, cog: 14 }), [G1])
  assert.deepEqual(resolveGears({ chainring: null, cog: null }), [])
  assert.deepEqual(resolveGears({ gears: [G2, G1], chainring: 1, cog: 1 }).map((g) => g.id), ['g2', 'g1'])
  assert.deepEqual(primaryGear({ gears: [G2, G1] }), G2)
})

test('validateGearConfig mirrors the database rules', () => {
  assert.equal(validateGearConfig([G1, G2], [{ start_s: 0, end_s: 10, gear_id: 'g2' }]), null)
  assert.match(validateGearConfig([G1, { ...G1 }], []), /Duplicate/)
  assert.ok(validateGearConfig([{ ...G1, cog: 3 }], []))
  assert.ok(validateGearConfig([{ ...G1, cog: '' }], []))
  assert.match(validateGearConfig([G1], [{ start_s: 0, end_s: 10, gear_id: 'nope' }]), /unknown gear/)
  assert.match(validateGearConfig([G1, G2], [{ start_s: 0, end_s: 10, gear_id: 'g2' }, { start_s: 5, end_s: 20, gear_id: 'g2' }]), /overlap/)
  assert.ok(validateGearConfig([G1], [{ start_s: 10, end_s: 10, gear_id: 'g1' }]))
  assert.ok(validateGearConfig(Array.from({ length: 9 }, (_, i) => ({ ...G1, id: `x${i}` })), []))
  assert.ok(validateGearConfig([{ ...G1, note: 'x'.repeat(81) }], []))
})

test('assignSegment splits, trims, merges and clears for the primary gear', () => {
  let s = assignSegment([], 10, 50, 'g2', 'g1')
  assert.deepEqual(s, [{ start_s: 10, end_s: 50, gear_id: 'g2' }])
  s = assignSegment(s, 20, 30, 'g3', 'g1')
  assert.deepEqual(s.map((x) => [x.start_s, x.end_s, x.gear_id]), [[10, 20, 'g2'], [20, 30, 'g3'], [30, 50, 'g2']])
  s = assignSegment(s, 20, 30, 'g2', 'g1')
  assert.deepEqual(s, [{ start_s: 10, end_s: 50, gear_id: 'g2' }])
  s = assignSegment(s, 0, 100, 'g1', 'g1')
  assert.deepEqual(s, [])
})

test('removeGear drops its segments; moveGear changes the primary', () => {
  const r = removeGear([G1, G2], [{ start_s: 0, end_s: 5, gear_id: 'g2' }], 'g2')
  assert.deepEqual(r, { gears: [G1], segments: [] })
  assert.deepEqual(moveGear([G1, G2], 'g2', -1).map((g) => g.id), ['g2', 'g1'])
  assert.deepEqual(moveGear([G1, G2], 'g1', -1).map((g) => g.id), ['g1', 'g2'])
  assert.equal(nextGearId([G1, G2]), 'g3')
})

test('gearAt uses the segment gear and the primary elsewhere', () => {
  const segs = [{ start_s: 5, end_s: 10, gear_id: 'g2' }]
  assert.equal(gearAt(4, [G1, G2], segs).id, 'g1')
  assert.equal(gearAt(5, [G1, G2], segs).id, 'g2')
  assert.equal(gearAt(9, [G1, G2], segs).id, 'g2')
  assert.equal(gearAt(10, [G1, G2], segs).id, 'g1')
  assert.equal(gearAt(0, [], []), null)
})

test('derived speed: a single gear is identical to deriveSpeedFromCadence', () => {
  const cad = [0, 60, 90, 120, null, 85]
  assert.deepEqual(deriveSpeedWithSegments(cad, [G1], []), deriveSpeedFromCadence(cad, 58, 14))
  assert.deepEqual(deriveSpeedWithSegments(cad, [G1, G2], []), deriveSpeedFromCadence(cad, 58, 14))
})

test('derived speed uses the gear active at each moment', () => {
  const cad = [90, 90, 90, 90]
  const out = deriveSpeedWithSegments(cad, [G1, G2], [{ start_s: 2, end_s: 4, gear_id: 'g2' }])
  const a = deriveSpeedFromCadence(cad, 58, 14)
  const b = deriveSpeedFromCadence(cad, 52, 15)
  assert.deepEqual(out, [a[0], a[1], b[2], b[3]])
  assert.ok(b[2] < a[0])
})

test('summarizeSegments covers the whole ride with duration and averages', () => {
  const watts = [100, 100, 200, 200, 300, 300]
  const cadence = [80, 80, 100, 100, 0, 120]
  const speed = [30, 30, 40, 40, 50, 50]
  const out = summarizeSegments(6, [G1, G2], [{ start_s: 2, end_s: 4, gear_id: 'g2' }], { watts, cadence, speed })
  assert.deepEqual(out.map((r) => [r.start_s, r.end_s, r.gear_id, r.assigned]), [[0, 2, 'g1', false], [2, 4, 'g2', true], [4, 6, 'g1', false]])
  assert.equal(out[1].duration_s, 2)
  assert.equal(out[1].avg_power, 200)
  assert.equal(out[1].avg_cadence, 100)
  assert.equal(out[2].avg_cadence, 120)
  assert.equal(out[1].label, '52x15')
  assert.equal(out[1].note, 'warmup')
  assert.equal(summarizeSegments(6, [G1], [], {})[0].avg_power, null)
  assert.deepEqual(expandSegments(6, [], []), [])
})

test('gearForRange prefills from the dominant segment gear, primary otherwise', () => {
  const a = { gears: [G1, G2], gear_segments: [{ start_s: 100, end_s: 400, gear_id: 'g2' }] }
  assert.deepEqual(gearForRange(a, 150, 350), { chainring: 52, cog: 15 })
  assert.deepEqual(gearForRange(a, 0, 90), { chainring: 58, cog: 14 })
  assert.deepEqual(gearForRange(a), { chainring: 58, cog: 14 })
  assert.equal(gearForRange({ chainring: null, cog: null }, 0, 10), null)
  assert.deepEqual(gearForRange({ chainring: 50, cog: 15 }, 0, 10), { chainring: 50, cog: 15 })
})

test('toGearPayload normalises form strings and drops empty rows', () => {
  assert.deepEqual(toGearPayload([{ id: 'g1', chainring: '58', cog: '14', note: ' x ' }, { id: 'g2', chainring: '', cog: '' }]), [{ id: 'g1', chainring: 58, cog: 14, note: 'x' }])
})

test('withSegmentSpeed: single gear or road is untouched; segments recompute speed-dependent stats', () => {
  const cadence = Array(10).fill(90)
  const base = { ride_type: 'track', speed_source: 'derived_from_cadence', time_series: { cadence, speed: deriveSpeedFromCadence(cadence, 58, 14) }, avg_speed_kmh: 47.8, gears: [G1] }
  assert.equal(withSegmentSpeed(base).activity, base)
  assert.equal(withSegmentSpeed({ ...base, gears: [G1, G2], gear_segments: [] }).changed, false)
  assert.equal(withSegmentSpeed({ ...base, ride_type: 'road', gears: [G1, G2], gear_segments: [{ start_s: 0, end_s: 5, gear_id: 'g2' }] }).changed, false)
  assert.equal(withSegmentSpeed({ ...base, speed_source: 'sensor', gears: [G1, G2], gear_segments: [{ start_s: 0, end_s: 5, gear_id: 'g2' }] }).changed, false)
  const r = withSegmentSpeed({ ...base, gears: [G1, G2], gear_segments: [{ start_s: 0, end_s: 5, gear_id: 'g2' }] })
  assert.equal(r.changed, true)
  assert.ok(r.activity.avg_speed_kmh < 47.8)
  assert.equal(r.activity.time_series.speed[9], base.time_series.speed[9])
  assert.ok(r.activity.time_series.speed[0] < base.time_series.speed[0])
  assert.equal(r.activity.moving_time_s, 10)
})
