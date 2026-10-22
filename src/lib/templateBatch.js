// Client helpers for running a template on several activities at once (issue #293).
// The server (/api/templates/run-batch) does the evaluation; this module keeps the list, searches
// activities by name, sends them in small chunks and summarises the outcome.

export const MAX_BATCH_ACTIVITIES = 50
export const CHUNK_SIZE = 5
export const SEARCH_LIMIT = 10
const MAX_DEFERRALS = 3

export const STATUS_LABELS = Object.freeze({ ok: 'Done', no_match: 'No matching efforts', skipped: 'Skipped', failed: 'Failed' })

/** Adds an activity to the list (no duplicates, capped). */
export function addActivity(list, activity, max = MAX_BATCH_ACTIVITIES) {
  if (!activity?.id) return { list, error: null }
  if (list.some((a) => a.id === activity.id)) return { list, error: 'Already in the list' }
  if (list.length >= max) return { list, error: `At most ${max} activities per batch` }
  return { list: [...list, { id: activity.id, title: activity.title || 'Untitled activity', activity_date: activity.activity_date || null }], error: null }
}

export const removeActivity = (list, id) => list.filter((a) => a.id !== id)

/** Escapes LIKE wildcards so a name search is a plain substring match. */
export function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Searches activities by name. Own account: filtered by the owner explicitly. Athlete context: the masked
 * shared_activities view (a coach cannot read raw activities).
 */
export async function searchActivities(client, { ownerId, shared = false, query, limit = SEARCH_LIMIT }) {
  const q = String(query || '').trim()
  if (!ownerId || !q) return { data: [], error: null }
  const { data, error } = await client
    .from(shared ? 'shared_activities' : 'activities')
    .select('id, title, activity_date')
    .eq('user_id', ownerId)
    .ilike('title', `%${escapeLike(q)}%`)
    .order('activity_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  return { data: data || [], error: error || null }
}

export const chunk = (items, size = CHUNK_SIZE) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Runs `ids` through `post(ids) -> items[]` in chunks. Deferred ids (server time budget reached) are retried;
 * a failing request marks only its chunk as failed. `onProgress({done, total, items})` after each request.
 */
export async function runInChunks(ids, post, { onProgress, size = CHUNK_SIZE, shouldStop = () => false } = {}) {
  const total = ids.length
  const items = []
  let queue = chunk(ids, size)
  let deferrals = 0
  while (queue.length) {
    if (shouldStop()) break
    const group = queue.shift()
    let got
    try {
      got = await post(group)
    } catch (err) {
      got = group.map((id) => ({ activity_id: id, status: 'failed', reason: err?.message || 'Request failed' }))
    }
    const byId = new Map((got || []).map((i) => [i.activity_id, i]))
    const deferred = []
    for (const id of group) {
      const item = byId.get(id) || { activity_id: id, status: 'failed', reason: 'No result returned' }
      if (item.status === 'deferred') deferred.push(id)
      else items.push(item)
    }
    if (deferred.length) {
      deferrals += 1
      if (deferrals > MAX_DEFERRALS) for (const id of deferred) items.push({ activity_id: id, status: 'failed', reason: 'Server busy, try again' })
      else queue.unshift(deferred)
    }
    onProgress?.({ done: items.length, total, items: [...items] })
  }
  return items
}

/** Counts per status plus how many existing runs were replaced. */
export function summarizeBatch(items) {
  const counts = { ok: 0, no_match: 0, skipped: 0, failed: 0, replaced: 0 }
  for (const i of items || []) {
    if (counts[i.status] != null) counts[i.status] += 1
    if (i.status === 'ok' && i.replaced) counts.replaced += 1
  }
  return counts
}
