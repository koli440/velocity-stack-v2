// src/lib/intervalDsl.js
//
// Parser/stringifier for VelocityStack's user-authorable interval DSL
// (issue #14 — Template Creator). Lets a user describe a generic interval
// structure (repeated work/recovery blocks, or a single one-shot pattern) as
// plain text instead of a JSON manifest, e.g.:
//
//   4x
//   work 3min ±30% @ 90-110%FTP
//   recovery 2min ±50% @ <55%FTP
//
// or a one-shot "find the single best window" pattern (no recovery line):
//
//   1x
//   work 5min ±40% @ best
//
// Steps can also be keyed by distance instead of duration (issue #43 — find
// the best power/speed interval for a given distance, e.g. a 4km Individual
// Pursuit or a 200m Flying Sprint), using `km`/`m` units in place of
// `min`/`sec`. Because a distance-keyed window has no inherent power vs.
// speed preference, the `best`/`max` keyword requires an explicit metric for
// those steps: `best power` or `best speed`. Duration-keyed steps keep the
// bare `best`/`max` (defaulting to power) for backward compatibility with
// templates saved before this distinction existed:
//
//   4x
//   work 1km ±5% @ best power
//
//   1x
//   work 200m ±10% @ best speed
//
// Bands can also target heart rate (`bpm`, `%HRmax`) or cadence (`rpm`):
//
//   3x
//   work 10min ±10% @ 150-165bpm
//   recovery 5min ±30% @ <70%HRmax
//
// Warm-up and cool-down can be excluded from the search (issue #124): the
// first/last N of the activity are ignored by the detector:
//
//   3x
//   warmup 15min
//   cooldown 10min
//   work 10min ±10% @ 90-100%FTP
//   recovery 5min ±30% @ <55%FTP
//
// Prefix a step with `then` to require it to start exactly where the previous
// step ended (issue #125) — for over-unders, pyramids and ramps, where the
// steps of a repeat are back-to-back with different targets:
//
//   4x
//   work 2min ±5% @ 95-100%FTP
//   then work 1min ±5% @ 105-110%FTP
//   then work 2min ±5% @ 95-100%FTP
//   recovery 4min ±30% @ <55%FTP
//
// A repeat may contain any number of work/recovery steps, matched in the
// order written (multi-step blocks).
//
// Sets (issue #126): `<S> sets of <N>x` repeats the block N times per set, S
// sets, with an optional `set recovery` line (same syntax as a step, no `then`)
// searched for between sets:
//
//   3 sets of 5x
//   work 30sec ±20% @ 120-140%FTP
//   recovery 30sec ±50% @ <55%FTP
//   set recovery 5min ±30% @ <55%FTP
//
// Summary metrics (issue #127): a `metrics` line selects extra figures computed
// per work effort and summarised for the run (see src/lib/summaryMetrics.js):
//
//   3x
//   work 10min ±10% @ 90-100%FTP
//   recovery 5min ±30% @ <55%FTP
//   metrics np, vi, hr_recovery(30sec), decoupling, dropoff, pacing
//
// Deliberately plain JS (no Node-only APIs) so it can run both server-side
// (API route validation) and client-side (live preview in the creator UI).

import { SUMMARY_METRIC_IDS } from './summaryMetrics.js'

const METRICS_LINE_RE = /^metrics\b\s*:?\s*(.*)$/i
const METRIC_TOKEN_RE = /^([a-z_]+)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*(min|sec|s)\s*\))?$/i
const REPEAT_LINE_RE = /^(?:(\d+)\s*sets?\s*of\s*)?(\d+)\s*x$/i
const STEP_LINE_RE = /^(then\s+|set\s+)?(work|recovery)\s+(\d+(?:\.\d+)?)\s*(min|sec|km|m)\s*±\s*(\d+(?:\.\d+)?)\s*%\s*@\s*(.+)$/i
const EXCLUDE_LINE_RE = /^(warm-?up|cool-?down)\s+(\d+(?:\.\d+)?)\s*(min|sec)$/i
const RANGE_BAND_RE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(%FTP|%HRmax|bpm|rpm|W|km\/h)$/i
const MAX_BAND_RE = /^<\s*(\d+(?:\.\d+)?)\s*(%FTP|%HRmax|bpm|rpm|W|km\/h)$/i
const MIN_BAND_RE = /^>\s*(\d+(?:\.\d+)?)\s*(%FTP|%HRmax|bpm|rpm|W|km\/h)$/i
const BEST_BAND_RE = /^(?:best|max)(?:\s+(power|speed))?$/i

