// Training load (TL) of calendar days and weeks. Pure.
// Completed load = activityLoad() of fitnessForm.js (stored training_load, else HR estimate, gym model estimate),
// the same source as the Fitness page. Planned load = the "~TL" estimate of the workout (plannedToEvent().load).
// Rules (same as fitnessProjection.js: the past only counts real activities, future days use plans):
//  - a day's completed TL is the sum of its completed activities only; linked planned workouts are never added on top;
//  - past days: planned workouts that were not done (missed / skipped) add 0, only completed counts;
//  - today: completed TL plus the REMAINING planned workouts (not linked, not skipped), kept separate;
//  - future days: remaining planned workouts (a day with a completed activity shows that activity as done);
//  - gym sessions are shown, but when the rider excludes gym from fitness they do not count in totals.
// Completed load is split like the Fitness page (estimateShare / estimatedLoad): `measured` = stored training_load,
// `estimated` = HR estimate + gym model. Totals count both; completed = measured + estimated.
// Completed runs/rides that can't be scored are counted as `unscored` (reason: no HR / too short / no LT2 HR). No pace-based rTSS.
// Week: planned target = ~TL of every non-skipped planned workout (linked ones too, as the target), completed = sum of days.

import { activityLoad, localDayKey } from './fitnessForm.js'
import { resolveLtAt } from './lactateThresholds.js'
import { dayKey } from './calendar.js'

const round = (n) => Math.round(n)

/** { load, estimated, excluded } of a completed activity event, or null when it can't be scored. */
export function completedEventLoad(event, { ltHistory = [], includeGym = true } = {}) {
  if (!event || event.kind === 'planned') return null
  const r = activityLoad(event.loadSource || {}, ltHistory)
  if (!r) return null
  return { load: r.load, estimated: r.estimated, excluded: event.discipline === 'gym' && !includeGym }
}

const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
export const UNSCORED_REASONS = Object.freeze({
  noHr: 'No HR data',
  tooShort: 'Too short to score (under 5 min)',
  noLt2: 'Set LT2 HR in Physiology',
})

/** Why a completed run/ride has no TL: 'noHr' | 'tooShort' | 'noLt2', or null when scored / not applicable (gym, planned). */
export function unscoredReason(event, { ltHistory = [] } = {}) {
  if (!event || event.kind === 'planned' || event.discipline === 'gym') return null
  const src = event.loadSource || {}
  if (activityLoad(src, ltHistory)) return null
  const avgHr = numOrNull(src.avg_hr)
  if (avgHr === null || avgHr < 40 || avgHr > 230) return 'noHr'
  const secs = numOrNull(src.moving_time_s) ?? numOrNull(src.elapsed_time_s) ?? numOrNull(src.duration_sec) ?? 0
  if (!(secs >= 300 && secs <= 86400)) return 'tooShort'
  return 'noLt2'
}

/** Planned ~TL of a planned event: number or null (no estimate). Skipped workouts have no target. */
export function plannedEventLoad(event) {
  if (event?.kind !== 'planned' || event.status === 'skipped') return null
  return Number.isFinite(event.load) && event.load >= 0 ? event.load : null
}

const isRemainingPlanned = (e) => e.kind === 'planned' && !e.activityId && e.status !== 'skipped' && e.status !== 'completed' && e.status !== 'missed'

/**
 * TL of one day. `dayKeyStr` / `todayKey` are "YYYY-MM-DD".
 * @returns { completed, measured, estimated, completedEstimated, excludedGym, unscored, plannedRemaining, plannedRemainingUnknown, mode }
 *  mode: 'completed' (past or only completed activities), 'mixed' (completed + remaining plan), 'planned' (plan only), 'none'
 */
export function dayLoad(events, dayKeyStr, todayKey, opts = {}) {
  let completed = 0
  let estimated = 0
  let completedEstimated = false
  let excludedGym = 0
  let unscored = 0
  let scored = 0
  let plannedRemaining = 0
  let plannedRemainingUnknown = 0
  for (const e of events || []) {
    if (e.kind === 'planned') {
      if (dayKeyStr < todayKey || !isRemainingPlanned(e)) continue
      const l = plannedEventLoad(e)
      if (l === null) plannedRemainingUnknown += 1
      else plannedRemaining += l
      continue
    }
    const l = completedEventLoad(e, opts)
    if (!l) {
      if (unscoredReason(e, opts)) unscored += 1
      continue
    }
    if (l.excluded) {
      excludedGym += l.load
      continue
    }
    completed += l.load
    scored += 1
    if (l.estimated) {
      completedEstimated = true
      estimated += l.load
    }
  }
  const hasPlanned = plannedRemaining > 0
  const mode = scored > 0 ? (hasPlanned ? 'mixed' : 'completed') : hasPlanned ? 'planned' : 'none'
  return {
    completed: round(completed),
    estimated: round(estimated),
    measured: round(completed) - round(estimated),
    completedEstimated,
    excludedGym: round(excludedGym),
    unscored,
    plannedRemaining: round(plannedRemaining),
    plannedRemainingUnknown,
    mode,
  }
}

/**
 * TL of a week from all its events (any day). plannedPartial: a counted planned workout without estimate.
 * @returns { completed (= measured + estimated), measured, estimated, completedEstimated, unscored, planned, plannedPartial, hasPlanned, excludedGym }
 */
export function weekLoad(events, opts = {}) {
  let completed = 0
  let estimated = 0
  let completedEstimated = false
  let excludedGym = 0
  let unscored = 0
  let planned = 0
  let plannedCount = 0
  let plannedPartial = false
  for (const e of events || []) {
    if (e.kind === 'planned') {
      if (e.status === 'skipped') continue
      plannedCount += 1
      const l = plannedEventLoad(e)
      if (l === null) plannedPartial = true
      else planned += l
      continue
    }
    const l = completedEventLoad(e, opts)
    if (!l) {
      if (unscoredReason(e, opts)) unscored += 1
      continue
    }
    if (l.excluded) excludedGym += l.load
    else {
      completed += l.load
      if (l.estimated) {
        completedEstimated = true
        estimated += l.load
      }
    }
  }
  return {
    completed: round(completed),
    estimated: round(estimated),
    measured: round(completed) - round(estimated),
    completedEstimated,
    unscored,
    planned: round(planned),
    plannedPartial,
    hasPlanned: plannedCount > 0,
    excludedGym: round(excludedGym),
  }
}

/** Display label of an activity's TL: "TL 85", estimates "TL ~85"; null when unscored. */
export function activityTlLabel(event, opts = {}) {
  const l = completedEventLoad(event, opts)
  return l ? `TL ${l.estimated ? '~' : ''}${round(l.load)}` : null
}

/** Adds `tl` (week/day load) to calendar rows built by buildCalendarRows. Keeps the rows' own shape. */
export function addLoadToRows(rows, { today = new Date(), ltHistory = [], includeGym = true } = {}) {
  const todayKey = dayKey(today)
  const opts = { ltHistory, includeGym }
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((c) => ({ ...c, tl: dayLoad(c.events, c.key, todayKey, opts) })),
    summary: { ...row.summary, tl: weekLoad(row.cells.flatMap((c) => c.events), opts) },
  }))
}
