// Y-axis helpers for the PB Vault time chart: zoom to the data instead of starting at 0.

const MIN_PAD_S = 0.1
const PAD_FRACTION = 0.15

// Returns a "nice" [lo, hi] domain (rounded to 0.1s steps, or 1s for long times) or null.
export function timeDomain(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v))
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const pad = Math.max((max - min) * PAD_FRACTION, MIN_PAD_S)
  const step = max - min + 2 * pad > 20 ? 1 : 0.1
  const round = (v, fn) => Number((fn(v / step) * step).toFixed(2))
  const lo = Math.max(0, round(min - pad, Math.floor))
  const hi = round(max + pad, Math.ceil)
  return [lo, hi]
}

export function formatTimeTick(v) {
  return Number.isInteger(v) ? v.toFixed(1) : String(Number(v.toFixed(2)))
}
