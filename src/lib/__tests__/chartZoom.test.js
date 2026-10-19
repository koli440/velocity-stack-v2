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
