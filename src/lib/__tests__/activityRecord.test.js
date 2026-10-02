// Run with: node --test src/lib/__tests__/activityRecord.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildActivityInsert } from '../activityRecord.js'

test('buildActivityInsert passes speed_source through from the summary', () => {
  const derived = buildActivityInsert(
    { speed_source: 'derived_from_cadence' },
    { title: 't', userId: 'u1' }
  )
  assert.equal(derived.speed_source, 'derived_from_cadence')

  const sensor = buildActivityInsert({ speed_source: 'sensor' }, { title: 't', userId: 'u1' })
  assert.equal(sensor.speed_source, 'sensor')
})

test('buildActivityInsert defaults speed_source to null when the summary omits it', () => {
  const result = buildActivityInsert({}, { title: 't', userId: 'u1' })
  assert.equal(result.speed_source, null)
})
