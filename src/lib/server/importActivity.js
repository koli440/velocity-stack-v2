// src/lib/server/importActivity.js
//
// Shared server-side import pipeline: fetch from a provider adapter -> analyze -> de-duplicate
// (activityDuplicates, resolveDuplicate for upgrade/skip) -> insert activities + activity_curves.
// Used by the manual Intervals.icu modal (via /api/sync/intervals) and, later, background sync.

import { buildActivityInsert } from '../activityRecord.js'
import { findDuplicate, loadExistingActivityFingerprints, resolveDuplicate } from '../activityDuplicates.js'
import { ImportError, DUPLICATE_MESSAGE } from './importErrors.js'
import { autoLinkActivity, dayOfLocalStamp } from '../plannedWorkouts.js'
import { effectiveRideType, rideTypeHasGear, isKnownRideType } from '../rideType.js'
import { prepareAnalysis } from '../gymAnalysis.js'
import { resolveRideType } from '../sportType.js'
import { saveGymDetail } from '../gymDetail.js'
import { scoreGymBestEffort } from './gymLoadStore.js'
import { resolveImportTitle, localHourFromStamp, isGenericActivityName, RECENT_NAMES_WINDOW } from '../activityNaming.js'

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
 * @param {{ trackId?: string|null, isFixedGear?: boolean, title?: string|null, rideType?: string|null }} [args.options]
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
  // Gear is optional: only the rider's own saved default is used, never a hardcoded fallback.
  const chainring = prof.default_chainring || null
  const cog = prof.default_cog || null
  // Ride type: explicit option, else the rider's Settings default (road when unset). Never detected.
  const rideType = effectiveRideType(
    isKnownRideType(options.rideType) ? options.rideType : prof.default_ride_type
  )
  const isFixedGear = !!options.isFixedGear || rideTypeHasGear(rideType)

  const fetched = await provider.fetchActivity(externalId, {
    gearing: { chainring, cog, isFixedGear },
    analyzeFit,
  })
  // Providers can decline an activity (a sport we do not import): nothing is imported.
  if (fetched?.skip) return { status: 'skipped', activity: null }
  // Gym sessions keep only duration / heart rate / calories; rides pass through untouched.
  const prepared = prepareAnalysis(fetched, fetched.activityType, fetched.sport)
  const { activityType, summary, curves, time_series, gym } = prepared
  const isGym = activityType === 'gym'
  // Detected flavour (MTB, gravel, trail run...) beats the rider's default; plain road keeps their choice.
  const storedRideType = isGym ? null : resolveRideType(prepared.sport, rideType)

  // Providers serving many apps (partner:<slug>) keep their ids apart per app; the rest use their source name.
  const externalSource = provider.externalSource || provider.source
  const existing = await loadExistingActivityFingerprints(supabase, userId)
  const plan = planImport(
    {
      source: externalSource,
      externalId,
      startTime: summary.start_time,
      elapsedTimeS: summary.elapsed_time_s,
    },
    existing
  )
  if (plan.action === 'skip') return { status: 'skipped', activity: null }

  const sourceTitle = options.title || fetched.title || `${providerLabel(provider.source)} ${isGym ? 'Gym Session' : 'Sync'}`
  const naming = await loadNamingContext(supabase, userId, plan.action === 'upgrade' ? plan.existing.id : null)
  // A rider-edited name on the replaced copy is locked; a name it already got (generated) carries over.
  const keepTitle = naming.replaced?.title_locked ? naming.replaced.title : isGenericActivityName(sourceTitle) && !isGenericActivityName(naming.replaced?.title) ? naming.replaced.title : null
  const { title: finalTitle } = resolveImportTitle({
    title: sourceTitle,
    lockedTitle: keepTitle,
    seed: `${userId}|${summary.start_time || fetched.startDateLocal || externalId}`,
    activityType,
    sport: prepared.sport,
    rideType: storedRideType,
    summary,
    ftpWatts: prof.ftp_w ?? null,
    timeSeries: time_series,
    localHour: localHourFromStamp(fetched.startDateLocal),
    recentNames: naming.recentNames,
  })

  const record = buildActivityInsert(summary, {
    title: finalTitle,
    userId,
    trackId: isGym ? null : options.trackId || null,
    activityType,
    rideType: storedRideType,
    chainring,
    cog,
    crankLengthMm: prof.crank_length_mm || 165.0,
    timeSeries: time_series,
    curvesData: curves,
    source: provider.source,
    externalSource,
    externalId: String(externalId),
    processingStatus: 'baseline_completed',
    ftpWatts: prof.ftp_w ?? null,
    ftpHistory: prof.ftp_history ?? null,
    weightHistory: prof.weight_history ?? null,
    fallbackActivityDate: fetched.startDateLocal || undefined,
  })

  // Only written when set, so inserts never depend on the title_locked migration.
  if (naming.replaced?.title_locked) record.title_locked = true

  // Sets were looked for in this very file: the repair must not fetch it again.
  if (isGym) record.gym_detail_checked_at = new Date().toISOString()

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

  const curveErr = await insertCurves(supabase, activity.id, curves)
  if (curveErr) {
    // Never leave a ride without its curves: roll the activity back so the next sync retries it.
    const { error: rollbackErr } = await supabase.from('activities').delete().eq('id', activity.id)
    if (rollbackErr) console.warn(`Rollback of activity ${activity.id} failed:`, rollbackErr.message)
    throw new ImportError(`Saving curves failed: ${curveErr.message}`, 500)
  }

  if (gym) {
    const gymErr = await saveGymDetail(supabase, gym, { activityId: activity.id, userId })
    if (gymErr) {
      const { error: rollbackErr } = await supabase.from('activities').delete().eq('id', activity.id)
      if (rollbackErr) console.warn(`Rollback of activity ${activity.id} failed:`, rollbackErr.message)
      throw new ImportError(`Saving exercises and sets failed: ${gymErr.message}`, 500)
    }
    await scoreGymBestEffort(activity.id)
  }

  if (plan.action === 'upgrade') {
    // The higher-priority copy exists now. Move a planned workout's completion link over first (deleting the
    // old row would clear it and the workout would show as missed), then drop the lower-priority copy.
    const { error: relinkErr } = (await supabase.rpc?.('planned_workouts_relink_activity', { p_old: plan.existing.id, p_new: activity.id })) || {}
    if (relinkErr) console.warn(`Failed to keep planned workout links of ${plan.existing.id}:`, relinkErr.message)
    const { error: delErr } = await supabase.from('activities').delete().eq('id', plan.existing.id)
    if (delErr) console.warn(`Failed to remove replaced activity ${plan.existing.id}:`, delErr.message)
    await autoLinkImported(supabase, activity, fetched.startDateLocal)
    return { status: 'upgraded', activity, replacedId: plan.existing.id }
  }

  await autoLinkImported(supabase, activity, fetched.startDateLocal)
  return { status: 'imported', activity }
}

