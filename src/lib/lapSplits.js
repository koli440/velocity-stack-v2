// src/lib/lapSplits.js
//
// Track context for templates (issue #129): split an effort into laps of a
// fixed length using the 1 Hz speed stream (km/h). Distance is integrated per
// second and each lap boundary is interpolated inside its sample, so splits
// are not quantised to whole seconds. Only complete laps are reported.

const r2 = (n) => Math.round(n * 100) / 100

/**
 * @param {number[]} speed   speed stream in km/h
 * @param {number} start     first second of the effort (inclusive)
 * @param {number} end       end second (exclusive)
 * @param {number} lapLengthM
 * @returns {{lap_length_m: number, distance_m: number, lap_splits_sec: number[]} | null}
 *   null when lap length is invalid or the effort has no usable speed data.
 */
export function computeLapSplits(speed, start, end, lapLengthM) {
  if (!(lapLengthM > 0) || !Array.isArray(speed) || end <= start || speed.length < end) return null
  const seg = speed.slice(start, end)
  if (seg.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null

  const splits = []
  let cum = 0
  let nextBoundary = lapLengthM
  let lastCrossing = 0
  for (let i = 0; i < seg.length; i++) {
    const step = Math.max(0, seg[i]) / 3.6
    while (step > 0 && cum + step >= nextBoundary - 1e-9) {
      const crossing = i + (nextBoundary - cum) / step
      splits.push(r2(crossing - lastCrossing))
      lastCrossing = crossing
      nextBoundary += lapLengthM
    }
    cum += step
  }
  return { lap_length_m: lapLengthM, distance_m: Math.round(cum), lap_splits_sec: splits }
}

/** Summary over the laps of several efforts: fastest/slowest lap and their spread. */
export function lapSummary(lapSets) {
  const all = lapSets.flatMap((l) => l?.lap_splits_sec || [])
  if (!all.length) return { lap_count: 0, best_lap_sec: null, slowest_lap_sec: null, avg_lap_sec: null }
  return {
    lap_count: all.length,
    best_lap_sec: Math.min(...all),
    slowest_lap_sec: Math.max(...all),
    avg_lap_sec: r2(all.reduce((a, b) => a + b, 0) / all.length),
  }
}
