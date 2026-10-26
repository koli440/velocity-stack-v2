// Social feed helpers (issue #49): follow graph, rider search, followed-riders feed and
// per-activity visibility. All access control is enforced by RLS (see
// supabase/migrations/20261012000000_social_feed.sql); these helpers just shape queries.

import {
  FEED_ACTIVITY_COLUMNS,
  SHARED_FEED_COLUMNS,
  DEFAULT_ACTIVITIES_PAGE_SIZE,
} from './activityPagination.js'
import { normalizeZone, validateZone } from './privacyZone.js'

export const VISIBILITY_OPTIONS = Object.freeze([
  { value: 'private', label: 'Only me', hint: 'Only you can see this session' },
  { value: 'followers', label: 'Followers', hint: 'Only riders who follow you can see this session' },
  {
    value: 'public',
    label: 'Public',
    hint: 'Any signed-in VelocityStack rider can see this session (including its route), unless you blocked them',
  },
])

export const DEFAULT_VISIBILITY = 'public'

export const RIDER_SEARCH_LIMIT = 10

const PROFILE_COLUMNS = 'id, display_name, nickname, first_name, last_name, require_follow_approval, is_bot, avatar_url'

export function isValidVisibility(value) {
  return VISIBILITY_OPTIONS.some((o) => o.value === value)
}

