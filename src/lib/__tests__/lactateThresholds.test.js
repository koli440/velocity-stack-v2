// Run with: node --test src/lib/__tests__/lactateThresholds.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  validateLtEntry,
  resolveLtAt,
  ltFromHistoryEntry,
  ltFromActivity,
  fetchLtHistory,
  saveLtEntry,
  deleteLtEntry,
  lactateZoneBreakdown,
  activityLtSummary,
} from '../lactateThresholds.js'

const history = [
  { id: 'a', effective_from: '2026-01-01', lt1_power_w: 150, lt1_hr: 130, lt2_power_w: 220, lt2_hr: 160 },
  { id: 'b', effective_from: '2026-06-01', lt1_power_w: 160, lt1_hr: null, lt2_power_w: 235, lt2_hr: null },
]

test('resolveLtAt picks the latest entry on or before the date', () => {
  assert.equal(resolveLtAt(history, '2025-12-31T23:00:00Z'), null)
  assert.equal(resolveLtAt(history, '2026-01-01').id, 'a')
  assert.equal(resolveLtAt(history, '2026-05-31T12:00:00Z').id, 'a')
  assert.equal(resolveLtAt(history, '2026-06-01T00:00:00Z').id, 'b')
  assert.equal(resolveLtAt(history, new Date('2027-01-01T10:00:00Z')).id, 'b')
  assert.equal(resolveLtAt([], '2026-01-01'), null)
  assert.equal(resolveLtAt(null, '2026-01-01'), null)
})

test('ltFromHistoryEntry / ltFromActivity normalise values', () => {
  assert.deepEqual(ltFromHistoryEntry(history[1]), { lt1Power: 160, lt1Hr: null, lt2Power: 235, lt2Hr: null })
  assert.equal(ltFromHistoryEntry(null), null)
  assert.equal(ltFromActivity({}), null)
  assert.deepEqual(
    ltFromActivity({ lt1_power_at_activity_w: 150, lt2_hr_at_activity: 170 }),
    { lt1Power: 150, lt1Hr: null, lt2Power: null, lt2Hr: 170 }
  )
  assert.equal(ltFromActivity({ lt1_power_at_activity_w: 0 }), null)
})

test('validateLtEntry accepts valid, partial entries and coerces strings', () => {
  const { entry, error } = validateLtEntry({ effective_from: '2026-03-01', lt1_power_w: '150', lt2_power_w: '', lt2_hr: '165' })
  assert.equal(error, undefined)
  assert.deepEqual(entry, {
    effective_from: '2026-03-01',
    lt1_power_w: 150,
    lt2_power_w: null,
    lt1_hr: null,
    lt2_hr: 165,
  })
})

test('validateLtEntry rejects bad input', () => {
  assert.match(validateLtEntry({ effective_from: '', lt1_power_w: 100 }).error, /date/)
  assert.match(validateLtEntry({ effective_from: '2026-03-01' }).error, /at least one/)
  assert.match(validateLtEntry({ effective_from: '2026-03-01', lt1_power_w: 5000 }).error, /LT1 POWER/)
  assert.match(validateLtEntry({ effective_from: '2026-03-01', lt2_hr: 10 }).error, /LT2 HR/)
  assert.match(validateLtEntry({ effective_from: '2026-03-01', lt1_hr: 'x' }).error, /LT1 HR/)
  assert.match(validateLtEntry({ effective_from: '2026-03-01', lt1_power_w: 250, lt2_power_w: 200 }).error, /LT1 power must be lower/)
  assert.match(validateLtEntry({ effective_from: '2026-03-01', lt1_hr: 160, lt2_hr: 160 }).error, /LT1 HR must be lower/)
})

function fakeSupabase(calls) {
  const chain = (name) => {
    const q = {
      select: (...a) => (calls.push([name, 'select', a]), q),
      eq: (...a) => (calls.push([name, 'eq', a]), q),
      order: (...a) => (calls.push([name, 'order', a]), q),
      update: (...a) => (calls.push([name, 'update', a]), q),
      upsert: (...a) => (calls.push([name, 'upsert', a]), q),
      delete: (...a) => (calls.push([name, 'delete', a]), q),
      then: (res) => res({ data: history, error: null }),
    }
    return q
  }
  return { from: (name) => chain(name) }
}

