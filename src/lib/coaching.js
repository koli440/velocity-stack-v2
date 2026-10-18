// Coaching relationships (coaching step 2). All writes go through SECURITY DEFINER RPCs
// (see supabase/migrations/20261129000000_coaching_relationships.sql); the table itself is
// not readable by clients, `my_coaching()` is.

import { fetchProfilesByIds, authorName } from './social.js'
import { SHARED_FEED_COLUMNS, DEFAULT_ACTIVITIES_PAGE_SIZE } from './activityPagination.js'

export const COACHING_SETTINGS_PATH = '/settings#coaching'

/**
 * Splits the caller's relationships (rows from my_coaching()) into the groups the UI shows.
 * `coach` is the rider's single active coach; `athletes` are riders the user coaches.
 */
export function groupRelationships(rows, userId) {
  const groups = {
    coach: null,
    athletes: [],
    incomingInvites: [], // a coach invited me; I accept (and may replace my coach)
    incomingRequests: [], // a rider asked me to coach them
    outgoingInvites: [], // I invited a rider
    outgoingRequests: [], // I asked a rider to be my coach
  }
  for (const row of rows || []) {
    const iAmCoach = row.coach_id === userId
    const iAmRider = row.rider_id === userId
    if (!iAmCoach && !iAmRider) continue
    if (row.status === 'active') {
      if (iAmRider) groups.coach = row
      else groups.athletes.push(row)
    } else if (row.status === 'pending') {
      const mine = row.initiated_by === userId
      if (iAmRider) (mine ? groups.outgoingRequests : groups.incomingInvites).push(row)
      else (mine ? groups.outgoingInvites : groups.incomingRequests).push(row)
    }
  }
  return groups
}

// The other participant of a relationship row, seen from `userId`.
export function otherId(row, userId) {
  return row.coach_id === userId ? row.rider_id : row.coach_id
}

/**
 * Warning shown BEFORE a rider accepts a coach's invite when they already have a coach.
 * Returns null when nothing would be replaced.
 */
export function replacementWarning({ currentCoachName, newCoachName } = {}) {
  if (!currentCoachName) return null
  const next = newCoachName || 'this coach'
  return (
    `Accepting will replace ${currentCoachName} as your coach. ${currentCoachName} loses access ` +
    `to your data immediately and is notified. ${next} will be able to read all your data, ` +
    `including private activities.`
  )
}

// What the profile of another rider offers, from coaching_status_with().
// -> { invite, request, accept, decline, cancel, end, label, hint }
export function profileCoachingActions(status, { viewerHasCoach = false } = {}) {
  const none = { invite: false, request: false, accept: false, decline: false, cancel: false, end: false }
  switch (status) {
    case 'invited':
      return { ...none, cancel: true, label: 'Invitation sent' }
    case 'requested':
      return { ...none, cancel: true, label: 'Coach request sent' }
    case 'invite_received':
      return { ...none, accept: true, decline: true, label: 'Invited you as their athlete' }
    case 'request_received':
      return { ...none, accept: true, decline: true, label: 'Asked you to coach them' }
    case 'coach':
      return { ...none, end: true, label: 'Your coach' }
    case 'athlete':
      return { ...none, end: true, label: 'Your athlete' }
    case 'self':
      return none
    default:
      return {
        ...none,
        invite: true,
        request: !viewerHasCoach,
        hint: viewerHasCoach ? 'End your current coaching relationship to request a new coach.' : undefined,
      }
  }
}

// Maps database exceptions to short messages.
export function coachingErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/already pending|already have a coaching/i.test(msg)) return msg
  if (/End your current coaching|already has a coach|Too many pending|yourself/i.test(msg)) return msg
  if (/Rider not found|No such coaching/i.test(msg)) return 'This request is no longer available.'
  return 'Something went wrong. Please try again.'
}

// ---- Data access -----------------------------------------------------------------------

export async function fetchMyCoaching(client, userId) {
  if (!userId) return { rows: [], profiles: new Map(), error: null }
  const { data, error } = await client.rpc('my_coaching')
  if (error) return { rows: [], profiles: new Map(), error }
  const rows = data || []
  const { profiles } = await fetchProfilesByIds(
    client,
    rows.map((r) => otherId(r, userId))
  )
  return { rows, profiles, error: null }
}

export async function fetchCoachingStatus(client, otherUserId) {
  if (!otherUserId) return { id: null, status: 'none', error: null }
  const { data, error } = await client.rpc('coaching_status_with', { p_other: otherUserId })
  if (error) return { id: null, status: 'none', error }
  const row = Array.isArray(data) ? data[0] : data
  return { id: row?.id ?? null, status: row?.status || 'none', error: null }
}