export const BAND_SUFFIXES = {
  pct_ftp: '%FTP',
  watts: 'W',
  speed_kmh: 'km/h',
  pct_hrmax: '%HRmax',
  hr_bpm: 'bpm',
  cadence_rpm: 'rpm',
}

function bandTypeForSuffix(suffix) {
  const s = suffix.toUpperCase()
  if (s === 'W') return 'watts'
  if (s === 'KM/H') return 'speed_kmh'
  if (s === '%HRMAX') return 'pct_hrmax'
  if (s === 'BPM') return 'hr_bpm'
  if (s === 'RPM') return 'cadence_rpm'
  return 'pct_ftp'
}

/**
 * @param {string} bandText - the `@ <band>` portion of a step line, already trimmed.
 * @returns {{ bandType: 'pct_ftp'|'watts'|'speed_kmh'|'pct_hrmax'|'hr_bpm'|'cadence_rpm'|'best', bestMetric: 'power'|'speed'|null, powerMin: number|null, powerMax: number|null } | null}
 *   null when the band syntax is not recognised.
 */
function parseBand(bandText) {
  const text = bandText.trim()

  let m = text.match(BEST_BAND_RE)
  if (m) {
    return { bandType: 'best', bestMetric: m[1] ? m[1].toLowerCase() : null, powerMin: null, powerMax: null }
  }

  m = text.match(RANGE_BAND_RE)
  if (m) {
    const min = parseFloat(m[1])
    const max = parseFloat(m[2])
    return { bandType: bandTypeForSuffix(m[3]), bestMetric: null, powerMin: min, powerMax: max }
  }

  m = text.match(MAX_BAND_RE)
  if (m) {
    return { bandType: bandTypeForSuffix(m[2]), bestMetric: null, powerMin: null, powerMax: parseFloat(m[1]) }
  }

  m = text.match(MIN_BAND_RE)
  if (m) {
    return { bandType: bandTypeForSuffix(m[2]), bestMetric: null, powerMin: parseFloat(m[1]), powerMax: null }
  }

  return null
}

/**
 * Parse a full interval DSL document into a validated manifest.
 * @param {string} text
 * @returns {{
 *   repeatCount: number|null,                          // reps per set when setCount is set
 *   setCount: number|null,                             // "S sets of Nx"; null otherwise
 *   setRecovery: step|null,                            // "set recovery ..." line (role 'recovery')
 *   warmupSec: number|null, cooldownSec: number|null,  // excluded head/tail of the activity
 *   metrics: Array<{id: string, windowSec: number|null}>,  // selected summary metrics (issue #127)
 *   steps: Array<{role: 'work'|'recovery', keyBy: 'duration'|'distance', targetDurationSec: number|null, targetDistanceM: number|null, durationTolerancePct: number, contiguous?: true, bandType: 'pct_ftp'|'watts'|'speed_kmh'|'pct_hrmax'|'hr_bpm'|'cadence_rpm'|'best', bestMetric: 'power'|'speed'|null, powerMin: number|null, powerMax: number|null}>,
 *   errors: Array<{line: number, message: string}>
 * }}
 */
