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
// Lactate-threshold bands (issue #121) use the athlete's LT1/LT2 valid on the
// activity's date: `%LT1`/`%LT2` are a percentage of the LT power, `%LT1HR`/`%LT2HR`
// of the LT heart rate:
//
//   3x
//   work 10min ±10% @ 95-105%LT2
//   recovery 5min ±30% @ <80%LT1
//
// Power-zone bands (issue #194) use the athlete's Z1-Z6 for the activity's date (see
// src/lib/powerZones.js): `Z3` is one zone, `Z2-Z3` a range of zones, `<Z2` is below zone 2 and
// `>Z4` above zone 4:
//
//   3x
//   work 15min ±3% @ Z3
//   recovery 5min ±30% @ <Z2
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
// Fixed track patterns (issue #128): start with `pattern <name>` instead of a
// repeat line to express repeated_bursts, flying_sprint, sustained_tt or
// standing_start (see src/lib/legacyPatterns.js). Their option lines map 1:1
// onto the manifest keys those evaluators always read, so stored manifests and
// template_executions stay valid:
//
//   pattern repeated_bursts
//   count 3
//   duration 3min ±45sec
//   recovery window 60sec
//   metrics np
//
//   pattern flying_sprint
//   distance 200m
//
//   pattern sustained_tt
//   min duration 20min
//   lap 250m
//
//   pattern standing_start
//   distance 1km
//
// Deliberately plain JS (no Node-only APIs) so it can run both server-side
// (API route validation) and client-side (live preview in the creator UI).

import { ZONE_COUNT, isValidZone } from './powerZones.js'
import { SUMMARY_METRIC_IDS } from './summaryMetrics.js'
import {
  LEGACY_PATTERN_NAMES,
  LEGACY_PATTERN_OPTIONS,
  PATTERN_LINE_RE,
  formatLegacyOptions,
  isLegacyPattern,
  legacyOptionsFromManifest,
  parseLegacyOptionLine,
} from './legacyPatterns.js'

const METRICS_LINE_RE = /^metrics\b\s*:?\s*(.*)$/i
const METRIC_TOKEN_RE = /^([a-z0-9_]+)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*(min|sec|s)\s*\))?$/i
const REPEAT_LINE_RE = /^(?:(\d+)\s*sets?\s*of\s*)?(\d+)\s*x$/i
const STEP_LINE_RE = /^(then\s+|set\s+)?(work|recovery)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|seconds?|secs?|km|m|s)\s*±\s*(\d+(?:\.\d+)?)\s*%\s*@\s*(.+)$/i
const EXCLUDE_LINE_RE = /^(warm-?up|cool-?down)\s+(\d+(?:\.\d+)?)\s*(min|sec)$/i
const RANGE_BAND_RE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(%LT1HR|%LT2HR|%LT1|%LT2|%FTP|%HRmax|bpm|rpm|W\/kg|W|km\/h)$/i
const MAX_BAND_RE = /^<\s*(\d+(?:\.\d+)?)\s*(%LT1HR|%LT2HR|%LT1|%LT2|%FTP|%HRmax|bpm|rpm|W\/kg|W|km\/h)$/i
const MIN_BAND_RE = /^>\s*(\d+(?:\.\d+)?)\s*(%LT1HR|%LT2HR|%LT1|%LT2|%FTP|%HRmax|bpm|rpm|W\/kg|W|km\/h)$/i
// A bare target ('3W/kg') means the target ±5%, normalised to an explicit range so it round-trips.
const END_LINE_RE = /^end$/i
// A bare target ('50W', '95%FTP') means the target ±5%, like a bare W/kg target.
const BARE_BAND_RE = /^(\d+(?:\.\d+)?)\s*(%FTP|W)$/i
const BARE_WKG_RE = /^(\d+(?:\.\d+)?)\s*W\/kg$/i
export const WKG_TARGET_TOLERANCE = 0.05
export const MAX_NEST_DEPTH = 3 // repeated groups inside repeated groups
export const MAX_GROUP_REPEAT = 100
export const MAX_EXPANDED_STEPS = 200
// "m" is minutes below this value ("10m", "90m") and metres from it up ("200m"): a distance window under
// 100 m is not meaningful, so existing distance templates keep their meaning.
export const MIN_METRES_VALUE = 100
const ZONE_RANGE_RE = /^Z(\d+)\s*-\s*Z(\d+)$/i
const ZONE_SINGLE_RE = /^Z(\d+)$/i
const ZONE_MAX_RE = /^<\s*Z(\d+)$/i
const ZONE_MIN_RE = /^>\s*Z(\d+)$/i
const BEST_BAND_RE = /^(?:best|max)(?:\s+(power|speed))?$/i

