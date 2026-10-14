// Rider discovery helpers (issue #80). Search, ranking, blocks and follow state are
// computed by the search_riders / get_rider_profile RPCs (see migration 20261019000000).

export const RIDERS_PAGE_SIZE = 20
export const RIDER_SEARCH_MIN_CHARS = 2
export const RIDER_SEARCH_DEBOUNCE_MS = 300

// A term shorter than the minimum is treated as "no search" (browse mode).
export function normalizeRiderTerm(term) {
  const clean = String(term ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)
  return clean.length >= RIDER_SEARCH_MIN_CHARS ? clean : ''
}

export function riderName(rider) {
  return rider?.full_name || rider?.username || 'Rider'
}

export function riderInitial(rider) {
  return riderName(rider).charAt(0).toUpperCase()
}

// 'following' | 'requested' | 'none' | 'self' -> button label (null = no button).
export function followButtonLabel(rider, status = rider?.follow_status) {
  if (status === 'self') return null
  if (status === 'following') return 'Unfollow'
  if (status === 'requested') return 'Requested'
  return rider?.require_follow_approval ? 'Request' : 'Follow'
}

// Relative label for the last public ride date (YYYY-MM-DD), in whole days.
export function formatLastActive(dateStr, now = new Date()) {
  if (!dateStr) return 'No public rides yet'
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return 'No public rides yet'
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((today - d.getTime()) / 86400000)
  if (days <= 0) return 'Rode today'
  if (days === 1) return 'Rode yesterday'
  if (days < 30) return `Rode ${days} days ago`
  return `Last ride ${String(dateStr).slice(0, 10)}`
}

export function formatRideCount(count) {
  const n = Number(count) || 0
  return `${n} public ride${n === 1 ? '' : 's'}`
}

// Appends a page, dropping riders already present (offset paging can overlap when the
// list changes between requests).
export function mergeRiderPages(existing, next) {
  const seen = new Set(existing.map((r) => r.id))
  return [...existing, ...next.filter((r) => !seen.has(r.id))]
}

/**
 * One page of riders. Requests `limit + 1` rows to learn whether more exist.
 */
export async function fetchRidersPage(
  client,
  { term = '', botsOnly = false, offset = 0, limit = RIDERS_PAGE_SIZE } = {}
) {
  const { data, error } = await client.rpc('search_riders', {
    p_term: normalizeRiderTerm(term),
    p_bots_only: !!botsOnly,
    p_limit: limit + 1,
    p_offset: offset,
  })
  if (error) return { riders: [], hasMore: false, error }
  const rows = data || []
  return { riders: rows.slice(0, limit), hasMore: rows.length > limit, error: null }
}

export async function fetchRiderProfile(client, id) {
  if (!id) return { rider: null, error: null }
  const { data, error } = await client.rpc('get_rider_profile', { p_id: id })
  if (error) return { rider: null, error }
  const row = Array.isArray(data) ? data[0] : data
  return { rider: row || null, error: null }
}
