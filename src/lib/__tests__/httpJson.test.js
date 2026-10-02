// Run with: node --test src/lib/__tests__/httpJson.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonResponse } from '../httpJson.js'

function fakeResponse({ status = 200, contentType = 'application/json', body = {} } = {}) {
  return {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null
      },
    },
    async json() {
      return body
    },
  }
}

test('parseJsonResponse returns the parsed body for a JSON response', async () => {
  const res = fakeResponse({ body: { success: true, activities: [] } })
  const data = await parseJsonResponse(res)
  assert.deepEqual(data, { success: true, activities: [] })
})

test('parseJsonResponse throws a friendly error for an HTML error page', async () => {
  const res = fakeResponse({ status: 504, contentType: 'text/html; charset=utf-8' })
  await assert.rejects(() => parseJsonResponse(res), /HTTP 504/)
})

test('parseJsonResponse throws a friendly error when content-type is missing', async () => {
  const res = fakeResponse({ status: 200, contentType: '' })
  await assert.rejects(() => parseJsonResponse(res), /unexpected response/i)
})
