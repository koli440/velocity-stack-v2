// Blog posts as timeline items in the rider's own activity feed.
// Pure merge logic: cards are placed by their publish date among the loaded activities and never touch the
// activity list itself (counts, pagination, filters stay exactly as they were).

// A post counts as published at midday UTC of its date, so it sits among that day's activities rather than at an edge.
export const cardTime = (card) => Date.parse(`${card.date}T12:00:00Z`)

const activityTime = (act) => {
  const t = Date.parse(act?.activity_date || act?.created_at || '')
  return Number.isFinite(t) ? t : null
}

/**
 * @param {object[]} activities loaded so far, newest first (as fetched)
 * @param {{ date: string }[]} cards published-post cards
 * @param {{ hasMore?: boolean, now?: Date }} opts
 * @returns {({ kind: 'activity', activity: object } | { kind: 'blog', card: object })[]}
 *   Cards newer than the oldest loaded activity are interleaved; older ones wait until the feed reaches that far
 *   (or until there is nothing more to load), so infinite scroll keeps them in chronological position.
 */
export function mergeBlogCards(activities, cards, { hasMore = false, now = new Date() } = {}) {
  const nowMs = new Date(now).getTime()
  const pending = (Array.isArray(cards) ? cards : [])
    .filter((c) => c && Number.isFinite(cardTime(c)) && cardTime(c) <= nowMs)
    .sort((a, b) => cardTime(b) - cardTime(a) || (a.slug < b.slug ? 1 : -1))
  const acts = Array.isArray(activities) ? activities : []

  const times = acts.map(activityTime).filter((t) => t !== null)
  const oldest = times.length ? Math.min(...times) : null
  // While more pages exist, only cards at least as new as the oldest loaded activity are in range.
  const inRange = (c) => !hasMore || oldest === null || cardTime(c) >= oldest
  const queue = pending.filter(inRange)

  const out = []
  for (const act of acts) {
    const t = activityTime(act)
    while (queue.length && t !== null && cardTime(queue[0]) > t) out.push({ kind: 'blog', card: queue.shift() })
    out.push({ kind: 'activity', activity: act })
  }
  for (const card of queue) out.push({ kind: 'blog', card })
  return out
}
