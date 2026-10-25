// Run with: node --test src/lib/__tests__/pbChartDomain.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timeDomain, formatTimeTick } from '../pbChartDomain.js'

test('zooms around the data, not from 0', () => {
  const [lo, hi] = timeDomain([11.9, 12.3, 12.7])
  assert.ok(lo > 11 && lo <= 11.9)
  assert.ok(hi >= 12.7 && hi < 13.5)
})

test('single point and flat data get padding', () => {
  const [lo, hi] = timeDomain([12.5])
  assert.ok(lo < 12.5 && hi > 12.5)
  const flat = timeDomain([60, 60])
  assert.ok(flat[0] < 60 && flat[1] > 60)
})

test('longer times and empty input', () => {
  const [lo, hi] = timeDomain([62.4, 70.1, 65])
  assert.ok(lo <= 62.4 && hi >= 70.1 && lo > 50)
  assert.equal(timeDomain([]), null)
  assert.equal(timeDomain([NaN]), null)
})

test('never goes below zero', () => {
  assert.equal(timeDomain([0.05])[0], 0)
})

test('formatTimeTick', () => {
  assert.equal(formatTimeTick(12), '12.0')
  assert.equal(formatTimeTick(12.25), '12.25')
})