// Auto-link to the same-day planned workout, by the provider's own local start (no timezone on the server).
async function autoLinkImported(supabase, activity, startDateLocal) {
  const localDay = dayOfLocalStamp(startDateLocal)
  if (localDay) await autoLinkActivity(supabase, { activity, localDay })
}

/** One activity_curves row per metric; empty/null curves are skipped. Returns the insert error, if any. */
export async function insertCurves(supabase, activityId, curves) {
  const rows = Object.entries(curves || {})
    .filter(([, data]) => data && Object.keys(data).length > 0)
    .map(([curveType, data]) => ({ activity_id: activityId, curve_type: curveType, data }))
  if (rows.length === 0) return null
  const { error } = await supabase.from('activity_curves').insert(rows)
  return error || null
}

/** Recent titles (to avoid repeats) and the replaced copy's title/lock. Best effort: naming never blocks an import. */
async function loadNamingContext(supabase, userId, replacedId) {
  const out = { recentNames: [], replaced: null }
  try {
    const recent = await supabase.from('activities').select('title').eq('user_id', userId).order('created_at', { ascending: false }).limit(RECENT_NAMES_WINDOW)
    out.recentNames = (recent?.data || []).map((r) => r.title).filter(Boolean)
    if (replacedId) {
      const { data, error } = await supabase.from('activities').select('title, title_locked').eq('id', replacedId).maybeSingle()
      if (!error && data) out.replaced = data
    }
  } catch {
    // keep defaults
  }
  return out
}

function providerLabel(source) {
  return source === 'strava' ? 'Strava' : source === 'intervals' ? 'Intervals.icu' : source === 'wahoo' ? 'Wahoo' : source === 'garmin' ? 'Garmin' : source === 'partner' ? 'App' : 'Import'
}

export async function loadImportProfile(supabase, userId) {
  const { data } = await supabase
    .from('profiles')
    .select('default_chainring, default_cog, crank_length_mm, ftp_w, default_ride_type')
    .eq('id', userId)
    .maybeSingle()
  const { data: ftpRows } = await supabase
    .from('ftp_history')
    .select('effective_from, ftp_w')
    .eq('user_id', userId)
  const { data: weightRows } = await supabase
    .from('weight_history')
    .select('effective_from, weight_kg')
    .eq('user_id', userId)
  return { ...(data || {}), ftp_history: ftpRows || [], weight_history: weightRows || [] }
}

export { DUPLICATE_MESSAGE }
