// Re-runs stored template runs with the current detection (issue #283). Pure core with an injected store, so the
// same code is covered by tests (in-memory store) and used by the admin route (Supabase service store).
//
// Per run: skip when the template/activity/time series is gone, evaluate, then either report (dry run) or hand
// the result to the guarded SQL function template_rerun_apply (backup + update + verification in one transaction).

import { evaluateTemplate } from '../templateEngine.js'
import { REP_ANALYSIS_VERSION } from '../templateComparison.js'
import { weightFromActivity } from '../weightHistory.js'
import { ZONE_SNAPSHOT_COLUMN, zonesFromActivity } from '../powerZones.js'
import { LT_SNAPSHOT_COLUMNS, ltFromActivity } from '../lactateThresholds.js'

export const ACTIVITY_COLUMNS = `id, user_id, time_series, ftp_at_activity_w, max_hr, weight_at_activity_kg, ${ZONE_SNAPSHOT_COLUMN}, ${LT_SNAPSHOT_COLUMNS.join(', ')}`
export const MAX_ATTEMPTS = 3
export const TIME_BUDGET_MS = 45000
export const BATCH_SIZE = 25

export function hasTimeSeries(ts) {
  if (!ts || typeof ts !== 'object') return false
  return Object.values(ts).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && typeof v === 'object' && Object.keys(v).length > 0))
}

export const hasCurrentAnalysis = (summary) => summary?.rep_analysis?.v === REP_ANALYSIS_VERSION

const withoutGps = ({ latitude, longitude, ...rest }) => rest

const effortCount = (efforts) => (Array.isArray(efforts) ? efforts.length : 0)

/**
 * @param {object} row a template_executions row (execution_id, activity_id, template_id, user_id, by_coach, template_slug, updated_at, efforts, summary, attempts)
 * @param {{getTemplate, getActivity, apply}} store
 * @returns {Promise<{status: 'done'|'skipped'|'failed', reason?: string, warning?: string, efforts_after?: number}>}
 */
export async function processRun(row, store, { dryRun = false, evaluate = evaluateTemplate } = {}) {
  try {
    if (!row.template_id) return { status: 'skipped', reason: 'template no longer exists' }
    if (hasCurrentAnalysis(row.summary)) return { status: 'skipped', reason: 'already has per-effort data' }
    const template = await store.getTemplate(row.template_id)
    if (!template) return { status: 'skipped', reason: 'template no longer exists' }
    const activity = await store.getActivity(row.activity_id)
    if (!activity) return { status: 'skipped', reason: 'activity no longer exists' }
    if (!hasTimeSeries(activity.time_series)) return { status: 'skipped', reason: 'time series no longer available' }

    // Coach runs were evaluated without GPS (coach_template_run_inputs); keep that parity.
    const series = row.by_coach ? withoutGps(activity.time_series) : activity.time_series
    const result = evaluate(
      template,
      series,
      activity.ftp_at_activity_w ?? null,
      activity.max_hr ?? null,
      ltFromActivity(activity),
      weightFromActivity(activity),
      zonesFromActivity(activity)
    )
    const efforts = Array.isArray(result?.efforts) ? result.efforts : []
    const summary = result?.summary && typeof result.summary === 'object' ? result.summary : {}
    const before = effortCount(row.efforts)
    let warning = null
    if (efforts.length === 0) warning = 'current detection finds no efforts'
    else if (efforts.length < before) warning = `fewer efforts than before (${efforts.length} vs ${before})`

    if (dryRun) return { status: 'done', reason: 'would re-run', warning, efforts_after: efforts.length }

    const outcome = await store.apply({ id: row.execution_id, efforts, summary, expectedUpdatedAt: row.updated_at })
    if (outcome === 'done') return { status: 'done', warning, efforts_after: efforts.length }
    if (outcome === 'already_done') return { status: 'skipped', reason: 'already re-run (backup exists)' }
    if (outcome === 'changed') return { status: 'skipped', reason: 'run was updated while the job ran (already current)' }
    if (outcome === 'missing') return { status: 'skipped', reason: 'run no longer exists' }
    return { status: 'failed', reason: `unexpected result ${outcome}` }
  } catch (err) {
    return { status: 'failed', reason: String(err?.message || err).slice(0, 300) }
  }
}

const itemOf = (row, outcome, dryRun) => ({
  execution_id: row.execution_id,
  dry_run: dryRun,
  activity_id: row.activity_id,
  user_id: row.user_id,
  template_slug: row.template_slug ?? null,
  by_coach: !!row.by_coach,
  status: outcome.status,
  reason: outcome.reason ?? null,
  warning: outcome.warning ?? null,
  attempts: (row.attempts || 0) + 1,
  had_rep_analysis_before: !!row.summary?.rep_analysis,
  efforts_before: effortCount(row.efforts),
  efforts_after: outcome.efforts_after ?? null,
})

/**
 * Works through batches until the time budget is spent or nothing is left.
 * store: { batch(after, limit, dry), retryBatch(after, limit), record(item), progress(cursor, finished), ...processRun store }
 * @returns {{processed: number, counts: object, finished: boolean, cursor: string|null}}
 */
export async function runBatches(store, { dryRun = false, cursor = null, budgetMs = TIME_BUDGET_MS, batchSize = BATCH_SIZE, now = Date.now, evaluate } = {}) {
  const started = now()
  const counts = { done: 0, skipped: 0, failed: 0 }
  let processed = 0
  let after = cursor
  let finished = false
  let retry = false

  while (now() - started < budgetMs) {
    const rows = retry ? await store.retryBatch(null, batchSize) : await store.batch(after, batchSize, dryRun)
    if (!rows.length) {
      if (retry || dryRun) { finished = true; break }
      retry = true
      continue
    }
    for (const row of rows) {
      const outcome = await processRun(row, store, { dryRun, evaluate })
      await store.record(itemOf(row, outcome, dryRun))
      counts[outcome.status] += 1
      processed += 1
      if (!retry) after = row.execution_id
      if (now() - started >= budgetMs) break
    }
  }
  await store.progress(after, finished)
  return { processed, counts, finished, cursor: after }
}

/** Supabase service-role store used by the admin route. */
export function supabaseStore(service) {
  const rpc = async (fn, args) => {
    const { data, error } = await service.rpc(fn, args)
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data
  }
  return {
    batch: (after, limit, dry) => rpc('template_rerun_batch', { p_after: after, p_limit: limit, p_dry: dry }),
    retryBatch: (after, limit) => rpc('template_rerun_retry_batch', { p_after: after, p_limit: limit }),
    progress: (cursor, finished) => rpc('template_rerun_progress', { p_cursor: cursor, p_finished: finished }),
    async getTemplate(id) {
      const { data } = await service.from('analysis_templates').select('*').eq('id', id).maybeSingle()
      return data || null
    },
    async getActivity(id) {
      const { data } = await service.from('activities').select(ACTIVITY_COLUMNS).eq('id', id).maybeSingle()
      return data || null
    },
    apply: ({ id, efforts, summary, expectedUpdatedAt }) =>
      rpc('template_rerun_apply', { p_execution: id, p_efforts: efforts, p_summary: summary, p_expected_updated_at: expectedUpdatedAt }),
    async record(item) {
      const { error } = await service.from('template_rerun_items').upsert({ ...item, processed_at: new Date().toISOString() }, { onConflict: 'execution_id,dry_run' })
      if (error) throw new Error(`record: ${error.message}`)
    },
  }
}
