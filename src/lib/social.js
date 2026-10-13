// Social feed helpers (issue #49): follow graph, rider search, followed-riders feed and
// per-activity visibility. All access control is enforced by RLS (see
// supabase/migrations/20261012000000_social_feed.sql); these helpers just shape queries.

import { FEED_ACTIVITY_COLUMNS, DEFAULT_ACTIVITIES_PAGE_SIZE } from './activityPagination.js'

export const VISIBILITY_OPTIONS = Object.freeze([
  { value: 'private', label: 'Only me' },
  { value: 'followers', label: 'Followers' },
  { value: 'public', label: 'Public' },
])

export const RIDER_SEARCH_LIMIT = 10

export function isValidVisibility(value) {
  return VISIBILITY_OPTIONS.some((o) => o.value === value)
}

// Strip characters that have meaning in PostgREST filters / ILIKE patterns.
export function sanitizeSearchTerm(term) {
  return String(term ?? '')
    .replace(/[%_\\,()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)
}

export async function fetchFollowingIds(client, userId) {
  if (!userId) return { ids: [], error: null }
  const { data, error } = await client.from('follows').select('followee_id').eq('follower_id', userId)
  if (error) return { ids: [], error }
  return { ids: (data || []).map((r) => r.followee_id), error: null }
}

export async function fetchProfilesByIds(client, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  if (!unique.length) return { profiles: new Map(), error: null }
  const { data, error } = await client
    .from('public_profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', unique)
  if (error) return { profiles: new Map(), error }
  return { profiles: new Map((data || []).map((p) => [p.id, p])), error: null }
}

export async function followUser(client, { followerId, followeeId }) {
  if (!followerId || !followeeId || followerId === followeeId) {
    return { error: new Error('Invalid follow request') }
  }
  const { error } = await client
    .from('follows')
    .insert({ follower_id: followerId, followee_id: followeeId })
  // Already following = success (primary key violation).
  if (error && error.code !== '23505') return { error }
  return { error: null }
}

export async function unfollowUser(client, { followerId, followeeId }) {
  const { error } = await client
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', followeeId)
  return { error: error || null }
}

export async function searchRiders(client, { term, excludeId, limit = RIDER_SEARCH_LIMIT } = {}) {
  const clean = sanitizeSearchTerm(term)
  if (clean.length < 2) return { riders: [], error: null }
  let query = client
    .from('public_profiles')
    .select('id, username, full_name, avatar_url')
    .or(`username.ilike.%${clean}%,full_name.ilike.%${clean}%`)
    .limit(limit + 1)
  const { data, error } = await query
  if (error) return { riders: [], error }
  return {
    riders: (data || []).filter((r) => r.id !== excludeId).slice(0, limit),
    error: null,
  }
}

/**
 * One page of activities from riders the user follows (RLS limits the rows to those
 * shared with the user), each annotated with its `author` public profile.
 */
export async function fetchFollowingFeedPage(
  client,
  { userId, page = 0, pageSize = DEFAULT_ACTIVITIES_PAGE_SIZE } = {}
) {
  if (!userId) return { data: [], hasMore: false, error: null }

  const { ids, error: followError } = await fetchFollowingIds(client, userId)
  if (followError) return { data: [], hasMore: false, error: followError }
  if (!ids.length) return { data: [], hasMore: false, error: null }

  const from = page * pageSize
  const { data, error } = await client
    .from('activities')
    .select(FEED_ACTIVITY_COLUMNS)
    .in('user_id', ids)
    .neq('visibility', 'private')
    .order('activity_date', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) return { data: [], hasMore: false, error }

  const rows = data || []
  const { profiles } = await fetchProfilesByIds(client, rows.map((r) => r.user_id))

  return {
    data: rows.map((r) => ({ ...r, author: profiles.get(r.user_id) || null })),
    hasMore: rows.length === pageSize,
    error: null,
  }
}

export async function setActivityVisibility(client, { activityId, visibility }) {
  if (!isValidVisibility(visibility)) return { error: new Error('Invalid visibility') }
  const { error } = await client.from('activities').update({ visibility }).eq('id', activityId)
  return { error: error || null }
}

export function authorName(author) {
  return author?.full_name || author?.username || 'Rider'
}
