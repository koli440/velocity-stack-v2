// Runs one template on several activities (issue #293). Pure core with an injected store so the same code
// is tested with an in-memory store and used by /api/templates/run-batch with the own-account or coach store.
// Re-running an existing run replaces its result in place (same row, same coach stamp): no duplicates.

import { evaluateTemplate } from '../templateEngine.js'
import { weightFromActivity } from '../weightHistory.js'
import { ZONE_SNAPSHOT_COLUMN, zonesFromActivity } from '../powerZones.js'
import { LT_SNAPSHOT_COLUMNS, ltFromActivity } from '../lactateThresholds.js'
import { hasTimeSeries } from './templateRerun.js'

export const MAX_BATCH_TOTAL = 50
export const MAX_IDS_PER_REQUEST = 10
export const REQUEST_BUDGET_MS = 40000
export const ACTIVITY_COLUMNS = `id, user_id, time_series, ftp_at_activity_w, max_hr, weight_at_activity_kg, ${ZONE_SNAPSHOT_COLUMN}, ${LT_SNAPSHOT_COLUMNS.join(', ')}`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Unique, valid activity ids from a request body, or an error message. */
export function parseActivityIds(value, max = MAX_IDS_PER_REQUEST) {
  if (!Array.isArray(value) || value.length === 0) return { error: 'activityIds must be a non-empty list' }
  if (value.length > max) return { error: `At most ${max} activities per request` }
  const ids = []
  for (const v of value) {
    if (typeof v !== 'string' || !UUID_RE.test(v)) return { error: 'Invalid activity id' }
    const id = v.toLowerCase()
    if (!ids.includes(id)) ids.push(id)
  }
  return { ids }
}

const fail = (activity_id, reason) => ({ activity_id, status: 'failed', reason })

/**
 * store: { load(id) -> {activity, replaces: boolean} | null, save(activity, result) -> void }
 * Items stay in input order; ids not reached before the time budget are 'deferred' (the client resends them).
 */
export async function runTemplateBatch(ids, template, store, { evaluate = evaluateTemplate, budgetMs = REQUEST_BUDGET_MS, now = Date.now } = {}) {
  const started = now()
  const items = []
  for (const id of ids) {
    if (now() - started >= budgetMs) {
      items.push({ activity_id: id, status: 'deferred' })
      continue
    }
    try {
      const loaded = await store.load(id)
      if (!loaded?.activity) {
        items.push({ activity_id: id, status: 'skipped', reason: 'Activity not found or not accessible' })
        continue
      }
      const { activity, replaces } = loaded
      if (!hasTimeSeries(activity.time_series)) {
        items.push({ activity_id: id, status: 'skipped', reason: 'No time series data' })
        continue
      }
      const result = evaluate(
        template,
        activity.time_series,
        activity.ftp_at_activity_w ?? null,
        activity.max_hr ?? null,
        ltFromActivity(activity),
        weightFromActivity(activity),
        zonesFromActivity(activity)
      )
      const efforts = Array.isArray(result?.efforts) ? result.efforts : []
      if (efforts.length === 0) {
        // Nothing to store; an existing run keeps its previous result.
        items.push({ activity_id: id, status: 'no_match', reason: replaces ? 'No matching efforts (existing run kept)' : 'No matching efforts', replaced: false })
        continue
      }
      const summary = result?.summary && typeof result.summary === 'object' ? result.summary : {}
      await store.save(activity, { efforts, summary })
      items.push({ activity_id: id, status: 'ok', replaced: !!replaces, efforts: efforts.length })
    } catch (err) {
      items.push(fail(id, String(err?.message || err).slice(0, 200)))
    }
  }
  return items
}

/** Own-account store: every query filters by the owner explicitly (RLS also lets a coach read riders' rows). */
export function ownStore(supabase, userId, templateId) {
  return {
    async load(id) {
      const { data: activity } = await supabase.from('activities').select(ACTIVITY_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle()
      if (!activity) return null
      const { data: existing } = await supabase
        .from('template_executions')
        .select('id')
        .eq('activity_id', id)
        .eq('template_id', templateId)
        .eq('user_id', userId)
        .eq('by_coach', false)
        .limit(1)
      return { activity, replaces: (existing || []).length > 0 }
    },
    async save(activity, { efforts, summary }) {
      const { error } = await supabase
        .from('template_executions')
        .upsert(
          { activity_id: activity.id, template_id: templateId, user_id: userId, by_coach: false, efforts, summary, updated_at: new Date().toISOString() },
          { onConflict: 'activity_id,template_id,coach_key' }
        )
      if (error) throw new Error(error.message)
      await supabase.from('activities').update({ processing_status: 'template_applied' }).eq('id', activity.id).eq('user_id', userId)
    },
  }
}

/** Coach store: inputs and writes only through the coach-safe RPCs (consent re-checked by is_coach_of in SQL). */
export function coachStore(supabase, coachId, riderId, templateId) {
  return {
    async load(id) {
      const { data: inputs, error } = await supabase.rpc('coach_template_run_inputs', { p_activity: id })
      if (error || !inputs || inputs.user_id !== riderId) return null
      const { data: existing } = await supabase
        .from('template_executions')
        .select('id')
        .eq('activity_id', id)
        .eq('template_id', templateId)
        .eq('user_id', riderId)
        .eq('by_coach', true)
        .eq('run_by_coach_id', coachId)
        .limit(1)
      return { activity: { ...inputs, id }, replaces: (existing || []).length > 0 }
    },
    async save(activity, { efforts, summary }) {
      const { error } = await supabase.rpc('coach_save_template_run', { p_activity: activity.id, p_template: templateId, p_efforts: efforts, p_summary: summary })
      if (error) throw new Error(error.message)
    },
  }
}
