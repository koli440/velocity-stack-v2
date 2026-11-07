// Pure helpers for the admin dashboard (/admin). Data comes from the admin-only RPC admin_dashboard_stats()
// (supabase/migrations/20270128000000_admin_dashboard.sql): aggregates only, never user identities.

export const PROVIDER_LABELS = { garmin: 'Garmin', wahoo: 'Wahoo', intervals: 'Intervals.icu', strava: 'Strava', manual: 'Upload', bot: 'Bot' }
export const TYPE_LABELS = { ride: 'Ride', run: 'Run', gym: 'Gym' }

export const providerLabel = (key) => PROVIDER_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1) : 'Unknown')

/** [{day, count}] -> sum of counts. */
export function sumSeries(series) {
  return (series || []).reduce((n, p) => n + (Number(p?.count) || 0), 0)
}

/** Largest count in a series (at least 1, so bars never divide by zero). */
export function maxCount(series) {
  return Math.max(1, ...(series || []).map((p) => Number(p?.count) || 0))
}

/** Whole-number percentage, 0 when the total is 0. */
export function pct(part, total) {
  const t = Number(total) || 0
  return t > 0 ? Math.round(((Number(part) || 0) / t) * 100) : 0
}

/** Compares the second half of a series with the first: { current, previous, delta, direction }. */
export function trend(series) {
  const list = series || []
  const mid = Math.floor(list.length / 2)
  const previous = sumSeries(list.slice(0, mid))
  const current = sumSeries(list.slice(mid))
  const delta = current - previous
  return { current, previous, delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' }
}

/** Health of one provider row: error > stale > idle (nobody connected) > ok. */
export function providerHealth(row) {
  if (!row || !(Number(row.connected) > 0)) return 'idle'
  if (Number(row.errors) > 0) return 'error'
  if (Number(row.stale) > 0) return 'warn'
  return 'ok'
}

/** Orders providers for display: Garmin, Wahoo, Intervals.icu, Strava first, any others alphabetically. */
export function orderProviders(rows) {
  const order = ['garmin', 'wahoo', 'intervals', 'strava']
  const rank = (p) => { const i = order.indexOf(p); return i === -1 ? order.length : i }
  return [...(rows || [])].sort((a, b) => rank(a.provider) - rank(b.provider) || String(a.provider).localeCompare(String(b.provider)))
}

/** Adds providers that have no connections yet (so the panel always lists the four integrations). */
export function withAllProviders(rows) {
  const have = new Set((rows || []).map((r) => r.provider))
  const empty = (provider) => ({ provider, connected: 0, active: 0, errors: 0, disconnected: 0, stale: 0, last_synced_at: null, imported_24h: 0, imported_7d: 0 })
  return orderProviders([...(rows || []), ...['garmin', 'wahoo', 'intervals', 'strava'].filter((p) => !have.has(p)).map(empty)])
}

/** Short UTC date label for a chart day (YYYY-MM-DD -> D/M). */
export function dayLabel(day) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(day || ''))
  return m ? `${Number(m[2])}/${Number(m[1])}` : ''
}

/** Failure share of the uploads that reached a final status (imported + duplicate + failed), in whole percent. */
export function failureRate(app) {
  const done = (Number(app?.imported) || 0) + (Number(app?.duplicate) || 0) + (Number(app?.failed) || 0)
  return pct(app?.failed, done)
}

/** Health of a partner app row: suspended/pending > high failure rate or reuse revocations > ok. */
export function partnerAppHealth(app) {
  if (!app || app.status !== 'approved') return app?.status || 'pending'
  if (Number(app.reuse_revocations) > 0 || (Number(app.failed) >= 3 && failureRate(app) >= 20)) return 'warn'
  return 'ok'
}

/** Average with one decimal (e.g. reactions per reacted activity); 0 when the divisor is 0. */
export function average(total, count) {
  const c = Number(count) || 0
  return c > 0 ? Math.round(((Number(total) || 0) / c) * 10) / 10 : 0
}

/** Respect panel figures derived from admin_respect_stats(): shares of active users and per-activity average. */
export function respectSummary(stats) {
  const s = stats || {}
  return {
    perActivity: average(s.total, s.activities),
    gavePct: pct(s.active_gave, s.active_users),
    receivedPct: pct(s.active_received, s.active_users),
    publicPct: pct(s.by_visibility?.public, (Number(s.by_visibility?.public) || 0) + (Number(s.by_visibility?.non_public) || 0)),
    notifiedPct: pct(s.notified_reactions, s.total),
  }
}
