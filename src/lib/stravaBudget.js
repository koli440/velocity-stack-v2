// src/lib/stravaBudget.js
// Pure math for the app-wide Strava API budget (the limits are shared by every athlete of the app).
// Defaults match the app's current limits: read 200 / 15 min and 2,000 / day, overall 400 / 15 min and 4,000 / day.
// Backfill may only use part of each window; the rest is reserved for live (webhook / new-ride) syncs.

export const WINDOW_15M_MS = 15 * 60 * 1000
export const BACKFILL_SHARE_15M = 0.6
export const BACKFILL_SHARE_DAY = 0.7
export const LIVE_MARGIN = 3

export const DEFAULT_LIMITS = { read15m: 200, readDay: 2000, overall15m: 400, overallDay: 4000 }

/** Start of the 15-minute window containing `now` (windows reset at :00/:15/:30/:45 UTC). */
export function window15Start(now = new Date()) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  return new Date(Math.floor(t / WINDOW_15M_MS) * WINDOW_15M_MS)
}

/** UTC calendar day (YYYY-MM-DD) containing `now` (the daily limit resets at midnight UTC). */
export function dayStart(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10)
}

/** Next reset of the 15-minute window / the daily limit, for logs and messages. */
export function nextWindowReset(now = new Date()) {
  return new Date(window15Start(now).getTime() + WINDOW_15M_MS)
}

const int = (v, fallback = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.floor(Number(v))) : fallback)

/**
 * strava_rate_budget row (or null) -> normalised budget for `now`: usage counters of a window that
 * already rolled over are zero. Missing rows/limits fall back to the app defaults.
 */
export function normalizeBudget(row, now = new Date()) {
  const same15 = row?.window_15m_start && new Date(row.window_15m_start).getTime() === window15Start(now).getTime()
  const sameDay = row?.window_day && String(row.window_day).slice(0, 10) === dayStart(now)
  return {
    read15m: same15 ? int(row.read_15m_usage) : 0,
    readDay: sameDay ? int(row.read_day_usage) : 0,
    overall15m: same15 ? int(row.overall_15m_usage) : 0,
    overallDay: sameDay ? int(row.overall_day_usage) : 0,
    limits: {
      read15m: int(row?.read_15m_limit, DEFAULT_LIMITS.read15m) || DEFAULT_LIMITS.read15m,
      readDay: int(row?.read_day_limit, DEFAULT_LIMITS.readDay) || DEFAULT_LIMITS.readDay,
      overall15m: int(row?.overall_15m_limit, DEFAULT_LIMITS.overall15m) || DEFAULT_LIMITS.overall15m,
      overallDay: int(row?.overall_day_limit, DEFAULT_LIMITS.overallDay) || DEFAULT_LIMITS.overallDay,
    },
  }
}

/** "100,1000" -> [100, 1000]; null when missing or malformed. */
function pair(v) {
  if (v == null || v === '') return null
  const p = String(v).split(',').map((x) => Number(x.trim()))
  return p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0) ? p : null
}

/**
 * Response headers -> { read?: {limit:[15m,day], usage:[15m,day]}, overall?: {...} }.
 * X-ReadRateLimit-* covers read requests, X-RateLimit-* the overall budget. null when neither is present.
 */
export function parseBudgetHeaders(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k] ?? headers?.[k.toLowerCase()])
  const out = {}
  const readLimit = pair(get('X-ReadRateLimit-Limit'))
  const readUsage = pair(get('X-ReadRateLimit-Usage'))
  if (readLimit && readUsage) out.read = { limit: readLimit, usage: readUsage }
  const limit = pair(get('X-RateLimit-Limit'))
  const usage = pair(get('X-RateLimit-Usage'))
  if (limit && usage) out.overall = { limit, usage }
  return out.read || out.overall ? out : null
}

/** Fold an observed header set into a budget (usage only grows inside a window). Returns a new budget. */
export function applyObservation(budget, observed) {
  if (!observed) return budget
  const next = { ...budget, limits: { ...budget.limits } }
  if (observed.read) {
    next.read15m = Math.max(next.read15m, observed.read.usage[0])
    next.readDay = Math.max(next.readDay, observed.read.usage[1])
    if (observed.read.limit[0] > 0) next.limits.read15m = observed.read.limit[0]
    if (observed.read.limit[1] > 0) next.limits.readDay = observed.read.limit[1]
  }
  if (observed.overall) {
    next.overall15m = Math.max(next.overall15m, observed.overall.usage[0])
    next.overallDay = Math.max(next.overallDay, observed.overall.usage[1])
    if (observed.overall.limit[0] > 0) next.limits.overall15m = observed.overall.limit[0]
    if (observed.overall.limit[1] > 0) next.limits.overallDay = observed.overall.limit[1]
  }
  return next
}

/** Count `n` requests we are about to make (they are read requests and also count towards the overall budget). */
export function spend(budget, n = 1) {
  return {
    ...budget,
    read15m: budget.read15m + n,
    readDay: budget.readDay + n,
    overall15m: budget.overall15m + n,
    overallDay: budget.overallDay + n,
  }
}

/** Requests still allowed for a purpose: 'live' may use the whole window (minus a small margin), 'backfill' only its share. */
export function remainingRequests(budget, purpose = 'live') {
  const { limits } = budget
  const backfill = purpose === 'backfill'
  const cap = (limit, share, margin = LIVE_MARGIN) => (backfill ? Math.floor(limit * share) : Math.max(0, limit - margin))
  return Math.max(
    0,
    Math.min(
      cap(limits.read15m, BACKFILL_SHARE_15M) - budget.read15m,
      cap(limits.readDay, BACKFILL_SHARE_DAY) - budget.readDay,
      cap(limits.overall15m, BACKFILL_SHARE_15M) - budget.overall15m,
      cap(limits.overallDay, BACKFILL_SHARE_DAY) - budget.overallDay
    )
  )
}

export const canSpend = (budget, purpose = 'live', n = 1) => remainingRequests(budget, purpose) >= n

/** Arguments for the record_strava_rate_usage RPC. */
export function budgetToRpcArgs(budget) {
  return {
    p_read_15m_usage: budget.read15m,
    p_read_day_usage: budget.readDay,
    p_overall_15m_usage: budget.overall15m,
    p_overall_day_usage: budget.overallDay,
    p_read_15m_limit: budget.limits.read15m,
    p_read_day_limit: budget.limits.readDay,
    p_overall_15m_limit: budget.limits.overall15m,
    p_overall_day_limit: budget.limits.overallDay,
  }
}
