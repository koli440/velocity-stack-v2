// src/lib/templateEngine.js
//
// Modular evaluation engine for VelocityStack's declarative analysis templates.
// Given a template manifest + an activity's 1Hz time_series, it detects the
// matching efforts (reusing the universal effort detector) and computes the
// template-specific benchmark metrics (drop-off %, pacing index, recovery, …).

import { analyzeSessionEfforts } from './effortDetectionEngine.js'

function avg(arr) {
  if (!arr || arr.length === 0) return null
  return arr.reduce((a, b) => a + (b || 0), 0) / arr.length
}

function max(arr) {
  if (!arr || arr.length === 0) return null
  return Math.max(...arr)
}

/**
 * Pacing index: ratio of the second half average to the first half average
 * of a given stream slice, expressed as a percentage. 100% = perfectly even
 * pacing; < 100% = positive fade (slowing down); > 100% = negative split.
 */
function pacingIndex(stream, start, end) {
  const dur = end - start
  if (dur < 4) return null
  const mid = start + Math.floor(dur / 2)
  const first = avg(stream.slice(start, mid))
  const second = avg(stream.slice(mid, end))
  if (!first) return null
  return Math.round((second / first) * 1000) / 10
}

/** Drop-off %: decline of the last repeat vs the best (first/strongest) repeat. */
function dropoffPct(values) {
  const valid = values.filter((v) => typeof v === 'number' && !isNaN(v))
  if (valid.length < 2) return null
  const best = Math.max(...valid)
  const last = valid[valid.length - 1]
  if (!best) return null
  return Math.round(((best - last) / best) * 1000) / 10
}

/** HR recovery: how many bpm the heart rate drops within N seconds after an effort ends. */
function hrRecovery(hrStream, effortEnd, windowSec) {
  if (!hrStream || !hrStream.length) return null
  const atEnd = hrStream[effortEnd]
  const atWindow = hrStream[Math.min(hrStream.length - 1, effortEnd + windowSec)]
  if (atEnd == null || atWindow == null) return null
  return Math.round(atEnd - atWindow)
}

function evaluateRepeatedBursts(template, timeSeries, detection) {
  const { watts = [], heartrate = [] } = timeSeries
  const manifest = template.manifest
  const targetDur = manifest.target_duration_sec || 180
  const tolerance = manifest.duration_tolerance_sec || 45
  const recoveryWindow = manifest.recovery_window_sec || 60

  const matched = (detection.efforts || []).filter(
    (e) => Math.abs((e.duration_sec || 0) - targetDur) <= tolerance
  )
  const topN = matched
    .sort((a, b) => a.start_sec - b.start_sec)
    .slice(0, manifest.target_count || matched.length)

  const efforts = topN.map((e, idx) => {
    const segWatts = watts.slice(e.start_sec, e.end_sec)
    return {
      ...e,
      rep: idx + 1,
      avg_power: Math.round(avg(segWatts) || 0),
      max_power: max(segWatts),
      pacing_index: pacingIndex(watts, e.start_sec, e.end_sec),
      hr_recovery_60s: hrRecovery(heartrate, e.end_sec, recoveryWindow),
    }
  })

  const dropoff = dropoffPct(efforts.map((e) => e.avg_power))

  return {
    efforts,
    summary: {
      reps_detected: efforts.length,
      reps_target: manifest.target_count || null,
      dropoff_pct: dropoff,
      avg_power: efforts.length ? Math.round(avg(efforts.map((e) => e.avg_power))) : null,
    },
  }
}

function evaluateFlyingSprint(template, timeSeries, detection) {
  const { watts = [], cadence = [], speed = [] } = timeSeries
  const effort = (detection.efforts || [])[0]
  if (!effort) return { efforts: [], summary: {} }

  const { start_sec: start, end_sec: end } = effort
  const segSpeed = speed.slice(start, end)
  const distance = template.manifest.distance_m || 200
  const avgSpeedKmh = avg(segSpeed)
  const estimatedTime = avgSpeedKmh ? Math.round((distance / (avgSpeedKmh / 3.6)) * 1000) / 1000 : null

  const enriched = {
    ...effort,
    estimated_time: estimatedTime,
    pacing_index: pacingIndex(watts.length ? watts : cadence, start, end),
  }

  return {
    efforts: [enriched],
    summary: {
      estimated_time_sec: estimatedTime,
      max_cadence: effort.max_cadence ?? max(cadence.slice(start, end)),
      max_power: effort.max_power ?? max(watts.slice(start, end)),
    },
  }
}

function evaluateSustainedTT(template, timeSeries, detection) {
  const { watts = [], heartrate = [] } = timeSeries
  const manifest = template.manifest
  const effort = (detection.efforts || [])[0]
  if (!effort) return { efforts: [], summary: {} }

  const { start_sec: start, end_sec: end } = effort
  const dur = end - start

  if (manifest.min_duration_sec && dur < manifest.min_duration_sec) {
    return { efforts: [], summary: { reason: 'Effort shorter than template minimum duration' } }
  }

  const segWatts = watts.slice(start, end)
  const pacing = pacingIndex(watts, start, end)
  const dropoff = dropoffPct([avg(segWatts.slice(0, Math.floor(dur / 2))), avg(segWatts.slice(Math.floor(dur / 2)))])

  let lapSplits = null
  if (manifest.lap_length_m) {
    const lapCount = Math.max(1, Math.round((effort.suggested_distance_m || 3000) / manifest.lap_length_m))
    const lapDur = dur / lapCount
    lapSplits = Array.from({ length: lapCount }, (_, i) => Math.round(lapDur * 100) / 100)
  }

  let pwHrDecoupling = null
  if (manifest.metrics?.includes('pw_hr_decoupling_pct') && heartrate.length >= end) {
    const segHr = heartrate.slice(start, end)
    const mid = Math.floor(dur / 2)
    const firstPwHr = avg(segWatts.slice(0, mid)) / (avg(segHr.slice(0, mid)) || 1)
    const secondPwHr = avg(segWatts.slice(mid)) / (avg(segHr.slice(mid)) || 1)
    if (firstPwHr) {
      pwHrDecoupling = Math.round(((firstPwHr - secondPwHr) / firstPwHr) * 1000) / 10
    }
  }

  const enriched = {
    ...effort,
    pacing_index: pacing,
    dropoff_pct: dropoff,
    lap_splits_250m: lapSplits,
    pw_hr_decoupling_pct: pwHrDecoupling,
  }

  return {
    efforts: [enriched],
    summary: {
      avg_power: effort.avg_power ?? Math.round(avg(segWatts)),
      pacing_index: pacing,
      dropoff_pct: dropoff,
      pw_hr_decoupling_pct: pwHrDecoupling,
    },
  }
}