test('fetch/save/delete use the history table scoped to the user', async () => {
  const calls = []
  const sb = fakeSupabase(calls)
  const res = await fetchLtHistory(sb, 'u1')
  assert.equal(res.history.length, 2)
  await saveLtEntry(sb, { userId: 'u1', entry: { effective_from: '2026-01-01', lt1_hr: 130 } })
  await saveLtEntry(sb, { userId: 'u1', entry: { effective_from: '2026-01-01', lt1_hr: 131 }, id: 'x' })
  await deleteLtEntry(sb, { userId: 'u1', id: 'x' })
  const ops = calls.map((c) => c[1])
  assert.ok(ops.includes('upsert') && ops.includes('update') && ops.includes('delete'))
  const upsert = calls.find((c) => c[1] === 'upsert')
  assert.equal(upsert[2][0].user_id, 'u1')
  assert.deepEqual(upsert[2][1], { onConflict: 'user_id,effective_from' })
  assert.ok(calls.every((c) => c[0] === 'lactate_threshold_history'))
})

test('migration is idempotent, RLS-protected and not leaked via shared view', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261103000000_lactate_thresholds.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.lactate_threshold_history/)
  assert.match(sql, /public\.lactate_threshold_history ENABLE ROW LEVEL SECURITY/)
  assert.equal((sql.match(/user_id = auth\.uid\(\)/g) || []).length >= 5, true)
  for (const col of ['lt1_power_at_activity_w', 'lt1_hr_at_activity', 'lt2_power_at_activity_w', 'lt2_hr_at_activity']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS[\\s\\S]*${col}`))
  }
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_activities_lt_snapshot/)
  assert.ok(!/shared_activities/.test(sql))
})

test('lactateZoneBreakdown splits a stream into three zones', () => {
  const z = lactateZoneBreakdown([100, 150, 200, 220, 300, null, undefined, 'x'], 150, 220)
  assert.deepEqual(z.map((x) => [x.id, x.seconds]), [['below_lt1', 1], ['lt1_lt2', 2], ['above_lt2', 2]])
})

test('lactateZoneBreakdown with a single threshold gives two zones', () => {
  assert.deepEqual(
    lactateZoneBreakdown([100, 150, 200], 150, null).map((x) => [x.id, x.seconds]),
    [['below_lt1', 1], ['above_lt1', 2]]
  )
  assert.deepEqual(
    lactateZoneBreakdown([100, 150, 200], null, 150).map((x) => [x.id, x.seconds]),
    [['below_lt2', 1], ['above_lt2', 2]]
  )
})

test('lactateZoneBreakdown handles missing streams and thresholds', () => {
  assert.deepEqual(lactateZoneBreakdown(null, 150, 220), [])
  assert.deepEqual(lactateZoneBreakdown([100], null, null), [])
  assert.deepEqual(lactateZoneBreakdown([null, null], 150, 220), [])
})

test('activityLtSummary uses the activity snapshot only', () => {
  assert.equal(activityLtSummary({ time_series: { watts: [1] } }), null)
  const s = activityLtSummary({
    lt1_power_at_activity_w: 150,
    lt2_power_at_activity_w: 220,
    lt1_hr_at_activity: 130,
    time_series: { watts: [100, 160, 250], heartrate: [120, 140] },
  })
  assert.equal(s.lt.lt1Power, 150)
  assert.deepEqual(s.power.map((x) => x.seconds), [1, 1, 1])
  assert.deepEqual(s.hr.map((x) => [x.id, x.seconds]), [['below_lt1', 1], ['above_lt1', 1]])
  const noStreams = activityLtSummary({ lt1_power_at_activity_w: 150, time_series: {} })
  assert.deepEqual(noStreams.power, [])
})
