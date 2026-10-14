// src/lib/server/importActivity.js
//
// Shared server-side import pipeline: fetch from a provider adapter -> analyze -> de-duplicate
// (activityDuplicates, resolveDuplicate for upgrade/skip) -> insert activities + activity_curves.
// Used by the manual Intervals.icu modal (via /api/sync/intervals) and, later, background sync.

import { buildActivityInsert } from '../activityRecord.js'
import { findDuplicate, loadExistingActivityFingerprints, resolveDuplicate } from '../activityDuplicates.js'
import { ImportError, DUPLICATE_MESSAGE } from './importErrors.js'

/**
 * Pure: decides what to do given the candidate and the user's existing activities.
 * @returns {{ action: 'insert' } | { action: 'skip', existing: object } | { action: 'upgrade', existing: object }}
 */
export function planImport({ source, externalId, startTime, elapsedTimeS }, existingFingerprints = []) {
  const sameExternal = existingFingerprints.find(
    (e) => e.external_source === source && e.external_id != null && String(e.external_id) === String(externalId)
  )
  if (sameExternal) return { action: 'skip', existing: sameExternal }

  const duplicate = findDuplicate({ startTime, elapsedTimeS }, existingFingerprints)
  if (!duplicate) return { action: 'insert' }

  return { action: resolveDuplicate({ source }, duplicate), existing: duplicate }
}

const UNIQUE_VIOLATION = '23505'

/**
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase - caller-scoped (RLS) client
 * @param {string} args.userId - verified user id (never client-supplied)
 * @param {{ source: string, fetchActivity: Function }} args.provider - provider adapter
 * @param {string|number} args.externalId
 * @param {{ trackId?: string|null, isFixedGear?: boolean, title?: string|null }} [args.options]
 * @param {Function} [args.analyzeFit] - (blob, filename, gearing) => Promise<analyze.py JSON|null>
 * @param {object} [args.profile] - { default_chainring, default_cog, crank_length_mm, ftp_w }; loaded when omitted
 * @returns {Promise<{ status: 'imported'|'upgraded'|'skipped', activity: object|null, replacedId?: string }>}
 */
export async function importActivity({
  supabase,
  userId,
  provider,
  externalId,
  options = {},
  analyzeFit,
  profile,
}) {
  if (!userId) throw new ImportError('Unauthorized', 401)
  if (externalId == null || externalId === '') throw new ImportError('Missing activityId', 400)

  const prof = profile || (await loadImportProfile(supabase, userId))
  const chainring = prof.default_chainring || 58
  const cog = prof.default_cog || 14
  const isFixedGear = !!options.isFixedGear

  const fetched = await provider.fetchActivity(externalId, {
    gearing: { chainring, cog, isFixedGear },
    analyzeFit,
  })
  const { summary = {}, curves = {}, time_series = {} } = fetched

  const existing = await loadExistingActivityFingerprints(supabase, userId)
  const plan = planImport(
    {
      source: provider.source,
      externalId,
      startTime: summary.start_time,
      elapsedTimeS: summary.elapsed_time_s,
    },
    existing
  )
  if (plan.action === 'skip') return { status: 'skipped', activity: null }

  const record = buildActivityInsert(summary, {
    title: options.title || fetched.title || `${providerLabel(provider.source)} Sync`,
    userId,
    trackId: options.trackId || null,
    chainring,
    cog,
    crankLengthMm: prof.crank_length_mm || 165.0,
    timeSeries: time_series,
    curvesData: curves,
    source: provider.source,
    externalSource: provider.source,
    externalId: String(externalId),
    processingStatus: 'baseline_completed',
    ftpWatts: prof.ftp_w ?? null,
    fallbackActivityDate: fetched.startDateLocal || undefined,
  })

  const { data: activity, error: insertErr } = await supabase
    .from('activities')
    .insert([record])
    .select()
    .single()
  if (insertErr) {
    // Lost a race / DB guard (trg_guard_activity_duplicate, uq_activities_user_external)
    if (insertErr.code === UNIQUE_VIOLATION) return { status: 'skipped', activity: null }
    throw new ImportError(insertErr.message, 500)
  }

  const curveRows = Object.entries(curves).map(([curveType, data]) => ({
    activity_id: activity.id,
    curve_type: curveType,
    data,
  }))
  if (curveRows.length > 0) {
    const { error: curveErr } = await supabase.from('activity_curves').insert(curveRows)
    if (curveErr) console.warn(`activity_curves insert failed for ${activity.id}:`, curveErr.message)
  }

  if (plan.action === 'upgrade') {
    // The higher-priority copy exists now; drop the lower-priority one it replaces.
    const { error: delErr } = await supabase.from('activities').delete().eq('id', plan.existing.id)
    if (delErr) console.warn(`Failed to remove replaced activity ${plan.existing.id}:`, delErr.message)
    return { status: 'upgraded', activity, replacedId: plan.existing.id }
  }

  return { status: 'imported', activity }
}

function providerLabel(source) {
  return source === 'strava' ? 'Strava' : source === 'intervals' ? 'Intervals.icu' : 'Import'
}

export async function loadImportProfile(supabase, userId) {
  const { data } = await supabase
    .from('profiles')
    .select('default_chainring, default_cog, crank_length_mm, ftp_w')
    .eq('id', userId)
    .maybeSingle()
  return data || {}
}

export { DUPLICATE_MESSAGE }
