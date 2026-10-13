// Tile-less route thumbnail for the activity feed (issue #49).
// Projects GPS points into a square viewbox and simplifies them so the feed can
// render an inline SVG polyline without Leaflet or map tiles.

import { applyPrivacyZone } from './privacyZone.js'

export const ROUTE_PREVIEW_SIZE = 100
const PADDING = 8

function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy)
}

// Iterative Douglas-Peucker (avoids recursion depth issues on long routes).
export function simplifyPoints(points, tolerance) {
  if (points.length < 3) return points.slice()
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxDist = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last])
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * @param {number[]} latitude
 * @param {number[]} longitude
 * @param {{ maxPoints?: number }} [options]
 * @returns {{ points: Array<[number, number]>, start: [number, number], end: [number, number] } | null}
 */
export function buildRoutePreview(latitude, longitude, { maxPoints = 60 } = {}) {
  if (!Array.isArray(latitude) || !Array.isArray(longitude)) return null

  const valid = []
  const len = Math.min(latitude.length, longitude.length)
  for (let i = 0; i < len; i++) {
    const lat = latitude[i]
    const lng = longitude[i]
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      (lat !== 0 || lng !== 0) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      valid.push([lat, lng])
    }
  }
  if (valid.length < 2) return null

  const lats = valid.map((p) => p[0])
  const lngs = valid.map((p) => p[1])
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const midLat = (minLat + maxLat) / 2
  const lngScale = Math.cos((midLat * Math.PI) / 180)

  const width = (maxLng - minLng) * lngScale
  const height = maxLat - minLat
  const span = Math.max(width, height)
  if (span === 0) return null

  const inner = ROUTE_PREVIEW_SIZE - PADDING * 2
  const scale = inner / span
  const offsetX = PADDING + (inner - width * scale) / 2
  const offsetY = PADDING + (inner - height * scale) / 2

  const round = (n) => Math.round(n * 10) / 10
  const projected = valid.map(([lat, lng]) => [
    round(offsetX + (lng - minLng) * lngScale * scale),
    round(offsetY + (maxLat - lat) * scale),
  ])

  let tolerance = 0.3
  let simplified = simplifyPoints(projected, tolerance)
  while (simplified.length > maxPoints && tolerance < 20) {
    tolerance *= 1.5
    simplified = simplifyPoints(projected, tolerance)
  }

  return {
    points: simplified,
    start: simplified[0],
    end: simplified[simplified.length - 1],
  }
}

export function routePreviewToPath(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

const SPARKLINE_POINTS = 40

/**
 * Persisted feed preview for an activity's `time_series`.
 * - GPS route -> { kind: 'route', points }
 * - no GPS but power -> { kind: 'sparkline', values } (downsampled mean power, rounded)
 * - GPS samples inside `privacyZone` are dropped before the route is built
 * - nothing usable -> { kind: 'none' } (sentinel so backfill doesn't retry forever)
 */
export function buildFeedPreview(timeSeries = {}, privacyZone = null) {
  const { latitude, longitude } = applyPrivacyZone(timeSeries?.latitude, timeSeries?.longitude, privacyZone)
  const route = buildRoutePreview(latitude, longitude)
  if (route) return { kind: 'route', points: route.points }

  const watts = Array.isArray(timeSeries?.watts)
    ? timeSeries.watts.filter((w) => Number.isFinite(w))
    : []
  if (watts.length >= 10 && watts.some((w) => w > 0)) {
    const buckets = Math.min(SPARKLINE_POINTS, watts.length)
    const values = []
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor((b * watts.length) / buckets)
      const to = Math.max(from + 1, Math.floor(((b + 1) * watts.length) / buckets))
      let sum = 0
      for (let i = from; i < to; i++) sum += watts[i]
      values.push(Math.round(sum / (to - from)))
    }
    return { kind: 'sparkline', values }
  }

  return { kind: 'none' }
}

/** SVG polyline points for a sparkline within the preview viewbox. */
export function sparklineToPath(values) {
  if (!Array.isArray(values) || values.length < 2) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = (ROUTE_PREVIEW_SIZE - PADDING * 2) / (values.length - 1)
  return values
    .map((v, i) => {
      const x = Math.round((PADDING + i * step) * 10) / 10
      const y = Math.round((ROUTE_PREVIEW_SIZE - PADDING - ((v - min) / range) * (ROUTE_PREVIEW_SIZE - PADDING * 2)) * 10) / 10
      return `${x},${y}`
    })
    .join(' ')
}