export function parseIntervalDsl(text) {
  const errors = []
  const steps = []
  let repeatCount = null
  let setCount = null
  let setRecovery = null
  let warmupSec = null
  let cooldownSec = null
  let metrics = []
  let sawMetricsLine = false

  const rawLines = (text || '').split(/\r\n|\r|\n/)
  let sawRepeatLine = false

  rawLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    const line = rawLine.trim()
    if (!line) return // blank lines are allowed as spacing

    if (!sawRepeatLine) {
      const m = line.match(REPEAT_LINE_RE)
      if (!m) {
        errors.push({ line: lineNo, message: `Expected a repeat count like "4x", "1x" or "3 sets of 5x", got "${line}".` })
        sawRepeatLine = true // avoid cascading "expected repeat line" errors
        return
      }
      repeatCount = parseInt(m[2], 10)
      if (!(repeatCount >= 1)) {
        errors.push({ line: lineNo, message: 'Repeat count must be 1 or greater.' })
      }
      if (m[1] != null) {
        setCount = parseInt(m[1], 10)
        if (!(setCount >= 1)) errors.push({ line: lineNo, message: 'Set count must be 1 or greater.' })
      }
      sawRepeatLine = true
      return
    }

    const ex = line.match(EXCLUDE_LINE_RE)
    if (ex) {
      const isWarmup = ex[1].toLowerCase().startsWith('warm')
      const sec = parseFloat(ex[2]) * (ex[3].toLowerCase() === 'min' ? 60 : 1)
      if (!(sec > 0)) {
        errors.push({ line: lineNo, message: `${isWarmup ? 'Warm-up' : 'Cool-down'} duration must be greater than 0.` })
      } else if ((isWarmup ? warmupSec : cooldownSec) != null) {
        errors.push({ line: lineNo, message: `Only one ${isWarmup ? 'warmup' : 'cooldown'} line is allowed.` })
      } else if (isWarmup) {
        warmupSec = sec
      } else {
        cooldownSec = sec
      }
      return
    }

    const mm = line.match(METRICS_LINE_RE)
    if (mm) {
      if (sawMetricsLine) {
        errors.push({ line: lineNo, message: 'Only one "metrics" line is allowed.' })
        return
      }
      sawMetricsLine = true
      const parsedMetrics = parseMetricsList(mm[1], lineNo, errors)
      metrics = parsedMetrics
      return
    }

    const m = line.match(STEP_LINE_RE)
    if (!m) {
      errors.push({
        line: lineNo,
        message:
          `Could not parse step line "${line}". Expected format: ` +
          '"[then] work|recovery <value><min|sec|km|m> ±<tolerance>% @ <band>" (or "warmup <n>min|sec" / "cooldown <n>min|sec").',
      })
      return
    }

    const [, prefixRaw, roleRaw, valueRaw, unitRaw, toleranceRaw, bandTextRaw] = m
    const role = roleRaw.toLowerCase()
    const isSetRecovery = Boolean(prefixRaw) && prefixRaw.trim().toLowerCase() === 'set'
    const contiguous = Boolean(prefixRaw) && !isSetRecovery
    if (isSetRecovery) {
      if (role !== 'recovery') {
        errors.push({ line: lineNo, message: '"set" can only prefix a recovery line: "set recovery <value> ±<tol>% @ <band>".' })
      } else if (setCount == null) {
        errors.push({ line: lineNo, message: '"set recovery" needs a first line like "3 sets of 5x".' })
      } else if (setRecovery) {
        errors.push({ line: lineNo, message: 'Only one "set recovery" line is allowed.' })
      }
    }
    if (contiguous && !steps.length) {
      errors.push({ line: lineNo, message: '"then" needs a preceding step in the same repeat; remove it from the first step.' })
    }
    const value = parseFloat(valueRaw)
    const unit = unitRaw.toLowerCase()
    const tolerance = parseFloat(toleranceRaw)
    const keyBy = unit === 'km' || unit === 'm' ? 'distance' : 'duration'
    const targetDurationSec = keyBy === 'duration' ? (unit === 'min' ? value * 60 : value) : null
    const targetDistanceM = keyBy === 'distance' ? (unit === 'km' ? value * 1000 : value) : null

    if (keyBy === 'duration' && !(targetDurationSec > 0)) {
      errors.push({ line: lineNo, message: 'Step duration must be greater than 0.' })
    }
    if (keyBy === 'distance' && !(targetDistanceM > 0)) {
      errors.push({ line: lineNo, message: 'Step distance must be greater than 0.' })
    }
    if (!(tolerance >= 0 && tolerance <= 100)) {
      errors.push({ line: lineNo, message: 'Tolerance must be between 0 and 100%.' })
    }

    const band = parseBand(bandTextRaw)
    let bestMetric = null
    if (!band) {
      errors.push({
        line: lineNo,
        message:
          `Unrecognised band "${bandTextRaw.trim()}". Expected "a-b%FTP", "<x%FTP", ">x%FTP", ` +
          'the same with "W", "km/h", "bpm", "%HRmax" or "rpm" instead of "%FTP", or "best"/"max" (with "power"/"speed" ' +
          'required on distance-keyed steps).',
      })
    } else if (band.bandType === 'best') {
      bestMetric = band.bestMetric
      if (!bestMetric) {
        if (keyBy === 'distance') {
          errors.push({
            line: lineNo,
            message: 'Distance-keyed steps require a metric for "best"/"max": use "best power" or "best speed".',
          })
        }
        bestMetric = 'power' // backward-compatible default for duration-keyed bare "best"/"max"
      }
    } else {
      if (band.powerMin != null && band.powerMin < 0) {
        errors.push({ line: lineNo, message: 'Band minimum must be >= 0.' })
      }
      if (band.powerMax != null && band.powerMax < 0) {
        errors.push({ line: lineNo, message: 'Band maximum must be >= 0.' })
      }
      if (band.powerMin != null && band.powerMax != null && band.powerMin >= band.powerMax) {
        errors.push({ line: lineNo, message: 'Band minimum must be less than its maximum.' })
      }
    }

    const stepObj = {
      role,
      keyBy,
      targetDurationSec,
      targetDistanceM,
      durationTolerancePct: tolerance,
      bandType: band ? band.bandType : null,
      bestMetric: band && band.bandType === 'best' ? bestMetric : null,
      powerMin: band ? band.powerMin : null,
      powerMax: band ? band.powerMax : null,
      ...(contiguous ? { contiguous: true } : {}),
    }
    if (isSetRecovery) {
      if (role === 'recovery' && !setRecovery) setRecovery = stepObj
    } else {
      steps.push(stepObj)
    }
  })

  if (!sawRepeatLine) {
    errors.push({ line: 1, message: 'Empty template: expected a repeat count line like "4x".' })
  }

  if (!steps.some((s) => s.role === 'work')) {
    errors.push({ line: rawLines.length || 1, message: 'Template must contain at least one "work" step.' })
  }

  return { repeatCount, setCount, setRecovery, steps, warmupSec, cooldownSec, metrics, errors }
}

