import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heroCardContent, summaryMetrics } from '../heroCard.js'

test('activity with a power preview gets a power-over-time series', () => {
  const c = heroCardContent({ power_preview: { kind: 'power', step_s: 60, values: [150, 300, 250] } })
  assert.equal(c.kind, 'power')
  assert.deepEqual(c.data.map((d) => [d.t, d.power]), [[0, 150], [60, 300], [120, 250]])
})

test('no power data falls back to summary', () => {
  for (const power_preview of [null, undefined, {}, { kind: 'none' }]) {
    const c = heroCardContent({ power_preview, distance_m: 42500, moving_time_s: 4000, avg_speed_kmh: 38.24 })
    assert.equal(c.kind, 'summary')
    assert.deepEqual(c.items.map((i) => [i.key, i.value, i.unit]), [
      ['distance', '42.5', 'km'], ['time', '1:06:40', 'time'], ['speed', '38.2', 'km/h'],
    ])
  }
})

test('summary omits missing metrics', () => {
  assert.deepEqual(summaryMetrics({ distance_m: 1000 }).map((i) => i.key), ['distance'])
  assert.deepEqual(summaryMetrics({}), [])
})

import { gymSummaryMetrics } from '../heroCard.js'

const row = (exercise_id, reps, weight_kg, set_type = 'active') => ({ exercise_id, reps, weight_kg, set_type })

test('gym activity gets full tile summary', () => {
  const act = { activity_type: 'gym', moving_time_s: 3725, calories: 310.4, avg_hr: 121.6 }
  const sets = [row('a', 10, 50), row('a', 8, 60), row('b', 12, 20), row('b', null, null, 'rest')]
  const c = heroCardContent(act, sets)
  assert.equal(c.kind, 'gym')
  assert.deepEqual(c.items.map((i) => [i.key, i.value, i.unit]), [
    ['time', '1:02:05', 'time'],
    ['exercises', '2', 'exercises'],
    ['sets', '3', 'sets'],
    ['volume', '1220', 'kg'],
    ['kcal', '310', 'kcal'],
    ['hr', '122', 'bpm avg'],
  ])
})

test('gym volume switches to tonnes from 10000 kg', () => {
  const m = gymSummaryMetrics({}, [row('a', 100, 100), row('a', 10, 50)])
  assert.deepEqual(m.find((i) => i.key === 'volume'), { key: 'volume', icon: 'trend', value: '10.5', unit: 't' })
})

test('gym partial data hides empty tiles; bodyweight sets add no volume', () => {
  const m = gymSummaryMetrics({ moving_time_s: 600 }, [row('a', 15, null), row('a', 15, 0)])
  assert.deepEqual(m.map((i) => i.key), ['time', 'exercises', 'sets'])
})

test('gym without any data yields no tiles', () => {
  assert.deepEqual(gymSummaryMetrics({ activity_type: 'gym' }, undefined), [])
  assert.deepEqual(heroCardContent({ activity_type: 'gym' }, []).items, [])
})

test('gym activity-level stats only when sets are unreadable', () => {
  const m = gymSummaryMetrics({ moving_time_s: 1800, calories: 200 }, null)
  assert.deepEqual(m.map((i) => i.key), ['time', 'kcal'])
})
