import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeActivityBadges } from '../activityBadges.js'

const day = (i) => `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`
const kinds = (map, id) => (map.get(id) || []).map((b) => b.kind)

test('no badges without history for record/percentile badges', () => {
  const map = computeActivityBadges([{ id: 'a', activity_date: day(0), max_power_w: 900 }])
  assert.deepEqual(kinds(map, 'a'), [])
})

test('power record needs minimum prior activities', () => {
  const acts = [300, 310, 320, 400].map((w, i) => ({ id: `a${i}`, activity_date: day(i), max_power_w: w }))
  const map = computeActivityBadges(acts)
  assert.deepEqual(kinds(map, 'a2'), [])
  assert.deepEqual(kinds(map, 'a3'), ['POWER_RECORD'])
  assert.match(map.get('a3')[0].detail, /\+80 W/)
})

test('improvement vs previous session at +3%', () => {
  const acts = [
    { id: 'a', activity_date: day(0), avg_power_w: 200 },
    { id: 'b', activity_date: day(1), avg_power_w: 205 },
    { id: 'c', activity_date: day(2), avg_power_w: 215 },
  ]
  const map = computeActivityBadges(acts)
  assert.deepEqual(kinds(map, 'b'), [])
  assert.deepEqual(kinds(map, 'c'), ['IMPROVEMENT'])
})

test('hard session by intensity factor, independent of history', () => {
  const map = computeActivityBadges([{ id: 'a', activity_date: day(0), intensity_factor: 1.05 }])
  assert.deepEqual(kinds(map, 'a'), ['HARD_SESSION'])
})

test('long ride / big climb use prior top 10%', () => {
  const acts = Array.from({ length: 10 }, (_, i) => ({
    id: `a${i}`, activity_date: day(i), distance_m: 10000 + i * 100, elevation_gain_m: 100,
  }))
  acts.push({ id: 'big', activity_date: day(11), distance_m: 50000, elevation_gain_m: 500 })
  acts.push({ id: 'small', activity_date: day(12), distance_m: 5000, elevation_gain_m: 50 })
  const map = computeActivityBadges(acts)
  assert.deepEqual(kinds(map, 'big'), ['LONG_RIDE', 'BIG_CLIMB'])
  assert.deepEqual(kinds(map, 'small'), [])
})

test('PB badge from personal bests on the same day, track-aware', () => {
  const acts = [
    { id: 'a', activity_date: day(0), track_id: 't1' },
    { id: 'b', activity_date: day(1), track_id: 't1' },
  ]
  const pbs = [
    { achieved_date: '2026-01-01', track_id: 't1', discipline: '500m' },
    { achieved_date: '2026-01-02', track_id: 't2', discipline: '1km' },
  ]
  const map = computeActivityBadges(acts, pbs)
  assert.deepEqual(kinds(map, 'a'), ['PB'])
  assert.deepEqual(kinds(map, 'b'), [])
})

test('is order independent and sorted by priority', () => {
  const acts = [
    { id: 'z', activity_date: day(3), max_power_w: 500, intensity_factor: 1.1 },
    { id: 'a', activity_date: day(0), max_power_w: 300 },
    { id: 'b', activity_date: day(1), max_power_w: 310 },
    { id: 'c', activity_date: day(2), max_power_w: 320 },
  ]
  assert.deepEqual(kinds(computeActivityBadges(acts), 'z'), ['POWER_RECORD', 'HARD_SESSION'])
})

import { serializeBadges, hydrateBadges } from '../activityBadges.js'

test('power curve record needs prior curve activities and reports durations', () => {
  const acts = [
    { id: 'a', activity_date: day(0), power_curve: { '5s': 800, '5m': 300 } },
    { id: 'b', activity_date: day(1), power_curve: { '5s': 810, '5m': 310 } },
    { id: 'c', activity_date: day(2), power_curve: { '5s': 790, '5m': 305 } },
    { id: 'd', activity_date: day(3), power_curve: { '5s': 850, '5m': 300, '1h': 200 } },
    { id: 'e', activity_date: day(4), power_curve: { '5s': 840 } },
  ]
  const map = computeActivityBadges(acts)
  assert.deepEqual(kinds(map, 'c'), [])
  assert.deepEqual(kinds(map, 'd'), ['CURVE_RECORD'])
  assert.equal(map.get('d')[0].detail, '5 s +40 W')
  assert.deepEqual(kinds(map, 'e'), [])
})

test('session count and distance milestones', () => {
  const acts = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, activity_date: day(i), distance_m: 10000 }))
  const map = computeActivityBadges(acts)
  assert.deepEqual(kinds(map, 'a9'), ['MILESTONE'])
  assert.equal(map.get('a9')[0].detail, '10th session')
  // 100 km crossed on the 10th session too -> session milestone wins; check distance alone
  const longActs = [
    { id: 'x', activity_date: day(0), distance_m: 90000 },
    { id: 'y', activity_date: day(1), distance_m: 20000 },
  ]
  assert.equal(computeActivityBadges(longActs).get('y')[0].detail, '100 km total')
})

test('serialize/hydrate round trip drops unknown kinds', () => {
  const map = computeActivityBadges([{ id: 'a', activity_date: day(0), intensity_factor: 1.1 }])
  const stored = serializeBadges(map.get('a'))
  assert.deepEqual(Object.keys(stored[0]).sort(), ['detail', 'kind'])
  const hydrated = hydrateBadges([...stored, { kind: 'NOPE' }, null])
  assert.equal(hydrated.length, 1)
  assert.equal(hydrated[0].label, 'Hard session')
  assert.deepEqual(hydrateBadges(null), [])
})
