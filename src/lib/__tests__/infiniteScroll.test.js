// Run with: node --test src/lib/__tests__/infiniteScroll.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAutoLoad, didLoadFail } from '../infiniteScroll.js'

const base = { hasMore: true, isLoadingMore: false, hasFailed: false, supported: true, inFlight: false }

test('canAutoLoad allows load in the happy path', () => {
  assert.equal(canAutoLoad(base), true)
})

test('canAutoLoad blocks when loading, in flight, failed, exhausted or unsupported', () => {
  assert.equal(canAutoLoad({ ...base, isLoadingMore: true }), false)
  assert.equal(canAutoLoad({ ...base, inFlight: true }), false)
  assert.equal(canAutoLoad({ ...base, hasFailed: true }), false)
  assert.equal(canAutoLoad({ ...base, hasMore: false }), false)
  assert.equal(canAutoLoad({ ...base, supported: false }), false)
  assert.equal(canAutoLoad({ ...base, hasHandler: false }), false)
})

test('didLoadFail detects empty results and throws', () => {
  assert.equal(didLoadFail({ prevCount: 10, nextCount: 20, hasMore: true }), false)
  assert.equal(didLoadFail({ prevCount: 10, nextCount: 10, hasMore: true }), true)
  assert.equal(didLoadFail({ prevCount: 10, nextCount: 10, hasMore: false }), false)
  assert.equal(didLoadFail({ prevCount: 10, nextCount: 10, hasMore: false, threw: true }), true)
})
