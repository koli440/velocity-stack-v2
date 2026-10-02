// Baseline ("history") durational curves (issue #28).
//
// For every durational curve type (Power, Speed, Cadence, Torque, HeartRate) we want a
// "best curve so far" for a given comparison period: last 30 days, last 90 days, this
// calendar year, the last floating/rolling year (365 days), or a custom date range picked
// by the user. Each point on the resulting curve records which activity produced that
// best value, so the UI can link back to it.
//
// This module is the pure, testable core of that computation. It is intentionally
// framework/DB agnostic: callers (API routes, RPC wrappers, etc.) are responsible for
// fetching the candidate activities + their curve data and handing them to
// `computeBaselineCurves`.

export const BASELINE_PERIODS = Object.freeze({
  LAST_30_DAYS: '30d',
  LAST_90_DAYS: '90d',
  CALENDAR_YEAR: 'calendar_year',
  ROLLING_YEAR: 'rolling_year',
  CUSTOM: 'custom',
})

export const BASELINE_PERIOD_LABELS = Object.freeze({
  [BASELINE_PERIODS.LAST_30_DAYS]: 'Last 30 Days',
  [BASELINE_PERIODS.LAST_90_DAYS]: 'Last 90 Days',
  [BASELINE_PERIODS.CALENDAR_YEAR]: 'This Year',
  [BASELINE_PERIODS.ROLLING_YEAR]: 'Last 365 Days',
  [BASELINE_PERIODS.CUSTOM]: 'Custom Period',
})

function addDays(date, days) {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Resolves the inclusive [start, end] date range for a baseline period.
 */
export function resolvePeriodRange(period, { now, customStart, customEnd } = {}) {
  const end = toDate(now) || new Date()

  switch (period) {
    case BASELINE_PERIODS.LAST_30_DAYS:
      return { start: addDays(end, -30), end }
    case BASELINE_PERIODS.LAST_90_DAYS:
      return { start: addDays(end, -90), end }
    case BASELINE_PERIODS.ROLLING_YEAR:
      return { start: addDays(end, -365), end }
    case BASELINE_PERIODS.CALENDAR_YEAR:
      return { start: new Date(Date.UTC(end.getUTCFullYear(), 0, 1)), end }
    case BASELINE_PERIODS.CUSTOM: {
      const start = toDate(customStart)
      const customEndDate = toDate(customEnd) || end
      if (!start) {
        throw new Error('Custom baseline period requires a valid customStart date')
      }
      if (!customEnd) {
        throw new Error('Custom baseline period requires a valid customEnd date')
      }
      return { start, end: customEndDate }
    }
    default:
      throw new Error(`Unknown baseline period: ${period}`)
  }
}

/**
 * Computes the best-ever ("baseline") durational curves across a set of activities,
 * scoped to a given period. Duration buckets are only populated when at least one
 * activity in range actually reported them (an activity's own duration determines
 * which buckets it can contribute to, not a fixed maximum).
 *
 * @param {Array<{id: string, title?: string, activity_date: string|Date, curves: Record<string, Record<string, number>>}>} activities
 * @param {object} options
 * @param {string} options.period - one of BASELINE_PERIODS
 * @param {Date|string} [options.now] - reference "now" for relative periods (defaults to current time)
 * @param {Date|string} [options.customStart] - required when period === 'custom'
 * @param {Date|string} [options.customEnd] - required when period === 'custom'
 * @returns {{ period: string, start: string, end: string, curves: Record<string, Record<string, { value: number, activityId: string, activityTitle: string|null, activityDate: string }>> }}
 */
export function computeBaselineCurves(activities, { period, now, customStart, customEnd } = {}) {
  const { start, end } = resolvePeriodRange(period, { now, customStart, customEnd })
  const curves = {}

  for (const activity of activities || []) {
    if (!activity) continue
    const activityDate = toDate(activity.activity_date)
    if (!activityDate) continue
    if (activityDate < start || activityDate > end) continue

    const activityCurves = activity.curves || {}
    for (const [metric, durations] of Object.entries(activityCurves)) {
      if (!durations) continue
      for (const [durationKey, rawValue] of Object.entries(durations)) {
        if (rawValue === null || rawValue === undefined) continue
        const value = Number(rawValue)
        if (Number.isNaN(value)) continue

        if (!curves[metric]) curves[metric] = {}
        const existing = curves[metric][durationKey]
        if (!existing || value > existing.value) {
          curves[metric][durationKey] = {
            value,
            activityId: activity.id,
            activityTitle: activity.title ?? null,
            activityDate: activityDate.toISOString(),
          }
        }
      }
    }
  }

  return {
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    curves,
  }
}
