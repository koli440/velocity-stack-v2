// Run with: node --test src/lib/__tests__/activityActions.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteActivity } from '../activityActions.js'

function createFakeClient({ storageError = null, deleteError = null } = {}) {
  const calls = { removedPaths: null, deletedActivityId: null }

  return {
    calls,
    storage: {
      from(bucket) {
        assert.equal(bucket, 'raw-activity-files')
        return {
          async remove(paths) {
            calls.removedPaths = paths
            return { error: storageError }
          },
        }
      },
    },
    from(table) {
      assert.equal(table, 'activities')
      return {
        delete() {
          return {
            eq(column, value) {
              assert.equal(column, 'id')
              calls.deletedActivityId = value
              return Promise.resolve({ error: deleteError })
            },
          }
        },
      }
    },
  }
}

test('deleteActivity removes the archived raw file and the activity row', async () => {
  const client = createFakeClient()
  const { error } = await deleteActivity(client, { id: 'act-1', raw_file_url: 'user-1/foo.fit' })

  assert.equal(error, null)
  assert.deepEqual(client.calls.removedPaths, ['user-1/foo.fit'])
  assert.equal(client.calls.deletedActivityId, 'act-1')
})

test('deleteActivity skips storage removal when there is no archived raw file', async () => {
  const client = createFakeClient()
  const { error } = await deleteActivity(client, { id: 'act-2' })

  assert.equal(error, null)
  assert.equal(client.calls.removedPaths, null)
  assert.equal(client.calls.deletedActivityId, 'act-2')
})

test('deleteActivity still deletes the activity row when storage removal fails', async () => {
  const client = createFakeClient({ storageError: new Error('storage down') })
  const { error } = await deleteActivity(client, { id: 'act-3', raw_file_url: 'user-1/bar.fit' })

  assert.equal(error, null)
  assert.equal(client.calls.deletedActivityId, 'act-3')
})

test('deleteActivity returns the database error when deletion fails', async () => {
  const client = createFakeClient({ deleteError: new Error('db exploded') })
  const { error } = await deleteActivity(client, { id: 'act-4' })

  assert.ok(error)
  assert.equal(error.message, 'db exploded')
})

test('deleteActivity rejects a missing activity id without calling the client', async () => {
  const client = createFakeClient()
  const { error } = await deleteActivity(client, {})

  assert.ok(error)
  assert.equal(client.calls.deletedActivityId, null)
})