export const BAND_SUFFIXES = {
  pct_ftp: '%FTP',
  watts: 'W',
  speed_kmh: 'km/h',
  pct_hrmax: '%HRmax',
  hr_bpm: 'bpm',
  cadence_rpm: 'rpm',
  pct_lt1: '%LT1',
  pct_lt2: '%LT2',
  pct_lt1_hr: '%LT1HR',
  pct_lt2_hr: '%LT2HR',
  wkg: 'W/kg',
}

// `zone` bands keep zone numbers (1-6) in powerMin/powerMax: both set = zones powerMin..powerMax
// inclusive, only powerMax = below that zone, only powerMin = above that zone.

function bandTypeForSuffix(suffix) {
  const s = suffix.toUpperCase()
  if (s === 'W/KG') return 'wkg'
  if (s === 'W') return 'watts'
  if (s === 'KM/H') return 'speed_kmh'
  if (s === '%HRMAX') return 'pct_hrmax'
  if (s === 'BPM') return 'hr_bpm'
  if (s === 'RPM') return 'cadence_rpm'
  if (s === '%LT1') return 'pct_lt1'
  if (s === '%LT2') return 'pct_lt2'
  if (s === '%LT1HR') return 'pct_lt1_hr'
  if (s === '%LT2HR') return 'pct_lt2_hr'
  return 'pct_ftp'
}

/**
 * @param {string} bandText - the `@ <band>` portion of a step line, already trimmed.
 * @returns {{ bandType: 'pct_ftp'|'watts'|'speed_kmh'|'pct_hrmax'|'hr_bpm'|'cadence_rpm'|'pct_lt1'|'pct_lt2'|'pct_lt1_hr'|'pct_lt2_hr'|'wkg'|'zone'|'best', bestMetric: 'power'|'speed'|null, powerMin: number|null, powerMax: number|null } | null}
 *   null when the band syntax is not recognised.
 */
