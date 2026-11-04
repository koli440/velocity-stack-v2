// src/lib/thresholdEstimates.js
//
// Threshold-test estimates (issue #379, part of #119): FTP and lactate thresholds (LT1/LT2, power
// and heart rate) estimated from the work window a template detected. Pure functions over ~1 Hz
// streams, shared by the summary metrics (estimated_ftp, estimated_lt2_power, ...) and the UI.
//
// Every estimate reports its protocol, source window, assumptions and a confidence note, and
// sanity checks warn when the test does not look maximal or valid. Estimates are only ever
// proposals: applying them to the profile is a separate, confirmed, user-edited step.

export const FTP_PROTOCOLS = {
  '20min': { durationSec: 1200, factor: 0.95, label: '20 min test (best 20 min x 0.95)' },
  '8min': { durationSec: 480, factor: 0.9, label: '8 min test (best 8 min x 0.90)' },
  ramp: { durationSec: 60, factor: 0.75, label: 'Ramp test (best 1 min x 0.75)' },
  '30min': { durationSec: 1800, factor: 1, label: '30 min test (best 30 min x 1.0)' },
  '60min': { durationSec: 3600, factor: 1, label: '60 min test (best 60 min x 1.0)' },
}

export const STEADY_PROTOCOL = 'steady'
export const STEADY_MIN_SEC = 1800
export const STEADY_STEP_SEC = 300
export const DECOUPLING_LIMIT_PCT = 5

export const LT1_FALLBACK_POWER_FACTOR = 0.75
export const LT1_FALLBACK_HR_FACTOR = 0.85

/** Metric id -> the estimate it produces. */
export const ESTIMATE_METRICS = {
  estimated_ftp: { field: 'ftp', unit: 'W', label: 'Estimated FTP' },
  estimated_lt2_power: { field: 'lt2_power', unit: 'W', label: 'Estimated LT2 power' },
  estimated_lt2_hr: { field: 'lt2_hr', unit: 'bpm', label: 'Estimated LT2 heart rate' },
  estimated_lt1_power: { field: 'lt1_power', unit: 'W', label: 'Estimated LT1 power' },
  estimated_lt1_hr: { field: 'lt1_hr', unit: 'bpm', label: 'Estimated LT1 heart rate' },
}

export const ESTIMATE_METRIC_IDS = Object.keys(ESTIMATE_METRICS)

export function isEstimateMetric(id) {
  return Object.prototype.hasOwnProperty.call(ESTIMATE_METRICS, id)
}

/** Protocols whose HR gives an LT2 HR (an 8 min or ramp test is too short/steep for that). */
const HR_PROTOCOLS = ['20min', '30min', '60min']

/** Protocols a metric accepts; the first one is its default. */
export function protocolsFor(id) {
  switch (id) {
    case 'estimated_ftp':
    case 'estimated_lt2_power':
      return ['20min', '8min', 'ramp', '30min', '60min']
    case 'estimated_lt2_hr':
      return HR_PROTOCOLS
    case 'estimated_lt1_power':
      return [STEADY_PROTOCOL, '20min', '8min', 'ramp', '30min', '60min']
    case 'estimated_lt1_hr':
      return [STEADY_PROTOCOL, ...HR_PROTOCOLS]
    default:
      return []
  }
}

export function defaultProtocol(id) {
  return protocolsFor(id)[0] || null
}

export function protocolLabel(protocol) {
  if (protocol === STEADY_PROTOCOL) return 'Steady-state test (aerobic decoupling < 5%)'
  return FTP_PROTOCOLS[protocol]?.label || String(protocol)
}

const round = Math.round

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function meanOf(stream, s, e, positiveOnly = false) {
  let sum = 0
  let n = 0
  const end = Math.min(e, stream.length)
  for (let i = Math.max(0, s); i < end; i++) {
    const v = num(stream[i])
    if (v == null || (positiveOnly && v <= 0)) continue
    sum += v
    n++
  }
  return n ? sum / n : null
}

function coverage(stream, s, e) {
  if (!Array.isArray(stream) || e <= s) return 0
  let n = 0
  for (let i = s; i < Math.min(e, stream.length); i++) if (num(stream[i]) > 0) n++
  return n / (e - s)
}

