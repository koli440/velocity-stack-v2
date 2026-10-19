import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relativeDateLabel, relativeDateTime, fullDateTime, calendarTileParts } from '../dateFormat.js'

const now = new Date(2026, 9, 19, 12, 0)
const opts = { now, locale: 'en-GB' }

test('relative label: today, yesterday, weekday within a week, else absolute', () => {
  assert.equal(relativeDateLabel(new Date(2026, 9, 19, 7, 30), opts), 'Today')
  assert.equal(relativeDateLabel(new Date(2026, 9, 18, 23, 59), opts), 'Yesterday')
  assert.equal(relativeDateLabel(new Date(2026, 9, 16, 9, 0), opts), 'Friday')
  assert.equal(relativeDateLabel(new Date(2026, 9, 12, 9, 0), opts), '12 Oct 2026')
  assert.equal(relativeDateLabel(new Date(2025, 0, 3), opts), '3 Jan 2025')
})

test('invalid or missing values', () => {
  assert.equal(relativeDateLabel(null, opts), '')
  assert.equal(relativeDateTime('nope', opts), '')
  assert.equal(fullDateTime(undefined, opts), '')
  assert.equal(calendarTileParts('x', opts), null)
})

test('relative date time appends the time', () => {
  assert.equal(relativeDateTime(new Date(2026, 9, 19, 7, 30), opts), 'Today · 07:30')
})

test('full date time and calendar tile', () => {
  const d = new Date(2026, 9, 18, 7, 30)
  assert.match(fullDateTime(d, { locale: 'en-GB' }), /^Sunday,? 18 October 2026 · 07:30$/)
  assert.deepEqual(calendarTileParts(d, { locale: 'en-GB' }), { day: '18', month: 'OCT' })
})
