// Run with: node --test src/lib/__tests__/baselineCurves.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BASELINE_PERIODS,
  resolvePeriodRange,
  computeBaselineCurves,
} from '../baselineCurves.js'

const NOW = new Date('2026-10-02T12:00:00.000Z')

test('resolvePeriodRange: 30d / 90d / rolling_year are relative to "now"', () => {
  const r30 = resolvePeriodRange(BASELINE_PERIODS.LAST_30_DAYS, { now: NOW })
  assert.equal(r30.end.toISOString(), NOW.toISOString())
  assert.equal(r30.start.toISOString(), '2026-09-02T12:00:00.000Z')

  const r90 = resolvePeriodRange(BASELINE_PERIODS.LAST_90_DAYS, { now: NOW })
  assert.equal(r90.start.toISOString(), '2026-07-04T12:00:00.000Z')

  const rYear = resolvePeriodRange(BASELINE_PERIODS.ROLLING_YEAR, { now: NOW })
  assert.equal(rYear.start.toISOString(), '2025-10-02T12:00:00.000Z')
})

test('resolvePeriodRange: calendar_year starts Jan 1st of the current year', () => {
  const { start, end } = resolvePeriodRange(BASELINE_PERIODS.CALENDAR_YEAR, { now: NOW })
  assert.equal(start.toISOString(), '2026-01-01T00:00:00.000Z')
  assert.equal(end.toISOString(), NOW.toISOString())
})

test('resolvePeriodRange: custom requires both start and end dates', () => {
  assert.throws(() => resolvePeriodRange(BASELINE_PERIODS.CUSTOM, { now: NOW }), /customStart/)
  assert.throws(
    () => resolvePeriodRange(BASELINE_PERIODS.CUSTOM, { now: NOW, customStart: '2026-01-01' }),
    /customEnd/
  )
  const { start, end } = resolvePeriodRange(BASELINE_PERIODS.CUSTOM, {
    now: NOW,
    customStart: '2026-01-01',
    customEnd: '2026-02-01',
  })
  assert.equal(start.toISOString(), '2026-01-01T00:00:00.000Z')
  assert.equal(end.toISOString(), '2026-02-01T00:00:00.000Z')
})

test('resolvePeriodRange: unknown period throws', () => {
  assert.throws(() => resolvePeriodRange('not-a-period'), /Unknown baseline period/)
})

test('computeBaselineCurves: picks the max value per metric/duration and attributes it', () => {
  const activities = [
    {
      id: 'act-1',
      title: 'Morning Ride',
      activity_date: '2026-09-20T08:00:00.000Z',
      curves: { Power: { '5s': 600, '1m': 350 } },
    },
    {
      id: 'act-2',
      title: 'Track Session',
      activity_date: '2026-09-25T08:00:00.000Z',
      curves: { Power: { '5s': 720, '1m': 300 } },
    },
  ]

  const result = computeBaselineCurves(activities, {
    period: BASELINE_PERIODS.LAST_30_DAYS,
    now: NOW,
  })

  assert.equal(result.period, BASELINE_PERIODS.LAST_30_DAYS)
  assert.equal(result.curves.Power['5s'].value, 720)
  assert.equal(result.curves.Power['5s'].activityId, 'act-2')
  assert.equal(result.curves.Power['5s'].activityTitle, 'Track Session')
  assert.equal(result.curves.Power['1m'].value, 350)
  assert.equal(result.curves.Power['1m'].activityId, 'act-1')
})

test('computeBaselineCurves: excludes activities outside the period', () => {
  const activities = [
    {
      id: 'old',
      title: 'Last Year',
      activity_date: '2025-01-01T00:00:00.000Z',
      curves: { Power: { '5s': 999 } },
    },
    {
      id: 'recent',
      title: 'Recent Ride',
      activity_date: '2026-09-28T00:00:00.000Z',
      curves: { Power: { '5s': 500 } },
    },
  ]

  const result = computeBaselineCurves(activities, {
    period: BASELINE_PERIODS.LAST_30_DAYS,
    now: NOW,
  })

  assert.equal(result.curves.Power['5s'].value, 500)
  assert.equal(result.curves.Power['5s'].activityId, 'recent')
})

test('computeBaselineCurves: duration buckets are only populated when an activity reported them (no imputation to a max duration)', () => {
  const activities = [
    {
      id: 'short-ride',
      title: 'Short Sprint Session',
      activity_date: '2026-09-29T00:00:00.000Z',
      curves: { Power: { '5s': 800 } }, // no 1h bucket at all
    },
  ]

  const result = computeBaselineCurves(activities, {
    period: BASELINE_PERIODS.LAST_30_DAYS,
    now: NOW,
  })

  assert.equal(result.curves.Power['5s'].value, 800)
  assert.equal(result.curves.Power['1h'], undefined)
})

test('computeBaselineCurves: ignores activities with missing/invalid dates or curve data', () => {
  const activities = [
    { id: 'no-date', title: 'Broken', curves: { Power: { '5s': 900 } } },
    { id: 'bad-date', title: 'Broken2', activity_date: 'not-a-date', curves: { Power: { '5s': 900 } } },
    { id: 'no-curves', title: 'Broken3', activity_date: '2026-09-29T00:00:00.000Z' },
    null,
    undefined,
  ]

  const result = computeBaselineCurves(activities, {
    period: BASELINE_PERIODS.LAST_30_DAYS,
    now: NOW,
  })

  assert.deepEqual(result.curves, {})
})

test('computeBaselineCurves: supports a custom day-picker range', () => {
  const activities = [
    {
      id: 'in-range',
      title: 'In Range',
      activity_date: '2026-06-15T00:00:00.000Z',
      curves: { Speed: { '1m': 45 } },
    },
    {
      id: 'out-of-range',
      title: 'Out of Range',
      activity_date: '2026-07-15T00:00:00.000Z',
      curves: { Speed: { '1m': 60 } },
    },
  ]

  const result = computeBaselineCurves(activities, {
    period: BASELINE_PERIODS.CUSTOM,
    customStart: '2026-06-01T00:00:00.000Z',
    customEnd: '2026-06-30T00:00:00.000Z',
  })

  assert.equal(result.curves.Speed['1m'].value, 45)
  assert.equal(result.curves.Speed['1m'].activityId, 'in-range')
})
