import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePhotoFile,
  buildPhotoPath,
  fitWithin,
  pickCovers,
  signPhotoUrls,
  fetchCoverPhotos,
  uploadActivityPhoto,
  deleteActivityPhoto,
  MAX_PHOTOS_PER_ACTIVITY,
  MAX_PHOTO_BYTES,
} from '../activityPhotos.js'

test('validatePhotoFile checks type, size and count', () => {
  assert.equal(validatePhotoFile({ type: 'image/jpeg', size: 100 }), null)
  assert.match(validatePhotoFile(null), /No file/)
  assert.match(validatePhotoFile({ type: 'image/gif', size: 1 }), /JPG, PNG or WebP/)
  assert.match(validatePhotoFile({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 }), /8 MB/)
  assert.match(validatePhotoFile({ type: 'image/png', size: 1 }, MAX_PHOTOS_PER_ACTIVITY), /at most/)
})

test('buildPhotoPath is scoped to user and activity folders', () => {
  assert.equal(buildPhotoPath({ userId: 'u', activityId: 'a', mimeType: 'image/png', id: 'x' }), 'u/a/x.png')
  assert.equal(buildPhotoPath({ userId: 'u', activityId: 'a', mimeType: 'image/webp', id: 'x' }), 'u/a/x.webp')
  assert.match(buildPhotoPath({ userId: 'u', activityId: 'a', mimeType: 'image/jpeg' }), /^u\/a\/.+\.jpg$/)
})

test('fitWithin downsizes only', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 })
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 })
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 })
})

test('pickCovers uses lowest position as cover and counts photos', () => {
  const covers = pickCovers([
    { activity_id: 'a', storage_path: 'p2', position: 1, created_at: '2026-01-01' },
    { activity_id: 'a', storage_path: 'p1', position: 0, created_at: '2026-01-02' },
    { activity_id: 'b', storage_path: 'q1', position: 0, created_at: '2026-01-01' },
  ])
  assert.deepEqual(covers.get('a'), { path: 'p1', count: 2 })
  assert.deepEqual(covers.get('b'), { path: 'q1', count: 1 })
})

function storageClient({ signed = [], uploadError = null } = {}) {
  const calls = { removed: [], uploaded: [], signedPaths: null }
  return {
    calls,
    storage: {
      from(bucket) {
        assert.equal(bucket, 'activity-photos')
        return {
          createSignedUrls: async (paths) => {
            calls.signedPaths = paths
            return { data: signed, error: null }
          },
          upload: async (path) => {
            calls.uploaded.push(path)
            return { error: uploadError }
          },
          remove: async (paths) => {
            calls.removed.push(...paths)
            return { error: null }
          },
        }
      },
    },
    rows: null,
    from(table) {
      assert.equal(table, 'activity_photos')
      const self = this
      const b = {
        select() { return b },
        in() { return Promise.resolve({ data: self.rows, error: null }) },
        insert() { return b },
        single() { return Promise.resolve(self.insertResult) },
        delete() { return b },
        eq() { return Promise.resolve({ error: null }) },
      }
      return b
    },
  }
}

test('signPhotoUrls dedupes paths and skips failures', async () => {
  const c = storageClient({
    signed: [{ path: 'a', signedUrl: 'u-a' }, { path: 'b', error: 'nope', signedUrl: null }],
  })
  const { urls } = await signPhotoUrls(c, ['a', 'b', 'a', null])
  assert.deepEqual(c.calls.signedPaths, ['a', 'b'])
  assert.deepEqual([...urls], [['a', 'u-a']])
  assert.equal((await signPhotoUrls(c, [])).urls.size, 0)
})

test('fetchCoverPhotos signs one cover per activity', async () => {
  const c = storageClient({ signed: [{ path: 'p1', signedUrl: 'url1' }] })
  c.rows = [
    { activity_id: 'a', storage_path: 'p1', position: 0, created_at: '1' },
    { activity_id: 'a', storage_path: 'p2', position: 1, created_at: '2' },
  ]
  const { covers } = await fetchCoverPhotos(c, ['a', 'b'])
  assert.deepEqual(c.calls.signedPaths, ['p1'])
  assert.deepEqual(covers.get('a'), { url: 'url1', count: 2 })
})

test('uploadActivityPhoto removes the file when the row insert fails', async () => {
  const c = storageClient()
  c.insertResult = { data: null, error: new Error('rls') }
  const res = await uploadActivityPhoto(c, { userId: 'u', activityId: 'a', blob: { type: 'image/jpeg', size: 10 } })
  assert.ok(res.error)
  assert.equal(c.calls.removed.length, 1)
  assert.equal(c.calls.removed[0], c.calls.uploaded[0])

  const bad = await uploadActivityPhoto(c, { userId: 'u', activityId: 'a', blob: { type: 'image/gif', size: 10 } })
  assert.ok(bad.error)
})

test('deleteActivityPhoto removes row then file', async () => {
  const c = storageClient()
  const res = await deleteActivityPhoto(c, { id: 'id1', storage_path: 'u/a/x.jpg' })
  assert.equal(res.error, null)
  assert.deepEqual(c.calls.removed, ['u/a/x.jpg'])
})
