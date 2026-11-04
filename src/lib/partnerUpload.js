// src/lib/partnerUpload.js
//
// Pure helpers for the partner upload API (POST /api/v1/activities): validation of the JSON streams payload and
// conversion of JSON / GPX / TCX input into the stream list `analyzeStreams` understands (1 Hz arrays).
// No I/O here; the HTTP and database layers live under src/lib/server and src/app/api/v1.

import { RIDE_SPORTS } from './sportType.js'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_JSON_BYTES = 8 * 1024 * 1024
export const MAX_SAMPLES = 50000 // ~13.9 h at 1 Hz
export const MIN_SAMPLES = 60
export const DEFAULT_SPORT = 'virtual'
export const FILE_EXTENSIONS = ['fit', 'tcx', 'gpx']

// JSON stream name -> analyzeStreams stream type.
const STREAM_TYPES = {
  power: 'watts',
  heart_rate: 'heartrate',
  cadence: 'cadence',
  speed: 'velocity_smooth', // m/s
  distance: 'distance', // m, cumulative
  altitude: 'altitude', // m
}

export class UploadValidationError extends Error {
  constructor(message, status = 422, code = 'invalid_request') {
    super(message)
    this.status = status
    this.code = code
  }
}

const bad = (msg, status, code) => {
  throw new UploadValidationError(msg, status, code)
}

/** Partner-chosen id, kept short and boring: it ends up in a unique index and in logs. */
export function validateExternalId(value) {
  const id = String(value ?? '').trim()
  if (!/^[A-Za-z0-9._:\-]{1,128}$/.test(id)) bad('external_id is required (1-128 chars: letters, digits, . _ : -)')
  return id
}

export function validateSport(value) {
  if (value == null || value === '') return DEFAULT_SPORT
  const s = String(value).trim().toLowerCase()
  if (!RIDE_SPORTS.includes(s)) bad(`sport must be one of: ${RIDE_SPORTS.join(', ')}`)
  return s
}

export function validateTitle(value) {
  if (value == null || value === '') return null
  return String(value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) || null
}

/** ISO 8601 with an explicit zone; not in the future (+5 min clock skew) and not before 2000. */
export function validateStartTime(value, now = Date.now()) {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    bad('start_time must be an ISO 8601 timestamp with a time zone, e.g. 2026-11-04T07:30:00Z')
  }
  const ms = Date.parse(raw)
  if (Number.isNaN(ms) || ms < Date.UTC(2000, 0, 1) || ms > now + 5 * 60 * 1000) bad('start_time is out of range')
  const off = /([+-])(\d{2}):?(\d{2})$/.exec(raw)
  const offsetMin = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0
  return { iso: new Date(ms).toISOString(), offsetMin }
}

/** Local wall-clock stamp "YYYY-MM-DDTHH:mm:ss" (what the providers call start_date_local). */
export function localStamp(iso, offsetMin = 0) {
  return new Date(Date.parse(iso) + offsetMin * 60000).toISOString().slice(0, 19)
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function cleanSeries(name, arr, n, { min, max }) {
  if (!Array.isArray(arr)) bad(`streams.${name} must be an array`)
  if (arr.length !== n) bad(`streams.${name} has ${arr.length} samples, expected ${n} (all streams are 1 Hz and equally long)`)
  return arr.map((v) => {
    const x = finiteOrNull(v)
    if (x == null) return 0
    if (x < min || x > max) bad(`streams.${name} has a value outside ${min}..${max}`)
    return x
  })
}

const RANGES = {
  power: { min: 0, max: 3000 },
  heart_rate: { min: 0, max: 260 },
  cadence: { min: 0, max: 300 },
  speed: { min: 0, max: 60 },
  distance: { min: 0, max: 1_000_000 },
  altitude: { min: -500, max: 9000 },
}

/**
 * Validates a JSON upload body and returns normalised data.
 * Body: { external_id, start_time, title?, sport?, streams: { power?, heart_rate?, cadence?, speed?, distance?, altitude? } }
 */
export function parseJsonUpload(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('JSON object expected')
  const externalId = validateExternalId(body.external_id)
  const start = validateStartTime(body.start_time, now)
  const streams = body.streams
  if (!streams || typeof streams !== 'object') bad('streams is required')
  const unknown = Object.keys(streams).filter((k) => !(k in STREAM_TYPES))
  if (unknown.length) bad(`Unknown streams: ${unknown.join(', ')}`)
  const lengths = Object.values(streams).map((a) => (Array.isArray(a) ? a.length : -1))
  const n = lengths[0]
  if (!lengths.length || n < MIN_SAMPLES) bad(`At least ${MIN_SAMPLES} samples (1 Hz) are required`)
  if (n > MAX_SAMPLES) bad(`At most ${MAX_SAMPLES} samples are accepted`, 413, 'too_large')
  if (!('power' in streams) && !('heart_rate' in streams) && !('speed' in streams) && !('distance' in streams)) {
    bad('Provide at least one of power, heart_rate, speed or distance')
  }
  const list = Object.entries(streams).map(([name, arr]) => ({
    type: STREAM_TYPES[name],
    data: cleanSeries(name, arr, n, RANGES[name]),
  }))
  return {
    externalId,
    title: validateTitle(body.title),
    sport: validateSport(body.sport),
    start,
    samples: n,
    streams: list,
  }
}

// ---- GPX / TCX -------------------------------------------------------------------------------------------

function assertSafeXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) bad('XML with a DOCTYPE or entities is not accepted')
}

