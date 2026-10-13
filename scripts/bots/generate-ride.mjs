import { createRng } from './prng.mjs'
import { ANCHOR_DATE } from './personas.mjs'

const WHEEL_DEV_M = 2.096 // 700c development per wheel revolution
const MAX_TREND = 0.15
const RHO = 1.2
const MASS_KG = 85

const dayMs = 86400000
const dayOfWeek = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay()

export function decideRide(persona, dateStr) {
  const rng = createRng(`${persona.key}|${dateStr}|decide`)
  return rng.next() < persona.weekly[dayOfWeek(dateStr)]
}

export function fitnessFactor(persona, dateStr) {
  const weeks = (Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${ANCHOR_DATE}T00:00:00Z`)) / (7 * dayMs)
  const trend = Math.max(-MAX_TREND, Math.min(MAX_TREND, persona.weeklyGain * weeks))
  const form = createRng(`${persona.key}|${dateStr}|form`).normal(0, 0.04)
  return 1 + trend + form
}

// Steady-state speed (m/s) for a given power: P = k*v^3 + crr*m*g*v (drafting reduces k).
function speedFromPower(power, cdaMod, draft) {
  const k = 0.5 * RHO * 0.22 * cdaMod * draft
  const roll = 0.003 * MASS_KG * 9.81
  let v = 10
  for (let i = 0; i < 30; i++) {
    const f = k * v ** 3 + roll * v - power
    v -= f / (3 * k * v * v + roll)
  }
  return Math.max(v, 0)
}

function pickSession(persona, rng) {
  const entries = Object.entries(persona.sessions)
  let r = rng.next() * entries.reduce((s, [, w]) => s + w, 0)
  for (const [name, w] of entries) {
    if ((r -= w) <= 0) return name
  }
  return entries[0][0]
}

// Segments are {sec, power, draft, label}; the power target is smoothed afterwards.
function buildPlan(type, persona, factor, rng, trackLen) {
  const ftp = persona.ftp * factor
  const seg = []
  const add = (sec, power, draft = 0.75, label = '') => seg.push({ sec: Math.round(sec), power, draft, label })
  const lapSec = (v) => trackLen / Math.max(v, 1)

  add(rng.range(480, 720), ftp * 0.5, 0.8, 'warmup')

  if (type === 'flying') {
    const efforts = rng.int(4, 6)
    for (let i = 0; i < efforts; i++) {
      add(rng.range(120, 180), ftp * 0.55, 0.8, 'recovery')
      // Two build-up laps, then the flying 200 m (~1 lap = 250 m: effort of ~13-14 s)
      add(2 * lapSec(12) , ftp * 0.9, 0.8, 'build')
      const peak = persona.peakPower * factor * rng.range(0.85, 1.0)
      add(Math.max(trackLen * 0.8 / speedFromPower(peak, persona.cdaMod, 1), 9), peak, 1, 'flying')
      add(rng.range(90, 150), ftp * 0.35, 0.8, 'cooldown-lap')
    }
  } else if (type === 'pack') {
    const blocks = rng.int(5, 8)
    for (let i = 0; i < blocks; i++) {
      add(rng.range(240, 420), ftp * rng.range(0.7, 0.85), 0.6, 'pack')
      const surges = rng.int(2, 4)
      for (let s = 0; s < surges; s++) {
        add(rng.range(8, 20), ftp * rng.range(1.5, 2.4), 0.85, 'surge')
        add(rng.range(40, 90), ftp * 0.65, 0.6, 'pack')
      }
      add(rng.range(120, 180), ftp * 0.45, 0.8, 'recovery')
    }
  } else {
    const total = rng.range(2400, 5400)
    let t = 0
    while (t < total) {
      const d = rng.range(300, 600)
      add(d, ftp * rng.range(0.62, 0.8), 0.6, 'endurance')
      t += d
    }
  }
  add(rng.range(300, 420), ftp * 0.4, 0.8, 'cooldown')
  return seg
}

// Oval of total length `len` centred on (lat0, lng0): two straights + two semicircles.
function trackPosition(distM, len, lat0, lng0) {
  const r = len / (2 * Math.PI + 4) // straight length = 2r => len = 2*pi*r + 2*2r
  const straight = 2 * r
  const s = ((distM % len) + len) % len
  let x
  let y
  if (s < straight) { x = -r + s; y = -r }
  else if (s < straight + Math.PI * r) {
    const a = (s - straight) / r
    x = r + r * Math.sin(a); y = -r * Math.cos(a)
  } else if (s < 2 * straight + Math.PI * r) {
    x = r - (s - straight - Math.PI * r); y = r
  } else {
    const a = (s - 2 * straight - Math.PI * r) / r
    x = -r - r * Math.sin(a); y = r * Math.cos(a)
  }
  return {
    lat: lat0 + y / 111320,
    lng: lng0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180)),
  }
}

/**
 * @returns {null | {title, type, startTime: Date, records: object[], gear}} 1 Hz records:
 *   {t, power, cadence, speedMs, hr, distance, lat, lng, altitude}
 */
export function generateRide(persona, dateStr, { trackLengthM = 250, lat = 43.5, lng = -79.9, altitude = 200 } = {}) {
  if (!decideRide(persona, dateStr)) return null

  const rng = createRng(`${persona.key}|${dateStr}|ride`)
  const factor = fitnessFactor(persona, dateStr)
  const type = pickSession(persona, rng)
  const plan = buildPlan(type, persona, factor, rng, trackLengthM)
  const dev = (persona.gear.chainring / persona.gear.cog) * WHEEL_DEV_M

  const start = new Date(`${dateStr}T00:00:00Z`)
  start.setUTCHours(persona.startHour, rng.int(0, 45), rng.int(0, 59))

  const records = []
  let power = plan[0].power
  let v = 0
  let dist = 0
  const hrBase = 62
  let hr = 90

  for (const s of plan) {
    for (let i = 0; i < s.sec; i++) {
      // Fast ramp for sprints, slower otherwise
      const tau = s.label === 'flying' || s.label === 'surge' ? 1.5 : 4
      power += (s.power - power) / tau
      const noisy = Math.max(0, power + rng.normal(0, Math.max(5, power * 0.04)))
      const vt = speedFromPower(power, persona.cdaMod, s.draft)
      v += (vt - v) * 0.15
      // Fixed gear: cadence follows speed; cap at the rider's realistic maximum
      const cadence = Math.min(persona.cadenceCap, (v / dev) * 60 + rng.normal(0, 1.2))
      dist += v
      const hrTarget = hrBase + 110 * Math.min(1.1, power / (persona.ftp * factor)) * 0.85
      hr += (hrTarget - hr) * 0.03
      const pos = trackPosition(dist, trackLengthM, lat, lng)
      records.push({
        t: records.length,
        power: Math.round(noisy),
        cadence: Math.max(0, Math.round(cadence)),
        speedMs: Math.max(0, v + rng.normal(0, 0.05)),
        hr: Math.round(Math.min(195, hr + rng.normal(0, 1))),
        distance: dist,
        lat: pos.lat,
        lng: pos.lng,
        altitude,
      })
    }
  }

  const label = { flying: 'Flying 200s', pack: 'Pack session', endurance: 'Endurance laps' }[type]
  return {
    title: `${label} (bot)`,
    type,
    startTime: start,
    records,
    gear: persona.gear,
  }
}
