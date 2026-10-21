// Per-ride gear list + elapsed-time gear segments (issue #279). Mirrors the validation in the
// activity_gears_error() SQL function so the UI can reject what the database would reject.
//
// gear entry:  { id, chainring, cog, note }
// segment:     { start_s, end_s, gear_id }   elapsed seconds, [start_s, end_s)
// The primary gear is gears[0]; time outside every segment uses the primary gear.
// A legacy ride with no gears but a stored chainring/cog resolves to a virtual primary gear.

import { parseGear, gearLabel } from './gear.js'
import { gearDevelopmentM } from './trackGearing.js'

export const MAX_GEARS = 8
export const MAX_SEGMENTS = 64
export const MAX_NOTE_LENGTH = 80
export const MAX_SEGMENT_END_S = 172800
export const LEGACY_GEAR_ID = 'g1'

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** Next unused gear id (g1, g2, ...). */
export function nextGearId(gears) {
  const used = new Set((gears || []).map((g) => g.id))
  let n = 1
  while (used.has(`g${n}`)) n++
  return `g${n}`
}

/** Form-state entry -> stored entry (teeth as integers). Invalid/empty gears yield null. */
function toStoredGear(entry) {
  const p = parseGear(entry?.chainring, entry?.cog)
  if (!p.valid || p.empty) return null
  const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, MAX_NOTE_LENGTH) : ''
  return { id: entry.id, chainring: p.chainring, cog: p.cog, note }
}

/**
 * The gear list of an activity row: stored entries, else a single legacy entry from chainring/cog.
 * Always returns well-formed stored entries.
 */
export function resolveGears(activity) {
  const list = Array.isArray(activity?.gears) ? activity.gears : []
  const out = []
  for (const g of list) {
    const s = toStoredGear(g)
    if (s && ID_RE.test(String(s.id))) out.push(s)
  }
  if (out.length > 0) return out
  const legacy = toStoredGear({ id: LEGACY_GEAR_ID, chainring: activity?.chainring, cog: activity?.cog })
  return legacy ? [legacy] : []
}

/** The primary gear ({id, chainring, cog, note}) or null. */
export function primaryGear(activity) {
  return resolveGears(activity)[0] ?? null
}

/** Stored segments filtered to well-formed ones, sorted by start. */
export function resolveSegments(activity) {
  const list = Array.isArray(activity?.gear_segments) ? activity.gear_segments : []
  return list
    .filter((s) => Number.isInteger(s?.start_s) && Number.isInteger(s?.end_s) && s.end_s > s.start_s && s.start_s >= 0 && typeof s.gear_id === 'string')
    .sort((a, b) => a.start_s - b.start_s)
}

/**
 * Validates a gear list + segments for saving.
 * @returns {string|null} an error message, or null when valid
 */
export function validateGearConfig(gears, segments) {
  const list = gears || []
  const segs = segments || []
  if (list.length > MAX_GEARS) return `At most ${MAX_GEARS} gears per ride`
  const ids = new Set()
  for (const g of list) {
    if (!ID_RE.test(String(g.id))) return 'Invalid gear id'
    if (ids.has(g.id)) return 'Duplicate gear id'
    ids.add(g.id)
    const p = parseGear(g.chainring, g.cog)
    if (!p.valid || p.empty) return p.error || 'Enter both chainring and cog for every gear'
    if (typeof g.note === 'string' && g.note.length > MAX_NOTE_LENGTH) return `Gear note is limited to ${MAX_NOTE_LENGTH} characters`
  }
  if (segs.length > MAX_SEGMENTS) return `At most ${MAX_SEGMENTS} segments per ride`
  let prevEnd = 0
  for (const s of segs) {
    if (!Number.isInteger(s.start_s) || !Number.isInteger(s.end_s)) return 'Segment times must be whole seconds'
    if (s.start_s < 0 || s.end_s <= s.start_s || s.end_s > MAX_SEGMENT_END_S) return 'Invalid segment range'
    if (s.start_s < prevEnd) return 'Segments must not overlap'
    if (!ids.has(s.gear_id)) return 'Segment refers to an unknown gear'
    prevEnd = s.end_s
  }
  return null
}

/** Form entries -> payload for the database (drops id-less/empty rows is the caller's job). */
export function toGearPayload(entries) {
  return (entries || []).map(toStoredGear).filter(Boolean)
}

/** Removes a gear and any segment that used it. Removing the primary promotes the next entry. */
export function removeGear(gears, segments, gearId) {
  return {
    gears: (gears || []).filter((g) => g.id !== gearId),
    segments: (segments || []).filter((s) => s.gear_id !== gearId),
  }
}

