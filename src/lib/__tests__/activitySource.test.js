import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importSourceKey, sourceBadgeLabel } from '../activitySource.js'
import { isGenericActivityName } from '../activityNaming.js'
import { parseJsonUpload } from '../partnerUpload.js'
import { SHARED_FEED_COLUMNS, FEED_ACTIVITY_COLUMNS } from '../activityPagination.js'

test('source badge labels', () => {
  assert.equal(sourceBadgeLabel({ source: 'garmin' }), 'Garmin')
  assert.equal(sourceBadgeLabel({ source: 'manual' }), null)
  assert.equal(sourceBadgeLabel({ source: 'partner', external_source: 'partner:pedal-mania' }, { 'pedal-mania': 'Pedal Mania' }), 'Pedal Mania')
  assert.equal(sourceBadgeLabel({ import_source: 'partner:pedal-mania' }), 'Pedal Mania')
  assert.equal(importSourceKey({ source: 'partner', external_source: 'partner:x' }), 'partner:x')
  assert.equal(sourceBadgeLabel(null), null)
})

test('the partner fallback title is generic so naming replaces it', () => {
  assert.ok(isGenericActivityName('APP SYNC'))
  assert.ok(!isGenericActivityName('Pedal Mania test ride'))
})

test('feed columns carry the source', () => {
  assert.ok(FEED_ACTIVITY_COLUMNS.includes('external_source'))
  assert.ok(SHARED_FEED_COLUMNS.split(', ').includes('import_source'))
  assert.ok(!SHARED_FEED_COLUMNS.includes('external_source'))
})

test('partner JSON accepts name as an alias of title', () => {
  const streams = { power: Array.from({ length: 60 }, () => 150) }
  const base = { external_id: 'x', start_time: '2026-11-04T07:30:00Z', streams }
  assert.equal(parseJsonUpload({ ...base, name: 'Pedal Mania test ride' }).title, 'Pedal Mania test ride')
  assert.equal(parseJsonUpload({ ...base, title: 'T', name: 'N' }).title, 'T')
})
