// src/lib/activityPagination.js
//
// Dynamic loading of activities (issue #46). The dashboard can have thousands of
// activities per user, so we can't load them all at once. This helper fetches
// activities a page at a time using Supabase's `.range()`, ordered by the most
// recent first (with `id` as a tiebreaker so pages stay stable when several
// activities share the same `activity_date`/`created_at`).

export const DEFAULT_ACTIVITIES_PAGE_SIZE = 20

// Feed columns (issue #49): explicit list instead of `*` so the heavy `time_series` /
// `curves_data` blobs are not shipped for every card; the persisted `route_preview` and
// `badges` columns carry everything the card needs.
const FEED_COLUMN_LIST = [
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
  'visibility',
  'route_preview',
  'badges',
  'tracks(name, length_m, surface)',
]

export const FEED_ACTIVITY_COLUMNS = FEED_COLUMN_LIST.join(', ')

// Same card data for activities of OTHER riders, read from the `shared_activities` view
// (no raw_file_url; GPS stripped). `tracks` is a JSON column there, not an embed.
export const SHARED_FEED_COLUMNS = FEED_COLUMN_LIST.filter((c) => c !== 'raw_file_url')
  .map((c) => (c.startsWith('tracks(') ? 'tracks' : c))
  .join(', ')

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
