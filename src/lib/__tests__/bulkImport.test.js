// Run with: node --test src/lib/__tests__/bulkImport.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandToFitFiles, importSingleFitFile, importFitFilesBatch, sha256Hex } from '../bulkImport.js'

function makeBlob(text) {
  const bytes = new TextEncoder().encode(text)
  return {
    async arrayBuffer() {
      return bytes.buffer
    },
  }
}

function makeFile(name) {
  // Minimal stand-in for a browser File: only `.name` is read by expandToFitFiles's filter.
  return { name }
}

function createFakeSupabase({ uploadError = null, insertError = null, curvesError = null } = {}) {
  const calls = { uploads: [], inserted: [], curveInserts: [] }

  return {
    calls,
    storage: {
      from(bucket) {
        assert.equal(bucket, 'raw-activity-files')
        return {
          async upload(path, blob, opts) {
            calls.uploads.push({ path, opts })
            return { error: uploadError }
          },
        }
      },
    },
    from(table) {
      if (table === 'activities') {
        return {
          insert(record) {
            calls.inserted.push(record)
            return {
              select() {
                return {
                  single() {
                    if (insertError) return Promise.resolve({ data: null, error: insertError })
                    return Promise.resolve({ data: { id: `act-${calls.inserted.length}` }, error: null })
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'activity_curves') {
        return {
          async insert(rows) {
            calls.curveInserts.push(rows)
            return { error: curvesError }
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

test('expandToFitFiles keeps only .fit files (case-insensitive) and ignores everything else', async () => {
  const picked = [makeFile('ride.FIT'), makeFile('notes.txt'), makeFile('another.fit')]
  const result = await expandToFitFiles(picked)

  assert.deepEqual(
    result.map((f) => f.name),
    ['ride.FIT', 'another.fit']
  )
})

test('importSingleFitFile inserts a new activity and reports success', async () => {
  const supabase = createFakeSupabase()
  const file = { name: 'ride1.fit', blob: makeBlob('ride-1-bytes'), lastModified: Date.UTC(2020, 0, 1) }
  const analyzeFile = async () => ({
    summary: { start_time: '2024-05-01T10:00:00.000Z', elapsed_time_s: 3600 },
    curves: { Power: { '1s': 300 } },
    time_series: { watts: [1, 2, 3] },
  })
  const existingFingerprints = []

  const result = await importSingleFitFile({
    file,
    analyzeFile,
    supabase,
    userId: 'user-1',
    existingFingerprints,
    meta: { chainring: '58', cog: '14' },
  })

  assert.equal(result.status, 'success')
  assert.equal(result.activityId, 'act-1')
  assert.equal(supabase.calls.uploads.length, 1)
  assert.equal(supabase.calls.inserted.length, 1)
  assert.equal(supabase.calls.inserted[0].user_id, 'user-1')
  assert.equal(supabase.calls.curveInserts.length, 1)
  // The successfully-imported file's fingerprint is appended so later files in the same batch
  // can be deduped against it.
  assert.equal(existingFingerprints.length, 1)
  assert.equal(existingFingerprints[0].start_time, '2024-05-01T10:00:00.000Z')
})

test('importSingleFitFile skips a file whose hash exactly matches an existing fingerprint', async () => {
  const supabase = createFakeSupabase()
  const file = { name: 'dup.fit', blob: makeBlob('same-bytes') }
  const fileSha256 = await sha256Hex(new TextEncoder().encode('same-bytes').buffer)
  const existingFingerprints = [{ file_sha256: fileSha256, start_time: null, elapsed_time_s: null }]

  let analyzeCalled = false
  const analyzeFile = async () => {
    analyzeCalled = true
    return { summary: {}, curves: {}, time_series: {} }
  }

  const result = await importSingleFitFile({
    file,
    analyzeFile,
    supabase,
    userId: 'user-1',
    existingFingerprints,
  })

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'duplicate')
  // Hash match is cheap - we should never pay for analysis on an exact duplicate.
  assert.equal(analyzeCalled, false)
  assert.equal(supabase.calls.inserted.length, 0)
})

test('importSingleFitFile skips a file matching an existing start_time/duration fingerprint', async () => {
  const supabase = createFakeSupabase()
  const file = { name: 'resynced.fit', blob: makeBlob('different-bytes-but-same-ride') }
  const analyzeFile = async () => ({
    summary: { start_time: '2024-05-01T10:00:01.000Z', elapsed_time_s: 3601 },
    curves: {},
    time_series: {},
  })
  const existingFingerprints = [
    { file_sha256: 'some-other-hash', start_time: '2024-05-01T10:00:00.000Z', elapsed_time_s: 3600 },
  ]

  const result = await importSingleFitFile({
    file,
    analyzeFile,
    supabase,
    userId: 'user-1',
    existingFingerprints,
  })

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'duplicate')
  assert.equal(supabase.calls.inserted.length, 0)
})

test('importSingleFitFile reports an error (without throwing) when analysis fails', async () => {
  const supabase = createFakeSupabase()
  const file = { name: 'broken.fit', blob: makeBlob('bytes') }
  const analyzeFile = async () => {
    throw new Error('corrupt .fit file')
  }

  const result = await importSingleFitFile({ file, analyzeFile, supabase, userId: 'user-1' })

  assert.equal(result.status, 'error')
  assert.match(result.error, /corrupt \.fit file/)
})

test('importSingleFitFile reports an error when the activity insert fails', async () => {
  const supabase = createFakeSupabase({ insertError: new Error('insert failed') })
  const file = { name: 'ride.fit', blob: makeBlob('bytes') }
  const analyzeFile = async () => ({
    summary: { start_time: '2024-05-01T10:00:00.000Z', elapsed_time_s: 100 },
    curves: {},
    time_series: {},
  })

  const result = await importSingleFitFile({ file, analyzeFile, supabase, userId: 'user-1' })

  assert.equal(result.status, 'error')
  assert.equal(result.error, 'insert failed')
})

test('importFitFilesBatch processes every file and keeps going after one failure', async () => {
  const supabase = createFakeSupabase()
  const files = [
    { name: 'good1.fit', blob: makeBlob('a') },
    { name: 'bad.fit', blob: makeBlob('b') },
    { name: 'good2.fit', blob: makeBlob('c') },
  ]

  let callCount = 0
  const analyzeFile = async () => {
    callCount += 1
    if (callCount === 2) throw new Error('bad file')
    return {
      summary: { start_time: `2024-05-0${callCount}T10:00:00.000Z`, elapsed_time_s: 100 * callCount },
      curves: {},
      time_series: {},
    }
  }

  const progressEvents = []
  const results = await importFitFilesBatch({
    files,
    analyzeFile,
    supabase,
    userId: 'user-1',
    onProgress: (result, index, total) => progressEvents.push({ fileName: result.fileName, index, total }),
  })

  assert.equal(results.length, 3)
  assert.deepEqual(
    results.map((r) => r.status),
    ['success', 'error', 'success']
  )
  assert.equal(progressEvents.length, 3)
  assert.deepEqual(progressEvents[1], { fileName: 'bad.fit', index: 1, total: 3 })
})
