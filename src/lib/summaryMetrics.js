// src/lib/summaryMetrics.js
//
// Template-selectable summary metrics (issue #127). A template lists the
// metrics it wants with a `metrics` DSL line (stored as `manifest.summary_metrics`);
// after detection, `applySummaryMetrics` adds them to every work effort and an
// aggregate to the run summary. Metrics are purely additive: templates that
// select none keep their output unchanged.
//
// Plain JS (no Node-only APIs): the parser and the UI import the catalog.

import { secondsInLtZone } from './lactateThresholds.js'
import { wattsPerKg } from './wkg.js'
import { ZONE_COUNT, ZONE_NAMES, zoneSeconds } from './powerZones.js'

/** Default HR recovery window (seconds) when `hr_recovery` has no explicit `(<n>sec)`. */
export const DEFAULT_HR_RECOVERY_WINDOW_SEC = 60

/**
 * Catalog. `key` is the flat field written to each effort and to the summary
 * (`hr_recovery` derives its key from its window); `agg` says how the work
 * efforts' values combine into the summary value.
 */
export const SUMMARY_METRICS = {
  avg_power: { key: 'avg_power', label: 'Average power (W)', agg: 'mean' },
  max_power: { key: 'max_power', label: 'Peak power (W)', agg: 'max' },
  np: { key: 'np_w', label: 'Normalized power (W, 30s rolling; efforts of 30s or more)', agg: 'mean' },
  vi: { key: 'vi', label: 'Variability index (NP / average power)', agg: 'mean' },
  if: { key: 'intensity_factor', label: 'Intensity factor (NP / FTP)', agg: 'mean' },
  avg_wkg: { key: 'avg_wkg', label: 'Average power-to-weight (W/kg; needs a weight)', agg: 'mean' },
  max_wkg: { key: 'max_wkg', label: 'Peak power-to-weight (W/kg; needs a weight)', agg: 'max' },
  np_wkg: { key: 'np_wkg', label: 'Normalized power-to-weight (W/kg; needs a weight)', agg: 'mean' },
  avg_hr: { key: 'avg_hr_bpm', label: 'Average heart rate (bpm)', agg: 'mean' },
  max_hr: { key: 'max_hr_bpm', label: 'Peak heart rate (bpm)', agg: 'max' },
  avg_cadence: { key: 'avg_cadence_rpm', label: 'Average cadence (rpm)', agg: 'mean' },
  max_cadence: { key: 'max_cadence_rpm', label: 'Peak cadence (rpm)', agg: 'max' },
  avg_speed: { key: 'avg_speed_kmh', label: 'Average speed (km/h)', agg: 'mean' },
  max_speed: { key: 'max_speed_kmh', label: 'Peak speed (km/h)', agg: 'max' },
  work_kj: { key: 'work_kj', label: 'Work done (kJ)', agg: 'sum' },
  pacing: { key: 'pacing_index', label: 'Pacing index (2nd half / 1st half, %)', agg: 'mean' },
  dropoff: { key: 'dropoff_pct', label: 'Drop-off (% below the best rep; summary = last rep vs best)', agg: 'series' },
  decoupling: { key: 'pw_hr_decoupling_pct', label: 'Power:HR decoupling (%)', agg: 'mean' },
  time_below_lt1: { key: 'time_below_lt1_s', label: 'Time below LT1 power (s)', agg: 'sum', lt: { stream: 'watts', zone: 'below_lt1', t1: 'lt1Power', t2: 'lt2Power' } },
  time_lt1_lt2: { key: 'time_lt1_lt2_s', label: 'Time between LT1 and LT2 power (s)', agg: 'sum', lt: { stream: 'watts', zone: 'lt1_lt2', t1: 'lt1Power', t2: 'lt2Power' } },
  time_above_lt2: { key: 'time_above_lt2_s', label: 'Time above LT2 power (s)', agg: 'sum', lt: { stream: 'watts', zone: 'above_lt2', t1: 'lt1Power', t2: 'lt2Power' } },
  time_below_lt1_hr: { key: 'time_below_lt1_hr_s', label: 'Time below LT1 heart rate (s)', agg: 'sum', lt: { stream: 'hr', zone: 'below_lt1', t1: 'lt1Hr', t2: 'lt2Hr' } },
  time_lt1_lt2_hr: { key: 'time_lt1_lt2_hr_s', label: 'Time between LT1 and LT2 heart rate (s)', agg: 'sum', lt: { stream: 'hr', zone: 'lt1_lt2', t1: 'lt1Hr', t2: 'lt2Hr' } },
  time_above_lt2_hr: { key: 'time_above_lt2_hr_s', label: 'Time above LT2 heart rate (s)', agg: 'sum', lt: { stream: 'hr', zone: 'above_lt2', t1: 'lt1Hr', t2: 'lt2Hr' } },
  ...Object.fromEntries(
    Array.from({ length: ZONE_COUNT }, (_, i) => [
      `time_z${i + 1}`,
      { key: `time_z${i + 1}_s`, label: `Time in power zone Z${i + 1} ${ZONE_NAMES[i]} (s; needs LT or FTP)`, agg: 'sum', zone: i + 1 },
    ])
  ),
  hr_recovery: { key: 'hr_recovery', label: 'HR recovery (bpm dropped N seconds after the effort)', agg: 'mean' },
}

