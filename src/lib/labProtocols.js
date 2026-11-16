// Lab protocol runner (docs/lab/protocol-runner.md): guided field tests, their structured workouts
// and the pure result calculation from an activity's power stream. Estimates are only proposals;
// applying them to the profile goes through applyThresholds.js.
import { bestWindow } from './thresholdEstimates.js'

export const LAB_PROTOCOL_IDS = Object.freeze(['ftp_ramp', 'ftp_20', 'ftp_8', 'cp3_12', 'cp5_20'])
export const LAB_RUN_STATUSES = Object.freeze(['planned', 'completed', 'applied', 'cancelled'])
export const LAB_RESULT_MAX_BYTES = 8000

const rampDsl = () => {
  const lines = ['recovery 10min ±0% @ <55%FTP']
  for (let pct = 50, i = 0; pct <= 140; pct += 6, i++) lines.push(`work 1min ±0% @ ${pct}-${pct + 5}%FTP`)
  lines.push('recovery 10min ±0% @ <50%FTP')
  return lines.join('\n')
}

const cpDsl = (a, b) =>
  [
    'recovery 15min ±0% @ <70%FTP',
    `work ${a}min ±0% @ best`,
    'recovery 30min ±0% @ <60%FTP',
    `work ${b}min ±0% @ best`,
    'recovery 10min ±0% @ <55%FTP',
  ].join('\n')

export const LAB_PROTOCOLS = Object.freeze({
  ftp_ramp: {
    id: 'ftp_ramp',
    label: 'FTP ramp test',
    summary: 'Stepped ramp to exhaustion; FTP = 75% of the best 1 minute.',
    efforts: [60],
    steps: [
      'Fresh legs: no hard riding the day before. Same time of day and setup as usual.',
      'Warm up 10 minutes easy. Then ride 1-minute steps from about 50% FTP, +6% every minute.',
      'Keep going until you cannot hold the step. Do not hold back; press lap or stop only at failure.',
      'Cool down 10 minutes easy.',
    ],
    dsl: rampDsl(),
    ftp: ({ efforts }) => (efforts[0] ? Math.round(efforts[0].avgW * 0.75) : null),
  },
  ftp_20: {
    id: 'ftp_20',
    label: '20-minute test',
    summary: 'One maximal 20-minute effort; FTP = 95% of the average.',
    efforts: [1200],
    steps: [
      'Warm up 20 minutes easy with 3 x 1 minute harder, then 5 minutes easy.',
      'Optional: one 5-minute hard effort, then 10 minutes easy to clear the legs.',
      'Ride 20 minutes as hard as you can sustain evenly. Start controlled, finish empty.',
      'Cool down 10 minutes easy.',
    ],
    dsl: ['recovery 20min ±0% @ <65%FTP', 'work 5min ±0% @ 100-115%FTP', 'recovery 10min ±0% @ <55%FTP', 'work 20min ±0% @ best', 'recovery 10min ±0% @ <55%FTP'].join('\n'),
    ftp: ({ efforts }) => (efforts[0] ? Math.round(efforts[0].avgW * 0.95) : null),
  },
  ftp_8: {
    id: 'ftp_8',
    label: '8-minute test',
    summary: 'Two maximal 8-minute efforts; FTP = 90% of the better average.',
    efforts: [480],
    steps: [
      'Warm up 20 minutes easy with 3 x 1 minute harder.',
      'Ride 8 minutes all-out but evenly paced. Recover 10 minutes easy.',
      'Repeat the 8-minute effort. The better of the two counts.',
      'Cool down 10 minutes easy.',
    ],
    dsl: ['recovery 20min ±0% @ <65%FTP', 'work 8min ±0% @ best', 'recovery 10min ±0% @ <55%FTP', 'work 8min ±0% @ best', 'recovery 10min ±0% @ <55%FTP'].join('\n'),
    ftp: ({ efforts }) => (efforts[0] ? Math.round(efforts[0].avgW * 0.9) : null),
  },
  cp3_12: {
    id: 'cp3_12',
    label: 'CP3/CP12 test',
    summary: 'Maximal 3 and 12 minute efforts; critical power and W′ from the two-point model.',
    efforts: [180, 720],
    steps: [
      'Warm up 15 minutes easy with 2 x 1 minute harder.',
      'Ride 3 minutes all-out (steady maximal pacing, not a sprint start).',
      'Recover 30 minutes very easy. Eat and drink a little.',
      'Ride 12 minutes all-out. Cool down 10 minutes easy.',
    ],
    dsl: cpDsl(3, 12),
    cp: true,
  },
  cp5_20: {
    id: 'cp5_20',
    label: 'CP5/CP20 test',
    summary: 'Maximal 5 and 20 minute efforts; critical power and W′ from the two-point model.',
    efforts: [300, 1200],
    steps: [
      'Warm up 15 minutes easy with 2 x 1 minute harder.',
      'Ride 5 minutes all-out with even pacing.',
      'Recover 30 minutes very easy. Eat and drink a little.',
      'Ride 20 minutes all-out with even pacing. Cool down 10 minutes easy.',
    ],
    dsl: cpDsl(5, 20),
    cp: true,
  },
})

