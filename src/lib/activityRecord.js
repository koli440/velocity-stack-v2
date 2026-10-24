// src/lib/activityRecord.js
//
// Single mapping from an `analyze.py`-shaped `summary` object (the shared metric-computation
// engine used by both manual .fit uploads and the Intervals.icu sync pipeline) into the exact
// `activities` table insert payload. Keeping this in one place guarantees every ingestion path
// persists the same set of activity-level metrics (issue #11).

import { buildFeedPreview } from './routePreview.js'
import { buildPowerPreview } from './powerPreview.js'
import { zoneSignature } from './privacyZone.js'
import { ftpAt } from './ftpHistory.js'
import { weightAt } from './weightHistory.js'

/**
 * @param {object} summary - output of api/analyze.py's `analyze_fit_file().summary`
 * @param {object} meta
 * @param {string} meta.title
 * @param {string} meta.userId
 * @param {string|null} [meta.trackId]
 * @param {string|null} [meta.rideType] - ride type key (road/track/...); null leaves it unset (= road)
 * @param {number|null} [meta.chainring]
 * @param {number|null} [meta.cog]
 * @param {number} [meta.crankLengthMm]
 * @param {object} [meta.timeSeries]
 * @param {object} [meta.curvesData]
 * @param {string|null} [meta.rawFileUrl]
 * @param {string|null} [meta.fileSha256]
 * @param {string} [meta.source] - 'manual' | 'intervals' | 'strava' | 'wahoo'
 * @param {string|null} [meta.externalSource]
 * @param {string|number|null} [meta.externalId]
 * @param {string} [meta.processingStatus]
 * @param {Array|null} [meta.ftpHistory] - athlete FTP history; the FTP valid on the activity's date
 *   is snapshotted (issue #142). Takes precedence over ftpWatts.
 * @param {Array|null} [meta.weightHistory] - athlete body weight history; the weight valid on the
 *   activity's date is snapshotted (issue #143). When omitted, the DB trigger resolves it.
 * @param {number|null} [meta.ftpWatts] - fallback FTP when no history is supplied, used to derive
 *   intensity_factor/training_load
 * @param {object|null} [meta.privacyZone] - owner's GPS privacy zone, applied to route_preview
 * @param {string} [meta.fallbackActivityDate] - used when summary.start_time is unavailable
 */
export function buildActivityInsert(summary = {}, meta = {}) {
  const {
    title,
    userId,
    trackId = null,
    rideType = null,
    chainring = null,
    cog = null,
    crankLengthMm = 165.0,
    timeSeries = {},
    curvesData = {},
    rawFileUrl = null,
    fileSha256 = null,
    source = 'manual',
    externalSource = null,
    externalId = null,
    processingStatus = 'baseline_completed',
    ftpWatts: fallbackFtp = null,
    ftpHistory = null,
    weightHistory = null,
    privacyZone = null,
    fallbackActivityDate = new Date().toISOString(),
  } = meta

  const activityDate = summary.start_time || fallbackActivityDate
  const ftpWatts = Array.isArray(ftpHistory) ? ftpAt(ftpHistory, activityDate) : fallbackFtp

  const normalizedPower = summary.normalized_power_w ?? null
  const elapsedTime = summary.elapsed_time_s ?? null

  // Intensity Factor & Training Load (TSS-style) only make sense once the athlete has an FTP
  // and we have a normalized power + elapsed time to work from.
  let intensityFactor = null
  let trainingLoad = null
  if (ftpWatts && normalizedPower && elapsedTime) {
    intensityFactor = Math.round((normalizedPower / ftpWatts) * 1000) / 1000
    trainingLoad =
      Math.round(
        ((elapsedTime * normalizedPower * intensityFactor) / (ftpWatts * 3600)) * 100 * 10
      ) / 10
  }

  return {
    title: title?.trim() || 'Track Session',
    user_id: userId,
    track_id: trackId || null,
    ride_type: rideType || null,
    chainring: chainring ? parseInt(chainring) : null,
    cog: cog ? parseInt(cog) : null,
    crank_length_mm: crankLengthMm,
    activity_date: activityDate,
    start_time: summary.start_time ?? null,
    elapsed_time_s: summary.elapsed_time_s ?? null,
    moving_time_s: summary.moving_time_s ?? null,
    distance_m: summary.distance_m ?? null,
    avg_speed_kmh: summary.avg_speed_kmh ?? null,
    max_speed_kmh: summary.max_speed_kmh ?? null,
    avg_power_w: summary.avg_power_w ?? null,
    max_power_w: summary.max_power_w ?? null,
    normalized_power_w: normalizedPower,
    avg_cadence_rpm: summary.avg_cadence_rpm ?? null,
    max_cadence_rpm: summary.max_cadence_rpm ?? null,
    avg_torque_nm: summary.avg_torque_nm ?? null,
    peak_torque_nm: summary.peak_torque_nm ?? null,
    avg_hr: summary.avg_hr ?? null,
    max_hr: summary.max_hr ?? null,
    elevation_gain_m: summary.elevation_gain_m ?? null,
    elevation_loss_m: summary.elevation_loss_m ?? null,
    intensity_factor: intensityFactor,
    training_load: trainingLoad,
    speed_source: summary.speed_source ?? null,
    time_series: timeSeries || {},
    route_preview: buildFeedPreview(timeSeries || {}, privacyZone),
    route_preview_zone: zoneSignature(privacyZone),
    power_preview: buildPowerPreview(timeSeries?.watts),
    curves_data: curvesData || {},
    raw_file_url: rawFileUrl,
    file_sha256: fileSha256,
    processing_status: processingStatus,
    source,
    external_source: externalId != null ? externalSource : null,
    external_id: externalId != null ? String(externalId) : null,
    // Point-in-time FTP snapshot (issues #14, #142): the FTP valid on the ride's date (from the
    // athlete's FTP history), never the current one. When null, the DB trigger resolves it.
    ftp_at_activity_w: ftpWatts ?? null,
    // Weight snapshot (issue #143), same model as the FTP snapshot; null lets the DB trigger resolve it.
    weight_at_activity_kg: Array.isArray(weightHistory) ? weightAt(weightHistory, activityDate) : null,
  }
}
