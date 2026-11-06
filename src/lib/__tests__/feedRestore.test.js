import test from 'node:test'
import assert from 'node:assert/strict'
import { scopeFromSearch, feedPath, buildSnapshot, parseSnapshot, pagesToLoad, SNAPSHOT_TTL_MS } from '../feedRestore.js'

test('scopeFromSearch reads the tab and defaults to mine', () => {
  assert.equal(scopeFromSearch('?scope=following'), 'following')
  assert.equal(scopeFromSearch('scope=following&x=1'), 'following')
  assert.equal(scopeFromSearch('?scope=bogus'), 'mine')
  assert.equal(scopeFromSearch(''), 'mine')
  assert.equal(scopeFromSearch(null), 'mine')
})

test('feedPath', () => {
  assert.equal(feedPath('following'), '/?scope=following')
  assert.equal(feedPath('mine'), '/')
})

test('snapshot roundtrip, staleness and garbage', () => {
  const raw = buildSnapshot({ count: 60, scrollY: 12345.6, now: 1000 })
  assert.deepEqual(parseSnapshot(raw, 2000), { count: 60, scrollY: 12346 })
  assert.equal(parseSnapshot(raw, 1000 + SNAPSHOT_TTL_MS + 1), null)
  assert.equal(parseSnapshot(raw, 500), null)
  assert.equal(parseSnapshot('nope'), null)
  assert.equal(parseSnapshot(null), null)
  assert.equal(parseSnapshot(buildSnapshot({ count: 0, scrollY: 0, now: 1 }), 2), null)
})

test('pagesToLoad', () => {
  assert.equal(pagesToLoad({ loaded: 20, target: 60, pageSize: 20 }), 2)
  assert.equal(pagesToLoad({ loaded: 20, target: 50, pageSize: 20 }), 2)
  assert.equal(pagesToLoad({ loaded: 60, target: 40, pageSize: 20 }), 0)
  assert.equal(pagesToLoad({ loaded: 0, target: 10, pageSize: 0 }), 0)
})