function parseBand(bandText) {
  const text = bandText.trim()

  let m = text.match(BEST_BAND_RE)
  if (m) {
    return { bandType: 'best', bestMetric: m[1] ? m[1].toLowerCase() : null, powerMin: null, powerMax: null }
  }

  m = text.match(BARE_WKG_RE)
  if (m) {
    const target = parseFloat(m[1])
    const round = (v) => Math.round(v * 100) / 100
    return { bandType: 'wkg', bestMetric: null, powerMin: round(target * (1 - WKG_TARGET_TOLERANCE)), powerMax: round(target * (1 + WKG_TARGET_TOLERANCE)) }
  }

  m = text.match(BARE_BAND_RE)
  if (m) {
    const target = parseFloat(m[1])
    const round = (v) => Math.round(v * 100) / 100
    return { bandType: bandTypeForSuffix(m[2]), bestMetric: null, powerMin: round(target * (1 - WKG_TARGET_TOLERANCE)), powerMax: round(target * (1 + WKG_TARGET_TOLERANCE)) }
  }

  m = text.match(ZONE_SINGLE_RE)
  if (m) return { bandType: 'zone', bestMetric: null, powerMin: parseInt(m[1], 10), powerMax: parseInt(m[1], 10) }

  m = text.match(ZONE_RANGE_RE)
  if (m) return { bandType: 'zone', bestMetric: null, powerMin: parseInt(m[1], 10), powerMax: parseInt(m[2], 10) }

  m = text.match(ZONE_MAX_RE)
  if (m) return { bandType: 'zone', bestMetric: null, powerMin: null, powerMax: parseInt(m[1], 10) }

  m = text.match(ZONE_MIN_RE)
  if (m) return { bandType: 'zone', bestMetric: null, powerMin: parseInt(m[1], 10), powerMax: null }

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
 *   lapLengthM: number|null,                           // "lap 250m" track context (issue #129)
 *   pattern: 'repeated_bursts'|'flying_sprint'|'sustained_tt'|'standing_start'|null,  // fixed pattern (issue #128)
 *   patternOptions: object,                            // its manifest option keys (target_count, distance_m, ...)
 *   steps: Array<{role: 'work'|'recovery', keyBy: 'duration'|'distance', targetDurationSec: number|null, targetDistanceM: number|null, durationTolerancePct: number, contiguous?: true, bandType: 'pct_ftp'|'watts'|'speed_kmh'|'pct_hrmax'|'hr_bpm'|'cadence_rpm'|'pct_lt1'|'pct_lt2'|'pct_lt1_hr'|'pct_lt2_hr'|'wkg'|'zone'|'best', bestMetric: 'power'|'speed'|null, powerMin: number|null, powerMax: number|null}>,
 *   structure: Array<step|{repeat: number, items: Array}>|null,  // written order with nested repeat groups; null without groups
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
  let lapLengthM = null
  let pattern = null
  const patternOptions = {}

  const rawLines = (text || '').split(/\r\n|\r|\n/)
  let sawRepeatLine = false

  // Repeated groups ("6x" ... blank line / "end") nest inside the document; `tree` holds steps and group nodes
  // ({ repeat, items }) in written order, `steps` is the expanded flat list the matching engine runs.
  const tree = []
  const stack = [{ items: tree }]
  const groupLines = new WeakMap()
  let stepCount = 0
  let hasGroups = false
  const closeGroup = () => {
    const g = stack.pop()
    if (!g.items.length) errors.push({ line: groupLines.get(g) || 1, message: `Repeat group "${g.repeat}x" has no steps; add work/recovery lines under it.` })
  }
  const closeAllGroups = () => {
    while (stack.length > 1) closeGroup()
  }

  rawLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    const line = rawLine.trim()
    if (!line) {
      closeAllGroups() // a blank line ends open repeat groups (outside them it is just spacing)
      return
    }

    if (!sawRepeatLine) {
      const pm = line.match(PATTERN_LINE_RE)
      if (pm) {
        const name = pm[1].toLowerCase()
        if (isLegacyPattern(name)) pattern = name
        else errors.push({ line: lineNo, message: `Unknown pattern "${pm[1]}". Available: ${LEGACY_PATTERN_NAMES.join(', ')}.` })
        sawRepeatLine = true
        return
      }
      const m = line.match(REPEAT_LINE_RE)
      sawRepeatLine = true
      if (m) {
        repeatCount = parseInt(m[2], 10)
        if (!(repeatCount >= 1)) {
          errors.push({ line: lineNo, message: 'Repeat count must be 1 or greater.' })
        }
        if (m[1] != null) {
          setCount = parseInt(m[1], 10)
          if (!(setCount >= 1)) errors.push({ line: lineNo, message: 'Set count must be 1 or greater.' })
        }
        return
      }
      // No repeat line: the whole description is a single (1x) run of the steps, handled below.
      repeatCount = 1
    }

    if (!pattern) {
      const gm = line.match(REPEAT_LINE_RE)
      if (gm) {
        const count = parseInt(gm[2], 10)
        if (gm[1] != null) errors.push({ line: lineNo, message: '"<S> sets of <N>x" is only allowed as the first line; use "<N>x" for a repeated group.' })
        if (!(count >= 1)) errors.push({ line: lineNo, message: 'Repeat count must be 1 or greater.' })
        else if (count > MAX_GROUP_REPEAT) errors.push({ line: lineNo, message: `A repeated group can repeat at most ${MAX_GROUP_REPEAT} times.` })
        if (stack.length > MAX_NEST_DEPTH) errors.push({ line: lineNo, message: `Repeated groups can be nested at most ${MAX_NEST_DEPTH} levels deep.` })
        const node = { repeat: count, items: [] }
        groupLines.set(node, lineNo)
        stack[stack.length - 1].items.push(node)
        stack.push(node)
        hasGroups = true
        return
      }
      if (END_LINE_RE.test(line)) {
        if (stack.length > 1) closeGroup()
        else errors.push({ line: lineNo, message: '"end" has no open repeated group to close.' })
        return
      }
    }

    const ex = line.match(EXCLUDE_LINE_RE)
    if (!pattern && (ex || METRICS_LINE_RE.test(line) || /^lap\b/i.test(line))) closeAllGroups() // document-level lines end open groups
    if (ex && pattern) {
      errors.push({ line: lineNo, message: `"${ex[1].toLowerCase()}" is not available with pattern ${pattern}.` })
      return
    }
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

    const opt = parseLegacyOptionLine(line)
    if (pattern) {
      if (!opt) {
        errors.push({
          line: lineNo,
          message:
            `Could not parse "${line}". Pattern ${pattern} accepts: ${LEGACY_PATTERN_OPTIONS[pattern].join(', ')}, metrics` +
            (STEP_LINE_RE.test(line) ? ' (work/recovery step lines are only used without "pattern").' : '.'),
        })
      } else if (!LEGACY_PATTERN_OPTIONS[pattern].includes(opt.option.name)) {
        errors.push({ line: lineNo, message: `"${opt.option.name}" is not available with pattern ${pattern}. Accepted: ${LEGACY_PATTERN_OPTIONS[pattern].join(', ')}.` })
      } else if (opt.error) {
        errors.push({ line: lineNo, message: opt.error })
      } else if (opt.option.keys.some((k) => patternOptions[k] != null)) {
        errors.push({ line: lineNo, message: `Only one "${opt.option.name}" line is allowed.` })
      } else {
        Object.assign(patternOptions, opt.values)
      }
      return
    }
    if (opt && opt.option.name === 'lap') {
      if (opt.error) errors.push({ line: lineNo, message: opt.error })
      else if (lapLengthM != null) errors.push({ line: lineNo, message: 'Only one "lap" line is allowed.' })
      else lapLengthM = opt.values.lap_length_m
      return
    }
    if (opt) {
      errors.push({ line: lineNo, message: `"${opt.option.name}" needs a first line like "pattern repeated_bursts" instead of a repeat count.` })
      return
    }

    const m = line.match(STEP_LINE_RE)
    if (!m) {
      errors.push({
        line: lineNo,
        message:
          `Could not parse step line "${line}". Expected format: ` +
          '"[then] work|recovery <value><min|sec|km|m> ±<tolerance>% @ <band>" (or "warmup <n>min|sec" / "cooldown <n>min|sec", a group line like "6x", or "end").',
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
    if (isSetRecovery && stack.length > 1) {
      errors.push({ line: lineNo, message: '"set recovery" cannot be inside a repeated group.' })
    }
    if (contiguous && !stepCount) {
      errors.push({ line: lineNo, message: '"then" needs a preceding step in the same repeat; remove it from the first step.' })
    }
    const value = parseFloat(valueRaw)
    const unitText = unitRaw.toLowerCase()
    let unit = unitText.startsWith('min') ? 'min' : unitText.startsWith('s') ? 'sec' : unitText
    if (unit === 'm' && value < MIN_METRES_VALUE) unit = 'min'
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
          'the same with "W", "km/h", "bpm", "%HRmax", "rpm", "%LT1", "%LT2", "%LT1HR", "%LT2HR" or "W/kg" instead of "%FTP", a power zone ' +
          '("Z3", "Z2-Z3", "<Z2", ">Z4"), or "best"/"max" (with "power"/"speed" required on distance-keyed steps).',
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
    } else if (band.bandType === 'zone') {
      const zoneError = validateZoneBand(band)
      if (zoneError) errors.push({ line: lineNo, message: zoneError })
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
      stepCount++
      stack[stack.length - 1].items.push(stepObj)
    }
  })
  closeAllGroups()

  const leafCount = (items) => items.reduce((n, it) => n + (it.items ? it.repeat * leafCount(it.items) : 1), 0)
  const expand = (items) => items.flatMap((it) => (it.items ? Array.from({ length: it.repeat }, () => expand(it.items)).flat() : [{ ...it }]))
  const total = leafCount(tree)
  if (total > MAX_EXPANDED_STEPS) {
    errors.push({ line: 1, message: `The repeated groups expand to ${total} steps; the limit is ${MAX_EXPANDED_STEPS}.` })
    steps.push(...tree.filter((it) => !it.items))
  } else {
    steps.push(...expand(tree))
  }

  if (!sawRepeatLine) {
    errors.push({ line: 1, message: 'Empty template: expected work/recovery lines, optionally with a repeat count line like "4x".' })
  }

  if (!pattern && !steps.some((s) => s.role === 'work')) {
    errors.push({ line: rawLines.length || 1, message: 'Template must contain at least one "work" step.' })
  }

  return { repeatCount, setCount, setRecovery, steps, structure: hasGroups ? tree : null, warmupSec, cooldownSec, metrics, pattern, patternOptions, lapLengthM, errors }
}

