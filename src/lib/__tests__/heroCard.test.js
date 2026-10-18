import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heroCardContent, summaryMetrics } from '../heroCard.js'

test('activity with power curve gets a profile', () => {
  const c = heroCardContent({ power_curve: { '15s': 900, '5m': 350 } })
  assert.equal(c.kind, 'profile')
  assert.equal(c.data.length, 7)
  assert.equal(c.data[0].power, 900)
  assert.equal(c.data[1].power, null)
})

test('no power data falls back to summary', () => {
  for (const power_curve of [null, undefined, {}, { '15s': 0 }]) {
    const c = heroCardContent({ power_curve, distance_m: 42500, moving_time_s: 4000, avg_speed_kmh: 38.24 })
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
