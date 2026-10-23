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

// Keep a [lo, hi] range inside the full domain without changing its width (unless it is wider than the domain).
export function clampRange(range, domain) {
  const [dlo, dhi] = domain
  const width = range[1] - range[0]
  if (!(width < dhi - dlo)) return [dlo, dhi]
  const lo = clamp(range[0], dlo, dhi - width)
  return [lo, lo + width]
}

// Zoom around the centre of the current view. factor > 1 zooms in, < 1 zooms out.
// Returns null when the result is the full domain (i.e. "not zoomed").
export function zoomBy(range, domain, factor, minFraction = MIN_RANGE_FRACTION) {
  const [dlo, dhi] = domain
  const full = dhi - dlo
  if (!(full > 0) || !(factor > 0)) return range ? [...range] : null
  const cur = range || domain
  const centre = (cur[0] + cur[1]) / 2
  const width = clamp((cur[1] - cur[0]) / factor, full * minFraction, full)
  if (width >= full) return null
  return clampRange([centre - width / 2, centre + width / 2], domain)
}

// Pan by a fraction of the current view width (negative = left). No-op when not zoomed.
export function panBy(range, domain, fraction) {
  if (!range) return null
  const shift = (range[1] - range[0]) * fraction
  return clampRange([range[0] + shift, range[1] + shift], domain)
}