function validateZoneBand({ powerMin, powerMax }) {
  for (const z of [powerMin, powerMax]) {
    if (z != null && !isValidZone(z)) return `Unknown zone "Z${z}". Power zones are Z1 to Z${ZONE_COUNT}.`
  }
  if (powerMin != null && powerMax != null && powerMin > powerMax) {
    return `Zone range must go from the lower to the higher zone, e.g. "Z${powerMax}-Z${powerMin}".`
  }
  if (powerMin == null && powerMax === 1) return '"<Z1" matches nothing: there is no zone below Z1.'
  if (powerMax == null && powerMin === ZONE_COUNT) return `">Z${ZONE_COUNT}" matches nothing: there is no zone above Z${ZONE_COUNT}.`
  return null
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
  if (bandType === 'zone') {
    if (powerMin != null && powerMax != null) return powerMin === powerMax ? `Z${powerMin}` : `Z${powerMin}-Z${powerMax}`
    if (powerMax != null) return `<Z${powerMax}`
    return `>Z${powerMin}`
  }
  const suffix = BAND_SUFFIXES[bandType] || '%FTP'
  if (powerMin != null && powerMax != null) return `${formatNumber(powerMin)}-${formatNumber(powerMax)}${suffix}`
  if (powerMax != null) return `<${formatNumber(powerMax)}${suffix}`
  if (powerMin != null) return `>${formatNumber(powerMin)}${suffix}`
  return suffix
}