const num = (s) => {
  if (s == null) return null
  const v = Number(String(s).trim())
  return Number.isFinite(v) ? v : null
}

function tag(block, names) {
  for (const n of names) {
    const m = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${n}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*<`, 'i').exec(block)
    if (m) return m[1]
  }
  return null
}

function blocks(text, name) {
  const out = []
  const re = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${name}>`, 'gi')
  let m
  while ((m = re.exec(text))) out.push({ attrs: m[0].slice(0, m[0].indexOf('>')), body: m[1] })
  return out
}

/** Points -> 1 Hz series (last known value carried forward); returns the stream list + first timestamp. */
export function resamplePoints(points) {
  const pts = points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t)
  if (pts.length < 2) bad('The file has no usable time-stamped track points')
  const t0 = pts[0].t
  const n = Math.floor((pts[pts.length - 1].t - t0) / 1000) + 1
  if (n < MIN_SAMPLES) bad(`The activity is too short (minimum ${MIN_SAMPLES} s)`)
  if (n > MAX_SAMPLES) bad(`At most ${MAX_SAMPLES} s of activity are accepted`, 413, 'too_large')
  const keys = ['watts', 'heartrate', 'cadence', 'velocity_smooth', 'distance', 'altitude', 'lat', 'lon']
  const series = Object.fromEntries(keys.map((k) => [k, new Array(n).fill(null)]))
  let pi = 0
  let last = {}
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 1000
    while (pi < pts.length && pts[pi].t <= t) {
      last = { ...last, ...Object.fromEntries(Object.entries(pts[pi]).filter(([k, v]) => k !== 't' && v != null)) }
      pi++
    }
    for (const k of keys) series[k][i] = last[k] ?? null
  }
  const list = []
  for (const k of ['watts', 'heartrate', 'cadence', 'velocity_smooth', 'distance', 'altitude']) {
    if (series[k].some((v) => v != null)) list.push({ type: k, data: series[k].map((v) => v ?? 0) })
  }
  if (series.lat.some((v) => v != null) && series.lon.some((v) => v != null)) {
    list.push({ type: 'latlng', data: series.lat.map((v) => v ?? 0), data2: series.lon.map((v) => v ?? 0) })
  }
  return { streams: list, startMs: t0, samples: n }
}

export function parseGpx(text) {
  assertSafeXml(text)
  if (!/<gpx[\s>]/i.test(text)) bad('Not a GPX file')
  const points = blocks(text, 'trkpt').map(({ attrs, body }) => {
    const lat = num(/lat\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1])
    const lon = num(/lon\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1])
    const time = tag(body, ['time'])
    return {
      t: time ? Date.parse(time) : NaN,
      lat,
      lon,
      altitude: num(tag(body, ['ele'])),
      heartrate: num(tag(body, ['hr'])),
      cadence: num(tag(body, ['cad'])),
      watts: num(tag(body, ['power', 'watts', 'PowerInWatts'])),
    }
  })
  return resamplePoints(points)
}

export function parseTcx(text) {
  assertSafeXml(text)
  if (!/<TrainingCenterDatabase[\s>]/i.test(text)) bad('Not a TCX file')
  const points = blocks(text, 'Trackpoint').map(({ body }) => {
    const time = tag(body, ['Time'])
    return {
      t: time ? Date.parse(time) : NaN,
      lat: num(tag(body, ['LatitudeDegrees'])),
      lon: num(tag(body, ['LongitudeDegrees'])),
      altitude: num(tag(body, ['AltitudeMeters'])),
      distance: num(tag(body, ['DistanceMeters'])),
      heartrate: num(blocks(body, 'HeartRateBpm')[0] ? tag(blocks(body, 'HeartRateBpm')[0].body, ['Value']) : null),
      cadence: num(tag(body, ['Cadence'])),
      watts: num(tag(body, ['Watts'])),
      velocity_smooth: num(tag(body, ['Speed'])),
    }
  })
  return resamplePoints(points)
}

/** File extension of an upload name, lower-case, or null. */
export function fileExtension(name) {
  const m = /\.([A-Za-z0-9]{2,4})$/.exec(String(name ?? ''))
  return m ? m[1].toLowerCase() : null
}

/** Rows of an upload body as the API reports them. */
export function uploadView(row) {
  if (!row) return null
  return {
    id: row.id,
    external_id: row.external_id,
    status: row.status,
    activity_id: row.activity_id ?? null,
    error: row.error ?? null,
    created_at: row.created_at,
  }
}
