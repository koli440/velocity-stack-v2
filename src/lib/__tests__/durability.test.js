import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secondAtWork, computeDurability, durabilityRating, durabilityTrend } from '../durability.js'

const rep = (w, n) => new Array(n).fill(w)
// 300 s at 350 W (105 kJ), then 200 W until 2000 kJ is reached, then 300 s at `late` W
const ride = (late, ride2h = true) => [...rep(350, 300), ...rep(200, 9500), ...rep(150, ride2h ? 600 : 0), ...rep(late, 300)]

test('secondAtWork finds the 2000 kJ point', () => {
  assert.equal(secondAtWork(rep(200, 20000), 2000), 9999)
  assert.equal(secondAtWork(rep(100, 10), 2000), -1)
  assert.equal(secondAtWork(null), -1)
})

test('fresh vs fatigued drop', () => {
  const r = computeDurability(ride(315))
  assert.equal(r.freshW, 350)
  assert.equal(r.fatiguedW, 315)
  assert.equal(r.dropPct, 10)
})

test('null when threshold is never reached or no fatigued window', () => {
  assert.equal(computeDurability(rep(200, 3000)), null)
  assert.equal(computeDurability(rep(200, 10010)), null)
})

test('rating bands and trend ordering', () => {
  assert.equal(durabilityRating(1), 'Excellent')
  assert.equal(durabilityRating(5), 'Good')
  assert.equal(durabilityRating(8), 'Fair')
  assert.equal(durabilityRating(12), 'Needs work')
  const t = durabilityTrend([
    { id: 'a', activity_date: '2027-01-01T08:00', watts: ride(330) },
    { id: 'b', activity_date: '2027-02-01T08:00', watts: ride(340) },
    { id: 'c', activity_date: '2027-03-01', watts: rep(200, 100) },
  ])
  assert.deepEqual(t.map((x) => x.id), ['b', 'a'])
})
