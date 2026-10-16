import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiff, validateSuggestionInput, reviewPath, formatValue } from '../suggestions.js'
import { describeNotification } from '../notifications.js'

const targets = [{ entity_type: 'velodrome', allowed_columns: ['name', 'city'] }]

test('buildDiff compares to current row or treats as new', () => {
  const d = buildDiff({ name: 'B', city: 'X' }, { name: 'A', city: 'X' })
  assert.deepEqual(d.map((r) => r.changed), [true, false])
  assert.equal(buildDiff({ name: 'B' }, null)[0].before, null)
})

test('validateSuggestionInput enforces registry and allowed fields', () => {
  assert.ok(validateSuggestionInput({ entity_type: 'nope', payload: { a: 1 } }, targets).error)
  assert.ok(validateSuggestionInput({ entity_type: 'velodrome', payload: {} }, targets).error)
  assert.ok(validateSuggestionInput({ entity_type: 'velodrome', payload: { x: 1 } }, targets).error)
  const ok = validateSuggestionInput({ entity_type: 'velodrome', target_id: 5, payload: { name: 'n' } }, targets)
  assert.equal(ok.value.target_id, '5')
})

test('helpers and notification text', () => {
  assert.equal(reviewPath('abc'), '/admin/suggestions/abc')
  assert.equal(formatValue(null), '—')
  assert.equal(describeNotification({ type: 'suggestion_submitted' }, { username: 'ann' }), 'ann submitted a suggestion for review')
  assert.match(describeNotification({ type: 'suggestion_approved' }, null), /approved/)
  assert.match(describeNotification({ type: 'suggestion_rejected' }, null), /declined/)
})