// Strip characters that have meaning in PostgREST filters / ILIKE patterns.
export function sanitizeSearchTerm(term) {
  return String(term ?? '')
    .replace(/[%_\\,()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 254)
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
    .select(PROFILE_COLUMNS)
    .in('id', unique)
  if (error) return { profiles: new Map(), error }
  return { profiles: new Map((data || []).map((p) => [p.id, p])), error: null }
}

// With `requiresApproval` (target.require_follow_approval) a follow request is created
// instead of a follow. RLS enforces both paths, so a stale flag just surfaces an error.
export async function followUser(client, { followerId, followeeId, requiresApproval = false }) {
  if (!followerId || !followeeId || followerId === followeeId) {
    return { error: new Error('Invalid follow request'), status: null }
  }
  const table = requiresApproval ? 'follow_requests' : 'follows'
  const row = requiresApproval
    ? { requester_id: followerId, target_id: followeeId }
    : { follower_id: followerId, followee_id: followeeId }
  const { error } = await client.from(table).insert(row)
  // Already following / already requested = success (primary key violation).
  if (error && error.code !== '23505') return { error, status: null }
  return { error: null, status: requiresApproval ? 'requested' : 'following' }
}

export async function unfollowUser(client, { followerId, followeeId }) {
  const { error } = await client
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', followeeId)
  return { error: error || null }
}

// Name search (nickname / first / last, or an exact e-mail address) runs server-side in
// the search_riders RPC, which also drops blocked riders and the caller.
export async function searchRiders(
  client,
  { term, excludeId, excludeIds = [], limit = RIDER_SEARCH_LIMIT } = {}
) {
  const clean = sanitizeSearchTerm(term)
  if (clean.length < 2) return { riders: [], error: null }
  const { data, error } = await client.rpc('search_riders', {
    p_term: clean,
    p_bots_only: false,
    p_limit: limit + 1 + excludeIds.length,
    p_offset: 0,
  })
  if (error) return { riders: [], error }
  return {
    riders: (data || []).filter((r) => r.id !== excludeId && !excludeIds.includes(r.id)).slice(0, limit),
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
    .from('shared_activities')
    .select(SHARED_FEED_COLUMNS)
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
  return author?.display_name || 'Rider'
}

// ---- Blocking -----------------------------------------------------------------------

// The database removes follows and pending requests in both directions (trigger).
export async function blockUser(client, { blockerId, blockedId }) {
  if (!blockerId || !blockedId || blockerId === blockedId) {
    return { error: new Error('Invalid block request') }
  }
  const { error } = await client.from('blocks').insert({ blocker_id: blockerId, blocked_id: blockedId })
  if (error && error.code !== '23505') return { error }
  return { error: null }
}

export async function unblockUser(client, { blockerId, blockedId }) {
  const { error } = await client
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
  return { error: error || null }
}

export async function fetchBlockedIds(client, userId) {
  if (!userId) return { ids: [], error: null }
  const { data, error } = await client.from('blocks').select('blocked_id').eq('blocker_id', userId)
  if (error) return { ids: [], error }
  return { ids: (data || []).map((r) => r.blocked_id), error: null }
}

// ---- Followers, counts, requests ------------------------------------------------------

export async function fetchFollowerIds(client, userId) {
  if (!userId) return { ids: [], error: null }
  const { data, error } = await client.from('follows').select('follower_id').eq('followee_id', userId)
  if (error) return { ids: [], error }
  return { ids: (data || []).map((r) => r.follower_id), error: null }
}

// Counts are only available for the signed-in rider (RLS: follows are visible to the
// two riders involved).
export async function fetchFollowCounts(client, userId) {
  if (!userId) return { followers: 0, following: 0, error: null }
  const [followers, following] = await Promise.all([
    client.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', userId),
    client.from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ])
  const error = followers.error || following.error || null
  return { followers: followers.count ?? 0, following: following.count ?? 0, error }
}

export async function fetchIncomingRequestIds(client, userId) {
  if (!userId) return { ids: [], error: null }
  const { data, error } = await client.from('follow_requests').select('requester_id').eq('target_id', userId)
  if (error) return { ids: [], error }
  return { ids: (data || []).map((r) => r.requester_id), error: null }
}

export async function fetchOutgoingRequestIds(client, userId) {
  if (!userId) return { ids: [], error: null }
  const { data, error } = await client.from('follow_requests').select('target_id').eq('requester_id', userId)
  if (error) return { ids: [], error }
  return { ids: (data || []).map((r) => r.target_id), error: null }
}

export async function approveFollowRequest(client, { requesterId }) {
  const { error } = await client.rpc('approve_follow_request', { p_requester: requesterId })
  return { error: error || null }
}

// Used both by the target (decline) and the requester (cancel).
export async function removeFollowRequest(client, { requesterId, targetId }) {
  const { error } = await client
    .from('follow_requests')
    .delete()
    .eq('requester_id', requesterId)
    .eq('target_id', targetId)
  return { error: error || null }
}

export async function setRequireFollowApproval(client, { userId, value }) {
  const { error } = await client
    .from('profiles')
    .update({ require_follow_approval: !!value })
    .eq('id', userId)
  return { error: error || null }
}

export async function fetchRequireFollowApproval(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('require_follow_approval')
    .eq('id', userId)
    .maybeSingle()
  return { value: !!data?.require_follow_approval, error: error || null }
}

// ---- GPS privacy zone ---------------------------------------------------------------------

export async function fetchPrivacyZone(client, userId) {
  if (!userId) return { zone: null, error: null }
  const { data, error } = await client
    .from('profiles')
    .select('privacy_zone_lat, privacy_zone_lng, privacy_zone_radius_m')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { zone: null, error }
  return { zone: normalizeZone(data), error: null }
}

/** Saves (or, with `zone: null`, disables) the zone. Previews must be rebuilt afterwards. */
export async function savePrivacyZone(client, { userId, zone }) {
  let columns = { privacy_zone_lat: null, privacy_zone_lng: null, privacy_zone_radius_m: null }
  if (zone) {
    const problem = validateZone(zone)
    if (problem) return { error: new Error(problem), zone: null }
    const z = normalizeZone(zone)
    columns = { privacy_zone_lat: z.lat, privacy_zone_lng: z.lng, privacy_zone_radius_m: z.radius }
  }
  const { error } = await client.from('profiles').update(columns).eq('id', userId)
  if (error) return { error, zone: null }
  return { error: null, zone: normalizeZone(columns) }
}
