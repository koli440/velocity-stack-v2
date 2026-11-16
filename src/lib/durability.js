// Durability test (docs/lab/durability.md): best 5 minute power fresh vs after ~2000 kJ of work in one ride.
import { bestWindow } from './thresholdEstimates.js'

export const DURABILITY_KJ = 2000
export const DURABILITY_WINDOW_SEC = 300

/** Second index at which cumulative work reaches `kj` (1 Hz watts), or -1. */
export function secondAtWork(watts, kj = DURABILITY_KJ) {
  if (!Array.isArray(watts)) return -1
  const target = kj * 1000
  let sum = 0
  for (let i = 0; i < watts.length; i++) {
    sum += Number(watts[i]) > 0 ? Number(watts[i]) : 0
    if (sum >= target) return i
  }
  return -1
}

/**
 * Fresh vs fatigued 5 minute power of one ride. Fresh = best 5 min before the work threshold,
 * fatigued = best 5 min after it. Returns null when the ride never reaches the threshold, or either part
 * is shorter than 5 minutes.
 */
export function computeDurability(watts, { kj = DURABILITY_KJ, windowSec = DURABILITY_WINDOW_SEC } = {}) {
  const cut = secondAtWork(watts, kj)
  if (cut < 0) return null
  const fresh = bestWindow(watts, 0, cut, windowSec)
  const tired = bestWindow(watts, cut, watts.length, windowSec)
  if (!fresh || !tired || !(fresh.avg > 0) || !(tired.avg > 0)) return null
  const freshW = Math.round(fresh.avg)
  const fatiguedW = Math.round(tired.avg)
  return {
    kj, cutSec: cut, freshW, fatiguedW,
    dropPct: Math.round(((freshW - fatiguedW) / freshW) * 1000) / 10,
  }
}

const BANDS = [[3, 'Excellent'], [6, 'Good'], [10, 'Fair']]
/** Rating of a drop %: under 3 excellent, 6 good, 10 fair, otherwise needs work. */
export function durabilityRating(dropPct) {
  for (const [limit, label] of BANDS) if (dropPct < limit) return label
  return 'Needs work'
}

/** Results for rides ({ id, title, activity_date, watts }) with a qualifying drop, newest first. */
export function durabilityTrend(rides) {
  return (rides || [])
    .map((r) => ({ id: r.id, title: r.title, date: String(r.activity_date || '').slice(0, 10), result: computeDurability(r.watts) }))
    .filter((r) => r.result)
    .sort((a, b) => b.date.localeCompare(a.date))
}
