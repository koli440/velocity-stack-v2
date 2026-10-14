import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBackfillDays,
  backfillOldest,
  normalizeIntervalsAthleteId,
  connectionStatusLabel,
  isConnected,
} from '../connections.js'

test('parseBackfillDays defaults, full history and validation', () => {
  assert.deepEqual(parseBackfillDays(undefined), { ok: true, value: 30 })
  assert.deepEqual(parseBackfillDays(null), { ok: true, value: null })
  assert.deepEqual(parseBackfillDays('full'), { ok: true, value: null })
  assert.deepEqual(parseBackfillDays('90'), { ok: true, value: 90 })
  for (const bad of [0, -5, 1.5, 'abc', '', 40000, {}]) assert.equal(parseBackfillDays(bad).ok, false)
})

test('backfillOldest computes the list window', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  assert.equal(backfillOldest(30, now), '2026-09-14')
  assert.equal(backfillOldest(1, now), '2026-10-13')
  assert.equal(backfillOldest(null, now), undefined)
  assert.equal(backfillOldest(undefined, now), '2026-09-14')
})

test('normalizeIntervalsAthleteId', () => {
  assert.equal(normalizeIntervalsAthleteId(' 228280 '), 'i228280')
  assert.equal(normalizeIntervalsAthleteId('i228280'), 'i228280')
  assert.equal(normalizeIntervalsAthleteId(null), '')
})

test('status helpers', () => {
  assert.equal(connectionStatusLabel(null), 'Not connected')
  assert.equal(connectionStatusLabel({ status: 'disconnected' }), 'Not connected')
  assert.equal(connectionStatusLabel({ status: 'error' }), 'Needs attention')
  assert.equal(connectionStatusLabel({ status: 'active' }), 'Connected')
  assert.equal(isConnected({ status: 'error' }), true)
  assert.equal(isConnected({ status: 'disconnected' }), false)
})
