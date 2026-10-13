// src/lib/activityPagination.js
//
// Dynamic loading of activities (issue #46). The dashboard can have thousands of
// activities per user, so we can't load them all at once. This helper fetches
// activities a page at a time using Supabase's `.range()`, ordered by the most
// recent first (with `id` as a tiebreaker so pages stay stable when several
// activities share the same `activity_date`/`created_at`).

export const DEFAULT_ACTIVITIES_PAGE_SIZE = 20

// Feed columns (issue #49): explicit list instead of `*` so the heavy `time_series` /
// `curves_data` blobs are not shipped for every card. Only the GPS arrays needed for
// the route thumbnail are pulled out of `time_series` via JSON paths.
export const FEED_ACTIVITY_COLUMNS = [
  'id',
  'user_id',
  'title',
  'activity_date',
  'created_at',
  'track_id',
  'chainring',
  'cog',
  'distance_m',
  'moving_time_s',
  'avg_power_w',
  'max_power_w',
  'avg_hr',
  'avg_speed_kmh',
  'max_speed_kmh',
  'elevation_gain_m',
  'intensity_factor',
  'training_load',
  'raw_file_url',
  'route_lat:time_series->latitude',
  'route_lng:time_series->longitude',
  'tracks(name, length_m, surface)',
].join(', ')

export const BADGE_HISTORY_COLUMNS =
  'id, activity_date, created_at, track_id, avg_power_w, max_power_w, max_speed_kmh, distance_m, elevation_gain_m, intensity_factor'

/**
 * Lightweight, metric-only history used to compute feed badges consistently
 * regardless of how many feed pages are loaded.
 */
export async function fetchBadgeHistory(client, { userId, limit = 5000 } = {}) {
  if (!userId) return { activities: [], personalBests: [], error: null }

  const [acts, pbs] = await Promise.all([
    client
      .from('activities')
      .select(BADGE_HISTORY_COLUMNS)
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .limit(limit),
    client.from('personal_bests').select('id, track_id, discipline, achieved_date').eq('user_id', userId),
  ])

  return {
    activities: acts.data || [],
    personalBests: pbs.data || [],
    error: acts.error || null,
  }
}

/**
 * Fetches a single page of a user's activities, most recent first.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client - Supabase client to query with.
 * @param {{ userId: string, page?: number, pageSize?: number }} options
 * @returns {Promise<{ data: Array<object>, hasMore: boolean, error: Error|null }>}
 */
export async function fetchActivitiesPage(
  client,
  { userId, page = 0, pageSize = DEFAULT_ACTIVITIES_PAGE_SIZE } = {}
) {
  if (!userId) {
    return { data: [], hasMore: false, error: null }
  }

  const from = page * pageSize
  const to = from + pageSize - 1

  const { data, error } = await client
    .from('activities')
    .select(FEED_ACTIVITY_COLUMNS)
    .eq('user_id', userId)
    .order('activity_date', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)

  if (error) {
    return { data: [], hasMore: false, error }
  }

  const rows = data || []

  return {
    data: rows,
    // If we got a full page, there may be more; the next fetch will confirm it.
    hasMore: rows.length === pageSize,
    error: null,
  }
}
