// src/lib/legacyPatterns.js
//
// DSL/manifest grammar for the four fixed track-cycling patterns that used to
// be reachable only through hand-written JSON manifests (issue #128):
// repeated_bursts, flying_sprint, sustained_tt, standing_start.
//
// A template starts with `pattern <name>` instead of a repeat line, followed by
// that pattern's option lines, e.g.
//
//   pattern repeated_bursts
//   count 3
//   duration 3min ±45sec
//   recovery window 60sec
//
// Each option maps 1:1 onto the manifest key the legacy evaluators already read
// (templateEngine.js), so existing manifests, stored template_executions and the
// seeded system templates keep working unchanged: `buildIntervalManifest` yields
// the same manifest shape the evaluators consume.
//
// Plain JS (no Node-only APIs): shared by the parser, the API routes and the UI.

export const LEGACY_PATTERN_NAMES = ['repeated_bursts', 'flying_sprint', 'sustained_tt', 'standing_start']

const NUM = '(\\d+(?:\\.\\d+)?)'
const toSec = (v, unit) => parseFloat(v) * (unit.toLowerCase() === 'min' ? 60 : 1)
const toMeters = (v, unit) => parseFloat(v) * (unit.toLowerCase() === 'km' ? 1000 : 1)

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}
function fmtDuration(sec) {
  return sec % 60 === 0 && sec >= 60 ? `${sec / 60}min` : `${fmtNum(sec)}sec`
}
function fmtDistance(m) {
  return m % 1000 === 0 && m >= 1000 ? `${fmtNum(m / 1000)}km` : `${fmtNum(m)}m`
}

// Order here is the order options are written back by stringifyIntervalDsl.
export const LEGACY_OPTIONS = [
  {
    name: 'count',
    keys: ['target_count'],
    re: /^count\s+(\d+)$/i,
    parse: (m) => ({ target_count: parseInt(m[1], 10) }),
    format: (o) => `count ${o.target_count}`,
    has: (o) => o.target_count != null,
    check: (o) => (o.target_count >= 1 ? null : 'Count must be 1 or greater.'),
  },
  {
    name: 'duration',
    keys: ['target_duration_sec', 'duration_tolerance_sec'],
    re: new RegExp(`^duration\\s+${NUM}\\s*(min|sec)\\s*±\\s*${NUM}\\s*(min|sec)$`, 'i'),
    parse: (m) => ({ target_duration_sec: toSec(m[1], m[2]), duration_tolerance_sec: toSec(m[3], m[4]) }),
    format: (o) => `duration ${fmtDuration(o.target_duration_sec)} ±${fmtDuration(o.duration_tolerance_sec ?? 0)}`,
    has: (o) => o.target_duration_sec != null,
    check: (o) => (o.target_duration_sec > 0 ? null : 'Duration must be greater than 0.'),
    hint: 'duration <value><min|sec> ±<tolerance><min|sec>',
  },
  {
    name: 'recovery window',
    keys: ['recovery_window_sec'],
    re: new RegExp(`^recovery\\s+window\\s+${NUM}\\s*(min|sec)$`, 'i'),
    parse: (m) => ({ recovery_window_sec: toSec(m[1], m[2]) }),
    format: (o) => `recovery window ${fmtDuration(o.recovery_window_sec)}`,
    has: (o) => o.recovery_window_sec != null,
    check: (o) => (o.recovery_window_sec > 0 ? null : 'Recovery window must be greater than 0.'),
  },
  {
    name: 'distance',
    keys: ['distance_m'],
    re: new RegExp(`^distance\\s+${NUM}\\s*(km|m)$`, 'i'),
    parse: (m) => ({ distance_m: toMeters(m[1], m[2]) }),
    format: (o) => `distance ${fmtDistance(o.distance_m)}`,
    has: (o) => o.distance_m != null,
    check: (o) => (o.distance_m > 0 ? null : 'Distance must be greater than 0.'),
  },
  {
    name: 'min duration',
    keys: ['min_duration_sec'],
    re: new RegExp(`^min\\s+duration\\s+${NUM}\\s*(min|sec)$`, 'i'),
    parse: (m) => ({ min_duration_sec: toSec(m[1], m[2]) }),
    format: (o) => `min duration ${fmtDuration(o.min_duration_sec)}`,
    has: (o) => o.min_duration_sec != null,
    check: (o) => (o.min_duration_sec > 0 ? null : 'Minimum duration must be greater than 0.'),
  },
  {
    name: 'distances',
    keys: ['distances_m'],
    re: /^distances\s+(.+)$/i,
    parse: (m) => {
      const items = m[1].split(',').map((t) => t.trim()).filter(Boolean)
      const parsed = items.map((t) => t.match(new RegExp(`^${NUM}\\s*(km|m)$`, 'i')))
      if (!items.length || parsed.some((p) => !p)) return { error: 'Distances must look like "2km, 3km, 4km".' }
      return { distances_m: parsed.map((p) => toMeters(p[1], p[2])) }
    },
    format: (o) => `distances ${o.distances_m.map(fmtDistance).join(', ')}`,
    has: (o) => Array.isArray(o.distances_m) && o.distances_m.length > 0,
    check: (o) => (o.distances_m.every((d) => d > 0) ? null : 'Distances must be greater than 0.'),
  },
  {
    name: 'lap',
    keys: ['lap_length_m'],
    re: new RegExp(`^lap\\s+${NUM}\\s*(km|m)$`, 'i'),
    parse: (m) => ({ lap_length_m: toMeters(m[1], m[2]) }),
    format: (o) => `lap ${fmtDistance(o.lap_length_m)}`,
    has: (o) => o.lap_length_m != null,
    check: (o) => (o.lap_length_m > 0 ? null : 'Lap length must be greater than 0.'),
  },
]

