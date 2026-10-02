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
// Deliberately plain JS (no Node-only APIs) so it can run both server-side
// (API route validation) and client-side (live preview in the creator UI).

const REPEAT_LINE_RE = /^(\d+)\s*x$/i
const STEP_LINE_RE = /^(work|recovery)\s+(\d+(?:\.\d+)?)\s*(min|sec)\s*±\s*(\d+(?:\.\d+)?)\s*%\s*@\s*(.+)$/i
const RANGE_BAND_RE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(%FTP|W)$/i
const MAX_BAND_RE = /^<\s*(\d+(?:\.\d+)?)\s*(%FTP|W)$/i
const MIN_BAND_RE = /^>\s*(\d+(?:\.\d+)?)\s*(%FTP|W)$/i
const BEST_BAND_RE = /^(best|max)$/i

/**
 * @param {string} bandText - the `@ <band>` portion of a step line, already trimmed.
 * @returns {{ bandType: 'pct_ftp'|'watts'|'best', powerMin: number|null, powerMax: number|null } | null}
 *   null when the band syntax is not recognised.
 */
function parseBand(bandText) {
  const text = bandText.trim()

  if (BEST_BAND_RE.test(text)) {
    return { bandType: 'best', powerMin: null, powerMax: null }
  }

  let m = text.match(RANGE_BAND_RE)
  if (m) {
    const min = parseFloat(m[1])
    const max = parseFloat(m[2])
    const bandType = m[3].toUpperCase() === 'W' ? 'watts' : 'pct_ftp'
    return { bandType, powerMin: min, powerMax: max }
  }

  m = text.match(MAX_BAND_RE)
  if (m) {
    const bandType = m[2].toUpperCase() === 'W' ? 'watts' : 'pct_ftp'
    return { bandType, powerMin: null, powerMax: parseFloat(m[1]) }
  }

  m = text.match(MIN_BAND_RE)
  if (m) {
    const bandType = m[2].toUpperCase() === 'W' ? 'watts' : 'pct_ftp'
    return { bandType, powerMin: parseFloat(m[1]), powerMax: null }
  }

  return null
}

/**
 * Parse a full interval DSL document into a validated manifest.
 * @param {string} text
 * @returns {{
 *   repeatCount: number|null,
 *   steps: Array<{role: 'work'|'recovery', targetDurationSec: number, durationTolerancePct: number, bandType: 'pct_ftp'|'watts'|'best', powerMin: number|null, powerMax: number|null}>,
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
          '"work|recovery <value><min|sec> ±<tolerance>% @ <band>".',
      })
      return
    }

    const [, roleRaw, valueRaw, unitRaw, toleranceRaw, bandTextRaw] = m
    const role = roleRaw.toLowerCase()
    const value = parseFloat(valueRaw)
    const unit = unitRaw.toLowerCase()
    const tolerance = parseFloat(toleranceRaw)
    const targetDurationSec = unit === 'min' ? value * 60 : value

    if (!(targetDurationSec > 0)) {
      errors.push({ line: lineNo, message: 'Step duration must be greater than 0.' })
    }
    if (!(tolerance >= 0 && tolerance <= 100)) {
      errors.push({ line: lineNo, message: 'Tolerance must be between 0 and 100%.' })
    }

    const band = parseBand(bandTextRaw)
    if (!band) {
      errors.push({
        line: lineNo,
        message:
          `Unrecognised power band "${bandTextRaw.trim()}". Expected "a-b%FTP", "<x%FTP", ` +
          '">x%FTP", the same with "W" instead of "%FTP", or "best"/"max".',
      })
    } else if (band.bandType !== 'best') {
      if (band.powerMin != null && band.powerMin < 0) {
        errors.push({ line: lineNo, message: 'Power band minimum must be >= 0.' })
      }
      if (band.powerMax != null && band.powerMax < 0) {
        errors.push({ line: lineNo, message: 'Power band maximum must be >= 0.' })
      }
      if (band.powerMin != null && band.powerMax != null && band.powerMin >= band.powerMax) {
        errors.push({ line: lineNo, message: 'Power band minimum must be less than its maximum.' })
      }
    }

    steps.push({
      role,
      targetDurationSec,
      durationTolerancePct: tolerance,
      bandType: band ? band.bandType : null,
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

function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function formatBand({ bandType, powerMin, powerMax }) {
  if (bandType === 'best') return 'best'
  const suffix = bandType === 'watts' ? 'W' : '%FTP'
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
    lines.push(
      `${step.role} ${formatDuration(step.targetDurationSec)} ±${formatNumber(step.durationTolerancePct)}% @ ${formatBand(
        step
      )}`
    )
  })
  return lines.join('\n')
}
