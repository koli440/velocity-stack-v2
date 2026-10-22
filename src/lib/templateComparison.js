// Template run comparison (issue #283): reference selection, rep matching, fade metrics, anomaly flags and the
// headline metric. Pure helpers shared by the evaluation engine (stored `rep_analysis`), the UI and the tests.
// Everything degrades gracefully for runs stored before these fields existed: values are derived from `efforts[]`.

import { formatRaceTime } from './effortMetrics.js'

export const REFERENCE_MODES = Object.freeze(['previous', 'pb', 'median5', 'custom'])
export const REFERENCE_LABELS = Object.freeze({
  previous: 'Previous run',
  pb: 'Personal best run',
  median5: 'Median of last 5 runs',
  custom: 'Custom run',
})
export const MEDIAN_RUNS = 5
/** A headline change within this many percent counts as "similar". */
export const SIMILAR_PCT = 1
/** A rep this far (percent) worse than the median of the reps is flagged. */
export const ANOMALY_PCT = 5
export const REP_ANALYSIS_VERSION = 1

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round1 = (v) => Math.round(v * 10) / 10 + 0
const round2 = (v) => Math.round(v * 100) / 100 + 0
const isWork = (e) => !!e && (e.role === undefined || e.role === 'work')

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const LEGACY_TIME_PATTERNS = new Set(['sustained_tt', 'flying_sprint', 'standing_start'])

const METRICS = {
  time: { id: 'time', label: 'Time', unit: 's', lowerBetter: true, summaryKeys: ['avg_time_sec', 'estimated_time_sec', 'best_time_sec'] },
  power: { id: 'power', label: 'Avg power', unit: 'W', lowerBetter: false, summaryKeys: ['avg_power'] },
  speed: { id: 'speed', label: 'Avg speed', unit: 'km/h', lowerBetter: false, summaryKeys: ['avg_speed_kmh'] },
  hr: { id: 'hr', label: 'Avg HR', unit: 'bpm', lowerBetter: false, summaryKeys: ['avg_hr_bpm'] },
}

/** Value of one effort for a metric (null when missing). */
export function effortValue(effort, metric) {
  if (!effort) return null
  switch (metric?.id) {
    case 'time':
      return num(effort.elapsed_time_sec) ?? num(effort.estimated_time_sec) ?? num(effort.estimated_time)
    case 'power':
      return num(effort.avg_power)
    case 'speed':
      return num(effort.avg_speed_kmh)
    case 'hr':
      return num(effort.avg_hr_bpm)
    default:
      return null
  }
}

/**
 * Headline metric of a run, chosen automatically: time for time-trial / sprint / distance-keyed templates,
 * average power for interval templates (falling back to speed, then heart rate when there is no power).
 * @param {{efforts?: object[], summary?: object}} run
 * @param {{manifest?: object}} [opts] manifest (when known) decides by pattern
 */
export function headlineMetric(run, { manifest } = {}) {
  const efforts = Array.isArray(run?.efforts) ? run.efforts : []
  const work = efforts.filter(isWork)
  const summary = run?.summary || {}
  const timeKeyed =
    LEGACY_TIME_PATTERNS.has(manifest?.pattern) ||
    work.some((e) => e.keyed_by === 'distance' || e.target_distance_m != null || num(e.estimated_time) != null || num(e.estimated_time_sec) != null) ||
    (work.length === 0 && ['estimated_time_sec', 'best_time_sec', 'avg_time_sec'].some((k) => num(summary[k]) != null))
  if (timeKeyed && (work.some((e) => effortValue(e, METRICS.time) != null) || METRICS.time.summaryKeys.some((k) => num(summary[k]) != null))) {
    return METRICS.time
  }
  for (const id of ['power', 'speed', 'hr']) {
    const m = METRICS[id]
    if (work.some((e) => effortValue(e, m) != null) || m.summaryKeys.some((k) => num(summary[k]) != null)) return m
  }
  return null
}

/** Rep number of each work effort: the stored `rep`, else its position among the work efforts. */
function repNumber(effort, position) {
  return Number.isInteger(effort.rep) && effort.rep > 0 ? effort.rep : position + 1
}

