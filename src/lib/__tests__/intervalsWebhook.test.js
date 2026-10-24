import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAuthorizedWebhook, parseIntervalsEvents, athleteIdVariants, isOwnCalendarEcho, scopeLost } from '../intervalsWebhook.js'

test('authorization: body secret or header', () => {
  assert.equal(isAuthorizedWebhook({ bodySecret: 's3', authorization: null }, 's3'), true)
  assert.equal(isAuthorizedWebhook({ bodySecret: undefined, authorization: 's3' }, 's3'), true)
  assert.equal(isAuthorizedWebhook({ bodySecret: undefined, authorization: 'Bearer s3' }, 's3'), true)
  assert.equal(isAuthorizedWebhook({ bodySecret: 'x', authorization: 'y' }, 's3'), false)
  assert.equal(isAuthorizedWebhook({}, 's3'), false)
  assert.equal(isAuthorizedWebhook({ bodySecret: 's3' }, ''), false)
})

test('parseIntervalsEvents', () => {
  assert.deepEqual(parseIntervalsEvents(null), [])
  assert.deepEqual(parseIntervalsEvents({ events: 'x' }), [])
  const out = parseIntervalsEvents({ events: [{ athlete_id: 123, type: 'ACTIVITY_UPLOADED' }, { type: 'X' }, null] })
  assert.deepEqual(out, [{ athlete_id: '123', type: 'ACTIVITY_UPLOADED' }])
})

test('athleteIdVariants', () => {
  assert.deepEqual(athleteIdVariants('228280').sort(), ['228280', 'i228280'])
  assert.deepEqual(athleteIdVariants('i228280').sort(), ['228280', 'i228280'])
})

test('calendar echo detection', () => {
  assert.equal(isOwnCalendarEcho({ events: [{ external_id: 'velocity-stack:1' }], deleted_events: [] }), true)
  assert.equal(isOwnCalendarEcho({ events: [{ external_id: 'velocity-stack:1' }], deleted_events: [5] }), false)
  assert.equal(isOwnCalendarEcho({ events: [{ external_id: 'other' }] }), false)
  assert.equal(isOwnCalendarEcho({ events: [] }), false)
})

test('scopeLost', () => {
  assert.equal(scopeLost({}), true)
  assert.equal(scopeLost({ scope: 'ACTIVITY:READ,CALENDAR:WRITE' }), false)
  assert.equal(scopeLost({ scope: 'CALENDAR:WRITE' }), true)
  assert.equal(scopeLost({ scopes: ['ACTIVITY:READ'] }), false)
})
