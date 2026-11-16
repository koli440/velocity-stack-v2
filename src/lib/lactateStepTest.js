// Lactate step test maths (docs/lab/lactate-step-test.md). Steps: { power (W), lactate (mmol/L), hr? (bpm) }.
const num = (v) => (v === '' || v == null ? NaN : Number(v))

/** Cleans raw form rows: numeric, valid, sorted by power. Returns { steps } or { error }. */
export function normalizeSteps(rows) {
  const steps = []
  for (const r of rows || []) {
    const power = num(r.power)
    const lactate = num(r.lactate)
    if (Number.isNaN(power) && Number.isNaN(lactate)) continue
    if (!(power >= 1 && power <= 2500)) return { error: 'Each step needs a power between 1 and 2500 W' }
    if (!(lactate >= 0 && lactate <= 30)) return { error: 'Each step needs a lactate between 0 and 30 mmol/L' }
    const hr = num(r.hr)
    if (!Number.isNaN(hr) && !(hr >= 20 && hr <= 260)) return { error: 'Heart rate must be between 20 and 260' }
    steps.push({ power: Math.round(power), lactate: Math.round(lactate * 100) / 100, hr: Number.isNaN(hr) ? null : Math.round(hr) })
  }
  if (steps.length < 3) return { error: 'Enter at least 3 steps' }
  if (steps.length > 20) return { error: 'At most 20 steps' }
  steps.sort((a, b) => a.power - b.power)
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].power === steps[i - 1].power) return { error: 'Step powers must be different' }
  }
  return { steps }
}

function lerp(a, b, t) { return a + (b - a) * t }

/** Power (and HR) where the lactate curve first reaches `level` (linear interpolation), or null. */
export function oblaAt(steps, level) {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].lactate >= level) {
      if (i === 0) return null
      const a = steps[i - 1]
      const b = steps[i]
      if (b.lactate === a.lactate) return null
      const t = (level - a.lactate) / (b.lactate - a.lactate)
      return { power: lerp(a.power, b.power, t), hr: a.hr != null && b.hr != null ? lerp(a.hr, b.hr, t) : null }
    }
  }
  return null
}

// Least squares polynomial fit (degree 3), x scaled to 0..1 for conditioning.
function polyFit(xs, ys, deg) {
  const n = deg + 1
  const m = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  for (let i = 0; i < xs.length; i++) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) m[r][c] += xs[i] ** (r + c)
      m[r][n] += ys[i] * xs[i] ** r
    }
  }
  for (let col = 0; col < n; col++) {
    let p = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[p][col])) p = r
    if (Math.abs(m[p][col]) < 1e-12) return null
    ;[m[col], m[p]] = [m[p], m[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col] / m[col][col]
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

const evalPoly = (co, x) => co.reduce((s, c, i) => s + c * x ** i, 0)

/** Dmax: point of the fitted curve furthest from the line between first and last step. */
export function dmax(steps) {
  if (steps.length < 4) return null
  const p0 = steps[0].power
  const span = steps[steps.length - 1].power - p0
  const xs = steps.map((s) => (s.power - p0) / span)
  const co = polyFit(xs, steps.map((s) => s.lactate), Math.min(3, steps.length - 1))
  if (!co) return null
  const y0 = evalPoly(co, 0)
  const slope = evalPoly(co, 1) - y0
  let best = null
  for (let i = 0; i <= 1000; i++) {
    const x = i / 1000
    const d = y0 + slope * x - evalPoly(co, x)
    if (best == null || d > best.d) best = { d, x }
  }
  if (!best || best.d <= 0 || best.x <= 0 || best.x >= 1) return null
  const power = p0 + best.x * span
  return { power, hr: hrAt(steps, power) }
}

function hrAt(steps, power) {
  const pts = steps.filter((s) => s.hr != null)
  if (pts.length < 2) return null
  for (let i = 1; i < pts.length; i++) {
    if (power <= pts[i].power) {
      const a = pts[i - 1]
      const b = pts[i]
      return lerp(a.hr, b.hr, Math.min(1, Math.max(0, (power - a.power) / (b.power - a.power))))
    }
  }
  return pts[pts.length - 1].hr
}

/** LT1: first step whose lactate exceeds the baseline (lowest value) by 0.5 mmol/L, interpolated. */
export function lt1Baseline(steps) {
  const base = Math.min(...steps.slice(0, 3).map((s) => s.lactate))
  const r = oblaAt(steps, base + 0.5)
  if (r) return r
  return null
}

const rnd = (r) => (r ? { power: Math.round(r.power), hr: r.hr == null ? null : Math.round(r.hr) } : null)

/** Computes all thresholds. Each is { power, hr } (HR may be null) or null when not reached. */
export function computeLactateResult(steps) {
  const lt1 = rnd(lt1Baseline(steps))
  const dm = rnd(dmax(steps))
  const o2 = rnd(oblaAt(steps, 2))
  const o4 = rnd(oblaAt(steps, 4))
  const lt2 = dm || o4
  return {
    lt1, lt2, lt2Method: dm ? 'dmax' : o4 ? 'obla4' : null,
    dmax: dm, obla2: o2, obla4: o4,
  }
}

/** Suggested threshold-history entry (validateLtEntry fields) from a result; null if nothing usable. */
export function ltEntryFromResult(result, date) {
  if (!result) return null
  const { lt1, lt2 } = result
  if (!lt1 && !lt2) return null
  const lt1Ok = lt1 && (!lt2 || lt1.power < lt2.power)
  return {
    effective_from: date,
    lt1_power_w: lt1Ok ? lt1.power : null,
    lt1_hr: lt1Ok ? lt1.hr : null,
    lt2_power_w: lt2 ? lt2.power : null,
    lt2_hr: lt2 ? lt2.hr : null,
  }
}
