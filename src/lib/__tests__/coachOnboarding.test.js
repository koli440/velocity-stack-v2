import test from 'node:test'
import assert from 'node:assert/strict'
import * as o from '../coachOnboarding.js'

const base = { dob: '1990-05-05', events: [], blackout: [], weekdays: {} }

test('buildAnswers drops empty fields and coerces numbers', () => {
  const a = o.buildAnswers({ ...base, ftp_w: '280', weight_kg: '72.5', height_cm: '', main_goal: ' race ', platforms: 'Garmin, ,Strava',
    events: [{ name: 'Nationals', date: '2027-01-01', priority: 'A' }, { name: '', date: '2027-02-01' }],
    blackout: [{ date: '2027-03-01', note: '' }, { date: '' }], weekdays: { mon: 'short', tue: '' } })
  assert.deepEqual(a.about, { dob: '1990-05-05', weight_kg: 72.5 })
  assert.equal(a.history.ftp_w, 280)
  assert.equal(a.goals.main_goal, 'race')
  assert.deepEqual(a.goals.events, [{ name: 'Nationals', date: '2027-01-01', priority: 'A' }])
  assert.deepEqual(a.availability, { weekdays: { mon: 'short' }, blackout: [{ date: '2027-03-01' }] })
  assert.deepEqual(a.equipment.platforms, ['Garmin', 'Strava'])
  assert.ok(!('height_cm' in a.about))
})

test('answersToForm round-trips buildAnswers', () => {
  const f = { ...base, ftp_w: 280, main_goal: 'race', events: [{ name: 'N', date: '2027-01-01', priority: 'A' }], platforms: 'Garmin, Strava', weekdays: { sat: 'long' } }
  const again = o.buildAnswers(o.answersToForm(o.buildAnswers(f)))
  assert.deepEqual(again, o.buildAnswers(f))
})

test('ageOn and isMinor', () => {
  const today = new Date('2026-11-16T00:00:00Z')
  assert.equal(o.ageOn('2008-11-16', today), 18)
  assert.equal(o.ageOn('2008-11-17', today), 17)
  assert.equal(o.ageOn('nope', today), null)
  assert.equal(o.isMinor('2012-01-01', today), true)
  assert.equal(o.isMinor('1990-01-01', today), false)
})

test('validateForm enforces consent, dob, ranges and health rules', () => {
  assert.match(o.validateForm(base, {}), /consent/i)
  assert.match(o.validateForm({ ...base, dob: '' }, { consent: true }), /birth/i)
  assert.match(o.validateForm({ ...base, ftp_w: 5000 }, { consent: true }), /FTP/)
  assert.match(o.validateForm({ ...base, events: Array(6).fill({ name: 'x' }) }, { consent: true }), /events/)
  assert.match(o.validateForm(base, { consent: true, health: { parq: [] }, healthDeclined: true }), /Health/)
  assert.match(o.validateForm({ ...base, dob: '2015-01-01' }, { consent: true, health: { parq: [] } }), /Health|birth/)
  assert.equal(o.validateForm(base, { consent: true, health: { parq: Array(7).fill(false) } }), null)
})

test('healthFlag and consent hash', async () => {
  assert.equal(o.healthFlag({ parq: [false, true] }), true)
  assert.equal(o.healthFlag(null), false)
  assert.equal(o.PARQ_QUESTIONS.length, 7)
  assert.match(await o.consentHash(), /^[0-9a-f]{64}$/)
  assert.notEqual(await o.consentHash('a'), await o.consentHash('b'))
})