/** Best average of `d` consecutive samples inside [s, e): { start, end, avg } or null. */
export function bestWindow(stream, s, e, d) {
  const end = Math.min(e, stream.length)
  if (!Array.isArray(stream) || d < 1 || end - s < d) return null
  let sum = 0
  for (let i = s; i < s + d; i++) sum += num(stream[i]) || 0
  let best = { start: s, sum }
  for (let i = s + d; i < end; i++) {
    sum += (num(stream[i]) || 0) - (num(stream[i - d]) || 0)
    if (sum > best.sum) best = { start: i - d + 1, sum }
  }
  return { start: best.start, end: best.start + d, avg: best.sum / d }
}

/** Power:HR decoupling % of a slice: relative drop of the second half's W/bpm vs the first's. */
export function decouplingPct(watts, hr, s, e) {
  if (!Array.isArray(watts) || !Array.isArray(hr) || e - s < 4) return null
  const mid = s + Math.floor((e - s) / 2)
  const ratio = (a, b) => {
    const w = meanOf(watts, a, b)
    const h = meanOf(hr, a, b, true)
    return w != null && h ? w / h : null
  }
  const first = ratio(s, mid)
  const second = ratio(mid, e)
  if (!first || second == null) return null
  return ((first - second) / first) * 100
}

function pacingPct(watts, s, e) {
  const mid = s + Math.floor((e - s) / 2)
  const first = meanOf(watts, s, mid)
  const second = meanOf(watts, mid, e)
  return first && second != null ? (second / first) * 100 : null
}

function blockCv(watts, s, e, blockSec) {
  const means = []
  for (let a = s; a + blockSec <= e; a += blockSec) {
    const m = meanOf(watts, a, a + blockSec)
    if (m != null) means.push(m)
  }
  if (means.length < 3) return null
  const avg = means.reduce((x, y) => x + y, 0) / means.length
  if (!avg) return null
  const variance = means.reduce((x, y) => x + (y - avg) ** 2, 0) / means.length
  return (Math.sqrt(variance) / avg) * 100
}

const W = (code, message, severity = 'warn') => ({ code, message, severity })

function windowInfo(start, end) {
  return { start_sec: start, end_sec: end, duration_sec: end - start }
}

function confidenceOf(warnings, fallback) {
  if (fallback) return 'low'
  const n = warnings.filter((w) => w.severity === 'warn').length
  return n === 0 ? 'high' : n === 1 ? 'medium' : 'low'
}

/** Sanity checks common to every maximal-effort test window. */
function maximalChecks(watts, hr, start, end, protocol, streamLength, wantsHr) {
  const warnings = []
  const isRamp = protocol === 'ramp'
  if (!isRamp) {
    const pace = pacingPct(watts, start, end)
    if (pace != null && (pace < 90 || pace > 110)) {
      warnings.push(W('uneven_pacing', `Pacing was very uneven (second half ${round(pace)}% of the first); the test may not have been a steady maximal effort.`))
    }
    let zeros = 0
    for (let i = start; i < end; i++) if (!(num(watts[i]) > 0)) zeros++
    if (zeros / (end - start) > 0.05) {
      warnings.push(W('coasting', `${round((zeros / (end - start)) * 100)}% of the window has no power (coasting or dropouts).`))
    }
  }
  const avg = meanOf(watts, start, end)
  if (avg != null && avg < 80) {
    warnings.push(W('low_power', `Average power of ${round(avg)} W is very low; this does not look like a maximal test.`))
  }
  if (start < 300 && !isRamp) {
    warnings.push(W('early_window', 'The test window starts within the first 5 minutes of the activity, so there was probably no warm-up.'))
  }
  if (end >= streamLength - 5 && !isRamp) {
    warnings.push(W('window_at_end', 'The test window runs to the very end of the recording; check that it was not cut off.', 'info'))
  }
  if (wantsHr) {
    const cov = coverage(hr, start, end)
    if (cov === 0) warnings.push(W('no_hr', 'No heart-rate data in the test window; heart-rate thresholds cannot be estimated.'))
    else if (cov < 0.9) warnings.push(W('partial_hr', `Heart rate is missing for ${round((1 - cov) * 100)}% of the test window.`))
    else {
      const mid = start + Math.floor((end - start) / 2)
      const h1 = meanOf(hr, start, mid, true)
      const h2 = meanOf(hr, mid, end, true)
      if (h1 && h2 && (h2 / h1 - 1) * 100 > 10) {
        warnings.push(W('hr_drift', `Heart rate rose ${round((h2 / h1 - 1) * 100)}% from the first to the second half; the average may overstate LT2 HR.`))
      }
    }
  }
  return warnings
}