/** Map rep number -> value of the headline metric (multi-step reps: power is duration-weighted, time summed). */
export function repValues(run, metric) {
  const out = new Map()
  if (!metric) return out
  const work = (Array.isArray(run?.efforts) ? run.efforts : []).filter(isWork).sort((a, b) => (a.start_sec ?? 0) - (b.start_sec ?? 0))
  const groups = new Map()
  work.forEach((e, i) => {
    const v = effortValue(e, metric)
    if (v == null) return
    const rep = repNumber(e, i)
    if (!groups.has(rep)) groups.set(rep, [])
    groups.get(rep).push({ v, dur: num(e.duration_sec) || 0 })
  })
  for (const [rep, items] of groups) {
    if (items.length === 1) out.set(rep, items[0].v)
    else if (metric.id === 'time') out.set(rep, items.reduce((a, b) => a + b.v, 0))
    else {
      const total = items.reduce((a, b) => a + b.dur, 0)
      out.set(rep, total ? items.reduce((a, b) => a + b.v * b.dur, 0) / total : mean(items.map((i) => i.v)))
    }
  }
  return out
}

/** Whole-run headline value: the stored summary value, else the mean of the reps. */
export function headlineValue(run, metric) {
  if (!metric) return null
  for (const key of metric.summaryKeys) {
    const v = num(run?.summary?.[key])
    if (v != null) return v
  }
  const reps = [...repValues(run, metric).values()]
  return reps.length ? mean(reps) : null
}

/** Date a run was ridden (falls back to when it was stored). */
export function ridden(run) {
  const act = Array.isArray(run?.activities) ? run.activities[0] : run?.activities
  return new Date(act?.activity_date || run?.created_at || 0).getTime()
}

const better = (a, b, lowerBetter) => (lowerBetter ? a < b : a > b)

/**
 * Picks the reference a run is compared against.
 * @param {object[]} history executions of one template (any order)
 * @param {{id?: string, activity_id?: string, date: string|number|Date}} current the run being viewed
 * @param {{mode?: string, customId?: string, metric: object}} opts
 * @returns {null|{mode, requestedMode, fellBack, label, runs: object[], count, headline, reps: Map}}
 */
export function selectReference(history, current, { mode = 'previous', customId = null, metric } = {}) {
  if (!metric) return null
  const now = new Date(current?.date).getTime()
  const others = (Array.isArray(history) ? history : []).filter(
    (h) => h && h.id !== current?.id && !(current?.activity_id && h.activity_id === current.activity_id)
  )
  const usable = (h) => headlineValue(h, metric) != null
  const prior = others.filter((h) => ridden(h) <= now && usable(h)).sort((a, b) => ridden(b) - ridden(a))
  const requestedMode = REFERENCE_MODES.includes(mode) ? mode : 'previous'

  const build = (m, runs, fellBack = false) => {
    if (!runs.length) return null
    const headlines = runs.map((r) => headlineValue(r, metric))
    const perRep = new Map()
    for (const r of runs) for (const [rep, v] of repValues(r, metric)) (perRep.get(rep) || perRep.set(rep, []).get(rep)).push(v)
    const reps = new Map([...perRep].sort((a, b) => a[0] - b[0]).map(([rep, vals]) => [rep, runs.length === 1 ? vals[0] : median(vals)]))
    return {
      mode: m,
      requestedMode,
      fellBack,
      label: m === 'median5' ? `Median of last ${runs.length} run${runs.length === 1 ? '' : 's'}` : REFERENCE_LABELS[m],
      runs,
      count: runs.length,
      headline: runs.length === 1 ? headlines[0] : median(headlines),
      reps,
    }
  }

  if (requestedMode === 'custom') {
    const picked = others.find((h) => h.id === customId && usable(h))
    if (picked) return build('custom', [picked])
    return build('previous', prior.slice(0, 1), true)
  }
  if (requestedMode === 'pb') {
    const best = prior.reduce((acc, h) => (!acc || better(headlineValue(h, metric), headlineValue(acc, metric), metric.lowerBetter) ? h : acc), null)
    return build('pb', best ? [best] : [])
  }
  if (requestedMode === 'median5') return build('median5', prior.slice(0, MEDIAN_RUNS))
  return build('previous', prior.slice(0, 1))
}

