// Keeps the persisted feed columns (activities.route_preview / activities.badges) up to
// date for a user's own activities (issue #49). Runs from the dashboard after any change
// (upload, sync, bulk import, delete): cheap when nothing changed.

import { buildFeedPreview } from './routePreview.js'
import { zoneSignature } from './privacyZone.js'
import { fetchPrivacyZone } from './social.js'
import { computeActivityBadges, serializeBadges } from './activityBadges.js'

export const PREVIEW_BATCH_SIZE = 10
export const MAX_PREVIEW_BATCHES = 20
export const BADGE_HISTORY_LIMIT = 5000

const HISTORY_COLUMNS =
  'id, activity_date, created_at, track_id, avg_power_w, max_power_w, max_speed_kmh, distance_m, elevation_gain_m, intensity_factor, badges, power_curve:curves_data->Power'

/**
 * Builds/refreshes `route_preview` for activities that have none yet or whose preview was
 * built with a different privacy zone than the owner's current one (zone changed or
 * ingested without it). Returns how many were updated.
 */
export async function backfillRoutePreviews(
  client,
  userId,
  { maxBatches = MAX_PREVIEW_BATCHES, privacyZone = null } = {}
) {
  const signature = zoneSignature(privacyZone)
  // Rows without a signature are treated as 'none' (unzoned) by the database.
  const stale =
    signature === 'none'
      ? 'route_preview.is.null,route_preview_zone.neq.none'
      : `route_preview.is.null,route_preview_zone.is.null,route_preview_zone.neq.${signature}`

  let updated = 0
  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await client
      .from('activities')
      .select('id, lat:time_series->latitude, lng:time_series->longitude, watts:time_series->watts')
      .eq('user_id', userId)
      .or(stale)
      .limit(PREVIEW_BATCH_SIZE)

    if (error || !data?.length) break

    let batchUpdated = 0
    await Promise.all(
      data.map(async (row) => {
        const preview = buildFeedPreview(
          { latitude: row.lat, longitude: row.lng, watts: row.watts },
          privacyZone
        )
        const { error: updateError } = await client
          .from('activities')
          .update({ route_preview: preview, route_preview_zone: signature })
          .eq('id', row.id)
        if (!updateError) batchUpdated++
      })
    )
    updated += batchUpdated

    // Stop if nothing could be written (avoids re-reading the same failing rows).
    if (data.length < PREVIEW_BATCH_SIZE || batchUpdated === 0) break
  }
  return updated
}

/** Recomputes badges from the user's whole history and writes only the rows that changed. */
export async function refreshUserBadges(client, userId) {
  const [acts, pbs] = await Promise.all([
    client
      .from('activities')
      .select(HISTORY_COLUMNS)
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .limit(BADGE_HISTORY_LIMIT),
    client.from('personal_bests').select('id, track_id, discipline, achieved_date').eq('user_id', userId),
  ])

  if (acts.error) return { updated: 0, error: acts.error }

  const history = acts.data || []
  const computed = computeActivityBadges(history, pbs.data || [])
  const changed = history.filter((a) => {
    const next = JSON.stringify(serializeBadges(computed.get(a.id) || []))
    return JSON.stringify(a.badges ?? null) !== next
  })

  let updated = 0
  for (let i = 0; i < changed.length; i += 10) {
    await Promise.all(
      changed.slice(i, i + 10).map(async (a) => {
        const { error } = await client
          .from('activities')
          .update({ badges: serializeBadges(computed.get(a.id) || []) })
          .eq('id', a.id)
        if (!error) updated++
      })
    )
  }
  return { updated, error: null }
}

export async function syncFeedData(client, userId, { privacyZone } = {}) {
  if (!userId) return { previews: 0, badges: 0 }
  const zone = privacyZone === undefined ? (await fetchPrivacyZone(client, userId)).zone : privacyZone
  const previews = await backfillRoutePreviews(client, userId, { privacyZone: zone })
  const { updated } = await refreshUserBadges(client, userId)
  return { previews, badges: updated }
}