export const isLabProtocol = (id) => LAB_PROTOCOL_IDS.includes(id)

/** Brief text stored as the planned workout description. */
export function protocolDescription(id) {
  const p = LAB_PROTOCOLS[id]
  if (!p) return ''
  return `${p.summary}\n\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`.slice(0, 2000)
}

/** Two-point critical power model: work = CP * t + W'. Returns { cp, wPrime } or null when implausible. */
export function criticalPower(short, long) {
  if (!short || !long || long.durationSec <= short.durationSec) return null
  const w1 = short.avgW * short.durationSec
  const w2 = long.avgW * long.durationSec
  const cp = (w2 - w1) / (long.durationSec - short.durationSec)
  const wPrime = w1 - cp * short.durationSec
  if (!(cp > 0) || !(wPrime > 0) || cp >= long.avgW) return null
  return { cp: Math.round(cp), wPrime: Math.round(wPrime) }
}

/** Best non-overlapping-agnostic efforts of the protocol in a watts stream. */
export function detectEfforts(protocolId, watts) {
  const p = LAB_PROTOCOLS[protocolId]
  if (!p || !Array.isArray(watts)) return []
  const out = []
  for (const durationSec of p.efforts) {
    const w = bestWindow(watts, 0, watts.length, durationSec)
    if (!w) return []
    out.push({ durationSec, avgW: Math.round(w.avg), startSec: w.start })
  }
  return out
}

/**
 * Result of a protocol for a watts stream: { protocol, efforts, ftp?, cp?, wPrime?, proposals, warnings }
 * or null when the stream is too short / has no usable power.
 */
export function computeProtocolResult(protocolId, watts) {
  const p = LAB_PROTOCOLS[protocolId]
  const efforts = detectEfforts(protocolId, watts)
  if (!p || efforts.length !== p.efforts.length || efforts.some((e) => !(e.avgW > 0))) return null
  const result = { protocol: protocolId, efforts, proposals: [], warnings: [] }
  if (p.ftp) {
    const ftp = p.ftp({ efforts })
    if (ftp) {
      result.ftp = ftp
      result.proposals.push({ field: 'ftp', value: ftp, label: `FTP ${ftp} W` })
    }
  }
  if (p.cp) {
    const m = criticalPower(efforts[0], efforts[1])
    if (!m) result.warnings.push('The two efforts do not give a plausible critical power; check the pacing or repeat the test.')
    else {
      result.cp = m.cp
      result.wPrime = m.wPrime
      result.proposals.push({ field: 'ftp', value: m.cp, label: `FTP ${m.cp} W (from critical power)` })
    }
  }
  if (efforts.length === 2 && efforts[1].startSec < efforts[0].startSec + efforts[0].durationSec) {
    result.warnings.push('The two best efforts overlap; the ride may not be two separate efforts.')
  }
  return result
}

/** Validates a result object before it is stored (the database re-checks size and shape). */
export function validateLabResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { error: 'Invalid result' }
  if (!isLabProtocol(result.protocol)) return { error: 'Unknown protocol' }
  if (JSON.stringify(result).length > LAB_RESULT_MAX_BYTES) return { error: 'Result is too large' }
  return { result }
}

/** Picks the activity with the strongest proposal among candidates ({ activity, result }). */
export function pickBestCandidate(candidates) {
  const ok = (candidates || []).filter((c) => c?.result)
  if (!ok.length) return null
  const score = (c) => c.result.proposals[0]?.value ?? c.result.efforts[0]?.avgW ?? 0
  return ok.reduce((a, b) => (score(b) > score(a) ? b : a))
}
