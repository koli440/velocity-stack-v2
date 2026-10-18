// Run with: node --test src/lib/__tests__/ftpHistory.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  validateFtpEntry,
  resolveFtpAt,
  ftpAt,
  ftpFromActivity,
  fetchFtpHistory,
  saveFtpEntry,
  deleteFtpEntry,
} from '../ftpHistory.js'
import { buildActivityInsert } from '../activityRecord.js'

const history = [
  { id: 'a', effective_from: '2026-01-01', ftp_w: 250 },
  { id: 'b', effective_from: '2026-06-01', ftp_w: 280 },
]

test('resolveFtpAt picks the latest entry on or before the date', () => {
  assert.equal(resolveFtpAt(history, '2025-12-31T23:00:00Z'), null)
  assert.equal(resolveFtpAt(history, '2026-01-01').id, 'a')
  assert.equal(resolveFtpAt(history, '2026-05-31T12:00:00Z').id, 'a')
  assert.equal(resolveFtpAt(history, '2026-06-01T00:00:00Z').id, 'b')
  assert.equal(resolveFtpAt(history, new Date('2027-01-01T10:00:00Z')).id, 'b')
  assert.equal(resolveFtpAt([], '2026-01-01'), null)
  assert.equal(resolveFtpAt(null, '2026-01-01'), null)
  assert.equal(resolveFtpAt(history, 'garbage'), null)
})

test('ftpAt / ftpFromActivity return positive numbers or null', () => {
  assert.equal(ftpAt(history, '2026-07-01'), 280)
  assert.equal(ftpAt(history, '2025-01-01'), null)
  assert.equal(ftpFromActivity({ ftp_at_activity_w: 255 }), 255)
  assert.equal(ftpFromActivity({ ftp_at_activity_w: null }), null)
  assert.equal(ftpFromActivity(null), null)
})

test('validateFtpEntry', () => {
  assert.deepEqual(validateFtpEntry({ effective_from: '2026-01-01', ftp_w: '280.4' }).entry, {
    effective_from: '2026-01-01',
    ftp_w: 280,
  })
  assert.ok(validateFtpEntry({ effective_from: 'x', ftp_w: 280 }).error)
  assert.ok(validateFtpEntry({ effective_from: '2026-01-01', ftp_w: '' }).error)
  assert.ok(validateFtpEntry({ effective_from: '2026-01-01', ftp_w: 0 }).error)
  assert.ok(validateFtpEntry({ effective_from: '2026-01-01', ftp_w: 3000 }).error)
  assert.ok(validateFtpEntry({ effective_from: '2026-01-01', ftp_w: 'abc' }).error)
})

test('buildActivityInsert snapshots the FTP valid on the activity date, not the current one', () => {
  const summary = { start_time: '2026-03-10T10:00:00Z', normalized_power_w: 200, elapsed_time_s: 3600 }
  const r = buildActivityInsert(summary, { title: 't', userId: 'u', ftpHistory: history, ftpWatts: 999 })
  assert.equal(r.ftp_at_activity_w, 250)
  assert.equal(r.intensity_factor, 0.8)
  assert.equal(r.training_load, 64)

  const later = buildActivityInsert({ ...summary, start_time: '2026-08-01T10:00:00Z' }, { title: 't', userId: 'u', ftpHistory: history })
  assert.equal(later.ftp_at_activity_w, 280)
})

test('buildActivityInsert: no FTP before first entry leaves the snapshot empty', () => {
  const r = buildActivityInsert(
    { start_time: '2025-01-01T00:00:00Z', normalized_power_w: 200, elapsed_time_s: 3600 },
    { title: 't', userId: 'u', ftpHistory: history, ftpWatts: 300 }
  )
  assert.equal(r.ftp_at_activity_w, null)
  assert.equal(r.intensity_factor, null)
})

test('buildActivityInsert falls back to ftpWatts without history (legacy callers)', () => {
  const r = buildActivityInsert({ start_time: '2026-03-10T10:00:00Z' }, { title: 't', userId: 'u', ftpWatts: 300 })
  assert.equal(r.ftp_at_activity_w, 300)
  assert.equal(buildActivityInsert({}, { title: 't', userId: 'u' }).ftp_at_activity_w, null)
})

function fakeSupabase(result = { data: [], error: null }) {
  const calls = []
  const chain = (op) => {
    const c = {
      select: (...a) => (calls.push([op, 'select', a]), c),
      eq: (...a) => (calls.push([op, 'eq', a]), c),
      order: (...a) => (calls.push([op, 'order', a]), Promise.resolve(result)),
      then: (r) => r(result),
    }
    return c
  }
  return {
    calls,
    from: (t) => ({
      select: (...a) => (calls.push([t, 'select', a]), chain(t).select(...a)),
      upsert: (row, opts) => (calls.push([t, 'upsert', row, opts]), Promise.resolve(result)),
      update: (row) => (calls.push([t, 'update', row]), chain(t)),
      delete: () => (calls.push([t, 'delete']), chain(t)),
    }),
  }
}

test('fetch/save/delete use the ftp_history table scoped to the user', async () => {
  const s = fakeSupabase({ data: [history[1]], error: null })
  const { history: rows } = await fetchFtpHistory(s, 'u1')
  assert.equal(rows.length, 1)
  assert.equal(s.calls[0][0], 'ftp_history')

  const s2 = fakeSupabase()
  await saveFtpEntry(s2, { userId: 'u1', entry: { effective_from: '2026-01-01', ftp_w: 250 } })
  assert.deepEqual(s2.calls[0].slice(0, 3), ['ftp_history', 'upsert', { effective_from: '2026-01-01', ftp_w: 250, user_id: 'u1' }])
  assert.equal(s2.calls[0][3].onConflict, 'user_id,effective_from')

  const s3 = fakeSupabase()
  await saveFtpEntry(s3, { userId: 'u1', id: 'x', entry: { effective_from: '2026-01-01', ftp_w: 250 } })
  assert.equal(s3.calls[0][1], 'update')
  await deleteFtpEntry(s3, { userId: 'u1', id: 'x' })
})

test('migration is idempotent and wires snapshot, resnapshot and backfill', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261105000000_ftp_history.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ftp_history/)
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_activities_ftp_snapshot/)
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ftp_history_resnapshot/)
  assert.match(sql, /ftp_at_activity_w IS NULL/)
  assert.match(sql, /ON CONFLICT \(user_id, effective_from\) DO NOTHING/)
  assert.equal((sql.match(/DROP POLICY IF EXISTS/g) || []).length, (sql.match(/CREATE POLICY/g) || []).length)
})