function parseMetricsList(listText, lineNo, errors) {
  const out = []
  const tokens = listText.split(',').map((t) => t.trim()).filter(Boolean)
  if (!tokens.length) {
    errors.push({ line: lineNo, message: `"metrics" needs at least one metric. Available: ${SUMMARY_METRIC_IDS.join(', ')}.` })
    return out
  }
  for (const token of tokens) {
    const t = token.match(METRIC_TOKEN_RE)
    const id = t ? t[1].toLowerCase() : null
    if (!t || !SUMMARY_METRIC_IDS.includes(id)) {
      errors.push({ line: lineNo, message: `Unknown metric "${token}". Available: ${SUMMARY_METRIC_IDS.join(', ')}.` })
      continue
    }
    let windowSec = null
    if (t[2] != null) {
      if (id !== 'hr_recovery') {
        errors.push({ line: lineNo, message: `Metric "${id}" does not take a window; only hr_recovery(<n>sec) does.` })
        continue
      }
      windowSec = parseFloat(t[2]) * (t[3].toLowerCase() === 'min' ? 60 : 1)
      if (!(windowSec > 0)) {
        errors.push({ line: lineNo, message: 'HR recovery window must be greater than 0.' })
        continue
      }
    }
    if (out.some((m) => m.id === id && m.windowSec === windowSec)) {
      errors.push({ line: lineNo, message: `Metric "${id}" is listed twice.` })
      continue
    }
    out.push({ id, windowSec })
  }
  return out
}

function formatDuration(targetDurationSec) {
  if (targetDurationSec % 60 === 0 && targetDurationSec >= 60) {
    return `${targetDurationSec / 60}min`
  }
  return `${targetDurationSec}sec`
}