/** Which option lines each pattern accepts. */
export const LEGACY_PATTERN_OPTIONS = {
  repeated_bursts: ['count', 'duration', 'recovery window'],
  flying_sprint: ['distance'],
  standing_start: ['distance'],
  sustained_tt: ['min duration', 'distances', 'lap'],
}

export const PATTERN_LINE_RE = /^pattern\s+([a-z_]+)$/i

export function isLegacyPattern(name) {
  return LEGACY_PATTERN_NAMES.includes(name)
}

/**
 * Try to parse an option line. Returns null when the line is not an option line at all,
 * otherwise `{ option, values?, error? }`.
 */
export function parseLegacyOptionLine(line) {
  for (const option of LEGACY_OPTIONS) {
    const m = line.match(option.re)
    if (m) {
      const out = option.parse(m)
      if (out.error) return { option, error: out.error }
      const problem = option.check(out)
      return problem ? { option, error: problem } : { option, values: out }
    }
  }
  // Recognise a malformed use of a known keyword so the caller can give a precise message.
  const keyword = LEGACY_OPTIONS.find((o) => new RegExp(`^${o.name.replace(' ', '\\s+')}\\b`, 'i').test(line))
  if (keyword && !/^recovery\s+\d/i.test(line)) {
    return { option: keyword, error: `Could not parse "${line}". Expected ${keyword.hint || `"${keyword.name} <value>"`}.` }
  }
  return null
}

/** Option lines for stringify, in canonical order, from a `patternOptions` object. */
export function formatLegacyOptions(pattern, options = {}) {
  const allowed = LEGACY_PATTERN_OPTIONS[pattern] || []
  return LEGACY_OPTIONS.filter((o) => allowed.includes(o.name) && o.has(options)).map((o) => o.format(options))
}

/** Pick only the option keys a pattern accepts out of a (stored) manifest. */
export function legacyOptionsFromManifest(manifest = {}) {
  const allowedNames = LEGACY_PATTERN_OPTIONS[manifest.pattern] || []
  const out = {}
  for (const o of LEGACY_OPTIONS.filter((x) => allowedNames.includes(x.name))) {
    const probe = {}
    for (const key of o.keys) if (manifest[key] != null) probe[key] = manifest[key]
    if (o.has(probe)) Object.assign(out, probe)
  }
  return out
}
