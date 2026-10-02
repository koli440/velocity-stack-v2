// src/lib/activityRecord.js
//
// Single mapping from an `analyze.py`-shaped `summary` object (the shared metric-computation
// engine used by both manual .fit uploads and the Intervals.icu sync pipeline) into the exact
// `activities` table insert payload. Keeping this in one place guarantees every ingestion path
// persists the same set of activity-level metrics (issue #11).

/**
 * @param {object} summary - output of api/analyze.py's `analyze_fit_file().summary`
 * @param {object} meta
 * @param {string} meta.title
 * @param {string} meta.userId
 * @param {string|null} [meta.trackId]
 * @param {number|null} [meta.chainring]
 * @param {number|null} [meta.cog]
 * @param {number} [meta.crankLengthMm]
 * @param {object} [meta.timeSeries]
 * @param {object} [meta.curvesData]
 * @param {string|null} [meta.rawFileUrl]
 * @param {string|null} [meta.fileSha256]
 * @param {string} [meta.processingStatus]
 * @param {number|null} [meta.ftpWatts] - athlete FTP, used to derive intensity_factor/training_load
 * @param {string} [meta.fallbackActivityDate] - used when summary.start_time is unavailable
 */
export function buildActivityInsert(summary = {}, meta = {}) {
  const {
    title,
    userId,
    trackId = null,
    chainring = null,
    cog = null,
    crankLengthMm = 165.0,
    timeSeries = {},
    curvesData = {},
    rawFileUrl = null,
    fileSha256 = null,
    processingStatus = 'baseline_completed',
    ftpWatts = null,
    fallbackActivityDate = new Date().toISOString(),
  } = meta

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
    chainring: chainring ? parseInt(chainring) : null,
    cog: cog ? parseInt(cog) : null,
    crank_length_mm: crankLengthMm,
    activity_date: summary.start_time || fallbackActivityDate,
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
    curves_data: curvesData || {},
    raw_file_url: rawFileUrl,
    file_sha256: fileSha256,
    processing_status: processingStatus,
    // Point-in-time FTP snapshot (issue #14): persisted as a raw column so
    // %FTP-based template evaluation always uses the FTP that was valid when
    // the ride happened, never the athlete's current (possibly very
    // different) FTP.
    ftp_at_activity_w: ftpWatts ?? null,
  }
}
