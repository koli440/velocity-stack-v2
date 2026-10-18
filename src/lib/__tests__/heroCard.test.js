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
