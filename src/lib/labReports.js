// Lab reports (docs/lab/reports.md): a frozen snapshot of chosen sections behind an unguessable token.
// All access goes through the lab_report_* RPCs (supabase/migrations/20270165000000_lab_reports.sql).
import { PHENOTYPE_LABELS } from './labPowerProfile.js'
import { cadenceProfile, pedallingTrend, summarizeFueling } from './labProtocolEntries.js'

export const REPORT_PATH = '/lab/report'
export const TITLE_MAX = 80
export const NOTE_MAX = 300
export const TOKEN_RE = /^[0-9a-f]{64}$/

export const REPORT_SECTIONS = Object.freeze([
  { key: 'thresholds', label: 'FTP and lactate thresholds', health: false },
  { key: 'tests', label: 'Recent field tests', health: false },
  { key: 'phenotype', label: 'Power profile and phenotype', health: false },
  { key: 'forms', label: 'Body composition, mobility and sprint (private health data)', health: true },
  { key: 'lactate', label: 'Lactate step test', health: false },
  { key: 'durability', label: 'Durability', health: false },
  { key: 'decoupling', label: 'Efficiency and decoupling', health: false },
  { key: 'aero', label: 'Aero tests (CdA)', health: false, ownOnly: true },
  { key: 'fueling', label: 'Fueling and glucose (private health data)', health: true },
  { key: 'fit', label: 'Bike-fit log', health: false },
  { key: 'pedalling', label: 'Pedalling efficiency', health: false },
  { key: 'cadence', label: 'Cadence and torque profile', health: false },
])

// Every Lab feature (labFeatures.js) maps to the report sections that carry its data. A feature without a report
// section must be listed in REPORT_EXEMPT with the reason; labReports.test.js fails for an unregistered feature.
export const FEATURE_REPORT_SECTIONS = Object.freeze({
  protocols: ['thresholds', 'tests', 'aero'],
  lactate: ['lactate'],
  profile: ['phenotype'],
  durability: ['durability'],
  decoupling: ['decoupling'],
  forms: ['forms'],
  fueling: ['fueling'],
  fit: ['fit'],
  pedalling: ['pedalling'],
  cadence: ['cadence'],
})
export const REPORT_EXEMPT = Object.freeze({
  schedule: 'Planning tool, produces no results',
  reports: 'The report builder itself',
})

export const isReportPath = (pathname) => String(pathname || '').startsWith(`${REPORT_PATH}/`)
export const reportPath = (token) => `${REPORT_PATH}/${token}`
export const reportUrl = (token, origin) => `${origin}${reportPath(token)}`
export const isValidToken = (t) => typeof t === 'string' && TOKEN_RE.test(t)

/** Sections the viewer may include: health-like and own-only data only when the viewer is the athlete. */
export const allowedSections = (isOwnAthlete) => REPORT_SECTIONS.filter((s) => isOwnAthlete || !(s.health || s.ownOnly))

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, num(obj?.[k])]).filter(([, v]) => v != null))

/**
 * Builds the snapshot: only whitelisted numeric fields of the chosen sections. `source` holds
 * { ftp, lt, runs, profile, body }; sections without data are omitted.
 */
