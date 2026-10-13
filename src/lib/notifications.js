// In-app notifications (issue #49): new follower, follow request, request approved.
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
    default:
      return 'New notification'
  }
}

export function countUnread(notifications) {
  return (notifications || []).filter((n) => !n.read_at).length
}

export async function fetchNotifications(client, userId, limit = NOTIFICATION_PAGE_SIZE) {
  if (!userId) return { notifications: [], error: null }
  const { data, error } = await client
    .from('notifications')
    .select('id, type, actor_id, created_at, read_at')
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
