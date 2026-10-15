// Per-template usage statistics aggregated from the current user's template_executions rows.

import { SUMMARY_METRICS, DEFAULT_RUN_KEYS, LEGACY_STATIC_KEYS } from './summaryMetrics.js'

const KNOWN_KEYS = new Set(Object.values(SUMMARY_METRICS).map((m) => m.key))
const HR_RECOVERY_KEY = /^hr_recovery_\d+s$/

// Keys where a lower value is not "better", so a best (max) value is meaningful.
const BEST_KEYS = new Set([
  'avg_power', 'max_power', 'np_w', 'avg_wkg', 'max_wkg', 'np_wkg', 'avg_hr_bpm', 'max_hr_bpm',
  'avg_cadence_rpm', 'max_cadence_rpm', 'avg_speed_kmh', 'max_speed_kmh', 'work_kj',
])

export function isStatMetricKey(key) {
  if (LEGACY_STATIC_KEYS.includes(key)) return false
  return KNOWN_KEYS.has(key) || HR_RECOVERY_KEY.test(key)
}

const round2 = (v) => Math.round(v * 100) / 100

/** Numeric, non-legacy summary entries of one run. */
export function runMetrics(summary) {
  const out = {}
  if (!summary || typeof summary !== 'object') return out
  for (const [k, v] of Object.entries(summary)) {
    if (isStatMetricKey(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

/**
 * @param {Array} rows template_executions rows with embedded `activities(title, activity_date)`
 * @returns {Record<string, {count, last_run_at, metrics, runs}>} keyed by template id
 */
export function aggregateTemplateStats(rows) {
  const byTemplate = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.template_id) continue
    const t = (byTemplate[row.template_id] ||= { count: 0, last_run_at: null, runs: [], sums: {} })
    const act = Array.isArray(row.activities) ? row.activities[0] : row.activities
    const date = act?.activity_date || row.created_at || null
    const metrics = runMetrics(row.summary)
    t.count++
    if (date && (!t.last_run_at || date > t.last_run_at)) t.last_run_at = date
    t.runs.push({
      id: row.id,
      activity_id: row.activity_id,
      title: act?.title || null,
      date,
      metrics,
    })
    for (const [k, v] of Object.entries(metrics)) {
      const s = (t.sums[k] ||= { total: 0, n: 0, best: v })
      s.total += v
      s.n++
      if (v > s.best) s.best = v
    }
  }
  const result = {}
  for (const [id, t] of Object.entries(byTemplate)) {
    const metrics = {}
    for (const [k, s] of Object.entries(t.sums)) {
      metrics[k] = { avg: round2(s.total / s.n), n: s.n, best: BEST_KEYS.has(k) ? s.best : null }
    }
    t.runs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    result[id] = { count: t.count, last_run_at: t.last_run_at, metrics, runs: t.runs }
  }
  return result
}

const LABELS = {
  avg_power: 'Avg power (W)', max_power: 'Peak power (W)', np_w: 'NP (W)', vi: 'VI', intensity_factor: 'IF',
  avg_wkg: 'Avg W/kg', max_wkg: 'Peak W/kg', np_wkg: 'NP W/kg', avg_hr_bpm: 'Avg HR (bpm)', max_hr_bpm: 'Peak HR (bpm)',
  avg_cadence_rpm: 'Avg cadence (rpm)', max_cadence_rpm: 'Peak cadence (rpm)', avg_speed_kmh: 'Avg speed (km/h)',
  max_speed_kmh: 'Peak speed (km/h)', work_kj: 'Work (kJ)', pacing_index: 'Pacing (%)', dropoff_pct: 'Drop-off (%)',
  pw_hr_decoupling_pct: 'Decoupling (%)',
}

export function metricLabel(key) {
  if (LABELS[key]) return LABELS[key]
  const m = HR_RECOVERY_KEY.test(key) && key.match(/\d+/)
  if (m) return `HR recovery ${m[0]}s (bpm)`
  return key.replace(/_/g, ' ')
}

/** Default keys first (in default order), then the rest alphabetically. */
export function orderMetricKeys(keys) {
  const list = [...keys]
  const rank = (k) => (DEFAULT_RUN_KEYS.includes(k) ? DEFAULT_RUN_KEYS.indexOf(k) : 100)
  return list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
