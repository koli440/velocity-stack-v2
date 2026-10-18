// Activity comments (issues #222-#224): data access and pure text helpers for the UI.
// All access control lives in the database (RLS + SECURITY DEFINER RPCs, see
// 20261204000000_activity_comments.sql); these helpers only shape queries and text.

import { fetchProfilesByIds } from './social.js'

export const COMMENT_MAX_LENGTH = 2000
export const COMMENT_PAGE_LIMIT = 500
export const MENTION_QUERY_MAX = 40

export function commentLength(body) {
  return String(body ?? '').trim().length
}

export function isValidCommentBody(body) {
  const n = commentLength(body)
  return n >= 1 && n <= COMMENT_MAX_LENGTH
}

// Raw database errors are replaced by messages a rider can act on.
export function commentErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/report limit/i.test(msg)) return 'You have reported too many comments. Please try again later.'
  if (/limit reached/i.test(msg)) return 'You are commenting too fast. Please try again in a while.'
  if (/turned off/i.test(msg)) return 'Comments are turned off for this activity.'
  if (/not found/i.test(msg)) return 'This activity or comment is no longer available.'
  if (/own comment/i.test(msg)) return 'You cannot report your own comment.'
  if (/1-2000/.test(msg)) return `A comment must be 1-${COMMENT_MAX_LENGTH} characters.`
  return 'Something went wrong. Please try again.'
}

export function commentCountLabel(n) {
  return n === 1 ? '1 comment' : `${n || 0} comments`
}

export function relativeTime(iso, now = Date.now()) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString()
}

// ---- @mentions ----------------------------------------------------------------------------

const HANDLE_CHAR = /[A-Za-z0-9_.-]/

// The @handle being typed at the caret ("hi @jo|"), or null. The "@" must start a word,
// mirroring the server-side parser.
export function activeMentionQuery(text, caret) {
  const value = String(text ?? '')
  const pos = Math.min(Math.max(caret ?? value.length, 0), value.length)
  let i = pos
  while (i > 0 && HANDLE_CHAR.test(value[i - 1])) i -= 1
  if (i === 0 || value[i - 1] !== '@') return null
  const start = i - 1
  if (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) return null
  const query = value.slice(i, pos)
  if (query.length > MENTION_QUERY_MAX) return null
  return { start, query }
}

// Replaces the "@query" typed at `start`..`caret` with "@nickname " and returns the new
// text and caret position.
export function applyMention(text, mention, caret, nickname) {
  const value = String(text ?? '')
  const end = Math.min(Math.max(caret ?? value.length, 0), value.length)
  const insert = `@${nickname} `
  return {
    text: value.slice(0, mention.start) + insert + value.slice(end),
    caret: mention.start + insert.length,
  }
}

// Splits a comment into plain text and mention segments. `mentions` maps lower-case
// nickname -> user id; only handles that were actually notified become links, everything
// else stays plain text. The result is rendered as React text, never as HTML.
export function splitCommentBody(body, mentions) {
  const text = String(body ?? '')
  const parts = []
  const re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_.-]{1,40})/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    const raw = m[2]
    const handle = raw.replace(/[.-]+$/, '')
    const userId = mentions?.get?.(handle.toLowerCase())
    if (!userId) continue
    const start = m.index + m[1].length
    if (start > last) parts.push({ type: 'text', text: text.slice(last, start) })
    parts.push({ type: 'mention', text: `@${handle}`, userId })
    last = start + 1 + handle.length
    re.lastIndex = last
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

// ---- Links --------------------------------------------------------------------------------

// Where a notification about an activity comment leads; the coach stays in the athlete context.
export function activityCommentsHref(activityId, info) {
  if (!activityId) return null
  const base = info?.viewer_is_coach && info.owner_id
    ? `/coach/${info.owner_id}/activities/${activityId}`
    : `/activities/${activityId}`
  return `${base}#comments`
}

// ---- Data access --------------------------------------------------------------------------

// activity id -> { owner_id, comments_enabled, comment_count, coach_id, viewer_is_coach }.
// Activities the viewer cannot see are absent.
export async function fetchCommentInfo(client, activityIds) {
  const ids = [...new Set((activityIds || []).filter(Boolean))].slice(0, 100)
  if (!ids.length) return { info: new Map(), error: null }
  const { data, error } = await client.rpc('activity_comment_info', { p_ids: ids })
  if (error) return { info: new Map(), error }
  return { info: new Map((data || []).map((r) => [r.activity_id, r])), error: null }
}

