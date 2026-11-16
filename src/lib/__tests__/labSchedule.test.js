import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDue, upcomingDates, validateScheduleForm, buildTimeline } from '../labSchedule.js'

test('nextDue steps by interval and respects end', () => {
  const s = { start: '2027-01-04', weeks: 8 }
  assert.equal(nextDue({ ...s, from: '2026-12-01' }), '2027-01-04')
  assert.equal(nextDue({ ...s, from: '2027-01-04' }), '2027-01-04')
  assert.equal(nextDue({ ...s, from: '2027-01-05' }), '2027-03-01')
  assert.equal(nextDue({ ...s, from: '2027-03-01' }), '2027-03-01')
  assert.equal(nextDue({ ...s, end: '2027-02-01', from: '2027-01-05' }), null)
})

test('upcomingDates lists following dates', () => {
  const d = upcomingDates({ start_date: '2027-01-04', interval_weeks: 4, end_date: '2027-03-10' }, '2027-01-05', 5)
  assert.deepEqual(d, ['2027-02-01', '2027-03-01'])
})

test('validateScheduleForm', () => {
  assert.ok(validateScheduleForm({ protocol: 'ftp_20', weeks: 0, start: '2027-01-01' }).error)
  assert.ok(validateScheduleForm({ protocol: 'ftp_20', weeks: 8, start: 'x' }).error)
  assert.ok(validateScheduleForm({ protocol: 'ftp_20', weeks: 8, start: '2027-01-02', end: '2027-01-01' }).error)
  assert.equal(validateScheduleForm({ athleteId: 'a', protocol: 'ftp_20', weeks: '8', start: '2027-01-01' }).args.p_weeks, 8)
})

test('buildTimeline computes FTP deltas and skips cancelled', () => {
  const t = buildTimeline([
    { id: 2, planned_date: '2027-03-01', protocol: 'ftp_20', status: 'applied', result: { ftp: 290 }, applied: { ftp: 290 } },
    { id: 1, planned_date: '2027-01-01', protocol: 'ftp_20', status: 'completed', result: { ftp: 280 } },
    { id: 3, planned_date: '2027-02-01', protocol: 'ftp_20', status: 'cancelled' },
    { id: 4, planned_date: '2027-05-01', protocol: 'ftp_20', status: 'planned' },
  ])
  assert.deepEqual(t.map((r) => [r.id, r.delta]), [[1, null], [2, 10], [4, null]])
})