/** Moves a gear by delta positions (reordering changes which gear is primary). */
export function moveGear(gears, gearId, delta) {
  const list = [...(gears || [])]
  const i = list.findIndex((g) => g.id === gearId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  ;[list[i], list[j]] = [list[j], list[i]]
  return list
}

/**
 * Sets the gear for [start_s, end_s): trims/splits existing segments it overlaps, then merges
 * neighbours with the same gear. Assigning the primary gear simply clears the range (unassigned =
 * primary), so the result stays minimal.
 */
export function assignSegment(segments, startS, endS, gearId, primaryId) {
  const start = Math.max(0, Math.round(startS))
  const end = Math.min(MAX_SEGMENT_END_S, Math.round(endS))
  if (!(end > start)) return [...(segments || [])]
  const next = []
  for (const s of segments || []) {
    if (s.end_s <= start || s.start_s >= end) {
      next.push({ ...s })
      continue
    }
    if (s.start_s < start) next.push({ start_s: s.start_s, end_s: start, gear_id: s.gear_id })
    if (s.end_s > end) next.push({ start_s: end, end_s: s.end_s, gear_id: s.gear_id })
  }
  if (gearId !== primaryId) next.push({ start_s: start, end_s: end, gear_id: gearId })
  next.sort((a, b) => a.start_s - b.start_s)
  const merged = []
  for (const s of next) {
    const last = merged[merged.length - 1]
    if (last && last.gear_id === s.gear_id && last.end_s === s.start_s) last.end_s = s.end_s
    else merged.push({ ...s })
  }
  return merged
}

/** Gear id active at elapsed second t (primary when unassigned). */
export function gearIdAt(t, segments, primaryId) {
  for (const s of segments || []) {
    if (t >= s.start_s && t < s.end_s) return s.gear_id
  }
  return primaryId
}

/** Gear entry active at elapsed second t, or null when the ride has no gear. */
export function gearAt(t, gears, segments) {
  if (!gears?.length) return null
  const id = gearIdAt(t, segments, gears[0].id)
  return gears.find((g) => g.id === id) ?? gears[0]
}

/**
 * Per-sample gear active at each index of a 1 Hz series of length n. Index equals elapsed seconds.
 * @returns {Array<object|null>}
 */
export function gearPerSample(n, gears, segments) {
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = gearAt(i, gears, segments)
  return out
}

/**
 * Cadence x gear derived speed (km/h) using the gear active at each second. With a single gear
 * this is identical to deriveSpeedFromCadence().
 */
export function deriveSpeedWithSegments(cadenceStream, gears, segments) {
  const cad = cadenceStream || []
  const devCache = new Map()
  const dev = (g) => {
    if (!devCache.has(g.id)) devCache.set(g.id, gearDevelopmentM(g.chainring, g.cog))
    return devCache.get(g.id)
  }
  return cad.map((c, i) => {
    const g = gearAt(i, gears, segments)
    if (!g || !(c > 0)) return 0
    return Math.round(dev(g) * (c / 60) * 3.6 * 10) / 10
  })
}

const avg = (values) => {
  const v = values.filter((x) => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Time ranges the ride is split into: each assigned segment plus the unassigned gaps (primary gear),
 * over [0, totalS).
 * @returns {Array<{ start_s:number, end_s:number, gear_id:string, assigned:boolean }>}
 */
export function expandSegments(totalS, gears, segments) {
  if (!gears?.length || !(totalS > 0)) return []
  const primaryId = gears[0].id
  const out = []
  let cursor = 0
  for (const s of segments || []) {
    const start = Math.min(s.start_s, totalS)
    const end = Math.min(s.end_s, totalS)
    if (end <= start) continue
    if (start > cursor) out.push({ start_s: cursor, end_s: start, gear_id: primaryId, assigned: false })
    out.push({ start_s: start, end_s: end, gear_id: s.gear_id, assigned: true })
    cursor = end
  }
  if (cursor < totalS) out.push({ start_s: cursor, end_s: totalS, gear_id: primaryId, assigned: false })
  return out
}

/**
 * Per-segment summary: duration, average power, cadence and speed over each range.
 * Series are 1 Hz and may be missing; averages are null when the series is absent.
 * @param {{ watts?: number[], cadence?: number[], speed?: number[] }} series speed in km/h
 */
export function summarizeSegments(totalS, gears, segments, series = {}) {
  return expandSegments(totalS, gears, segments).map((r) => {
    const g = gears.find((x) => x.id === r.gear_id)
    const slice = (arr) => (Array.isArray(arr) ? arr.slice(r.start_s, r.end_s) : [])
    const watts = slice(series.watts)
    const cadence = slice(series.cadence)
    const speed = slice(series.speed)
    return {
      ...r,
      label: g ? gearLabel(g.chainring, g.cog) : '',
      note: g?.note || '',
      duration_s: r.end_s - r.start_s,
      avg_power: avg(watts),
      avg_cadence: avg(cadence.filter((c) => c > 0)),
      avg_speed: avg(speed),
    }
  })
}

/**
 * Gear to prefill a PB Vault/Aero Lab entry from: the gear covering the given elapsed time range
 * most (by overlap), else the primary gear. start/end optional: without them the primary gear.
 * @returns {{ chainring:number, cog:number }|null}
 */
export function gearForRange(activity, startS, endS) {
  const gears = resolveGears(activity)
  if (!gears.length) return null
  if (!(endS > startS)) return pick(gears[0])
  const parts = expandSegments(endS, gears, resolveSegments(activity))
  const weights = new Map()
  for (const r of parts) {
    const overlap = Math.min(r.end_s, endS) - Math.max(r.start_s, startS)
    if (overlap > 0) weights.set(r.gear_id, (weights.get(r.gear_id) || 0) + overlap)
  }
  let best = gears[0]
  let bestW = -1
  for (const g of gears) {
    const w = weights.get(g.id) || 0
    if (w > bestW) {
      best = g
      bestW = w
    }
  }
  return pick(best)
}

function pick(g) {
  return { chainring: g.chainring, cog: g.cog }
}
