// src/lib/bulkImport.js
//
// Shared orchestration for bulk-importing a historical archive of .fit files (issue #36),
// reusing the same analyze -> buildActivityInsert -> insert pipeline as the manual single
// .fit upload (FitUploader) and the Intervals.icu sync (IntervalsSyncModal), so every
// ingestion path keeps producing an identical set of metrics (see also issue #11).
//
// This module is intentionally framework-free (no React, only Web APIs - File/Blob/crypto -
// that are also available under Node's `node --test`), so it can be exercised with fake
// `analyzeFile`/`supabase` doubles in unit tests without a browser or network access.

import { buildActivityInsert } from './activityRecord'
import { findDuplicate } from './activityDuplicates'

const FIT_EXTENSION_RE = /\.fit$/i
const FIT_GZ_EXTENSION_RE = /\.fit\.gz$/i
const ZIP_EXTENSION_RE = /\.zip$/i

/**
 * Expands a user-selected FileList/File[] into a flat list of .fit files, transparently
 * unpacking any .zip archives (e.g. a full Strava/Garmin export bundle) via JSZip.
 * Garmin Connect's "Export Your Data" bundle nests each ride under activities/<id>.fit.gz
 * (individually gzip-compressed) - those are kept as-is here (`gzip: true`) and only
 * decompressed later, per-file, inside `importSingleFitFile` so one corrupt entry can't abort
 * expansion of an entire archive.
 * Non-.fit(.gz) entries inside a zip (readme, .gpx, .tcx, folders, etc.) are silently skipped,
 * as are any top-level files that are neither .fit, .fit.gz, nor .zip.
 *
 * @param {FileList|File[]} fileList
 * @returns {Promise<{ name: string, blob: Blob, lastModified: number|undefined, gzip?: boolean }[]>}
 */
export async function expandToFitFiles(fileList) {
  const files = Array.from(fileList || [])
  const result = []

  for (const file of files) {
    if (ZIP_EXTENSION_RE.test(file.name)) {
      const entries = await extractFitEntriesFromZip(file)
      result.push(...entries)
    } else if (FIT_GZ_EXTENSION_RE.test(file.name)) {
      result.push({
        name: file.name.replace(/\.gz$/i, ''),
        blob: file,
        lastModified: file.lastModified,
        gzip: true,
      })
    } else if (FIT_EXTENSION_RE.test(file.name)) {
      result.push({ name: file.name, blob: file, lastModified: file.lastModified })
    }
  }

  return result
}

async function extractFitEntriesFromZip(zipFile) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(zipFile)
  const entries = []

  for (const relativePath of Object.keys(zip.files)) {
    const entry = zip.files[relativePath]
    if (entry.dir) continue

    const isGzip = FIT_GZ_EXTENSION_RE.test(relativePath)
    if (!isGzip && !FIT_EXTENSION_RE.test(relativePath)) continue

    const blob = await entry.async('blob')
    // Use only the final path segment as the display name - archives commonly nest files
    // under an "activities/" (or similar) folder.
    const rawName = relativePath.split('/').pop()
    const name = isGzip ? rawName.replace(/\.gz$/i, '') : rawName
    entries.push({ name, blob, lastModified: entry.date ? entry.date.getTime() : undefined, gzip: isGzip })
  }

  return entries
}

/**
 * Decompresses a gzip-compressed Blob (e.g. a Garmin Connect `<id>.fit.gz` entry) using the
 * native, browser/Node-global `DecompressionStream` - no extra dependency needed for a format
 * this ubiquitous.
 *
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
async function gunzipBlob(blob) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support decompressing .gz files - please extract the archive first.')
  }
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).blob()
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} lowercase hex SHA-256 digest
 */
