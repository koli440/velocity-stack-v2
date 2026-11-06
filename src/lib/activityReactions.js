// Activity reactions ("Respect", a lightweight +1). All access control is in the database
// (20270138000000_activity_reactions.sql); these helpers shape RPC calls and text.

import { fetchProfilesByIds } from './social.js'

export const REACTION_TYPES = Object.freeze({
  respect: { label: 'Respect', icon: 'flame' },
})
export const DEFAULT_REACTION = 'respect'
export const REACTION_ICON = REACTION_TYPES[DEFAULT_REACTION].icon

export function reactionCountLabel(n, type = DEFAULT_REACTION) {
  const label = REACTION_TYPES[type]?.label || 'Respect'
  const count = Math.max(0, Number(n) || 0)
  return `${label}: ${count}`
}

export function reactionButtonLabel(reacted, type = DEFAULT_REACTION) {
  const label = REACTION_TYPES[type]?.label || 'Respect'
  return reacted ? `Remove your ${label.toLowerCase()}` : `Give ${label.toLowerCase()}`
}

export function reactionErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/limit reached/i.test(msg)) return 'You are reacting too fast. Please try again in a while.'
  if (/turned off/i.test(msg)) return 'The rider turned reactions off.'
  if (/own activity/i.test(msg)) return 'You cannot react to your own activity.'
  if (/not found/i.test(msg)) return 'This activity is no longer available.'
  if (/not available/i.test(msg)) return 'Reactions are not available for this account.'
  return 'Something went wrong. Please try again.'
}

// Optimistic state after a tap.
export function toggledState({ count, reacted }) {
  const c = Math.max(0, Number(count) || 0)
  return reacted ? { count: Math.max(0, c - 1), reacted: false } : { count: c + 1, reacted: true }
}

// Names for the owner's "who reacted" line: first `max` names, then "and N others".
export function reactorSummary(names, total, max = 3) {
  const list = (names || []).filter(Boolean)
  const count = Math.max(Number(total) || 0, list.length)
  if (!count) return ''
  const shown = list.slice(0, max)
  if (!shown.length) return count === 1 ? '1 rider' : `${count} riders`
  const rest = count - shown.length
  if (rest <= 0) {
    if (shown.length === 1) return shown[0]
    return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  }
  return `${shown.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`
}

// "ann and 3 others gave you respect" style text for a coalesced notification.
export function reactionNotificationText(name, eventCount) {
  const n = Math.max(1, Number(eventCount) || 1)
  const who = n === 1 ? name : `${name} and ${n - 1} ${n - 1 === 1 ? 'other' : 'others'}`
  return `${who} gave respect to your activity`
}

// activity id -> { owner_id, reaction_count, i_reacted, can_react, is_owner }.
// Activities the viewer cannot see are absent.
export async function fetchReactionInfo(client, activityIds) {
  const ids = [...new Set((activityIds || []).filter(Boolean))].slice(0, 100)
  if (!ids.length) return { info: new Map(), error: null }
  const { data, error } = await client.rpc('activity_reaction_info', { p_ids: ids, p_type: DEFAULT_REACTION })
  if (error) return { info: new Map(), error }
  return { info: new Map((data || []).map((r) => [r.activity_id, r])), error: null }
}

export async function setActivityReaction(client, { activityId, on, type = DEFAULT_REACTION }) {
  const { data, error } = await client.rpc('set_activity_reaction', {
    p_activity: activityId,
    p_on: !!on,
    p_type: type,
  })
  return { count: error ? null : data, error: error || null }
}

// Owner only (the database returns nothing for anybody else). Names come from public_profiles.
export async function fetchReactors(client, activityId, type = DEFAULT_REACTION) {
  if (!activityId) return { reactors: [], error: null }
  const { data, error } = await client.rpc('activity_reactors', { p_activity: activityId, p_type: type })
  if (error) return { reactors: [], error }
  const rows = data || []
  const { profiles } = await fetchProfilesByIds(client, rows.map((r) => r.user_id))
  return {
    reactors: rows.map((r) => ({ ...r, profile: profiles.get(r.user_id) || null })),
    error: null,
  }
}