function formatDistance(targetDistanceM) {
  if (targetDistanceM % 1000 === 0 && targetDistanceM >= 1000) {
    return `${formatNumber(targetDistanceM / 1000)}km`
  }
  return `${formatNumber(targetDistanceM)}m`
}

function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function formatBand({ bandType, bestMetric, powerMin, powerMax, keyBy }) {
  if (bandType === 'best') {
    // Bare "best"/"max" is only unambiguous (defaults to power) for
    // duration-keyed steps; distance-keyed steps always spell out the metric.
    if (keyBy === 'distance' || bestMetric === 'speed') return `best ${bestMetric || 'power'}`
    return 'best'
  }
  const suffix = BAND_SUFFIXES[bandType] || '%FTP'
  if (powerMin != null && powerMax != null) return `${formatNumber(powerMin)}-${formatNumber(powerMax)}${suffix}`
  if (powerMax != null) return `<${formatNumber(powerMax)}${suffix}`
  if (powerMin != null) return `>${formatNumber(powerMin)}${suffix}`
  return suffix
}

/**
 * Render a parsed (or hand-built) manifest back into editable DSL text.
 * @param {{repeatCount: number, steps: Array}} manifest
 * @returns {string}
 */
export function stringifyIntervalDsl({ repeatCount, steps = [], warmupSec = null, cooldownSec = null, setCount = null, setRecovery = null, metrics = [] } = {}) {
  const lines = [setCount ? `${setCount} sets of ${repeatCount}x` : `${repeatCount}x`]
  if (warmupSec) lines.push(`warmup ${formatDuration(warmupSec)}`)
  if (cooldownSec) lines.push(`cooldown ${formatDuration(cooldownSec)}`)
  const stepLine = (step, prefix) => {
    const valueText = step.keyBy === 'distance' ? formatDistance(step.targetDistanceM) : formatDuration(step.targetDurationSec)
    return `${prefix}${step.role} ${valueText} ±${formatNumber(step.durationTolerancePct)}% @ ${formatBand(step)}`
  }
  steps.forEach((step) => lines.push(stepLine(step, step.contiguous ? 'then ' : '')))
  if (setCount && setRecovery) lines.push(stepLine({ ...setRecovery, role: 'recovery' }, 'set '))
  if (metrics && metrics.length) {
    lines.push(`metrics ${metrics.map((m) => (m.windowSec ? `${m.id}(${formatDuration(m.windowSec)})` : m.id)).join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Build the stored `analysis_templates.manifest` for a parsed DSL document.
 * Optional fields are omitted when unused so manifests of templates that do not
 * use newer grammar are byte-identical to those saved before it existed.
 */
export function buildIntervalManifest({ repeatCount, steps, warmupSec = null, cooldownSec = null, setCount = null, setRecovery = null, metrics = [] }) {
  return {
    pattern: 'custom_intervals',
    repeat_count: repeatCount,
    steps,
    ...(warmupSec ? { warmup_sec: warmupSec } : {}),
    ...(cooldownSec ? { cooldown_sec: cooldownSec } : {}),
    ...(setCount ? { set_count: setCount } : {}),
    ...(setCount && setRecovery ? { set_recovery: setRecovery } : {}),
    ...(metrics && metrics.length
      ? { summary_metrics: metrics.map((m) => ({ id: m.id, ...(m.windowSec ? { window_sec: m.windowSec } : {}) })) }
      : {}),
  }
}

/** Inverse of buildIntervalManifest: the `stringifyIntervalDsl` input for a stored manifest. */
export function manifestToDslInput(manifest = {}) {
  return {
    repeatCount: manifest.repeat_count,
    steps: manifest.steps || [],
    warmupSec: manifest.warmup_sec ?? null,
    cooldownSec: manifest.cooldown_sec ?? null,
    setCount: manifest.set_count ?? null,
    setRecovery: manifest.set_recovery ?? null,
    metrics: (manifest.summary_metrics || []).map((m) => ({ id: m.id, windowSec: m.window_sec ?? null })),
  }
}
