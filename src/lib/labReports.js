// Lab reports (docs/lab/reports.md): a frozen snapshot of chosen sections behind an unguessable token.
// All access goes through the lab_report_* RPCs (supabase/migrations/20270165000000_lab_reports.sql).
import { PHENOTYPE_LABELS } from './labPowerProfile.js'

export const REPORT_PATH = '/lab/report'
export const TITLE_MAX = 80
export const NOTE_MAX = 300
export const TOKEN_RE = /^[0-9a-f]{64}$/

export const REPORT_SECTIONS = Object.freeze([
  { key: 'thresholds', label: 'FTP and lactate thresholds', health: false },
  { key: 'tests', label: 'Recent field tests', health: false },
  { key: 'phenotype', label: 'Power profile and phenotype', health: false },
  { key: 'forms', label: 'Body composition (private health data)', health: true },
])

export const isReportPath = (pathname) => String(pathname || '').startsWith(`${REPORT_PATH}/`)
export const reportPath = (token) => `${REPORT_PATH}/${token}`
export const reportUrl = (token, origin) => `${origin}${reportPath(token)}`
export const isValidToken = (t) => typeof t === 'string' && TOKEN_RE.test(t)

/** Sections the viewer may include: health-like data only when the viewer is the athlete. */
export const allowedSections = (isOwnAthlete) => REPORT_SECTIONS.filter((s) => isOwnAthlete || !s.health)

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
    out.phenotype = { label: PHENOTYPE_LABELS[type], ...pick(wkg, ['5s', '1m', '5m', '20m']) }
  }
  if (want.has('forms') && isOwnAthlete && source.body) {
    const b = pick(source.body, ['weight_kg', 'body_fat_pct'])
    if (Object.keys(b).length) out.forms = b
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
