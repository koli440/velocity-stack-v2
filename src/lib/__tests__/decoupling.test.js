import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rideDecoupling, decouplingTrend } from '../decoupling.js'

const N = 3600
const steady = (w1, h1, w2, h2) => ({
  watts: [...new Array(N / 2).fill(w1), ...new Array(N / 2).fill(w2)],
  hr: [...new Array(N / 2).fill(h1), ...new Array(N / 2).fill(h2)],
})

test('decoupling of a steady ride', () => {
  const { watts, hr } = steady(200, 130, 200, 143)
  const r = rideDecoupling(watts, hr)
  assert.equal(r.decouplingPct, 9.1)
  assert.equal(r.ef1, 1.54)
  assert.equal(r.avgW, 200)
})

test('no drift gives 0 %', () => {
  const { watts, hr } = steady(200, 130, 200, 130)
  assert.equal(rideDecoupling(watts, hr).decouplingPct, 0)
})

test('skips short, gappy and variable rides', () => {
  assert.match(rideDecoupling(new Array(1000).fill(200), new Array(1000).fill(130)).skipped, /45/)
  const { watts, hr } = steady(200, 130, 200, 130)
  const gap = hr.slice(); for (let i = 100; i < 200; i++) gap[i] = 0
  assert.match(rideDecoupling(watts, gap).skipped, /gap/)
  const wild = watts.map((_, i) => (Math.floor(i / 60) % 2 ? 50 : 350))
  assert.match(rideDecoupling(wild, hr).skipped, /variability/)
  assert.ok(rideDecoupling(null, hr).skipped)
})

test('trend keeps qualifying rides oldest first', () => {
  const a = steady(200, 130, 200, 130)
  const t = decouplingTrend([
    { id: 'b', activity_date: '2027-02-01', ...a },
    { id: 'a', activity_date: '2027-01-01', ...a },
    { id: 'x', activity_date: '2027-03-01', watts: [], hr: [] },
  ])
  assert.deepEqual(t.map((r) => r.id), ['a', 'b'])
})
