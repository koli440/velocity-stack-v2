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
// Deliberately plain JS (no Node-only APIs) so it can run both server-side
// (API route validation) and client-side (live preview in the creator UI).

const REPEAT_LINE_RE = /^(\d+)\s*x$/i
const STEP_LINE_RE = /^(work|recovery)\s+(\d+(?:\.\d+)?)\s*(min|sec|km|m)\s*±\s*(\d+(?:\.\d+)?)\s*%\s*@\s*(.+)$/i
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
 *   repeatCount: number|null,
 *   steps: Array<{role: 'work'|'recovery', keyBy: 'duration'|'distance', targetDurationSec: number|null, targetDistanceM: number|null, durationTolerancePct: number, bandType: 'pct_ftp'|'watts'|'speed_kmh'|'pct_hrmax'|'hr_bpm'|'cadence_rpm'|'best', bestMetric: 'power'|'speed'|null, powerMin: number|null, powerMax: number|null}>,
 *   errors: Array<{line: number, message: string}>
 * }}
 */
export function parseIntervalDsl(text) {
  const errors = []
  const steps = []
  let repeatCount = null

  const rawLines = (text || '').split(/\r\n|\r|\n/)
  let sawRepeatLine = false

  rawLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    const line = rawLine.trim()
    if (!line) return // blank lines are allowed as spacing

    if (!sawRepeatLine) {
      const m = line.match(REPEAT_LINE_RE)
      if (!m) {
        errors.push({ line: lineNo, message: `Expected a repeat count like "4x" or "1x", got "${line}".` })
        sawRepeatLine = true // avoid cascading "expected repeat line" errors
        return
      }
      repeatCount = parseInt(m[1], 10)
      if (!(repeatCount >= 1)) {
        errors.push({ line: lineNo, message: 'Repeat count must be 1 or greater.' })
      }
      sawRepeatLine = true
      return
    }

    const m = line.match(STEP_LINE_RE)
    if (!m) {
      errors.push({
        line: lineNo,
        message:
          `Could not parse step line "${line}". Expected format: ` +
          '"work|recovery <value><min|sec|km|m> ±<tolerance>% @ <band>".',
      })
      return
    }

    const [, roleRaw, valueRaw, unitRaw, toleranceRaw, bandTextRaw] = m
    const role = roleRaw.toLowerCase()
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

    steps.push({
      role,
      keyBy,
      targetDurationSec,
      targetDistanceM,
      durationTolerancePct: tolerance,
      bandType: band ? band.bandType : null,
      bestMetric: band && band.bandType === 'best' ? bestMetric : null,
      powerMin: band ? band.powerMin : null,
      powerMax: band ? band.powerMax : null,
    })
  })

  if (!sawRepeatLine) {
    errors.push({ line: 1, message: 'Empty template: expected a repeat count line like "4x".' })
  }

  if (!steps.some((s) => s.role === 'work')) {
    errors.push({ line: rawLines.length || 1, message: 'Template must contain at least one "work" step.' })
  }

  return { repeatCount, steps, errors }
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
export function stringifyIntervalDsl({ repeatCount, steps = [] } = {}) {
  const lines = [`${repeatCount}x`]
  steps.forEach((step) => {
    const valueText = step.keyBy === 'distance' ? formatDistance(step.targetDistanceM) : formatDuration(step.targetDurationSec)
    lines.push(`${step.role} ${valueText} ±${formatNumber(step.durationTolerancePct)}% @ ${formatBand(step)}`)
  })
  return lines.join('\n')
}