function ftpFamily(protocol, streams, s, e) {
  const { watts, hr } = streams
  const spec = FTP_PROTOCOLS[protocol]
  const out = { window: null, assumptions: [], warnings: [], values: {} }
  if (!Array.isArray(watts) || !watts.length) {
    out.warnings.push(W('no_power', 'No power data in the test window.', 'error'))
    return out
  }
  const length = e - s
  if (length < spec.durationSec * 0.95) {
    out.warnings.push(W('too_short', `The detected window is ${round(length)} s; the ${protocol === 'ramp' ? 'ramp' : protocol} protocol needs at least ${round(spec.durationSec * 0.95)} s.`, 'error'))
    return out
  }
  const best = bestWindow(watts, s, e, Math.min(spec.durationSec, length))
  if (!best) {
    out.warnings.push(W('too_short', 'The detected window is too short for this protocol.', 'error'))
    return out
  }
  out.window = windowInfo(best.start, best.end)
  const ftp = round(best.avg * spec.factor)
  out.values.ftp = ftp
  out.values.lt2_power = ftp
  out.assumptions.push(
    `Best ${protocol === 'ramp' ? '1 min' : protocol} average ${round(best.avg)} W x ${spec.factor} = ${ftp} W.`,
    'LT2 power is taken to be about equal to FTP (an estimate, not a lactate measurement).'
  )
  out.warnings.push(...maximalChecks(watts, hr || [], best.start, best.end, protocol, watts.length, true))
  if (protocol === 'ramp') {
    if (best.start < s + (e - s) * 0.6) {
      out.warnings.push(W('ramp_peak_early', 'The best minute is not near the end of the ramp; the ramp may not have been taken to failure.'))
    }
  }
  if (HR_PROTOCOLS.includes(protocol)) {
    const hrStart = protocol === '30min' ? Math.max(best.start, best.end - 1200) : best.start
    const cov = coverage(hr || [], hrStart, best.end)
    if (cov >= 0.5) {
      out.values.lt2_hr = round(meanOf(hr, hrStart, best.end, true))
      out.assumptions.push(
        protocol === '30min'
          ? 'LT2 HR is the average heart rate of the last 20 min of the 30 min test (Friel style).'
          : 'LT2 HR is the average heart rate of the test window.'
      )
    }
  } else {
    out.warnings.push(W('hr_unsupported', 'An 8 min or ramp test does not give a reliable LT2 heart rate; use a 20 or 30 min test for that.', 'info'))
  }
  return out
}

function steadyFamily(streams, s, e) {
  const { watts, hr } = streams
  const out = { window: null, assumptions: [], warnings: [], values: {} }
  if (!Array.isArray(watts) || !watts.length) {
    out.warnings.push(W('no_power', 'No power data in the test window.', 'error'))
    return out
  }
  const length = e - s
  if (length < STEADY_MIN_SEC) {
    out.warnings.push(W('too_short', `The detected window is ${round(length / 60)} min; a steady-state LT1 test needs at least ${STEADY_MIN_SEC / 60} min (ideally 60-90).`, 'error'))
    return out
  }
  if (coverage(hr || [], s, e) < 0.5) {
    out.warnings.push(W('no_hr', 'No usable heart-rate data; aerobic decoupling cannot be computed, so LT1 cannot be estimated from this test.', 'error'))
    out.window = windowInfo(s, e)
    return out
  }
  const fullDecoupling = decouplingPct(watts, hr, s, e)
  const lengths = []
  for (let len = length; len > STEADY_MIN_SEC; len -= STEADY_STEP_SEC) lengths.push(len)
  lengths.push(STEADY_MIN_SEC)
  let found = null
  for (const len of lengths) {
    const d = decouplingPct(watts, hr, s, s + len)
    if (d != null && d < DECOUPLING_LIMIT_PCT) {
      found = { len, decoupling: d }
      break
    }
  }
  if (!found) {
    out.window = windowInfo(s, e)
    out.warnings.push(
      W('decoupling_high', `Aerobic decoupling was ${fullDecoupling == null ? 'not measurable' : `${round(fullDecoupling * 10) / 10}%`} (limit ${DECOUPLING_LIMIT_PCT}%), so the effort was above LT1. Repeat the test at a lower power.`)
    )
    return out
  }
  const end = s + found.len
  out.window = windowInfo(s, end)
  out.values.lt1_power = round(meanOf(watts, s, end))
  out.values.lt1_hr = round(meanOf(hr, s, end, true))
  out.assumptions.push(
    `LT1 is the average power over the longest ${round(found.len / 60)} min stretch with aerobic decoupling ${round(found.decoupling * 10) / 10}% (below ${DECOUPLING_LIMIT_PCT}%).`,
    'LT1 HR is the average heart rate of that stretch.'
  )
  if (found.len < length) {
    out.warnings.push(W('late_drift', `Decoupling exceeded ${DECOUPLING_LIMIT_PCT}% over the full ${round(length / 60)} min, so only the first ${round(found.len / 60)} min were used.`))
  }
  const cv = blockCv(watts, s, end, 300)
  if (cv != null && cv > 8) {
    out.warnings.push(W('not_steady', `Power varied ${round(cv * 10) / 10}% between 5 min blocks; a steady effort gives a more reliable LT1.`))
  }
  if (coverage(hr, s, end) < 0.9) out.warnings.push(W('partial_hr', 'Heart rate is missing for part of the test window.'))
  return out
}