export const SUMMARY_METRIC_IDS = Object.keys(SUMMARY_METRICS)

/** Summary/effort field written for a selected metric. */
export function summaryMetricKey(metric) {
  const def = SUMMARY_METRICS[metric.id]
  if (!def) return null
  if (metric.id === 'hr_recovery') return `hr_recovery_${windowOf(metric)}s`
  return def.key
}

function windowOf(metric) {
  return metric.window_sec ?? metric.windowSec ?? DEFAULT_HR_RECOVERY_WINDOW_SEC
}

const round1 = (v) => Math.round(v * 10) / 10
const round2 = (v) => Math.round(v * 100) / 100

function nums(arr) {
  return arr.filter((v) => typeof v === 'number' && !Number.isNaN(v))
}

function mean(arr) {
  const v = nums(arr)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function sliceStream(stream, start, end) {
  return Array.isArray(stream) && stream.length ? stream.slice(start, Math.min(end, stream.length)) : []
}

/** Normalized power: 4th-root of the mean 4th power of the 30s rolling average. Needs >= 30 samples. */
export function normalizedPower(watts) {
  const w = watts.map((v) => v || 0)
  if (w.length < 30) return null
  let sum = w.slice(0, 30).reduce((a, b) => a + b, 0)
  let acc = Math.pow(sum / 30, 4)
  let count = 1
  for (let i = 30; i < w.length; i++) {
    sum += w[i] - w[i - 30]
    acc += Math.pow(sum / 30, 4)
    count++
  }
  return Math.pow(acc / count, 0.25)
}

/** Power:HR decoupling: relative drop of the second half's W/bpm vs the first half's. */
export function powerHrDecoupling(watts, hr) {
  const n = Math.min(watts.length, hr.length)
  if (n < 4) return null
  const mid = Math.floor(n / 2)
  const ratio = (from, to) => {
    const w = mean(watts.slice(from, to))
    const h = mean(hr.slice(from, to))
    return h ? w / h : null
  }
  const first = ratio(0, mid)
  const second = ratio(mid, n)
  if (!first || second == null) return null
  return round1(((first - second) / first) * 100)
}

/** Pacing index: second-half average / first-half average of a slice, in %. */
export function pacingIndexOf(stream, start, end) {
  if (!Array.isArray(stream) || end - start < 4) return null
  const mid = start + Math.floor((end - start) / 2)
  const first = mean(stream.slice(start, mid))
  const second = mean(stream.slice(mid, end))
  if (!first || second == null) return null
  return round1((second / first) * 100)
}

/** Drop-off %: decline of the last value vs the best value in the series. */
export function dropoffOf(values) {
  const valid = nums(values)
  if (valid.length < 2) return null
  const best = Math.max(...valid)
  if (!best) return null
  return round1(((best - valid[valid.length - 1]) / best) * 100)
}

function hrRecoveryOf(hr, end, windowSec) {
  if (!Array.isArray(hr) || !hr.length) return null
  // From the effort's last sample to `windowSec` seconds later.
  const last = end - 1
  const after = last + windowSec
  if (last < 0 || after >= hr.length) return null
  const a = hr[last]
  const b = hr[after]
  if (!a || !b) return null
  return Math.round(a - b)
}

function effortValue(metric, effort, streams, ftp, lt, weightKg = null, zones = null) {
  const { watts, hr, cadence, speed } = streams
  const { start_sec: s, end_sec: e } = effort
  const ltDef = SUMMARY_METRICS[metric.id]?.lt
  const zoneNo = SUMMARY_METRICS[metric.id]?.zone
  if (zoneNo) {
    const secs = zoneSeconds(sliceStream(watts, s, e), zones)
    return secs ? secs[zoneNo - 1] : null
  }
  if (ltDef) {
    return lt ? secondsInLtZone(sliceStream(streams[ltDef.stream], s, e), ltDef.zone, lt[ltDef.t1], lt[ltDef.t2]) : null
  }
  switch (metric.id) {
    case 'avg_power': {
      const v = mean(sliceStream(watts, s, e))
      return v == null ? null : Math.round(v)
    }
    case 'max_power': {
      const v = nums(sliceStream(watts, s, e))
      return v.length ? Math.max(...v) : null
    }
    case 'np': {
      const v = normalizedPower(sliceStream(watts, s, e))
      return v == null ? null : Math.round(v)
    }
    case 'vi': {
      const np = normalizedPower(sliceStream(watts, s, e))
      const avg = mean(sliceStream(watts, s, e))
      return np && avg ? round2(np / avg) : null
    }
    case 'if': {
      const np = normalizedPower(sliceStream(watts, s, e))
      return np && ftp ? round2(np / ftp) : null
    }
    case 'avg_wkg': {
      const v = mean(sliceStream(watts, s, e))
      return v == null ? null : wattsPerKg(v, weightKg)
    }
    case 'max_wkg': {
      const v = nums(sliceStream(watts, s, e))
      return v.length ? wattsPerKg(Math.max(...v), weightKg) : null
    }
    case 'np_wkg': {
      const v = normalizedPower(sliceStream(watts, s, e))
      return v == null ? null : wattsPerKg(v, weightKg)
    }
    case 'avg_hr': {
      const v = mean(nums(sliceStream(hr, s, e)).filter((x) => x > 0))
      return v == null ? null : Math.round(v)
    }
    case 'max_hr': {
      const v = nums(sliceStream(hr, s, e))
      return v.length ? Math.max(...v) : null
    }
    case 'avg_cadence': {
      const v = mean(sliceStream(cadence, s, e))
      return v == null ? null : Math.round(v)
    }
    case 'max_cadence': {
      const v = nums(sliceStream(cadence, s, e))
      return v.length ? Math.max(...v) : null
    }
    case 'avg_speed': {
      const v = mean(sliceStream(speed, s, e))
      return v == null ? null : round1(v)
    }
    case 'max_speed': {
      const v = nums(sliceStream(speed, s, e))
      return v.length ? round1(Math.max(...v)) : null
    }
    case 'work_kj': {
      const v = nums(sliceStream(watts, s, e))
      return v.length ? round1(v.reduce((a, b) => a + b, 0) / 1000) : null
    }
    case 'pacing':
      return pacingIndexOf(watts && watts.length ? watts : speed, s, e)
    case 'decoupling':
      return powerHrDecoupling(sliceStream(watts, s, e), sliceStream(hr, s, e))
    case 'hr_recovery':
      return hrRecoveryOf(hr, e, windowOf(metric))
    default:
      return null
  }
}

function aggregate(def, values) {
  const v = nums(values)
  if (!v.length) return null
  if (def.agg === 'max') return Math.max(...v)
  if (def.agg === 'sum') return round1(v.reduce((a, b) => a + b, 0))
  const m = mean(v)
  // Keep the per-effort precision: integer metrics stay integers, ratios keep 2 decimals.
  return Number.isInteger(v[0]) && v.every(Number.isInteger) ? Math.round(m) : round2(m)
}

/**
 * Add the template's selected summary metrics to an evaluation result.
 * @param {Array<{id: string, window_sec?: number}>} metrics - `manifest.summary_metrics`
 * @param {{efforts: object[], summary: object}} result
 * @param {object} timeSeries - { watts, heartrate, cadence, speed }
 * @param {number|null} ftp
 * @param {{lt1Power, lt1Hr, lt2Power, lt2Hr}|null} lt - the activity's lactate threshold snapshot
 * @param {number|null} weightKg - the activity's body weight snapshot (W/kg metrics are null without it)
 * @param {object|null} zones - the activity's resolved power zones (see zonesFromActivity); time_z1..z6 are null without it
 * @returns the same result shape (a new object when metrics are applied).
 */
export function applySummaryMetrics(metrics, result, timeSeries = {}, ftp = null, lt = null, weightKg = null, zones = null) {
  const selected = (Array.isArray(metrics) ? metrics : []).filter((m) => m && SUMMARY_METRICS[m.id])
  if (!selected.length || !result || !Array.isArray(result.efforts) || !result.efforts.length) return result

  const streams = {
    watts: timeSeries.watts,
    hr: timeSeries.heartrate,
    cadence: timeSeries.cadence,
    speed: timeSeries.speed,
  }
  const isWork = (e) => e.role === undefined || e.role === 'work'
  const workIdx = result.efforts.map((e, i) => (isWork(e) ? i : -1)).filter((i) => i >= 0)

  const extras = new Map() // effort index -> { key: value }
  const summaryExtras = {}

  for (const metric of selected) {
    const def = SUMMARY_METRICS[metric.id]
    const key = summaryMetricKey(metric)
    const values = workIdx.map((i) => {
      const e = result.efforts[i]
      if (metric.id === 'dropoff') return null // filled in below, needs the whole series
      return effortValue(metric, e, streams, ftp, lt, weightKg, zones)
    })

    if (metric.id === 'dropoff') {
      const powers = workIdx.map((i) => {
        const e = result.efforts[i]
        const w = mean(sliceStream(streams.watts, e.start_sec, e.end_sec))
        return w == null ? (typeof e.avg_speed_kmh === 'number' ? e.avg_speed_kmh : null) : w
      })
      const best = Math.max(...nums(powers))
      workIdx.forEach((i, n) => {
        const v = typeof powers[n] === 'number' && best ? round1(((best - powers[n]) / best) * 100) : null
        extras.set(i, { ...(extras.get(i) || {}), [key]: v })
      })
      summaryExtras[key] = dropoffOf(powers)
      continue
    }

    workIdx.forEach((i, n) => {
      if (metric._default && values[n] == null) return
      extras.set(i, { ...(extras.get(i) || {}), [key]: values[n] })
    })
    const agg = aggregate(def, values)
    if (!(metric._default && agg == null)) summaryExtras[key] = agg
  }

  const efforts = result.efforts.map((e, i) => {
    const add = extras.get(i)
    if (!add) return e
    const merged = { ...e }
    // Never overwrite a value the detector/evaluator already computed (e.g. avg_power).
    for (const [k, v] of Object.entries(add)) if (merged[k] === undefined || merged[k] === null) merged[k] = v
    return merged
  })

  const summary = { ...(result.summary || {}) }
  for (const [k, v] of Object.entries(summaryExtras)) if (summary[k] === undefined || summary[k] === null) summary[k] = v
  return { ...result, efforts, summary }
}

/** Summary keys a manifest's selected metrics add (used by the UI to always show them). */
export function selectedSummaryKeys(metrics) {
  return (Array.isArray(metrics) ? metrics : []).map((m) => summaryMetricKey(m)).filter(Boolean)
}

/** Per-run performance metrics every template run reports by default (when the data exists). */
export const DEFAULT_RUN_METRIC_IDS = ['avg_wkg', 'avg_power', 'np', 'avg_speed', 'avg_cadence', 'avg_hr']

/** Summary keys always shown (when present) for template runs. */
export const DEFAULT_RUN_KEYS = DEFAULT_RUN_METRIC_IDS.map((id) => SUMMARY_METRICS[id].key)

/**
 * Static athlete reference values older stored runs may contain. They are not run results,
 * so they are never produced anymore and the UI hides them.
 */
export const LEGACY_STATIC_KEYS = ['ftp_wkg', 'lt1_wkg', 'lt2_wkg']

/** Selected metrics plus the defaults; default-only metrics are flagged so null values are skipped. */
export function withDefaultMetrics(metrics) {
  const selected = Array.isArray(metrics) ? metrics.filter(Boolean) : []
  const have = new Set(selected.map((m) => m.id))
  return [...selected, ...DEFAULT_RUN_METRIC_IDS.filter((id) => !have.has(id)).map((id) => ({ id, _default: true }))]
}

/**
 * Power-to-weight fallback (issue #143): adds `avg_wkg` to every effort that has an average power,
 * and the mean of the work efforts to the summary. Purely additive; without a weight the result
 * is returned untouched.
 */
export function attachWkg(result, weightKg) {
  if (!weightKg || !result || !Array.isArray(result.efforts) || !result.efforts.length) return result
  const efforts = result.efforts.map((e) => {
    if (e.avg_wkg != null || typeof e.avg_power !== 'number') return e
    const v = wattsPerKg(e.avg_power, weightKg)
    return v == null ? e : { ...e, avg_wkg: v }
  })
  const summary = { ...(result.summary || {}) }
  const work = efforts.filter((e) => e.role === undefined || e.role === 'work')
  const wkgs = nums(work.map((e) => e.avg_wkg))
  if (summary.avg_wkg == null && wkgs.length) summary.avg_wkg = round2(mean(wkgs))
  return { ...result, efforts, summary }
}