/** Better / similar / worse of a value against a reference, direction-aware. */
export function verdict(value, reference, metric) {
  if (value == null || reference == null || !metric) return null
  const diff = value - reference
  const pct = reference ? (diff / Math.abs(reference)) * 100 : 0
  const signed = metric.lowerBetter ? -pct : pct
  const kind = Math.abs(pct) <= SIMILAR_PCT ? 'similar' : signed > 0 ? 'better' : 'worse'
  return { verdict: kind, diff, pct: round1(pct) }
}

/** Strict rep-number matching: only reps present in both are compared; counts that differ are reported. */
export function matchReps(current, reference, metric) {
  const cur = current instanceof Map ? current : new Map()
  const ref = reference instanceof Map ? reference : new Map()
  const reps = [...cur.keys()].sort((a, b) => a - b)
  const firstRep = reps[0]
  const first = cur.get(firstRep)
  const rows = reps.map((rep) => {
    const value = cur.get(rep)
    const r = ref.get(rep)
    const has = r != null
    const diff = has ? value - r : null
    const pct = has && r ? (diff / Math.abs(r)) * 100 : null
    const vsFirstPct = rep !== firstRep && first ? ((value - first) / Math.abs(first)) * 100 : null
    return {
      rep,
      value,
      ref: has ? r : null,
      diff: has ? round2(diff) : null,
      pct: pct == null ? null : round1(pct),
      good: has && diff !== 0 ? (metric?.lowerBetter ? diff < 0 : diff > 0) : null,
      vsFirstPct: vsFirstPct == null ? null : round1(vsFirstPct),
    }
  })
  const common = rows.filter((r) => r.ref != null).map((r) => r.rep)
  const onlyCurrent = reps.filter((r) => !ref.has(r))
  const onlyRef = [...ref.keys()].filter((r) => !cur.has(r)).sort((a, b) => a - b)
  const countsDiffer = cur.size !== ref.size || onlyCurrent.length > 0 || onlyRef.length > 0
  let note = null
  if (countsDiffer && ref.size > 0) {
    const span = common.length === 1 ? `rep ${common[0]}` : `reps ${common[0]}–${common[common.length - 1]}`
    const counts = `Reference has ${ref.size} rep${ref.size === 1 ? '' : 's'}, this run ${cur.size}`
    note = common.length ? `${counts}: comparing the common ${span}.` : `${counts}: no common reps to compare.`
  }
  return { rows, common, onlyCurrent, onlyRef, countsDiffer, curCount: cur.size, refCount: ref.size, note }
}

/**
 * Fade through the reps. `slopePctPerRep` and `halfFadePct` are positive when the athlete gets worse.
 * @param {Map<number, number>} reps rep number -> value
 */
export function fadeMetrics(reps, metric) {
  const series = [...(reps instanceof Map ? reps : new Map())].sort((a, b) => a[0] - b[0]).map(([rep, value]) => ({ rep, value }))
  const n = series.length
  if (n < 2) return null
  const lower = !!metric?.lowerBetter
  const values = series.map((s) => s.value)
  const half = Math.floor(n / 2)
  const firstHalfAvg = mean(values.slice(0, half))
  const secondHalfAvg = mean(values.slice(n - half))
  const halfDeltaPct = firstHalfAvg ? ((secondHalfAvg - firstHalfAvg) / Math.abs(firstHalfAvg)) * 100 : null

  const best = lower ? Math.min(...values) : Math.max(...values)
  const worstValue = lower ? Math.max(...values) : Math.min(...values)
  const worstIdx = values.indexOf(worstValue)
  const worstPct = best ? (Math.abs(worstValue - best) / Math.abs(best)) * 100 : 0

  const xs = series.map((s) => s.rep)
  const mx = mean(xs)
  const mv = mean(values)
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  const slope = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (values[i] - mv), 0) / sxx : 0
  const slopePct = mv ? (slope / Math.abs(mv)) * 100 : 0
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mv) ** 2, 0) / (n - 1))
  const cv = mv ? (sd / Math.abs(mv)) * 100 : null

  return {
    n,
    firstHalfAvg: round2(firstHalfAvg),
    secondHalfAvg: round2(secondHalfAvg),
    halfDeltaPct: halfDeltaPct == null ? null : round1(halfDeltaPct),
    halfFadePct: halfDeltaPct == null ? null : round1(lower ? halfDeltaPct : -halfDeltaPct),
    worst: { rep: series[worstIdx].rep, index: worstIdx + 1, value: worstValue, pctBelowBest: round1(worstPct) },
    slopePctPerRep: round2(lower ? slopePct : -slopePct),
    cvPct: cv == null ? null : round1(cv),
    consistency: cv == null ? null : Math.max(0, Math.round(100 - cv)),
    curve: series.map((s) => ({ rep: s.rep, value: s.value, pctOfBest: round1(best ? (lower ? (best / s.value) * 100 : (s.value / best) * 100) : 0) })),
  }
}