/**
 * One estimate for a work window.
 * @param {string} id - estimated_ftp | estimated_lt2_power | estimated_lt2_hr | estimated_lt1_power | estimated_lt1_hr
 * @param {string|null} protocol - see protocolsFor(id); null = the metric's default
 * @param {{watts: number[], hr: number[]}} streams
 * @param {number} s - window start (sample index == seconds)
 * @param {number} e - window end (exclusive)
 * @returns {{id, field, unit, value: number|null, protocol, protocol_label, fallback, window, assumptions, warnings, confidence}|null}
 */
export function thresholdEstimate(id, protocol, streams, s, e) {
  const meta = ESTIMATE_METRICS[id]
  if (!meta) return null
  const proto = protocol || defaultProtocol(id)
  const isLt1 = meta.field.startsWith('lt1')
  let family
  let fallback = false
  let value = null
  if (proto === STEADY_PROTOCOL) {
    family = steadyFamily(streams, s, e)
    value = family.values[meta.field] ?? null
  } else if (FTP_PROTOCOLS[proto]) {
    family = ftpFamily(proto, streams, s, e)
    if (isLt1) {
      fallback = true
      const ftp = family.values.ftp
      if (meta.field === 'lt1_power' && ftp != null) value = round(ftp * LT1_FALLBACK_POWER_FACTOR)
      if (meta.field === 'lt1_hr' && family.values.lt2_hr != null) value = round(family.values.lt2_hr * LT1_FALLBACK_HR_FACTOR)
      if (value != null) {
        family.assumptions = [
          `FALLBACK estimate, not from a steady-state test: ${meta.field === 'lt1_power' ? `LT1 power ~ ${LT1_FALLBACK_POWER_FACTOR * 100}% of the estimated FTP` : `LT1 HR ~ ${LT1_FALLBACK_HR_FACTOR} x the estimated LT2 HR`}.`,
          ...family.assumptions,
        ]
        family.warnings.push(W('fallback', 'Fallback estimate: run the LT1 steady-state test (decoupling) for a measured value.', 'info'))
      }
    } else {
      value = family.values[meta.field] ?? null
    }
  } else {
    return null
  }
  const fatal = family.warnings.some((w) => w.severity === 'error')
  if (fatal) value = null
  if (value == null && !fatal && meta.unit === 'bpm' && !family.warnings.some((w) => w.code === 'no_hr' || w.code === 'hr_unsupported')) {
    family.warnings.push(W('no_hr', 'No usable heart-rate data in the test window.', 'error'))
  }
  return {
    id,
    field: meta.field,
    unit: meta.unit,
    label: meta.label,
    value,
    protocol: proto,
    protocol_label: protocolLabel(proto),
    fallback,
    window: family.window,
    assumptions: value == null ? [] : family.assumptions,
    warnings: family.warnings,
    confidence: value == null ? null : confidenceOf(family.warnings, fallback),
  }
}

/** Numeric value only (what the summary metrics store per effort). */
export function thresholdEstimateValue(id, protocol, streams, s, e) {
  return thresholdEstimate(id, protocol, streams, s, e)?.value ?? null
}

/**
 * Delta of an estimate vs the athlete's current profile value.
 * @returns {{current: number|null, delta: number|null, pct: number|null}}
 */
export function estimateDelta(estimate, current) {
  const cur = num(current)
  if (estimate == null || cur == null || cur <= 0) return { current: cur, delta: null, pct: null }
  const delta = round(estimate - cur)
  return { current: cur, delta, pct: round(((estimate - cur) / cur) * 1000) / 10 }
}
