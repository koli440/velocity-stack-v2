// Run with: node --test src/lib/__tests__/supabaseServer.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noStoreFetch } from '../noStoreFetch.js'

test('noStoreFetch forces cache: no-store and keeps other init', async () => {
  const orig = globalThis.fetch
  let seen
  globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response('{}') }
  try {
    await noStoreFetch('http://x/y', { method: 'GET', headers: { a: 'b' }, cache: 'force-cache' })
    assert.equal(seen.url, 'http://x/y')
    assert.equal(seen.init.cache, 'no-store')
    assert.equal(seen.init.method, 'GET')
    assert.deepEqual(seen.init.headers, { a: 'b' })
  } finally {
    globalThis.fetch = orig
  }
})
