// Efficiency and decoupling trend (docs/lab/decoupling.md): Pw:HR of the first vs second half of steady rides.
export const MIN_STEADY_SEC = 45 * 60
export const MAX_VARIABILITY_INDEX = 1.1
export const DECOUPLING_REFERENCE_PCT = 5
const MAX_GAP_SEC = 60
const MIN_COVERAGE = 0.9

const pos = (v) => (Number(v) > 0 ? Number(v) : 0)

// Rolling 30 s normalised power, as used for the variability index.
function normalizedPower(watts) {
  const win = 30
  if (watts.length < win) return null
  let sum = 0
  let acc = 0
  let n = 0
  for (let i = 0; i < watts.length; i++) {
    sum += pos(watts[i])
    if (i >= win) sum -= pos(watts[i - win])
    if (i >= win - 1) { acc += (sum / win) ** 4; n++ }
  }
  return n ? (acc / n) ** 0.25 : null
}

function halfStats(watts, hr, s, e) {
  let w = 0
  let h = 0
  let n = 0
  for (let i = s; i < e; i++) {
    const hv = pos(hr[i])
    if (hv > 0) { w += pos(watts[i]); h += hv; n++ }
  }
  return n ? { w: w / n, h: h / n } : null
}

/**
 * Decoupling of one ride. Qualifies when >= 45 min, with power and HR for >= 90 % of the time, no gap longer
 * than 60 s without HR, variability index < 1.10. Returns { durationSec, avgW, ef1, ef2, ef, decouplingPct,
 * variabilityIndex } or { skipped: reason }.
 */
export function rideDecoupling(watts, hr) {
  if (!Array.isArray(watts) || !Array.isArray(hr)) return { skipped: 'no power or heart rate' }
  const n = Math.min(watts.length, hr.length)
  if (n < MIN_STEADY_SEC) return { skipped: 'shorter than 45 min' }
  let covered = 0
  let gap = 0
  for (let i = 0; i < n; i++) {
    if (pos(hr[i]) > 0 && pos(watts[i]) > 0) { covered++; gap = 0 } else if (pos(hr[i]) <= 0 && ++gap > MAX_GAP_SEC) return { skipped: 'heart rate gap' }
  }
  if (covered / n < MIN_COVERAGE) return { skipped: 'too little power and heart rate data' }
  const ws = watts.slice(0, n)
  const np = normalizedPower(ws)
  const avg = ws.reduce((a, v) => a + pos(v), 0) / n
  const vi = np && avg ? np / avg : null
  if (vi == null || vi >= MAX_VARIABILITY_INDEX) return { skipped: 'not steady (variability index too high)' }
  const mid = Math.floor(n / 2)
  const a = halfStats(ws, hr, 0, mid)
  const b = halfStats(ws, hr, mid, n)
  if (!a || !b) return { skipped: 'no heart rate' }
  const ef1 = a.w / a.h
  const ef2 = b.w / b.h
  return {
    durationSec: n, avgW: Math.round(avg), variabilityIndex: Math.round(vi * 100) / 100,
    ef1: Math.round(ef1 * 100) / 100, ef2: Math.round(ef2 * 100) / 100,
    ef: Math.round(((ef1 + ef2) / 2) * 100) / 100,
    decouplingPct: Math.round(((ef1 - ef2) / ef1) * 1000) / 10,
  }
}

/** Qualifying rides ({ id, title, activity_date, watts, hr }) as a trend, oldest first. */
export function decouplingTrend(rides) {
  return (rides || [])
    .map((r) => ({ id: r.id, title: r.title, date: String(r.activity_date || '').slice(0, 10), result: rideDecoupling(r.watts, r.hr) }))
    .filter((r) => !r.result.skipped)
    .sort((a, b) => a.date.localeCompare(b.date))
}
