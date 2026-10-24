// src/lib/emptyFeed.js
// Pure decision logic for the "no activities yet" welcome card on the My sessions feed.
import { isConnected } from './connections.js'
import { backfillProgressText } from './syncPlan.js'

/** Result of the Strava OAuth round trip (?strava=<flag>) as [message, isError]. */
export const STRAVA_FLAGS = {
  connected: ['Strava connected. Importing your rides…', false],
  denied: ['Strava authorization was cancelled.', true],
  missing_scope: ['Please allow access to your activities on Strava and try again.', true],
  invalid_state: ['The Strava connection request expired. Please try again.', true],
  not_configured: ['Strava is not configured on this deployment.', true],
  error: ['Could not connect Strava. Please try again.', true],
}

export function stravaFlagMessage(flag) {
  const [text, isError] = STRAVA_FLAGS[flag] || STRAVA_FLAGS.error
  return { text, isError }
}

/** Result of the Wahoo OAuth round trip (?wahoo=<flag>) as [message, isError]. */
export const WAHOO_FLAGS = {
  connected: ['Wahoo connected. Importing your rides…', false],
  denied: ['Wahoo authorization was cancelled.', true],
  invalid_state: ['The Wahoo connection request expired. Please try again.', true],
  not_configured: ['Wahoo is not configured on this deployment.', true],
  error: ['Could not connect Wahoo. Please try again.', true],
}

export function wahooFlagMessage(flag) {
  const [text, isError] = WAHOO_FLAGS[flag] || WAHOO_FLAGS.error
  return { text, isError }
}

/** Result of the OAuth round trip (?intervals=<flag>). */
export const INTERVALS_FLAGS = {
  connected: ['Intervals.icu connected. Importing your rides…', false],
  denied: ['Intervals.icu authorization was cancelled.', true],
  invalid_state: ['The Intervals.icu connection request expired. Please try again.', true],
  not_configured: ['Intervals.icu OAuth is not configured on this deployment.', true],
  error: ['Could not connect Intervals.icu. Please try again.', true],
}

export function intervalsFlagMessage(flag) {
  const [text, isError] = INTERVALS_FLAGS[flag] || INTERVALS_FLAGS.error
  return { text, isError }
}

/**
 * Which welcome-card state to show.
 * - 'hidden': feed has activities, or connections are not loaded yet (avoids flashing the connect buttons)
 * - 'connect': nothing connected
 * - 'importing': connected and history is still being pulled in
 * - 'connected': connected, nothing importing, still empty
 * @param {{ activityCount: number, connections: Array|null, activitiesLoaded?: boolean }} input
 */
export function emptyFeedState({ activityCount, connections, activitiesLoaded = true }) {
  if (!activitiesLoaded || activityCount > 0 || !Array.isArray(connections)) return 'hidden'
  const connected = connections.filter(isConnected)
  if (connected.length === 0) return 'connect'
  if (connected.some((c) => backfillProgressText(c) || (c.status !== 'error' && !c.last_synced_at))) return 'importing'
  return 'connected'
}
