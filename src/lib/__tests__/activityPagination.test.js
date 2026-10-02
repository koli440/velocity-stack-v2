// Run with: node --test src/lib/__tests__/activityPagination.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchActivitiesPage, DEFAULT_ACTIVITIES_PAGE_SIZE } from '../activityPagination.js'

function createFakeClient(allRows, { error = null } = {}) {
  const calls = { table: null, filters: [], orders: [], range: null }

  return {
    calls,
    from(table) {
      calls.table = table
      return {
        select(columns) {
          calls.select = columns
          return this
        },
        eq(column, value) {
          calls.filters.push([column, value])
          return this
        },
        order(column, opts) {
          calls.orders.push([column, opts])
          return this
        },
        range(from, to) {
          calls.range = [from, to]
          if (error) return Promise.resolve({ data: null, error })
          return Promise.resolve({ data: allRows.slice(from, to + 1), error: null })
        },
      }
    },
  }
}

test('fetchActivitiesPage returns no rows and hasMore=false without a userId', async () => {
  const client = createFakeClient([])
  const result = await fetchActivitiesPage(client, {})

  assert.deepEqual(result, { data: [], hasMore: false, error: null })
  assert.equal(client.calls.table, null)
})

test('fetchActivitiesPage requests the correct range for the first page', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `act-${i}` }))
  const client = createFakeClient(rows)

  const result = await fetchActivitiesPage(client, { userId: 'user-1', page: 0, pageSize: 5 })

  assert.equal(client.calls.table, 'activities')
  assert.deepEqual(client.calls.filters, [['user_id', 'user-1']])
  assert.deepEqual(client.calls.range, [0, 4])
  assert.equal(result.data.length, 5)
  assert.equal(result.error, null)
})

test('fetchActivitiesPage reports hasMore=true when a full page is returned', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `act-${i}` }))
  const client = createFakeClient(rows)

  const result = await fetchActivitiesPage(client, { userId: 'user-1', page: 0, pageSize: 5 })

  assert.equal(result.data.length, 5)
  assert.equal(result.hasMore, true)
})

test('fetchActivitiesPage reports hasMore=false on the final, partial page', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: `act-${i}` }))
  const client = createFakeClient(rows)

  const result = await fetchActivitiesPage(client, { userId: 'user-1', page: 1, pageSize: 5 })

  assert.deepEqual(client.calls.range, [5, 9])
  assert.equal(result.data.length, 2)
  assert.equal(result.hasMore, false)
})

test('fetchActivitiesPage defaults to DEFAULT_ACTIVITIES_PAGE_SIZE', async () => {
  const rows = Array.from({ length: DEFAULT_ACTIVITIES_PAGE_SIZE }, (_, i) => ({ id: `act-${i}` }))
  const client = createFakeClient(rows)

  const result = await fetchActivitiesPage(client, { userId: 'user-1' })

  assert.deepEqual(client.calls.range, [0, DEFAULT_ACTIVITIES_PAGE_SIZE - 1])
  assert.equal(result.hasMore, true)
})

test('fetchActivitiesPage surfaces query errors without throwing', async () => {
  const client = createFakeClient([], { error: new Error('db exploded') })

  const result = await fetchActivitiesPage(client, { userId: 'user-1' })

  assert.deepEqual(result.data, [])
  assert.equal(result.hasMore, false)
  assert.equal(result.error.message, 'db exploded')
})
