// Coach <-> rider chat (/chat). Mirrors supabase/migrations/20270154000000_coach_chat.sql; the database is authoritative.
export const MAX_MESSAGE_LENGTH = 4000
export const EDIT_WINDOW_MS = 10 * 60 * 1000

export function chatErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'Chat is not available for this coach yet.'
  if (/read-only/i.test(msg)) return 'This conversation is read-only.'
  if (/too many messages/i.test(msg)) return 'You are sending messages too fast. Try again later.'
  if (/too many reports/i.test(msg)) return 'Too many reports today.'
  if (/too long/i.test(msg)) return `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`
  if (/empty/i.test(msg)) return 'Write a message first.'
  if (/invalid link/i.test(msg)) return 'That item cannot be shared here.'
  if (/10 minutes/i.test(msg)) return 'Messages can only be edited for 10 minutes.'
  if (/not authenticated/i.test(msg)) return 'Please sign in again.'
  if (/not found/i.test(msg)) return 'Message or conversation not found.'
  return msg || 'Something went wrong.'
}

export const canEditMessage = (m, userId, now = Date.now()) =>
  !!m && !m.deleted && m.sender_id === userId && now - new Date(m.created_at).getTime() <= EDIT_WINDOW_MS

// A chat reference is a mention card only: exactly these two params are sent and nothing links or completes a workout.
export const referenceParams = (ref) => ({ activityId: ref?.type === 'activity' ? ref.id : null, workoutId: ref?.type === 'workout' ? ref.id : null })

export const chatPath = (relationshipId) => `/chat/${relationshipId}`

// Every /chat row (pending included) opens its own relationship thread, never a profile page.
export const threadHref = (t) => chatPath(t.id)

export const totalUnread = (threads) => (threads || []).reduce((n, t) => n + (Number(t.unread) || 0), 0)

// Oldest first for display (the RPC returns newest first), merged by id so refetched pages never duplicate.
export function mergeMessages(...lists) {
  const byId = new Map()
  for (const l of lists) for (const m of l || []) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

export async function fetchThreads(client) {
  const { data, error } = await client.rpc('chat_threads_summary')
  return { threads: error ? [] : data || [], error }
}
export async function fetchMessages(client, thread, before = null) {
  const { data, error } = await client.rpc('chat_messages_list', { p_thread: thread, p_before: before, p_limit: 50 })
  return { thread: data || null, error }
}
export async function fetchReferenceCandidates(client, thread) {
  const { data, error } = await client.rpc('chat_reference_candidates', { p_thread: thread })
  return { activities: data?.activities || [], workouts: data?.workouts || [], error }
}
export async function sendMessage(client, thread, body, { activityId = null, workoutId = null } = {}) {
  const { data, error } = await client.rpc('send_chat_message', { p_thread: thread, p_body: body, p_activity: activityId, p_workout: workoutId })
  return { id: data, error }
}
export const editMessage = async (client, id, body) => ({ error: (await client.rpc('edit_chat_message', { p_id: id, p_body: body })).error })
export const deleteMessage = async (client, id) => ({ error: (await client.rpc('delete_chat_message', { p_id: id })).error })
export const markRead = async (client, thread) => ({ error: (await client.rpc('mark_chat_read', { p_thread: thread })).error })
export const reportMessage = async (client, id, reason) => ({ error: (await client.rpc('report_chat_message', { p_id: id, p_reason: reason })).error })
export async function fetchChatReports(client) {
  const { data, error } = await client.rpc('admin_chat_reports')
  return { rows: error ? [] : data || [], error }
}
export const resolveChatReport = async (client, id, actionTaken) => ({ error: (await client.rpc('admin_resolve_chat_report', { p_id: id, p_action_taken: actionTaken })).error })