export function buildSnapshot(chosen, source = {}, { isOwnAthlete = false } = {}) {
  const out = {}
  const want = new Set(chosen)
  if (want.has('thresholds')) {
    const t = { ...pick(source.ftp, ['ftp_w']), ...pick(source.lt, ['lt1_power_w', 'lt2_power_w', 'lt1_hr', 'lt2_hr']) }
    const asOf = source.ftp?.effective_from || source.lt?.effective_from
    if (Object.keys(t).length) out.thresholds = asOf ? { ...t, as_of: String(asOf).slice(0, 10) } : t
  }
  if (want.has('tests')) {
    const tests = (source.runs || [])
      .filter((r) => r.result && (r.status === 'completed' || r.status === 'applied'))
      .slice(0, 10)
      .map((r) => ({ protocol: String(r.protocol), date: String(r.planned_date).slice(0, 10), ...pick(r.result, ['ftp', 'cp']) }))
    if (tests.length) out.tests = tests
  }
  const type = source.profile?.phenotype?.type
  if (want.has('phenotype') && PHENOTYPE_LABELS[type]) {
    const wkg = Object.fromEntries((source.profile.rows || []).map((x) => [x.key, x.wkg]))
    const age = source.profile.age
    out.phenotype = {
      label: PHENOTYPE_LABELS[type],
      ...pick(wkg, ['5s', '1m', '5m', '20m']),
      ...(age ? { age: age.age, age_applied: !!age.applied, age_note: String(age.note || '').slice(0, 200) } : {}),
    }
  }
  if (want.has('forms') && isOwnAthlete && source.body) {
    const b = { ...pick(source.body, ['weight_kg', 'body_fat_pct']), ...pick(source.mobility, ['mobility_pass', 'mobility_total']), ...pick(source.sprint, ['sprint_distance_m', 'sprint_time_s']) }
    if (Object.keys(b).length) out.forms = b
  }
  if (want.has('lactate') && source.lactate?.result) {
    const r = source.lactate.result
    const l = {
      ...pick({ lt1_power_w: r.lt1?.power, lt1_hr: r.lt1?.hr, lt2_power_w: r.lt2?.power, lt2_hr: r.lt2?.hr, obla2_power_w: r.obla2?.power, obla4_power_w: r.obla4?.power }, ['lt1_power_w', 'lt1_hr', 'lt2_power_w', 'lt2_hr', 'obla2_power_w', 'obla4_power_w']),
    }
    if (Object.keys(l).length) out.lactate = { ...l, date: String(source.lactate.test_date || '').slice(0, 10) }
  }
  if (want.has('durability')) {
    const d = (source.durability || []).slice(0, 5).map((t) => ({ date: String(t.date).slice(0, 10), ...pick({ fresh_w: t.result?.freshW, fatigued_w: t.result?.fatiguedW, kj: t.result?.kj, drop_pct: t.result?.dropPct }, ['fresh_w', 'fatigued_w', 'kj', 'drop_pct']) }))
    if (d.length) out.durability = d
  }
  if (want.has('decoupling')) {
    const d = (source.decoupling || []).slice(-8).map((t) => ({ date: String(t.date).slice(0, 10), ...pick({ avg_w: t.result?.avgW, ef: t.result?.ef, decoupling_pct: t.result?.decouplingPct }, ['avg_w', 'ef', 'decoupling_pct']) }))
    if (d.length) out.decoupling = d
  }
  if (want.has('aero') && isOwnAthlete) {
    const a = (source.aero || []).slice(0, 5).map((t) => ({ date: String(t.test_date || t.created_at || '').slice(0, 10), position: String(t.position_name || '').slice(0, 60), ...pick(t, ['cda', 'speed_kmh', 'power_w']) }))
    if (a.length) out.aero = a
  }
  if (want.has('fueling') && isOwnAthlete) {
    const rows = (source.entries || []).filter((e) => e.kind === 'fueling')
    const sessions = rows.slice(0, 6).map((e) => {
      const x = summarizeFueling(e.data)
      return { date: String(e.recorded_at).slice(0, 10), session: e.data.session === 'fasted' ? 'fasted' : 'fed', ...pick({ carbs_g_per_h: e.data.carbs_g_per_h, avg_power_w: e.data.avg_power_w, during_avg: x.duringAvg, during_min: x.duringMin, after60: x.after60 }, ['carbs_g_per_h', 'avg_power_w', 'during_avg', 'during_min', 'after60']) }
    })
    if (sessions.length) out.fueling = sessions
  }
  if (want.has('fit')) {
    const e = (source.entries || []).find((x) => x.kind === 'fit')
    if (e) out.fit = { date: String(e.recorded_at).slice(0, 10), ...pick(e.data, ['saddle_height_mm', 'setback_mm', 'reach_mm', 'cleat_mm', 'crank_mm', 'avg_power_w', 'comfort']) }
  }
  if (want.has('pedalling')) {
    const t = pedallingTrend(source.entries || [])
    const latest = (source.entries || []).find((x) => x.kind === 'pedalling')
    const o = latest ? pick(latest.data, ['left_balance_pct', 'te_left', 'te_right', 'ps_left', 'ps_right']) : {}
    for (const [k, v] of Object.entries(t)) { if (v.change != null) o[`${k}_change`] = v.change }
    if (Object.keys(o).length) out.pedalling = o
  }
  if (want.has('cadence')) {
    const e = (source.entries || []).find((x) => x.kind === 'cadence')
    if (e) {
      const steps = cadenceProfile(e.data.steps).map((s) => pick(s, ['rpm', 'power_w']))
      out.cadence = { date: String(e.recorded_at).slice(0, 10), steps, best_rpm: cadenceProfile(e.data.steps).find((s) => s.best)?.rpm }
    }
  }
  return out
}

export function validateReportInput({ title, note, snapshot }) {
  const t = String(title || '').trim()
  if (!t) return { error: 'Give the report a title' }
  if (t.length > TITLE_MAX) return { error: `Title is limited to ${TITLE_MAX} characters` }
  const n = String(note || '').trim()
  if (n.length > NOTE_MAX) return { error: `Note is limited to ${NOTE_MAX} characters` }
  if (!snapshot || Object.keys(snapshot).length === 0) return { error: 'None of the chosen sections has data yet' }
  return { title: t, note: n, snapshot }
}
