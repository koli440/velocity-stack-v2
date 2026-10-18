// Pure logic for the planned-workout preview chart: turns a parsed DSL manifest (parseIntervalDsl /
// buildIntervalManifest output, nothing new in the DSL) into time/power segments, scales %FTP to watts with the
// rider's FTP and computes axis ticks. Rendering lives in src/components/WorkoutPreviewChart.js.

// Display conventions where the DSL has no target: warm-up / cool-down are drawn as ramps, steps without a
// usable power band get a role default (marked `approx`).
export const WARMUP_RAMP = Object.freeze([0.4, 0.65])
export const COOLDOWN_RAMP = Object.freeze([0.6, 0.4])
export const DEFAULT_LEVEL = Object.freeze({ work: 0.85, recovery: 0.5 })
// Upper bound (fraction of FTP) of power zones Z1..Z7 for `zone` bands (display approximation).
const ZONE_UPPER = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5, 2]
const ZONE_LOWER = [0, 0.55, 0.75, 0.9, 1.05, 1.2, 1.5]

const clampZone = (z) => Math.min(7, Math.max(1, Math.round(z)))

/** { lo, hi } as FTP fractions (lo may equal hi), or null when the band has no power meaning. */
function bandFractions(step, ftp) {
  const { bandType: t, powerMin: a, powerMax: b } = step
  if (t === 'pct_ftp' || t === 'watts') {
    if (a == null && b == null) return null
    let lo = a ?? b
    let hi = b ?? a
    if (a != null && b == null) hi = lo // ">x": draw at x
    if (t === 'watts') {
      if (!ftp) return null
      lo /= ftp
      hi /= ftp
    } else {
      lo /= 100
      hi /= 100
    }
    // "<x" has no lower bound: draw the whole block up to x
    return { lo: a == null ? 0 : lo, hi }
  }
  if (t === 'zone' && (a != null || b != null)) {
    const zl = clampZone(a ?? 1)
    const zh = clampZone(b ?? a)
    return { lo: ZONE_LOWER[zl - 1], hi: ZONE_UPPER[zh - 1] }
  }
  return null
}

function segmentFor(step, startS, ftp, role) {
  const dur = step.keyBy !== 'distance' ? Number(step.targetDurationSec) || 0 : 0
  const frac = bandFractions(step, ftp)
  const f = frac || { lo: DEFAULT_LEVEL[step.role] ?? 0.6, hi: DEFAULT_LEVEL[step.role] ?? 0.6 }
  return { role, startS, endS: startS + dur, lo: f.lo, hi: f.hi, approx: !frac, label: step.label || null }
}

/**
 * Segments for a manifest: warm-up, (sets x reps x steps, set recovery between sets), cool-down.
 * Returns { segments, durationS, untimed, partial, maxFraction, ftp, unit }.
 * Distance-keyed steps cannot be placed on a time axis: they are skipped, counted in `untimed` and set `partial`
 * (the same flag the structure summary uses). Heights are FTP fractions; `unit` is 'w' when `ftp` is known,
 * else 'pct' (axis in %FTP). Each segment: { role: warmup|work|recovery|setRecovery|cooldown, startS, endS, lo, hi,
 * approx, ramp? } where lo..hi is the band (hi = block height, lo..hi drawn lighter).
 */
export function buildPreview(manifest, { ftp = null } = {}) {
  const steps = Array.isArray(manifest?.steps) ? manifest.steps : []
  if (!steps.length) return null
  const ftpW = Number(ftp) > 0 ? Number(ftp) : null
  const reps = Math.max(1, Number(manifest.repeat_count) || 1)
  const sets = Math.max(1, Number(manifest.set_count) || 1)
  const segments = []
  let t = 0
  let untimed = 0
  const push = (seg) => {
    if (seg.endS > seg.startS) {
      segments.push(seg)
      t = seg.endS
    }
  }
  if (manifest.warmup_sec) push({ role: 'warmup', startS: t, endS: t + manifest.warmup_sec, lo: WARMUP_RAMP[0], hi: WARMUP_RAMP[1], ramp: WARMUP_RAMP, approx: true })
  for (let s = 0; s < sets; s++) {
    for (let r = 0; r < reps; r++) {
      for (const step of steps) {
        if (step.keyBy === 'distance' || !step.targetDurationSec) {
          if (step.keyBy === 'distance') untimed++
          continue
        }
        push(segmentFor(step, t, ftpW, step.role === 'recovery' ? 'recovery' : 'work'))
      }
    }
    const sr = manifest.set_recovery
    if (s < sets - 1 && sr?.targetDurationSec && sr.keyBy !== 'distance') push(segmentFor(sr, t, ftpW, 'setRecovery'))
  }
  if (manifest.cooldown_sec) push({ role: 'cooldown', startS: t, endS: t + manifest.cooldown_sec, lo: COOLDOWN_RAMP[1], hi: COOLDOWN_RAMP[0], ramp: COOLDOWN_RAMP, approx: true })
  if (!segments.length) return null
  const maxFraction = Math.max(...segments.map((g) => Math.max(g.hi, g.lo)))
  return { segments, durationS: t, untimed, partial: untimed > 0, maxFraction, ftp: ftpW, unit: ftpW ? 'w' : 'pct' }
}

/** Value (watts or %FTP, rounded) of an FTP fraction in the preview's unit. */
export const scalePower = (fraction, preview) => Math.round(fraction * (preview?.ftp || 100))

/** "1:05:00" / "8:20" */
export function formatElapsed(sec) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const TIME_STEPS = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
/** Elapsed-time ticks (seconds), at most ~`max` of them, starting at 0. */
export function timeTicks(durationS, max = 6) {
  if (!(durationS > 0)) return [0]
  const step = TIME_STEPS.find((s) => durationS / s <= max) || 7200
  const out = []
  for (let v = 0; v <= durationS; v += step) out.push(v)
  return out
}

/** "Nice" value ticks from 0 up to >= maxValue; returns { ticks, top }. */
export function valueTicks(maxValue, count = 4) {
  const m = Math.max(1, Number(maxValue) || 1)
  const raw = m / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) || 10 * pow
  const ticks = []
  for (let v = 0; v <= m + step * 0.999; v += step) {
    ticks.push(Math.round(v * 100) / 100)
    if (v >= m) break
  }
  return { ticks, top: ticks[ticks.length - 1] }
}

/** Colour class of a block by intensity (fraction of FTP), roughly the power zones. */
export function intensityColor(fraction) {
  if (fraction < 0.55) return '#94a3b8'
  if (fraction < 0.75) return '#22c55e'
  if (fraction < 0.9) return '#eab308'
  if (fraction < 1.05) return '#f97316'
  if (fraction < 1.2) return '#ef4444'
  return '#a855f7'
}

/** Screen-reader summary, e.g. "Workout preview: 1:05:00 total, 4 work blocks, peak 320 W; 2 distance steps not shown." */
export function previewSummaryText(preview) {
  if (!preview) return 'No workout preview'
  const work = preview.segments.filter((s) => s.role === 'work').length
  const peak = scalePower(preview.maxFraction, preview)
  const unit = preview.unit === 'w' ? 'W' : '% FTP'
  return `Workout preview: ${formatElapsed(preview.durationS)} total, ${work} work block${work === 1 ? '' : 's'}, peak ${peak} ${unit}${preview.partial ? `; ${preview.untimed} distance step${preview.untimed === 1 ? '' : 's'} not shown` : ''}.`
}
