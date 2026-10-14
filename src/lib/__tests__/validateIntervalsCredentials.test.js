import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateIntervalsCredentials } from '../server/intervalsProvider.js'

const ok = (status) => async () => ({ ok: status < 400, status })

test('accepts valid credentials', async () => {
  await validateIntervalsCredentials({ athleteId: 'i1', apiKey: 'k', fetchImpl: ok(200) })
})
test('rejects bad credentials with 400', async () => {
  await assert.rejects(
    () => validateIntervalsCredentials({ athleteId: 'i1', apiKey: 'k', fetchImpl: ok(401) }),
    (e) => e.status === 400
  )
})
test('maps upstream failure to 502', async () => {
  await assert.rejects(
    () => validateIntervalsCredentials({ athleteId: 'i1', apiKey: 'k', fetchImpl: ok(500) }),
    (e) => e.status === 502
  )
  await assert.rejects(
    () => validateIntervalsCredentials({ athleteId: 'i1', apiKey: 'k', fetchImpl: async () => { throw new Error('x') } }),
    (e) => e.status === 502
  )
})
test('requires both fields', async () => {
  await assert.rejects(() => validateIntervalsCredentials({ athleteId: '', apiKey: 'k' }), (e) => e.status === 400)
})
