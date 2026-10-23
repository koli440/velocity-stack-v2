// Run with: node --test src/lib/__tests__/chartZoom.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pxToValue, resolveSelection, sliceRange } from '../chartZoom.js'

test('pxToValue maps and clamps', () => {
  assert.equal(pxToValue(50, 100, [0, 1000]), 500)
  assert.equal(pxToValue(-10, 100, [0, 1000]), 0)
  assert.equal(pxToValue(500, 100, [0, 1000]), 1000)
  assert.equal(pxToValue(5, 0, [0, 10]), null)
})

test('drag selects a range, either direction', () => {
  const a = resolveSelection({ startPx: 20, endPx: 60, width: 100, domain: [0, 1000] })
  assert.deepEqual(a, { type: 'zoom', range: [200, 600] })
  const b = resolveSelection({ startPx: 60, endPx: 20, width: 100, domain: [0, 1000] })
  assert.deepEqual(b, { type: 'zoom', range: [200, 600] })
})

test('click resets when zoomed, ignored otherwise', () => {
  const base = { startPx: 10, endPx: 12, width: 100, domain: [0, 100] }
  assert.equal(resolveSelection({ ...base, zoomed: true }).type, 'reset')
  assert.equal(resolveSelection({ ...base, zoomed: false }).type, 'ignore')
})

test('tiny ranges are ignored', () => {
  const r = resolveSelection({ startPx: 10, endPx: 15, width: 2000, domain: [0, 1000] })
  assert.equal(r.type, 'ignore')
})

test('zooming further uses the current domain', () => {
  const r = resolveSelection({ startPx: 0, endPx: 50, width: 100, domain: [200, 600], zoomed: true })
  assert.deepEqual(r, { type: 'zoom', range: [200, 400] })
})

test('sliceRange keeps neighbours at edges', () => {
  const data = [0, 10, 20, 30, 40, 50].map((x) => ({ x }))
  assert.deepEqual(sliceRange(data, [15, 35]).map((d) => d.x), [10, 20, 30, 40])
  assert.deepEqual(sliceRange(data, [20, 30]).map((d) => d.x), [20, 30])
  assert.equal(sliceRange(data, null), data)
  assert.deepEqual(sliceRange(data, [100, 200]), [])
})

import { clampRange, zoomBy, panBy } from '../chartZoom.js'

test('clampRange keeps width and stays inside domain', () => {
  assert.deepEqual(clampRange([-50, 50], [0, 1000]), [0, 100])
  assert.deepEqual(clampRange([950, 1050], [0, 1000]), [900, 1000])
  assert.deepEqual(clampRange([-5, 2000], [0, 1000]), [0, 1000])
})

test('zoomBy is centre-anchored, bounded, and resets at full width', () => {
  assert.deepEqual(zoomBy(null, [0, 1000], 2), [250, 750])
  assert.deepEqual(zoomBy([250, 750], [0, 1000], 2), [375, 625])
  assert.equal(zoomBy([250, 750], [0, 1000], 0.5), null)
  assert.deepEqual(zoomBy([0, 100], [0, 1000], 0.5), [0, 200])
  const tiny = zoomBy([400, 600], [0, 1000], 1e9)
  assert.ok(Math.abs(tiny[1] - tiny[0] - 10) < 1e-9)
})

test('panBy shifts by a fraction and clamps; no-op when unzoomed', () => {
  assert.equal(panBy(null, [0, 1000], 0.5), null)
  assert.deepEqual(panBy([100, 200], [0, 1000], 0.5), [150, 250])
  assert.deepEqual(panBy([100, 200], [0, 1000], -2), [0, 100])
  assert.deepEqual(panBy([850, 950], [0, 1000], 1), [900, 1000])
})
