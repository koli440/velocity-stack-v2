// Pure helpers for the admin dashboard (/admin). Data comes from the admin-only RPC admin_dashboard_stats()
// (supabase/migrations/20270128000000_admin_dashboard.sql): aggregates only, never user identities.

import { RESPECT_LEVELS } from './respectLevel.js'

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

/** Buckets admin_respect_histogram() rows ({count, activities}) into tiers: exclusive (highest tier reached) and cumulative (at least). */
export function respectTiers(histogram, levels = RESPECT_LEVELS) {
  const rows = levels.map((l) => ({ ...l, exact: 0, atLeast: 0 }))
  for (const h of Array.isArray(histogram) ? histogram : []) {
    const n = Number(h?.count)
    const c = Number(h?.activities) || 0
    if (!(n >= 1) || c <= 0) continue
    rows.forEach((r) => { if (n >= r.min) r.atLeast += c })
    let top = -1
    rows.forEach((r, i) => { if (n >= r.min) top = i })
    if (top >= 0) rows[top].exact += c
  }
  return rows
}

export const FALLBACK_LABELS = { 'no-records': 'No records at this distance', 'no-lap-data': 'Records without usable lap data' }
export const fallbackLabel = (reason) => FALLBACK_LABELS[reason] || String(reason || 'Unknown')

/** Discipline + distance label, e.g. "Individual Pursuit · 4000 m". */
export function disciplineLabel(row) {
  const d = String(row?.discipline || 'Unknown')
  return Number(row?.distance_m) > 0 ? `${d} · ${row.distance_m} m` : d
}

/** PB Vault panel figures from admin_pb_vault_stats(): shares of all users, laps and records per rider. */
export function pbVaultSummary(stats) {
  const s = stats || {}
  const dist = s.distribution || {}
  const riders = Number(s.riders) || 0
  return {
    ridersPct: pct(riders, s.users_total),
    lapsPct: pct(s.with_laps, s.records),
    usableLapsPct: pct(s.with_usable_laps, s.records),
    pacingPct: pct(s.pacing_eligible_riders, riders),
    perRider: average(s.records, riders),
    distribution: [
      { key: 'one', label: '1 record', count: Number(dist.one) || 0 },
      { key: 'two_to_five', label: '2-5 records', count: Number(dist.two_to_five) || 0 },
      { key: 'six_plus', label: '6+ records', count: Number(dist.six_plus) || 0 },
    ],
  }
}

/** Weekly tool-usage rows -> a {day, count} series of one field (feeds the Bars helpers). */
export function weekSeries(weeks, ...fields) {
  return (weeks || []).map((w) => ({ day: w.week, count: fields.reduce((n, f) => n + (Number(w?.[f]) || 0), 0) }))
}

/** Sum of the `count` of event rows matching an event name (optionally only signed-in or public). */
export function eventCount(rows, event, loggedIn) {
  return (rows || []).reduce((n, r) => (r.event === event && (loggedIn === undefined || r.logged_in === loggedIn) ? n + (Number(r.count) || 0) : n), 0)
}

/** Tool-usage panel figures from admin_tool_usage_stats(). Counts are events, never visitors. */
export function toolUsageSummary(stats) {
  const s = stats || {}
  return {
    gearTotal: sumSeries(weekSeries(s.weeks, 'gear_public', 'gear_logged_in')),
    pursuitTotal: sumSeries(weekSeries(s.weeks, 'pursuit_public', 'pursuit_logged_in')),
    myPacingPct: pct(s.pursuit_plans_my_pacing, s.pursuit_plans_logged_in),
    fallbackTotal: sumSeries(s.pacing_fallbacks),
  }
}
