import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBaselines } from '../templateBaselines.js'

const day = (d) => new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString()

test('computeBaselines: previous, all-time and 90-day averages', () => {
  const history = [
    { activity_id: 'a', created_at: day(0), summary: { avg_power: 200 } },
    { activity_id: 'b', created_at: day(150), summary: { avg_power: 300 } },
    { activity_id: 'c', created_at: day(200), summary: { avg_power: 400 } },
    { activity_id: 'cur', created_at: day(210), summary: { avg_power: 999 } },
  ]
  const r = computeBaselines(history, { activityId: 'cur', runAt: day(210) })
  assert.equal(r.previous.activity_id, 'c')
  assert.equal(r.allTime.summary.avg_power, 300)
  assert.equal(r.allTime.count, 3)
  assert.equal(r.last90.summary.avg_power, 350)
  assert.equal(r.last90.count, 2)
})

test('computeBaselines: no history', () => {
  const r = computeBaselines([], { activityId: 'x', runAt: day(1) })
  assert.equal(r.previous, null)
  assert.equal(r.last90.count, 0)
})