function evaluateStandingStart(template, timeSeries, detection) {
  const { watts = [], torque = [] } = timeSeries
  const effort = (detection.efforts || [])[0]
  if (!effort) return { efforts: [], summary: {} }

  const { start_sec: start, end_sec: end } = effort
  const segWatts = watts.slice(start, end)
  const peakPowerIdx = segWatts.indexOf(Math.max(...segWatts))
  const timeToPeakPower = peakPowerIdx >= 0 ? peakPowerIdx : null

  const enriched = {
    ...effort,
    time_to_peak_power_sec: timeToPeakPower,
    avg_power_first_10s: Math.round(avg(segWatts.slice(0, 10)) || 0),
    peak_torque: effort.peak_torque ?? max(torque.slice(start, end)),
  }

  return {
    efforts: [enriched],
    summary: {
      peak_torque: enriched.peak_torque,
      time_to_peak_power_sec: timeToPeakPower,
      max_power: effort.max_power ?? max(segWatts),
    },
  }
}

/**
 * User-authorable "custom_intervals" pattern (issue #14): a manifest compiled
 * from a user's interval DSL (src/lib/intervalDsl.js) rather than a fixed
 * track-cycling discipline. Reuses the same avg/max/pacingIndex/dropoffPct
 * helpers as the other evaluators above.
 */
function evaluateCustomIntervals(template, timeSeries, detection, ftpAtActivityW) {
  const { watts = [] } = timeSeries
  const manifest = template.manifest || {}
  const repsTarget = manifest.repeat_count || null

  const rawEfforts = detection.efforts || []

  // Group the flat efforts list back into reps: each rep is the (ordered)
  // run of steps the DSL declares — typically [work] or [work, recovery].
  const stepsPerRep = (manifest.steps || []).length || 1
  const reps = []
  for (let i = 0; i < rawEfforts.length; i += stepsPerRep) {
    reps.push(rawEfforts.slice(i, i + stepsPerRep))
  }

  const efforts = reps.flatMap((repEfforts, repIdx) =>
    repEfforts.map((e) => ({
      ...e,
      rep: repIdx + 1,
      pacing_index: pacingIndex(watts, e.start_sec, e.end_sec),
    }))
  )

  const workEfforts = efforts.filter((e) => e.role === 'work')
  const dropoff = dropoffPct(workEfforts.map((e) => e.avg_power))

  return {
    efforts,
    summary: {
      reps_detected: reps.length,
      reps_target: repsTarget,
      dropoff_pct: dropoff,
      avg_power: workEfforts.length ? Math.round(avg(workEfforts.map((e) => e.avg_power))) : null,
    },
  }
}

const EVALUATORS = {
  repeated_bursts: evaluateRepeatedBursts,
  flying_sprint: evaluateFlyingSprint,
  sustained_tt: evaluateSustainedTT,
  standing_start: evaluateStandingStart,
  custom_intervals: evaluateCustomIntervals,
}

/**
 * Evaluate a single analysis_templates row against an activity's time_series.
 * @param {{slug: string, manifest: object}} template
 * @param {object} timeSeries - { watts, cadence, torque, speed, heartrate }
 * @param {number|null} [ftpAtActivityW] - the activity's own FTP snapshot (issue #14);
 *   only used by the `custom_intervals` pattern's %FTP-banded steps.
 * @returns {{ efforts: object[], summary: object }}
 */
export function evaluateTemplate(template, timeSeries = {}, ftpAtActivityW = null) {
  const manifest = template.manifest || {}
  const pattern = manifest.pattern || 'repeated_bursts'
  const evaluator = EVALUATORS[pattern]

  if (!timeSeries || (!timeSeries.watts?.length && !timeSeries.cadence?.length)) {
    return { efforts: [], summary: { reason: 'Activity has no time_series data to evaluate.' } }
  }

  // Map a template's pattern to the universal detector's discipline hint so
  // it runs the right detection strategy before we compute template metrics.
  const disciplineHint =
    pattern === 'sustained_tt'
      ? 'individual_pursuit'
      : pattern === 'flying_sprint'
      ? 'f200'
      : pattern === 'standing_start'
      ? 'standing_start'
      : pattern === 'custom_intervals'
      ? 'custom_intervals'
      : 'repeated_bursts'

  const detection = analyzeSessionEfforts({
    discipline: disciplineHint,
    timeSeries,
    ...(pattern === 'custom_intervals'
      ? { steps: manifest.steps || [], repeatCount: manifest.repeat_count || 1, ftpAtActivityW }
      : {}),
  })

  if (!evaluator) {
    return { efforts: detection.efforts || [], summary: {} }
  }

  return evaluator(template, timeSeries, detection, ftpAtActivityW)
}