/** Flags: reps notably worse than the median of the reps, and missing reps (gaps or fewer than the target). */
export function anomalies(reps, { expected = null, metric } = {}) {
  const map = reps instanceof Map ? reps : new Map()
  const flags = []
  const lower = !!metric?.lowerBetter
  const med = median([...map.values()])
  if (map.size >= 3 && med) {
    for (const [rep, v] of [...map].sort((a, b) => a[0] - b[0])) {
      const worsePct = ((lower ? v - med : med - v) / Math.abs(med)) * 100
      if (worsePct >= ANOMALY_PCT) {
        const p = Math.round(worsePct)
        flags.push({ type: 'low', rep, pct: p, text: lower ? `Rep ${rep} is ${p}% slower than the median` : `Rep ${rep} is ${p}% below the median` })
      }
    }
  }
  const maxRep = Math.max(0, ...map.keys())
  const top = Math.max(maxRep, Number.isInteger(expected) ? expected : 0)
  for (let rep = 1; rep <= top; rep++) if (!map.has(rep)) flags.push({ type: 'missing', rep, text: `Rep ${rep} missing` })
  return flags
}

/** "7 of 8 reps detected". `complete` is null when the template has no rep target. */
export function completeness(run, metric) {
  const summary = run?.summary || {}
  const work = (Array.isArray(run?.efforts) ? run.efforts : []).filter(isWork)
  const detected = num(summary.reps_detected) ?? (metric ? repValues(run, metric).size : work.length)
  const expected = num(summary.reps_target)
  if (!detected && !expected) return null
  if (expected == null) return detected > 1 ? { detected, expected: null, complete: null, text: `${detected} reps detected` } : null
  return { detected, expected, complete: detected >= expected, text: `${detected} of ${expected} reps detected` }
}

/** HR recovery between reps from the stored `hr_recovery_<n>s` effort field. */
export function hrRecoveryByRep(run) {
  const work = (Array.isArray(run?.efforts) ? run.efforts : []).filter(isWork).sort((a, b) => (a.start_sec ?? 0) - (b.start_sec ?? 0))
  const key = work.flatMap((e) => Object.keys(e)).find((k) => /^hr_recovery_\d+s$/.test(k) && work.some((e) => num(e[k]) != null))
  if (!key) return null
  const values = []
  work.forEach((e, i) => {
    const v = num(e[key])
    if (v != null) values.push({ rep: repNumber(e, i), bpm: v })
  })
  if (!values.length) return null
  return { key, windowSec: Number(key.match(/\d+/)[0]), values, avg: round1(mean(values.map((v) => v.bpm))) }
}

/** Everything the per-effort view needs for one run. */
export function analyzeRun(run, { manifest, metric = headlineMetric(run, { manifest }) } = {}) {
  const reps = repValues(run, metric)
  const complete = completeness(run, metric)
  return {
    metric,
    reps,
    headline: headlineValue(run, metric),
    fade: fadeMetrics(reps, metric),
    flags: anomalies(reps, { expected: complete?.expected ?? null, metric }),
    completeness: complete,
    hrRecovery: hrRecoveryByRep(run),
  }
}

/** Values of the headline metric over all runs, oldest first (the long-term trend). */
export function trendSeries(history, metric) {
  if (!metric) return []
  let best = null
  return [...(Array.isArray(history) ? history : [])]
    .sort((a, b) => ridden(a) - ridden(b))
    .map((h) => ({ id: h.id, activity_id: h.activity_id, date: ridden(h), value: headlineValue(h, metric), byCoach: !!h.by_coach }))
    .filter((p) => p.value != null)
    .map((p) => {
      if (best == null || better(p.value, best, metric.lowerBetter)) best = p.value
      return { ...p, best }
    })
}

