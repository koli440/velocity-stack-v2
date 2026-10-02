// Run with: node --test src/lib/__tests__/activityDuplicates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDuplicateActivity, findDuplicate, loadExistingActivityFingerprints } from '../activityDuplicates.js'

test('isDuplicateActivity matches on an exact file_sha256 hash', () => {
  const candidate = { fileSha256: 'abc123', startTime: null, elapsedTimeS: null }
  const existing = { file_sha256: 'abc123', start_time: null, elapsed_time_s: null }
  assert.equal(isDuplicateActivity(candidate, existing), true)
})

test('isDuplicateActivity matches when start_time and duration are both within tolerance', () => {
  const candidate = {
    fileSha256: 'different-hash',
    startTime: '2024-05-01T10:00:02.000Z',
    elapsedTimeS: 3600,
  }
  const existing = {
    file_sha256: 'original-hash',
    start_time: '2024-05-01T10:00:00.000Z',
    elapsed_time_s: 3603,
  }
  assert.equal(isDuplicateActivity(candidate, existing), true)
})

test('isDuplicateActivity does not match when start_time is far apart', () => {
  const candidate = {
    fileSha256: 'hash-a',
    startTime: '2024-05-01T10:30:00.000Z',
    elapsedTimeS: 3600,
  }
  const existing = {
    file_sha256: 'hash-b',
    start_time: '2024-05-01T10:00:00.000Z',
    elapsed_time_s: 3600,
  }
  assert.equal(isDuplicateActivity(candidate, existing), false)
})

test('isDuplicateActivity does not match when duration differs beyond tolerance', () => {
  const candidate = {
    fileSha256: 'hash-a',
    startTime: '2024-05-01T10:00:00.000Z',
    elapsedTimeS: 1800,
  }
  const existing = {
    file_sha256: 'hash-b',
    start_time: '2024-05-01T10:00:00.000Z',
    elapsed_time_s: 3600,
  }
  assert.equal(isDuplicateActivity(candidate, existing), false)
})

test('isDuplicateActivity returns false when there is not enough data to compare', () => {
  assert.equal(isDuplicateActivity({}, { file_sha256: null, start_time: null, elapsed_time_s: null }), false)
  assert.equal(isDuplicateActivity(null, { file_sha256: 'x' }), false)
  assert.equal(isDuplicateActivity({ fileSha256: 'x' }, null), false)
})

test('findDuplicate returns the first matching fingerprint, or null', () => {
  const fingerprints = [
    { file_sha256: 'h1', start_time: '2024-01-01T00:00:00.000Z', elapsed_time_s: 100 },
    { file_sha256: 'h2', start_time: '2024-02-01T00:00:00.000Z', elapsed_time_s: 200 },
  ]

  assert.deepEqual(findDuplicate({ fileSha256: 'h2' }, fingerprints), fingerprints[1])
  assert.equal(findDuplicate({ fileSha256: 'does-not-exist' }, fingerprints), null)
  assert.equal(findDuplicate({ fileSha256: 'h3' }, []), null)
})

function createFakeClient({ rows = [], error = null } = {}) {
  const calls = { table: null, selectedColumns: null, userId: null }
  return {
    calls,
    from(table) {
      calls.table = table
      return {
        select(columns) {
          calls.selectedColumns = columns
          return {
            eq(column, value) {
              assert.equal(column, 'user_id')
              calls.userId = value
              return Promise.resolve({ data: rows, error })
            },
          }
        },
      }
    },
  }
}

test('loadExistingActivityFingerprints queries activities scoped to the given user', async () => {
  const rows = [{ file_sha256: 'h1', start_time: '2024-01-01T00:00:00.000Z', elapsed_time_s: 100 }]
  const client = createFakeClient({ rows })

  const result = await loadExistingActivityFingerprints(client, 'user-1')

  assert.equal(client.calls.table, 'activities')
  assert.equal(client.calls.selectedColumns, 'file_sha256, start_time, elapsed_time_s')
  assert.equal(client.calls.userId, 'user-1')
  assert.deepEqual(result, rows)
})

test('loadExistingActivityFingerprints throws when the query fails', async () => {
  const client = createFakeClient({ error: new Error('db down') })
  await assert.rejects(() => loadExistingActivityFingerprints(client, 'user-1'), /db down/)
})

test('loadExistingActivityFingerprints returns an empty array when there is no data', async () => {
  const client = createFakeClient({ rows: null })
  const result = await loadExistingActivityFingerprints(client, 'user-1')
  assert.deepEqual(result, [])
})
