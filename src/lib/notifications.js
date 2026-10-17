// In-app notifications (issue #49): new follower, follow request, request approved, coaching.
// Rows are written by database triggers (see 20261014000000_blocks_requests_notifications.sql).

import { fetchProfilesByIds, authorName } from './social.js'

export const NOTIFICATION_PAGE_SIZE = 20

export function describeNotification(notification, actor) {
  const name = actor ? authorName(actor) : 'A rider'
  switch (notification?.type) {
    case 'new_follower':
      return `${name} started following you`
    case 'follow_request':
      return `${name} wants to follow you`
    case 'follow_approved':
      return `${name} approved your follow request`
    case 'coach_invite':
      return `${name} invited you to be their athlete`
    case 'coach_request':
      return `${name} asked you to be their coach`
    case 'coach_accepted':
      return `${name} accepted — coaching is now active`
    case 'coach_ended':
      return `${name} ended the coaching relationship`
    case 'coach_replaced':
      return `${name} chose a different coach — you no longer have access to their data`
    case 'suggestion_submitted':
      return `${name} submitted a suggestion for review`
    case 'suggestion_approved':
      return 'Your suggestion was approved'
    case 'suggestion_rejected':
      return 'Your suggestion was declined'
    default:
      return 'New notification'
  }
}

// Notifications that need an answer in Settings (accept / decline a coaching request).
export function notificationHref(notification) {
  return notification?.type === 'coach_invite' || notification?.type === 'coach_request'
    ? '/settings#coaching'
    : null
}

export function countUnread(notifications) {
  return (notifications || []).filter((n) => !n.read_at).length
}

export async function fetchNotifications(client, userId, limit = NOTIFICATION_PAGE_SIZE) {
  if (!userId) return { notifications: [], error: null }
  const { data, error } = await client
    .from('notifications')
    .select('id, type, actor_id, suggestion_id, created_at, read_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { notifications: [], error }
  const rows = data || []
  const { profiles } = await fetchProfilesByIds(client, rows.map((n) => n.actor_id))
  return {
    notifications: rows.map((n) => ({ ...n, actor: profiles.get(n.actor_id) || null })),
    error: null,
  }
}

export async function markAllNotificationsRead(client, userId) {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
  return { error: error || null }
}