export async function sha256Hex(buffer) {
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Imports a single .fit file using the exact same mapping (`buildActivityInsert`) as every
 * other ingestion path, and the shared duplicate check (issue #41). Never throws - all
 * failures are reported via the returned `status` so a batch import can keep going after one
 * bad file.
 *
 * @param {object} params
 * @param {{ name: string, blob: Blob, lastModified?: number, gzip?: boolean }} params.file
 *   - when `gzip` is set (e.g. a Garmin Connect export's `<id>.fit.gz`), `blob` is decompressed
 *   before hashing/analysis/upload so duplicate detection and storage both see plain .fit bytes.
 * @param {(blob: Blob, meta: object) => Promise<{ summary: object, curves: object, time_series: object }>} params.analyzeFile
 *   - injected so the UI can POST to /api/analyze while tests can supply a fake.
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {string} params.userId
 * @param {Array<object>} params.existingFingerprints - fingerprints (file_sha256/start_time/
 *   elapsed_time_s) of the user's already-imported activities, mutated in place as files
 *   succeed so later files in the same batch are also deduped against them.
 * @param {object} [params.meta] - passed through to buildActivityInsert / analyzeFile (trackId,
 *   chainring, cog, crankLengthMm, isFixedGear, ftpWatts, processingStatus, ...)
 * @param {boolean} [params.uploadRawFile] - archive the raw .fit to Storage (default true)
 * @returns {Promise<{ fileName: string, status: 'success'|'skipped'|'error', activityId?: string, reason?: string, error?: string }>}
 */
export async function importSingleFitFile({
  file,
  analyzeFile,
  supabase,
  userId,
  existingFingerprints = [],
  meta = {},
  uploadRawFile = true,
}) {
  const fileName = file?.name || 'unknown.fit'

  try {
    // Garmin Connect exports each activity individually gzip-compressed (<id>.fit.gz) -
    // decompress up front so hashing/duplicate-detection/analysis/storage all see the same
    // plain .fit bytes a manually-uploaded .fit file would produce.
    const fitBlob = file.gzip ? await gunzipBlob(file.blob) : file.blob

    const arrayBuffer = await fitBlob.arrayBuffer()
    const fileSha256 = await sha256Hex(arrayBuffer)

    // Cheap pre-check: an exact file hash match means we can skip without paying for analysis.
    if (findDuplicate({ fileSha256 }, existingFingerprints)) {
      return { fileName, status: 'skipped', reason: 'duplicate' }
    }

    const analysis = await analyzeFile(fitBlob, meta)
    if (!analysis?.summary) {
      return { fileName, status: 'error', error: 'Analysis did not return a summary.' }
    }

    const { start_time: startTime = null, elapsed_time_s: elapsedTimeS = null } = analysis.summary

    // Heuristic check: same ride re-imported from a different source won't share a file hash,
    // but will share (close enough) start time and duration (issue #41).
    if (findDuplicate({ fileSha256, startTime, elapsedTimeS }, existingFingerprints)) {
      return { fileName, status: 'skipped', reason: 'duplicate' }
    }

    let rawFileUrl = null
    if (uploadRawFile) {
      const storagePath = `${userId}/${Date.now()}-${fileName}`
      const { error: uploadError } = await supabase.storage
        .from('raw-activity-files')
        .upload(storagePath, fitBlob, { contentType: 'application/octet-stream' })

      if (uploadError) {
        console.warn(`Raw .fit archive upload failed for ${fileName}:`, uploadError.message)
      } else {
        rawFileUrl = storagePath
      }
    }

    // Historical-import fix: if the .fit file itself has no timestamp (rare, but some older/
    // minimal exports omit it), fall back to the file's own modified date instead of "now" -
    // otherwise a years-old ride would be recorded as having happened today.
    const fallbackActivityDate =
      meta.fallbackActivityDate || (file.lastModified ? new Date(file.lastModified).toISOString() : undefined)

    const activityInsert = buildActivityInsert(analysis.summary, {
      ...meta,
      title: meta.title || fileName.replace(/\.[^/.]+$/, ''),
      userId,
      timeSeries: analysis.time_series,
      curvesData: analysis.curves,
      rawFileUrl,
      fileSha256,
      fallbackActivityDate,
    })

    const { data: activity, error: insertError } = await supabase
      .from('activities')
      .insert(activityInsert)
      .select()
      .single()

    if (insertError) {
      return { fileName, status: 'error', error: insertError.message }
    }

    if (analysis.curves && Object.keys(analysis.curves).length > 0) {
      const curveRows = Object.entries(analysis.curves).map(([curveType, curveData]) => ({
        activity_id: activity.id,
        curve_type: curveType,
        data: curveData,
      }))
      const { error: curvesError } = await supabase.from('activity_curves').insert(curveRows)
      if (curvesError) {
        console.warn(`Failed to persist durational curves for ${fileName}:`, curvesError.message)
      }
    }

    // Make this activity visible to the duplicate check for subsequent files in the batch.
    existingFingerprints.push({ file_sha256: fileSha256, start_time: startTime, elapsed_time_s: elapsedTimeS })

    return { fileName, status: 'success', activityId: activity.id }
  } catch (err) {
    return { fileName, status: 'error', error: err.message || 'Unknown error' }
  }
}

/**
 * Sequentially imports a batch of .fit files, invoking `onProgress` after each file so the UI
 * can render live per-file status. Sequential (not parallel) on purpose: /api/analyze is a
 * serverless function with limited concurrency, and this keeps error attribution to a single
 * file simple.
 *
 * @param {object} params
 * @param {{ name: string, blob: Blob }[]} params.files
 * @param {(result: object, index: number, total: number) => void} [params.onProgress]
 * @returns {Promise<Array>} the list of per-file results, in input order.
 */
export async function importFitFilesBatch({ files, onProgress, ...singleFileParams }) {
  const results = []
  for (let i = 0; i < files.length; i++) {
    const result = await importSingleFitFile({ ...singleFileParams, file: files[i] })
    results.push(result)
    if (onProgress) onProgress(result, i, files.length)
  }
  return results
}
