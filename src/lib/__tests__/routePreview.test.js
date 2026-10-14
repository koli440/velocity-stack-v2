import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidRoutePoints, routePreviewToPath, buildRoutePreview, simplifyPoints, ROUTE_PREVIEW_SIZE } from '../routePreview.js'

test('returns null without enough valid points', () => {
  assert.equal(buildRoutePreview([], []), null)
  assert.equal(buildRoutePreview([1], [1]), null)
  assert.equal(buildRoutePreview([0, 0], [0, 0]), null)
  assert.equal(buildRoutePreview(null, undefined), null)
  assert.equal(buildRoutePreview([50, 50], [10, 10]), null)
})

test('projects an oval into the viewbox and caps points', () => {
  const lat = []
  const lng = []
  for (let i = 0; i < 2000; i++) {
    const a = (i / 2000) * Math.PI * 2
    lat.push(50 + Math.sin(a) * 0.001)
    lng.push(14 + Math.cos(a) * 0.002)
  }
  const preview = buildRoutePreview(lat, lng, { maxPoints: 60 })
  assert.ok(preview.points.length <= 60 && preview.points.length >= 8)
  for (const [x, y] of preview.points) {
    assert.ok(x >= 0 && x <= ROUTE_PREVIEW_SIZE && y >= 0 && y <= ROUTE_PREVIEW_SIZE)
  }
})

test('skips invalid coordinates', () => {
  const p = buildRoutePreview([0, 50, NaN, 50.01], [0, 14, 14, 14.01])
  assert.equal(p.points.length, 2)
})

test('simplifyPoints drops collinear points', () => {
  const out = simplifyPoints([[0, 0], [1, 1], [2, 2], [3, 3]], 0.1)
  assert.deepEqual(out, [[0, 0], [3, 3]])
})

import { buildFeedPreview, sparklineToPath } from '../routePreview.js'

test('buildFeedPreview prefers GPS route', () => {
  const p = buildFeedPreview({ latitude: [50, 50.01, 50.02], longitude: [14, 14.01, 14.0], watts: [100, 200] })
  assert.equal(p.kind, 'route')
  assert.ok(p.points.length >= 2)
})

test('buildFeedPreview falls back to a downsampled power sparkline', () => {
  const watts = Array.from({ length: 1000 }, (_, i) => (i % 100) * 3)
  const p = buildFeedPreview({ watts })
  assert.equal(p.kind, 'sparkline')
  assert.equal(p.values.length, 40)
  assert.ok(sparklineToPath(p.values).split(' ').length === 40)
})

test('buildFeedPreview returns a none sentinel when nothing is drawable', () => {
  assert.deepEqual(buildFeedPreview({}), { kind: 'none' })
  assert.deepEqual(buildFeedPreview({ watts: [0, 0, 0] }), { kind: 'none' })
  assert.deepEqual(buildFeedPreview(undefined), { kind: 'none' })
  assert.equal(sparklineToPath([1]), '')
})

test('malformed route points are rejected and never throw', () => {
  assert.equal(isValidRoutePoints([[1, 2], [3, 4]]), true)
  assert.equal(isValidRoutePoints([1, 2, 3, 4]), false) // flat array (old bot data)
  assert.equal(isValidRoutePoints([[1, 2], [3]]), false)
  assert.equal(isValidRoutePoints([[1, 'a'], [3, 4]]), false)
  assert.equal(isValidRoutePoints(null), false)
  assert.equal(routePreviewToPath([1, 2, [3, 4]]), '3,4')
  assert.equal(routePreviewToPath(undefined), '')
})
