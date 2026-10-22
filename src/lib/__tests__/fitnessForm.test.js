// Run with: TZ=Europe/Prague node --test src/lib/__tests__/fitnessForm.test.js
process.env.TZ = 'Europe/Prague'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activityLoad,
  dailyLoads,
  computeSeries,
  rampRate,
  rampLevel,
  isBuildingBaseline,
  formStatus,
  estimateShare,
  fitnessSummary,
  fetchFitnessActivities,
  localDayKey,
  addDays,
} from '../fitnessForm.js'

const near = (a, b, eps = 0.051) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`)
const ride = (date, extra = {}) => ({ activity_date: date, training_load: 60, ...extra })

test('day keys are local and day arithmetic survives DST', () => {
  assert.equal(localDayKey(new Date(2026, 9, 18, 23, 59)), '2026-10-18')
  assert.equal(localDayKey('garbage'), '')
  assert.equal(addDays('2026-10-24', 2), '2026-10-26')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('stored training_load is used as-is and not flagged as estimate', () => {
  assert.deepEqual(activityLoad(ride('2026-10-01T08:00:00Z', { avg_hr: 150, lt2_hr_at_activity: 170 })), { load: 60, estimated: false })
  assert.deepEqual(activityLoad(ride('2026-10-01T08:00:00Z', { training_load: 0 })), { load: 0, estimated: false })
})

test('HR estimate: 1h at LTHR = 100, 2h at 0.8*LTHR = 128; flagged as estimated', () => {
  const base = { activity_date: '2026-10-01T08:00:00Z', training_load: null }
  assert.deepEqual(activityLoad({ ...base, moving_time_s: 3600, avg_hr: 170, lt2_hr_at_activity: 170 }), { load: 100, estimated: true })
  assert.deepEqual(activityLoad({ ...base, moving_time_s: 7200, avg_hr: 136, lt2_hr_at_activity: 170 }), { load: 128, estimated: true })
})

test('HR estimate uses the threshold valid on the ride date and caps intensity', () => {
  const hist = [
    { effective_from: '2026-01-01', lt2_hr: 160 },
    { effective_from: '2026-09-01', lt2_hr: 180 },
  ]
  const a = { activity_date: '2026-10-01T08:00:00Z', moving_time_s: 3600, avg_hr: 180 }
  assert.equal(activityLoad(a, hist).load, 100)
  assert.equal(activityLoad({ ...a, avg_hr: 200, activity_date: '2026-06-01T08:00:00Z' }, hist).load, 132.2) // capped at 1.15^2
})

test('rides that cannot be scored are skipped, never guessed', () => {
  const base = { activity_date: '2026-10-01T08:00:00Z', moving_time_s: 3600 }
  assert.equal(activityLoad({ ...base, avg_hr: 150 }, []), null) // no threshold HR
  assert.equal(activityLoad({ ...base, lt2_hr_at_activity: 170 }, []), null) // no HR
  assert.equal(activityLoad({ ...base, avg_hr: 150, lt2_hr_at_activity: 170, moving_time_s: 60 }), null) // too short
  assert.equal(activityLoad({ ...base, avg_hr: 20, lt2_hr_at_activity: 170 }), null) // implausible HR
})

test('daily totals merge rides of one local day and track estimates', () => {
  const { days, skipped } = dailyLoads(
    [
      ride('2026-10-01T06:00:00Z'),
      ride('2026-10-01T15:00:00Z', { training_load: null, moving_time_s: 3600, avg_hr: 170, lt2_hr_at_activity: 170 }),
      ride('2026-10-03T06:00:00Z', { training_load: null }),
      ride('nope'),
    ]
  )
  assert.deepEqual(days['2026-10-01'], { load: 160, estimatedLoad: 100, rides: 2, estimatedRides: 1 })
  assert.equal(Object.keys(days).length, 1)
  assert.equal(skipped, 1)
})

test('a ride at 23:30 local belongs to its local day, not the UTC day', () => {
  const { days } = dailyLoads([ride(new Date(2026, 9, 1, 23, 30).toISOString())])
  assert.deepEqual(Object.keys(days), ['2026-10-01'])
})

test('hand-computed series: first day, rest days, gap (tau 42 / 7)', () => {
  // Day 1: 100, day 2: rest, day 3: 50.
  const days = { '2026-10-01': { load: 100, estimatedLoad: 0 }, '2026-10-03': { load: 50, estimatedLoad: 20 } }
  const s = computeSeries(days, { endDay: '2026-10-04' })
  assert.equal(s.length, 4)
  // day 1: form is previous (0-0); ctl = 100/42, atl = 100/7
  assert.deepEqual([s[0].fitness, s[0].fatigue, s[0].form], [2.4, 14.3, 0])
  // day 2: form = 2.381-14.286 = -11.9; ctl = 2.381*41/42 = 2.324, atl = 14.286*6/7 = 12.245
  assert.deepEqual([s[1].fitness, s[1].fatigue, s[1].form, s[1].load], [2.3, 12.2, -11.9, 0])
  // day 3: form = 2.324-12.245 = -9.9; ctl = 2.324+(50-2.324)/42 = 3.459; atl = 12.245+(50-12.245)/7 = 17.639
  assert.deepEqual([s[2].fitness, s[2].fatigue, s[2].form, s[2].estimatedLoad], [3.5, 17.6, -9.9, 20])
  // day 4: form = 3.459-17.639 = -14.2
  assert.equal(s[3].form, -14.2)
})

test('series can be trimmed to a start day while the averages keep the earlier history', () => {
  const days = { '2026-09-01': { load: 100, estimatedLoad: 0 } }
  const full = computeSeries(days, { endDay: '2026-09-10' })
  const trimmed = computeSeries(days, { startDay: '2026-09-09', endDay: '2026-09-10' })
  assert.equal(trimmed.length, 2)
  assert.deepEqual(trimmed, full.slice(-2))
})

test('constant daily load converges towards that load', () => {
  const days = {}
  for (let i = 0; i < 300; i++) days[addDays('2026-01-01', i)] = { load: 80, estimatedLoad: 0 }
  const s = computeSeries(days, { endDay: addDays('2026-01-01', 299) })
  near(s[299].fitness, 80, 0.2)
  near(s[299].fatigue, 80, 0.01)
})

test('empty data gives an empty series and summary', () => {
  assert.deepEqual(computeSeries({}, { endDay: '2026-10-01' }), [])
  assert.deepEqual(fitnessSummary({}, '2026-10-01'), { empty: true, series: [] })
})

test('ramp rate = fitness change over 7 days; levels', () => {
  const series = Array.from({ length: 10 }, (_, i) => ({ fitness: i * 1.5 }))
  assert.equal(rampRate(series), 10.5)
  assert.equal(rampRate(series.slice(0, 7)), null)
  assert.equal(rampLevel(10.5), 'warning')
  assert.equal(rampLevel(8), 'high')
  assert.equal(rampLevel(5), 'high')
  assert.equal(rampLevel(4.9), null)
  assert.equal(rampLevel(-3), null)
  assert.equal(rampLevel(null), null)
})

test('baseline flag: under 42 days of data', () => {
  assert.equal(isBuildingBaseline('2026-09-01', '2026-10-12'), true) // 41 days
  assert.equal(isBuildingBaseline('2026-09-01', '2026-10-13'), false) // 42 days
  assert.equal(isBuildingBaseline(null, '2026-10-13'), false)
})

test('form labels at the boundaries', () => {
  assert.equal(formStatus(26).key, 'detraining')
  assert.equal(formStatus(25).key, 'fresh')
  assert.equal(formStatus(5).key, 'neutral')
  assert.equal(formStatus(-10).key, 'neutral')
  assert.equal(formStatus(-10.1).key, 'productive')
  assert.equal(formStatus(-30).key, 'productive')
  assert.equal(formStatus(-31).key, 'overreaching')
  assert.equal(formStatus(null).key, 'unknown')
})

test('estimate share is load-weighted', () => {
  assert.equal(estimateShare([{ load: 100, estimatedLoad: 25 }, { load: 100, estimatedLoad: 25 }]), 0.25)
  assert.equal(estimateShare([{ load: 0, estimatedLoad: 0 }]), null)
})

test('summary reports current values, baseline and estimate share', () => {
  const days = { '2026-10-01': { load: 100, estimatedLoad: 100 }, '2026-10-02': { load: 100, estimatedLoad: 0 } }
  const sum = fitnessSummary(days, '2026-10-02')
  assert.equal(sum.empty, false)
  assert.equal(sum.building, true)
  assert.equal(sum.estimateShare, 0.5)
  assert.equal(sum.fitness, sum.series[1].fitness)
  assert.equal(sum.status.key, formStatus(sum.form).key)
  assert.equal(fitnessSummary(days, '2026-12-31', '2026-01-01').building, false)
})

test('fetch pages past the row cap, filters by owner and reads the first day', async () => {
  const calls = []
  const all = Array.from({ length: 2500 }, (_, i) => ({ id: i, activity_date: '2026-10-01T08:00:00Z' }))
  const client = {
    from(table) {
      const q = { table, filters: {} }
      const b = {
        select: () => b,
        eq: (c, v) => ((q.filters[c] = v), b),
        gte: () => b,
        order: () => b,
        limit: (n) => ((q.limit = n), b),
        range: (a, z) => ((q.range = [a, z]), b),
        then: (res) => {
          calls.push(q)
          if (q.limit) return res({ data: [{ activity_date: '2025-01-05T08:00:00Z' }], error: null })
          return res({ data: all.slice(q.range[0], q.range[1] + 1), error: null })
        },
      }
      return b
    },
  }
  const r = await fetchFitnessActivities(client, { userId: 'u1', now: new Date(2026, 9, 20) })
  assert.equal(r.data.length, 2500)
  assert.equal(r.firstDay, '2025-01-05')
  assert.equal(calls.length, 4) // 3 pages + first-day lookup
  assert.ok(calls.every((c) => c.filters.user_id === 'u1'))
  assert.deepEqual(await fetchFitnessActivities(client, { userId: '' }), { data: [], firstDay: null, error: null })
})
