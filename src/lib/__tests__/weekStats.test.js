// Run with: TZ=Europe/Prague node --test src/lib/__tests__/weekStats.test.js
process.env.TZ = 'Europe/Prague'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekBounds, weekTotals, sumActivities } from '../weekStats.js'

const act = (date, extra = {}) => ({ activity_date: date, distance_m: 10000, moving_time_s: 1800, training_load: 50, ...extra })

test('Sunday night belongs to the week ending, Monday morning starts the next', () => {
  const sun = weekBounds(new Date(2026, 9, 18, 23, 59))
  assert.equal(sun.start.getDate(), 12)
  assert.equal(sun.end.getDate(), 19)
  const mon = weekBounds(new Date(2026, 9, 19, 0, 0))
  assert.equal(mon.start.getDate(), 19)
  const acts = [act(new Date(2026, 9, 18, 23, 59).toISOString()), act(new Date(2026, 9, 19, 0, 1).toISOString())]
  assert.equal(weekTotals(acts, new Date(2026, 9, 18, 12)).current.count, 1)
  assert.equal(weekTotals(acts, new Date(2026, 9, 19, 12)).current.count, 1)
  assert.equal(weekTotals(acts, new Date(2026, 9, 19, 12)).previous.count, 1)
})

test('DST changes keep weeks anchored to local midnight', () => {
  // Autumn change 2026-10-25 (23h->25h day): week is Mon 19 - Mon 26.
  const fall = weekBounds(new Date(2026, 9, 25, 12))
  assert.deepEqual([fall.start.getDate(), fall.end.getDate()], [19, 26])
  assert.equal(fall.end.getHours(), 0)
  assert.equal((fall.end - fall.start) / 36e5, 169)
  // Spring change 2026-03-29: week is Mon 23 - Mon 30, 167h.
  const spring = weekBounds(new Date(2026, 2, 29, 12))
  assert.deepEqual([spring.start.getDate(), spring.end.getDate()], [23, 30])
  assert.equal((spring.end - spring.start) / 36e5, 167)
  assert.equal(spring.end.getHours(), 0)
})

test('sums distance, time and TSS; null TSS stays null', () => {
  const now = new Date(2026, 9, 15, 12)
  const d = new Date(2026, 9, 14, 8).toISOString()
  const t = weekTotals([act(d), act(d, { training_load: null }), act(d, { moving_time_s: null, elapsed_time_s: 600 })], now)
  assert.deepEqual(t.current, { distanceM: 30000, timeS: 4200, tss: 100, count: 3 })
  assert.equal(sumActivities([act(d, { training_load: null })], t.bounds.start, t.bounds.end).tss, null)
})

test('empty week yields zeros and null TSS', () => {
  const t = weekTotals([], new Date(2026, 9, 15))
  assert.deepEqual(t.current, { distanceM: 0, timeS: 0, tss: null, count: 0 })
})