function metricsLine(metrics) {
  return `metrics ${metrics.map((m) => (m.windowSec ? `${m.id}(${formatDuration(m.windowSec)})` : m.id)).join(', ')}`
}

/**
 * Render a parsed (or hand-built) manifest back into editable DSL text.
 * @param {{repeatCount: number, steps: Array}} manifest
 * @returns {string}
 */
export function stringifyIntervalDsl({ repeatCount, steps = [], structure = null, warmupSec = null, cooldownSec = null, setCount = null, setRecovery = null, metrics = [], pattern = null, patternOptions = {}, lapLengthM = null } = {}) {
  if (pattern) {
    const lines = [`pattern ${pattern}`, ...formatLegacyOptions(pattern, patternOptions)]
    if (metrics && metrics.length) lines.push(metricsLine(metrics))
    return lines.join('\n')
  }
  const lines = [setCount ? `${setCount} sets of ${repeatCount}x` : `${repeatCount}x`]
  if (warmupSec) lines.push(`warmup ${formatDuration(warmupSec)}`)
  if (cooldownSec) lines.push(`cooldown ${formatDuration(cooldownSec)}`)
  const stepLine = (step, prefix) => {
    const valueText = step.keyBy === 'distance' ? formatDistance(step.targetDistanceM) : formatDuration(step.targetDurationSec)
    return `${prefix}${step.role} ${valueText} ±${formatNumber(step.durationTolerancePct)}% @ ${formatBand(step)}`
  }
  const writeItems = (items, depth) => {
    const pad = '  '.repeat(depth)
    for (const it of items) {
      if (it.items) {
        lines.push(`${pad}${it.repeat}x`)
        writeItems(it.items, depth + 1)
        lines.push(`${pad}end`)
      } else lines.push(pad + stepLine(it, it.contiguous ? 'then ' : ''))
    }
  }
  if (Array.isArray(structure) && structure.length) writeItems(structure, 0)
  else steps.forEach((step) => lines.push(stepLine(step, step.contiguous ? 'then ' : '')))
  if (setCount && setRecovery) lines.push(stepLine({ ...setRecovery, role: 'recovery' }, 'set '))
  if (lapLengthM) lines.push(`lap ${formatDistance(lapLengthM)}`)
  if (metrics && metrics.length) {
    lines.push(metricsLine(metrics))
  }
  return lines.join('\n')
}