/**
 * Per-effort fields stored with a run (so old runs gain them on re-run): `rep`, `pct_of_best` and
 * `delta_vs_rep1_pct` on work efforts, plus a compact `summary.rep_analysis`. Purely additive;
 * `dropoff_pct` stays untouched. Never throws.
 */
export function applyRepAnalysis(result, { manifest } = {}) {
  try {
    if (!result || !Array.isArray(result.efforts) || !result.efforts.length) return result
    const metric = headlineMetric(result, { manifest })
    if (!metric) return result
    const sorted = result.efforts.map((e, i) => ({ e, i })).filter(({ e }) => isWork(e))
    sorted.sort((a, b) => (a.e.start_sec ?? 0) - (b.e.start_sec ?? 0))
    const repOf = new Map(sorted.map(({ e, i }, pos) => [i, repNumber(e, pos)]))
    const withRep = { ...result, efforts: result.efforts.map((e, i) => (repOf.has(i) && e.rep == null ? { ...e, rep: repOf.get(i) } : e)) }
    const a = analyzeRun(withRep, { manifest, metric })
    if (!a.reps.size) return result
    const curve = new Map((a.fade?.curve || []).map((c) => [c.rep, c.pctOfBest]))
    const first = a.reps.get(Math.min(...a.reps.keys()))
    const efforts = withRep.efforts.map((e, i) => {
      if (!repOf.has(i)) return e
      const v = effortValue(e, metric)
      if (v == null) return e
      const rep = e.rep
      return {
        ...e,
        ...(curve.has(rep) ? { pct_of_best: curve.get(rep) } : {}),
        ...(first && rep !== Math.min(...a.reps.keys()) ? { delta_vs_rep1_pct: round1(((v - first) / Math.abs(first)) * 100) } : {}),
      }
    })
    const f = a.fade
    const rep_analysis = {
      v: REP_ANALYSIS_VERSION,
      metric: metric.id,
      lower_is_better: metric.lowerBetter,
      reps_detected: a.reps.size,
      reps_expected: a.completeness?.expected ?? null,
      missing_reps: a.flags.filter((x) => x.type === 'missing').map((x) => x.rep),
      low_reps: a.flags.filter((x) => x.type === 'low').map((x) => x.rep),
      first_half_avg: f?.firstHalfAvg ?? null,
      second_half_avg: f?.secondHalfAvg ?? null,
      half_fade_pct: f?.halfFadePct ?? null,
      worst_rep: f?.worst.rep ?? null,
      worst_rep_index: f?.worst.index ?? null,
      worst_rep_pct_below_best: f?.worst.pctBelowBest ?? null,
      slope_pct_per_rep: f?.slopePctPerRep ?? null,
      cv_pct: f?.cvPct ?? null,
    }
    return { ...result, efforts, summary: { ...(result.summary || {}), rep_analysis } }
  } catch {
    return result
  }
}

/** True when a stored run already carries the per-effort analysis (used by the re-run job). */
export function hasRepAnalysis(run) {
  return !!run?.summary && typeof run.summary.rep_analysis === 'object' && run.summary.rep_analysis !== null
}

/** Display text of a headline value: m:ss.cc for times, rounded numbers with a unit otherwise. */
export function formatHeadline(metric, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (metric?.id === 'time') return formatRaceTime(value, 2)
  const v = metric?.id === 'speed' ? Math.round(value * 10) / 10 : Math.round(value)
  return `${v} ${metric?.unit || ''}`.trim()
}

/** Signed difference text, e.g. "-0.32 s" / "+12 W". */
export function formatDiff(metric, diff) {
  if (typeof diff !== 'number' || !Number.isFinite(diff)) return '—'
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±'
  const abs = Math.abs(diff)
  const body = metric?.id === 'time' ? abs.toFixed(2) : metric?.id === 'speed' ? abs.toFixed(1) : String(Math.round(abs))
  return `${sign}${body} ${metric?.unit || ''}`.trim()
}

/** Value of a summary key in the reference (the run's value, or the median over several runs). */
export function referenceSummaryValue(reference, key) {
  if (!reference?.runs?.length) return null
  const vals = reference.runs.map((r) => num(r.summary?.[key])).filter((v) => v != null)
  if (!vals.length) return null
  return vals.length === 1 ? vals[0] : median(vals)
}
