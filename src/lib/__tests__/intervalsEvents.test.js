import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createIntervalsEventsClient, PushError } from '../server/intervalsEvents.js'

// Mock Intervals.icu: never talks to the real API.
async function withServer(handler, fn) {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null })
      handler(req, res, seen)
    })
  })
  await new Promise((r) => server.listen(0, r))
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
  try {
    await fn(createIntervalsEventsClient({ athleteId: 'i42', apiKey: 'KEY', baseUrl }), seen)
  } finally {
    server.close()
  }
}
const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(obj))
}

test('create / update / delete use the events endpoints with basic auth', async () => {
  await withServer((req, res) => (req.method === 'DELETE' ? (res.writeHead(200), res.end()) : json(res, 200, { id: 77 })), async (c, seen) => {
    assert.equal(await c.create({ name: 'A' }), '77')
    assert.equal(await c.update('77', { name: 'B' }), '77')
    await c.remove('77')
    assert.deepEqual(seen.map((s) => [s.method, s.url]), [
      ['POST', '/api/v1/athlete/i42/events'],
      ['PUT', '/api/v1/athlete/i42/events/77'],
      ['DELETE', '/api/v1/athlete/i42/events/77'],
    ])
    assert.equal(seen[0].auth, `Basic ${Buffer.from('API_KEY:KEY').toString('base64')}`)
    assert.deepEqual(seen[0].body, { name: 'A' })
  })
})

test('findByExternalId only matches our external id', async () => {
  await withServer((req, res) => json(res, 200, [{ id: 1, external_id: 'other' }, { id: 2, external_id: 'velocity-stack:x' }, { id: 3 }]), async (c) => {
    assert.equal(await c.findByExternalId('velocity-stack:x', '2026-12-10', '2026-12-10'), '2')
    assert.equal(await c.findByExternalId('velocity-stack:y', '2026-12-10', '2026-12-10'), null)
  })
})

const codeOf = async (p) => p.then(() => null, (e) => e)

test('error mapping: 401, 403, 404, 422, 429, 500', async () => {
  const table = [[401, 'invalid_key', true], [403, 'forbidden', true], [404, 'not_found', false], [422, 'rejected', false], [429, 'rate_limited', false], [503, 'unavailable', false]]
  for (const [status, code, fatal] of table) {
    await withServer((req, res) => json(res, status, { message: 'nope' }, status === 429 ? { 'Retry-After': '30' } : {}), async (c) => {
      const e = await codeOf(c.create({ name: 'x' }))
      assert.ok(e instanceof PushError, `${status}`)
      assert.equal(e.code, code)
      assert.equal(e.fatal, fatal)
      assert.ok(!e.message.includes('KEY'))
      if (status === 429) assert.equal(e.retryAfterSec, 30)
    })
  }
})

test('unreachable server', async () => {
  const c = createIntervalsEventsClient({ athleteId: 'i1', apiKey: 'KEY', baseUrl: 'http://127.0.0.1:1/api/v1' })
  const e = await codeOf(c.create({}))
  assert.equal(e.code, 'unreachable')
})

test('remove treats 404 as already deleted; get returns null on 404', async () => {
  await withServer((req, res) => json(res, 404, {}), async (c) => {
    await c.remove('5')
    assert.equal(await c.get('5'), null)
  })
})
