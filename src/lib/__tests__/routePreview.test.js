import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRoutePreview, simplifyPoints, ROUTE_PREVIEW_SIZE } from '../routePreview.js'

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