/**
 * Build the stored `analysis_templates.manifest` for a parsed DSL document.
 * Optional fields are omitted when unused so manifests of templates that do not
 * use newer grammar are byte-identical to those saved before it existed.
 */
export function buildIntervalManifest({ repeatCount, steps, structure = null, warmupSec = null, cooldownSec = null, setCount = null, setRecovery = null, metrics = [], pattern = null, patternOptions = {}, lapLengthM = null }) {
  const summaryMetrics =
    metrics && metrics.length
      ? { summary_metrics: metrics.map((m) => ({ id: m.id, ...(m.windowSec ? { window_sec: m.windowSec } : {}) })) }
      : {}
  if (pattern) return { pattern, ...patternOptions, ...summaryMetrics }
  return {
    pattern: 'custom_intervals',
    repeat_count: repeatCount,
    steps,
    ...(Array.isArray(structure) && structure.length ? { structure } : {}),
    ...(warmupSec ? { warmup_sec: warmupSec } : {}),
    ...(cooldownSec ? { cooldown_sec: cooldownSec } : {}),
    ...(setCount ? { set_count: setCount } : {}),
    ...(setCount && setRecovery ? { set_recovery: setRecovery } : {}),
    ...(lapLengthM ? { lap_length_m: lapLengthM } : {}),
    ...summaryMetrics,
  }
}

/** Inverse of buildIntervalManifest: the `stringifyIntervalDsl` input for a stored manifest. */
export function manifestToDslInput(manifest = {}) {
  if (isLegacyPattern(manifest.pattern)) {
    // Seeded manifests list fixed output names under `metrics`; only decoupling changes what is computed.
    const legacyMetrics = Array.isArray(manifest.metrics) && manifest.metrics.includes('pw_hr_decoupling_pct') ? [{ id: 'decoupling', windowSec: null }] : []
    const selected = (manifest.summary_metrics || []).map((m) => ({ id: m.id, windowSec: m.window_sec ?? null }))
    return {
      pattern: manifest.pattern,
      patternOptions: legacyOptionsFromManifest(manifest),
      metrics: selected.length ? selected : manifest.pattern === 'sustained_tt' ? legacyMetrics : [],
    }
  }
  return {
    repeatCount: manifest.repeat_count,
    steps: manifest.steps || [],
    structure: Array.isArray(manifest.structure) ? manifest.structure : null,
    warmupSec: manifest.warmup_sec ?? null,
    cooldownSec: manifest.cooldown_sec ?? null,
    setCount: manifest.set_count ?? null,
    setRecovery: manifest.set_recovery ?? null,
    lapLengthM: manifest.lap_length_m ?? null,
    metrics: (manifest.summary_metrics || []).map((m) => ({ id: m.id, windowSec: m.window_sec ?? null })),
  }
}
