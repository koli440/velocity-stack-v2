// Coaching relationships (coaching step 2). All writes go through SECURITY DEFINER RPCs
// (see supabase/migrations/20261129000000_coaching_relationships.sql); the table itself is
// not readable by clients, `my_coaching()` is.

import { fetchProfilesByIds, authorName } from './social.js'

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

export { authorName }
