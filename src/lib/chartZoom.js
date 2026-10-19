// Pure helpers for drag-to-zoom on the activity stream charts.

export const MIN_DRAG_PX = 4
export const MIN_RANGE_FRACTION = 0.01

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Convert a pixel offset inside the plot area to a value on the (current) x domain.
export function pxToValue(px, width, domain) {
  if (!(width > 0) || !domain) return null
  const [lo, hi] = domain
  return lo + (clamp(px, 0, width) / width) * (hi - lo)
}

// Decide what a pointer drag means.
// Returns { type: 'zoom', range: [a, b] } | { type: 'reset' } | { type: 'ignore' }.
// A plain click (< MIN_DRAG_PX) resets when zoomed; a drag covering a tiny part of the
// current view is ignored.
export function resolveSelection({ startPx, endPx, width, domain, zoomed = false, minPx = MIN_DRAG_PX, minFraction = MIN_RANGE_FRACTION }) {
  if (!(width > 0) || !domain || !(domain[1] > domain[0])) return { type: 'ignore' }
  if (Math.abs(endPx - startPx) < minPx) return { type: zoomed ? 'reset' : 'ignore' }
  const a = pxToValue(Math.min(startPx, endPx), width, domain)
  const b = pxToValue(Math.max(startPx, endPx), width, domain)
  if ((b - a) / (domain[1] - domain[0]) < minFraction) return { type: 'ignore' }
  return { type: 'zoom', range: [a, b] }
}

// Points inside the range, plus one neighbour each side so lines reach the edges.
export function sliceRange(data, range) {
  if (!range || !data?.length) return data || []
  const [lo, hi] = range
  let first = data.findIndex((d) => d.x >= lo)
  if (first === -1) return []
  let last = data.length - 1
  while (last > first && data[last].x > hi) last--
  if (data[last].x < hi && last < data.length - 1) last++
  if (data[first].x > lo && first > 0) first--
  return data.slice(first, last + 1)
}