export async function fetchActivityComments(client, activityId) {
  const empty = { comments: [], profiles: new Map(), mentions: new Map(), error: null }
  if (!activityId) return empty
  const { data, error } = await client
    .from('activity_comments')
    .select('id, activity_id, user_id, body, reply_to, created_at, edited_at')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true })
    .limit(COMMENT_PAGE_LIMIT)
  if (error) return { ...empty, error }
  const comments = data || []
  if (!comments.length) return empty

  const { data: mentionRows } = await client
    .from('activity_comment_mentions')
    .select('comment_id, user_id')
    .in('comment_id', comments.map((c) => c.id))
  const mentionIds = [...new Set((mentionRows || []).map((r) => r.user_id))]
  const { profiles } = await fetchProfilesByIds(client, [...comments.map((c) => c.user_id), ...mentionIds])

  // comment id -> (lower-case nickname -> user id), used to render mention links
  const mentions = new Map()
  for (const row of mentionRows || []) {
    const nick = profiles.get(row.user_id)?.nickname
    if (!nick) continue
    if (!mentions.has(row.comment_id)) mentions.set(row.comment_id, new Map())
    mentions.get(row.comment_id).set(nick.toLowerCase(), row.user_id)
  }
  return { comments, profiles, mentions, error: null }
}

export async function addActivityComment(client, { activityId, body, replyTo = null }) {
  const { data, error } = await client.rpc('add_activity_comment', {
    p_activity: activityId,
    p_body: String(body ?? '').trim(),
    p_reply_to: replyTo,
  })
  return { id: data || null, error: error || null }
}

export async function editActivityComment(client, { commentId, body }) {
  const { error } = await client.rpc('edit_activity_comment', {
    p_comment: commentId,
    p_body: String(body ?? '').trim(),
  })
  return { error: error || null }
}

export async function deleteActivityComment(client, { commentId }) {
  const { error } = await client.rpc('delete_activity_comment', { p_comment: commentId })
  return { error: error || null }
}

export async function searchMentionCandidates(client, { activityId, query }) {
  const { data, error } = await client.rpc('activity_mention_candidates', {
    p_activity: activityId,
    p_query: query,
  })
  if (error) return { candidates: [], error }
  return { candidates: data || [], error: null }
}

// Owner switch: new comments are refused, existing ones stay readable. RLS limits the
// update to the owner's own activity.
export async function setCommentsEnabled(client, { activityId, enabled }) {
  const { data, error } = await client
    .from('activities')
    .update({ comments_enabled: !!enabled })
    .eq('id', activityId)
    .select('id')
  if (error) return { error }
  return { error: data?.length ? null : new Error('Activity not found') }
}

export async function reportActivityComment(client, { commentId, reason }) {
  const { error } = await client.rpc('report_activity_comment', {
    p_comment: commentId,
    p_reason: String(reason ?? '').trim().slice(0, 500) || null,
  })
  return { error: error || null }
}

export async function fetchCommentReports(client) {
  const { data, error } = await client.rpc('admin_list_comment_reports')
  return { reports: error ? [] : data || [], error: error || null }
}

export async function resolveCommentReport(client, { reportId, remove }) {
  const { error } = await client.rpc('admin_resolve_comment_report', {
    p_report: reportId,
    p_remove: !!remove,
  })
  return { error: error || null }

// ---- Realtime + unread --------------------------------------------------------------------

// Marks the thread as read now (fire and forget; failures only leave the dot visible).
export async function markCommentsRead(client, activityId) {
  if (!activityId) return { error: null }
  const { error } = await client.rpc('mark_activity_comments_read', { p_activity: activityId })
  return { error: error || null }
}

// activity id -> unread comment count (only activities with unread comments are present).
export async function fetchUnreadCounts(client, activityIds) {
  const ids = [...new Set((activityIds || []).filter(Boolean))].slice(0, 100)
  if (!ids.length) return { counts: new Map(), error: null }
  const { data, error } = await client.rpc('activity_comment_unread', { p_ids: ids })
  if (error) return { counts: new Map(), error }
  return { counts: new Map((data || []).map((r) => [r.activity_id, r.unread_count])), error: null }
}

// rider id -> unread comments across the athlete's activities, for the coach dashboard.
export async function fetchCoachUnreadComments(client) {
  const { data, error } = await client.rpc('coach_unread_comments')
  if (error) return { counts: new Map(), error }
  return { counts: new Map((data || []).map((r) => [r.rider_id, r.unread_count])), error: null }
}

// Live changes of one activity's comments. Any event triggers onChange (callers reload, which
// de-duplicates against optimistic posts). Returns an unsubscribe function.
export function subscribeActivityComments(client, activityId, onChange) {
  if (!activityId || !client.channel) return () => {}
  const channel = client
    .channel(`activity-comments-${activityId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'activity_comments', filter: `activity_id=eq.${activityId}` },
      onChange
    )
    .subscribe()
  return () => {
    client.removeChannel(channel)
  }
}
