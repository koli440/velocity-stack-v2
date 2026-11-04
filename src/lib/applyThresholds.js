// Review/apply of threshold-test estimates (issue #379): turns summary.threshold_estimates into
// proposals vs the profile values on the activity, and writes a confirmed value into the
// effective-dated FTP / lactate threshold history without silently overwriting anything.
import { estimateDelta } from './thresholdEstimates.js'
import { THRESHOLD_ESTIMATES_KEY } from './summaryMetrics.js'
import { fetchCoachingStatus } from './coaching.js'
import { validateFtpEntry, resolveFtpAt, ftpFromActivity, fetchFtpHistory, saveFtpEntry } from './ftpHistory.js'
import { validateLtEntry, resolveLtAt, ltFromActivity, fetchLtHistory, saveLtEntry } from './lactateThresholds.js'

const LT_COLUMN = { lt1_power: 'lt1_power_w', lt1_hr: 'lt1_hr', lt2_power: 'lt2_power_w', lt2_hr: 'lt2_hr' }
const LT_ACTIVITY_KEY = { lt1_power: 'lt1Power', lt1_hr: 'lt1Hr', lt2_power: 'lt2Power', lt2_hr: 'lt2Hr' }

/** Provenance columns for an entry applied from a template estimate (activity + run). */
function sourceColumns(source) {
  if (!source?.activityId) return {}
  return { source: 'template_estimate', source_activity_id: source.activityId, source_run_id: source.runId || null }
}

/**
 * Who may write a rider's history: the rider, or their ACTIVE coach (the same rule as the
 * is_coach_of() RLS policies). `coachingStatus` is the viewer's status towards the rider from
 * coaching_status_with: only 'athlete' (active, the viewer coaches this rider) may write;
 * pending, ended, blocked, unrelated viewers and the rider's own coach seen from the other side may not.
 */
export function canApplyToProfile({ viewerId, riderId, coachingStatus }) {
  if (!viewerId || !riderId) return { allowed: false, reason: 'Sign in to apply thresholds' }
  if (viewerId === riderId) return { allowed: true, asCoach: false }
  if (coachingStatus === 'athlete') return { allowed: true, asCoach: true }
  return { allowed: false, reason: 'Only the rider or their active coach can apply thresholds' }
}

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
export function planApply({ field, value, date, ftpHistory = [], ltHistory = [], source = null }) {
  if (field === 'ftp') {
    const v = validateFtpEntry({ effective_from: date, ftp_w: value })
    if (v.error) return { error: v.error }
    const existing = (ftpHistory || []).find((h) => h.effective_from === date) || null
    return { kind: 'ftp', entry: { ...v.entry, ...sourceColumns(source) }, existing, overwrite: !!existing, previous: resolveFtpAt(ftpHistory, date)?.ftp_w ?? null }
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
  return { kind: 'lt', entry: { ...v.entry, ...sourceColumns(source) }, existing, overwrite: !!existing, previous: base?.[column] ?? null }
}

/**
 * Applies one value to `userId`'s (the rider's) history. `actorId` is the signed-in user; when it
 * differs from the rider the active coaching relationship is verified first (RLS enforces it again).
 */
export async function applyThreshold(supabase, { userId, actorId = userId, field, value, date, source = null, confirmOverwrite = false }) {
  let coachingStatus = null
  if (actorId && userId && actorId !== userId) {
    const st = await fetchCoachingStatus(supabase, userId)
    if (st.error) return { error: 'Could not verify the coaching relationship' }
    coachingStatus = st.status
  }
  const perm = canApplyToProfile({ viewerId: actorId, riderId: userId, coachingStatus })
  if (!perm.allowed) return { error: perm.reason, forbidden: true }
  const [ftp, lt] = await Promise.all([fetchFtpHistory(supabase, userId), fetchLtHistory(supabase, userId)])
  if (ftp.error || lt.error) return { error: (ftp.error || lt.error).message || 'Could not load history' }
  const plan = planApply({ field, value, date, ftpHistory: ftp.history, ltHistory: lt.history, source })
  if (plan.error) return plan
  if (plan.overwrite && !confirmOverwrite) return { needsConfirm: true, plan }
  const res = plan.kind === 'ftp'
    ? await saveFtpEntry(supabase, { userId, entry: plan.entry })
    : await saveLtEntry(supabase, { userId, entry: plan.entry })
  if (res.error) return { error: res.error.message || 'Save failed' }
  return { saved: true, plan, asCoach: perm.asCoach }
}