const rpcAction = (name, params) => async (client, arg) => {
  const { error } = await client.rpc(name, params(arg))
  return { error: error || null }
}

export const inviteAthlete = rpcAction('invite_athlete', (riderId) => ({ p_rider: riderId }))
export const requestCoach = rpcAction('request_coach', (coachId) => ({ p_coach: coachId }))
export const acceptCoaching = rpcAction('accept_coaching', (id) => ({ p_id: id }))
export const declineCoaching = rpcAction('decline_coaching', (id) => ({ p_id: id }))
export const endCoaching = rpcAction('end_coaching', (id) => ({ p_id: id }))

// Athlete the signed-in coach may read (null when not their active coach).
export async function fetchAthleteProfile(client, riderId) {
  if (!riderId) return { athlete: null, error: null }
  const { data, error } = await client.rpc('get_athlete_profile', { p_rider: riderId })
  if (error) return { athlete: null, error }
  const row = Array.isArray(data) ? data[0] : data
  return { athlete: row || null, error: null }
}

// ---- Coach edits (coaching step 3) -----------------------------------------------------

// Training defaults a coach may change on the athlete's profile (mirrors the database whitelist).
export const COACH_PROFILE_FIELDS = Object.freeze([
  'home_track_id',
  'default_chainring',
  'default_cog',
  'crank_length_mm',
])

/** Keeps only the whitelisted profile fields (the database rejects everything else anyway). */
export function pickCoachProfileChanges(changes) {
  const out = {}
  for (const key of COACH_PROFILE_FIELDS) {
    if (changes && Object.prototype.hasOwnProperty.call(changes, key)) out[key] = changes[key]
  }
  return out
}

/**
 * "Set by coach" label for a history row or profile defaults. `row` carries the stamp columns
 * (`set_by_coach` + `changed_by` + `changed_at`, or the profile's `training_set_*` equivalents);
 * `names` maps user ids to display names. Returns null for the rider's own values.
 */
export function coachEditLabel(row, names) {
  const byCoach = row?.set_by_coach ?? row?.training_set_by_coach
  if (!byCoach) return null
  const who = row.changed_by ?? row.training_set_by
  const at = row.changed_at ?? row.training_set_at
  const name = (names instanceof Map ? names.get(who) : names?.[who]) || null
  const date = at ? new Date(at).toISOString().slice(0, 10) : null
  const parts = ['Set by coach']
  if (name) parts[0] += ` ${name}`
  if (date) parts.push(date)
  return parts.join(' · ')
}

/** Distinct stamp authors of rows, to resolve their names in one query. */
export function coachEditAuthorIds(rows) {
  const ids = new Set()
  for (const row of rows || []) {
    const byCoach = row?.set_by_coach ?? row?.training_set_by_coach
    const who = row?.changed_by ?? row?.training_set_by
    if (byCoach && who) ids.add(who)
  }
  return [...ids]
}

export async function fetchCoachDashboard(client) {
  const { data, error } = await client.rpc('coach_dashboard')
  return { rows: error ? [] : data || [], error: error || null }
}

export async function updateAthleteProfile(client, riderId, changes) {
  const { error } = await client.rpc('coach_update_athlete_profile', {
    p_rider: riderId,
    p_changes: pickCoachProfileChanges(changes),
  })
  return { error: error || null }
}

// Audit trail rows visible to the signed-in user (the rider sees all, a coach their own).
export async function fetchCoachEdits(client, riderId, limit = 50) {
  const { data, error } = await client
    .from('coach_edits')
    .select('id, coach_id, table_name, row_id, action, old_values, new_values, created_at')
    .eq('rider_id', riderId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return { edits: error ? [] : data || [], error: error || null }
}

// One page of an athlete's activities through the masked shared_activities view (a coach reads
// everything incl. private activities, but privacy-zone coordinates stay masked).
export async function fetchAthleteActivitiesPage(client, { riderId, page = 0, pageSize = DEFAULT_ACTIVITIES_PAGE_SIZE } = {}) {
  if (!riderId) return { data: [], hasMore: false, error: null }
  const from = page * pageSize
  const { data, error } = await client
    .from('shared_activities')
    .select(SHARED_FEED_COLUMNS)
    .eq('user_id', riderId)
    .order('activity_date', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1)
  if (error) return { data: [], hasMore: false, error }
  const rows = data || []
  return { data: rows, hasMore: rows.length === pageSize, error: null }
}

export { authorName }
