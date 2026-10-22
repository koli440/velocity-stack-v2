import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeReturnTo, withReturnTo, currentReturnTo, returnLabel, resolveBack } from '../returnTo.js'
import { monthParam, parseMonthParam } from '../calendar.js'

test('sanitizeReturnTo accepts same-origin relative paths only', () => {
  assert.equal(sanitizeReturnTo('/calendar?month=2027-01'), '/calendar?month=2027-01')
  assert.equal(sanitizeReturnTo('/coach/abc/calendar'), '/coach/abc/calendar')
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', 'calendar', '', null, undefined, 42, '/a\nb', '/'.padEnd(600, 'a')]) {
    assert.equal(sanitizeReturnTo(bad), null, String(bad))
  }
})

test('sanitizeReturnTo refuses to loop back onto an activity page', () => {
  assert.equal(sanitizeReturnTo('/activities/1'), null)
  assert.equal(sanitizeReturnTo('/coach/abc/activities/1?x=1'), null)
  assert.equal(sanitizeReturnTo('/coach/abc/activities'), '/coach/abc/activities')
})

test('withReturnTo only touches activity hrefs and keeps the hash', () => {
  assert.equal(withReturnTo('/activities/1', '/calendar?month=2027-01'), '/activities/1?returnTo=%2Fcalendar%3Fmonth%3D2027-01')
  assert.equal(withReturnTo('/activities/1#comments', '/'), '/activities/1?returnTo=%2F#comments')
  assert.equal(withReturnTo('/coach/r/activities/1', '/coach/r/calendar'), '/coach/r/activities/1?returnTo=%2Fcoach%2Fr%2Fcalendar')
  assert.equal(withReturnTo('/riders/1', '/calendar'), '/riders/1')
  assert.equal(withReturnTo('/activities/1', '//evil.com'), '/activities/1')
  assert.equal(withReturnTo('/activities/1', null), '/activities/1')
})

test('currentReturnTo joins path and query', () => {
  assert.equal(currentReturnTo('/calendar', 'month=2027-01'), '/calendar?month=2027-01')
  assert.equal(currentReturnTo('/', ''), '/')
  assert.equal(currentReturnTo(null), null)
})

test('returnLabel maps origins', () => {
  assert.equal(returnLabel('/'), 'Rider telemetry')
  assert.equal(returnLabel('/calendar?month=2027-01'), 'Calendar')
  assert.equal(returnLabel('/coach/abc/calendar'), 'Calendar')
  assert.equal(returnLabel('/coach/abc'), 'Athlete overview')
  assert.equal(returnLabel('/gears'), 'Gear Architect')
  assert.equal(returnLabel('/pb-vault'), 'PB Vault')
  assert.equal(returnLabel('/riders/xyz'), 'Rider profile')
  assert.equal(returnLabel('/unknown'), null)
  assert.equal(returnLabel('//evil.com'), null)
})

test('resolveBack uses the origin or falls back', () => {
  const fb = { fallbackHref: '/', fallbackLabel: '← Cockpit Telemetry' }
  assert.deepEqual(resolveBack({ search: 'returnTo=%2Fcalendar%3Fmonth%3D2027-01', ...fb }), { href: '/calendar?month=2027-01', label: 'Back to Calendar', fromOrigin: true })
  assert.deepEqual(resolveBack({ search: '', ...fb }), { href: '/', label: '← Cockpit Telemetry', fromOrigin: false })
  assert.equal(resolveBack({ search: 'returnTo=https%3A%2F%2Fevil.com', ...fb }).fromOrigin, false)
  assert.equal(resolveBack({ search: 'returnTo=%2Fx', ...fb }).label, 'Back')
})

test('resolveBack keeps athlete context', () => {
  const fb = { riderId: 'r1', fallbackHref: '/coach/r1/activities', fallbackLabel: '← Activities' }
  assert.equal(resolveBack({ search: 'returnTo=%2Fcoach%2Fr1%2Fcalendar%3Fmonth%3D2027-01', ...fb }).href, '/coach/r1/calendar?month=2027-01')
  assert.equal(resolveBack({ search: 'returnTo=%2Fcalendar', ...fb }).href, '/coach/r1/activities')
  assert.equal(resolveBack({ search: 'returnTo=%2Fcoach%2Fr2%2Fcalendar', ...fb }).href, '/coach/r1/activities')
  assert.equal(resolveBack({ search: 'returnTo=%2Fcoach%2Fr1', ...fb }).label, 'Back to Athlete overview')
})

test('month param round trip', () => {
  assert.equal(monthParam(new Date(2027, 0, 15)), '2027-01')
  assert.deepEqual(parseMonthParam('2027-01'), new Date(2027, 0, 1))
  assert.equal(parseMonthParam('2027-13'), null)
  assert.equal(parseMonthParam('x'), null)
})
