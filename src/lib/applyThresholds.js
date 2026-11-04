// Review/apply of threshold-test estimates (issue #379): turns summary.threshold_estimates into
// proposals vs the profile values on the activity, and writes a confirmed value into the
// effective-dated FTP / lactate threshold history without silently overwriting anything.
import { estimateDelta } from './thresholdEstimates.js'
import { THRESHOLD_ESTIMATES_KEY } from './summaryMetrics.js'
import { validateFtpEntry, resolveFtpAt, ftpFromActivity, fetchFtpHistory, saveFtpEntry } from './ftpHistory.js'
import { validateLtEntry, resolveLtAt, ltFromActivity, fetchLtHistory, saveLtEntry } from './lactateThresholds.js'

const LT_COLUMN = { lt1_power: 'lt1_power_w', lt1_hr: 'lt1_hr', lt2_power: 'lt2_power_w', lt2_hr: 'lt2_hr' }
const LT_ACTIVITY_KEY = { lt1_power: 'lt1Power', lt1_hr: 'lt1Hr', lt2_power: 'lt2Power', lt2_hr: 'lt2Hr' }

export function activityDay(activity) {
  const d = String(activity?.activity_date || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

/** Proposals (one per estimate with a value) with the current profile value and delta. */
export function buildProposals(summary, activity) {
  const list = Array.isArray(summary?.[THRESHOLD_ESTIMATES_KEY]) ? summary[THRESHOLD_ESTIMATES_KEY] : []
  const lt = ltFromActivity(activity)
  const out = []
  for (const est of list) {
    if (!est || est.value == null || !(est.field === 'ftp' || LT_COLUMN[est.field])) continue
    const current = est.field === 'ftp' ? ftpFromActivity(activity) : lt?.[LT_ACTIVITY_KEY[est.field]] ?? null
    out.push({ ...est, ...estimateDelta(est.value, current) })
  }
  return out
}

/**
 * Plans a save of `value` for `field` effective on `date`. LT entries hold four values, so the
 * new value is merged into the entry valid on that date. Returns { error } or
 * { kind, entry, existing, overwrite } where `overwrite` is true when an entry already exists
 * exactly on `date` (the caller must confirm before saving).
 */
export function planApply({ field, value, date, ftpHistory = [], ltHistory = [] }) {
  if (field === 'ftp') {
    const v = validateFtpEntry({ effective_from: date, ftp_w: value })
    if (v.error) return { error: v.error }
    const existing = (ftpHistory || []).find((h) => h.effective_from === date) || null
    return { kind: 'ftp', entry: v.entry, existing, overwrite: !!existing, previous: resolveFtpAt(ftpHistory, date)?.ftp_w ?? null }
  }
  const column = LT_COLUMN[field]
  if (!column) return { error: 'Unknown threshold field' }
  const base = resolveLtAt(ltHistory, date)
  const raw = { effective_from: date }
  for (const c of Object.values(LT_COLUMN)) raw[c] = base?.[c] ?? null
  raw[column] = value
  const v = validateLtEntry(raw)
  if (v.error) return { error: v.error }
  const existing = (ltHistory || []).find((h) => h.effective_from === date) || null
  return { kind: 'lt', entry: v.entry, existing, overwrite: !!existing, previous: base?.[column] ?? null }
}

export async function applyThreshold(supabase, { userId, field, value, date, confirmOverwrite = false }) {
  if (!userId) return { error: 'Sign in to apply thresholds' }
  const [ftp, lt] = await Promise.all([fetchFtpHistory(supabase, userId), fetchLtHistory(supabase, userId)])
  if (ftp.error || lt.error) return { error: (ftp.error || lt.error).message || 'Could not load history' }
  const plan = planApply({ field, value, date, ftpHistory: ftp.history, ltHistory: lt.history })
  if (plan.error) return plan
  if (plan.overwrite && !confirmOverwrite) return { needsConfirm: true, plan }
  const res = plan.kind === 'ftp'
    ? await saveFtpEntry(supabase, { userId, entry: plan.entry })
    : await saveLtEntry(supabase, { userId, entry: plan.entry })
  if (res.error) return { error: res.error.message || 'Save failed' }
  return { saved: true, plan }
}
