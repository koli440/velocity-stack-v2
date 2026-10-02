// src/lib/activityDuplicates.js
//
// Shared "unique activities per user" duplicate detection (issue #41), used by every
// ingestion path - manual .fit upload (FitUploader), Intervals.icu sync (IntervalsSyncModal),
// and bulk import (bulkImport.js) - so the same ride can't be inserted twice regardless of
// which path it came in through.
//
// An activity is considered a duplicate of an already-imported one (for the same user) if
// either:
//   1) its raw .fit file hash (file_sha256) matches exactly, or
//   2) its start_time and elapsed_time_s are both within a small tolerance of an existing
//      activity - the same ride re-imported from a different source (e.g. manually uploaded
//      after already being synced from Intervals.icu) won't produce a byte-identical file, so
//      the hash check alone isn't enough (per issue #41's own suggestion).

const START_TIME_TOLERANCE_S = 5
const DURATION_TOLERANCE_S = 5

/**
 * @param {{ fileSha256?: string|null, startTime?: string|null, elapsedTimeS?: number|null }} candidate
 * @param {{ file_sha256?: string|null, start_time?: string|null, elapsed_time_s?: number|null }} existing
 * @returns {boolean}
 */
export function isDuplicateActivity(candidate, existing) {
  if (!candidate || !existing) return false

  if (candidate.fileSha256 && existing.file_sha256 && candidate.fileSha256 === existing.file_sha256) {
    return true
  }

  if (!candidate.startTime || !existing.start_time) return false
  if (candidate.elapsedTimeS == null || existing.elapsed_time_s == null) return false

  const candidateStartMs = new Date(candidate.startTime).getTime()
  const existingStartMs = new Date(existing.start_time).getTime()
  if (Number.isNaN(candidateStartMs) || Number.isNaN(existingStartMs)) return false

  const startDiffS = Math.abs(candidateStartMs - existingStartMs) / 1000
  const durationDiffS = Math.abs(candidate.elapsedTimeS - existing.elapsed_time_s)

  return startDiffS <= START_TIME_TOLERANCE_S && durationDiffS <= DURATION_TOLERANCE_S
}

/**
 * Returns the first fingerprint in `existingFingerprints` that is a duplicate of `candidate`,
 * or `null` if none match.
 *
 * @param {object} candidate
 * @param {Array<object>} existingFingerprints
 * @returns {object|null}
 */
export function findDuplicate(candidate, existingFingerprints = []) {
  return existingFingerprints.find((existing) => isDuplicateActivity(candidate, existing)) || null
}

/**
 * Loads a lightweight projection of a user's existing activities (just the fields needed for
 * duplicate detection) so an entire import/sync can be de-duplicated without a DB round trip
 * per candidate activity.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Array<{ file_sha256: string|null, start_time: string|null, elapsed_time_s: number|null }>>}
 */
export async function loadExistingActivityFingerprints(supabase, userId) {
  const { data, error } = await supabase
    .from('activities')
    .select('file_sha256, start_time, elapsed_time_s')
    .eq('user_id', userId)

  if (error) throw error
  return data || []
}
