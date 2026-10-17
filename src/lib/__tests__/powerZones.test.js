// Run with: node --test src/lib/__tests__/powerZones.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_ZONE_PCTS,
  validateZoneEntry,
  resolveZonesAt,
  zonePctsFromEntry,
  zonePctsFromActivity,
  computeZones,
  zonesFromActivity,
  zoneRanges,
  formatZoneRange,
  zoneOfPower,
  zoneBandWatts,
  zoneSeconds,
  zoneBreakdown,
  fetchZoneHistory,
  saveZoneEntry,
  deleteZoneEntry,
} from '../powerZones.js'

const lt = { lt1Power: 200, lt2Power: 300 }

test('default zones from LT1/LT2: Z1<75% LT1 ... Z6>120% LT2', () => {
  const z = computeZones({ lt })
  assert.deepEqual(z.bounds, [150, 200, 300, 315, 360])
  assert.equal(z.estimated, false)
  assert.equal(z.source, 'lt')
  assert.deepEqual(DEFAULT_ZONE_PCTS, [75, 100, 100, 105, 120])
})

test('custom percentages are applied', () => {
  const z = computeZones({ lt, pcts: [70, 95, 98, 103, 115] })
  assert.deepEqual(z.bounds, [140, 190, 294, 309, 345])
})

test('FTP fallback is flagged as estimated; partial LT mixes sources', () => {
  const ftp = computeZones({ lt: null, ftp: 280 })
  assert.deepEqual(ftp.bounds, [158, 210, 280, 294, 336])
  assert.equal(ftp.estimated, true)
  assert.equal(ftp.source, 'ftp')
  const mixed = computeZones({ lt: { lt1Power: 200, lt2Power: null }, ftp: 280 })
  assert.equal(mixed.source, 'lt+ftp')
  assert.equal(mixed.estimated, true)
  assert.equal(mixed.lt1, 200)
  assert.equal(mixed.lt2, 280)
})

test('zones are unavailable without LT/FTP or with inconsistent values', () => {
  assert.equal(computeZones({}), null)
  assert.equal(computeZones({ lt: { lt1Power: 200 } }), null)
  assert.equal(computeZones({ lt: { lt1Power: 300 }, ftp: 250 }), null)
  assert.equal(computeZones({ lt: { lt1Power: 100, lt2Power: 101 }, pcts: [75, 100, 99, 100, 101] }), null)
})

test('zoneOfPower: boundary belongs to the zone above', () => {
  const z = computeZones({ lt })
  assert.equal(zoneOfPower(z, 0), 1)
  assert.equal(zoneOfPower(z, 149), 1)
  assert.equal(zoneOfPower(z, 150), 2)
  assert.equal(zoneOfPower(z, 250), 3)
  assert.equal(zoneOfPower(z, 300), 4)
  assert.equal(zoneOfPower(z, 315), 5)
  assert.equal(zoneOfPower(z, 360), 6)
  assert.equal(zoneOfPower(z, 1200), 6)
  assert.equal(zoneOfPower(z, null), null)
  assert.equal(zoneOfPower(z, 'x'), null)
  assert.equal(zoneOfPower(null, 100), null)
})

test('zoneRanges / formatZoneRange', () => {
  const r = zoneRanges(computeZones({ lt }))
  assert.equal(r.length, 6)
  assert.equal(formatZoneRange(r[0]), '<150 W')
  assert.equal(formatZoneRange(r[2]), '200–300 W')
  assert.equal(formatZoneRange(r[5]), '>360 W')
  assert.deepEqual(zoneRanges(null), [])
})

test('zoneBandWatts: single zone, range, below and above', () => {
  const z = computeZones({ lt })
  assert.deepEqual(zoneBandWatts(z, { powerMin: 3, powerMax: 3 }), { min: 200, max: 300 })
  assert.deepEqual(zoneBandWatts(z, { powerMin: 2, powerMax: 3 }), { min: 150, max: 300 })
  assert.deepEqual(zoneBandWatts(z, { powerMin: 1, powerMax: 1 }), { min: null, max: 150 })
  assert.deepEqual(zoneBandWatts(z, { powerMin: 6, powerMax: 6 }), { min: 360, max: null })
  assert.deepEqual(zoneBandWatts(z, { powerMin: null, powerMax: 2 }), { min: null, max: 150 })
  assert.deepEqual(zoneBandWatts(z, { powerMin: 4, powerMax: null }), { min: 315, max: null })
  assert.equal(zoneBandWatts(null, { powerMin: 3, powerMax: 3 }), null)
})

test('zoneSeconds / zoneBreakdown on a synthetic stream', () => {
  const z = computeZones({ lt })
  const stream = [100, 100, 160, 250, 250, 250, 310, 400, null, 'x']
  assert.deepEqual(zoneSeconds(stream, z), [2, 1, 3, 1, 0, 1])
  const b = zoneBreakdown(stream, z)
  assert.equal(b.length, 6)
  assert.equal(b[2].seconds, 3)
  assert.equal(b[2].pct, 37.5)
  assert.equal(zoneSeconds([], z), null)
  assert.equal(zoneSeconds(null, z), null)
  assert.equal(zoneSeconds(stream, null), null)
  assert.deepEqual(zoneBreakdown([], z), [])
})

const entry = { effective_from: '2026-03-01', z1_max_pct: 70, z2_max_pct: 95, z3_max_pct: 98, z4_max_pct: 104, z5_max_pct: 118 }

test('validateZoneEntry accepts a good entry and rejects bad ones', () => {
  assert.deepEqual(validateZoneEntry(entry).entry, entry)
  assert.deepEqual(validateZoneEntry({ ...entry, z1_max_pct: '70' }).entry.z1_max_pct, 70)
  assert.match(validateZoneEntry({ ...entry, effective_from: 'x' }).error, /date/)
  assert.match(validateZoneEntry({ ...entry, z2_max_pct: '' }).error, /Z2/)
  assert.match(validateZoneEntry({ ...entry, z3_max_pct: 301 }).error, /Z3/)
  assert.match(validateZoneEntry({ ...entry, z4_max_pct: 70.5 }).error, /Z4/)
  assert.match(validateZoneEntry({ ...entry, z1_max_pct: 95 }).error, /Z1/)
  assert.match(validateZoneEntry({ ...entry, z4_max_pct: 98 }).error, /increasing/)
})

test('history resolution and snapshots', () => {
  const history = [entry, { ...entry, effective_from: '2026-06-01', z1_max_pct: 60 }]
  assert.equal(resolveZonesAt(history, '2026-02-28'), null)
  assert.equal(resolveZonesAt(history, '2026-03-01').z1_max_pct, 70)
  assert.equal(resolveZonesAt(history, '2026-07-01T10:00:00Z').z1_max_pct, 60)
  assert.deepEqual(zonePctsFromEntry(entry), [70, 95, 98, 104, 118])
  assert.equal(zonePctsFromEntry(null), null)
  assert.deepEqual(zonePctsFromActivity({ power_zone_pcts_at_activity: [70, 95, 98, 104, 118] }), [70, 95, 98, 104, 118])
  assert.equal(zonePctsFromActivity({ power_zone_pcts_at_activity: null }), null)
  assert.equal(zonePctsFromActivity({ power_zone_pcts_at_activity: [1, 2, 3] }), null)
  assert.equal(zonePctsFromActivity({ power_zone_pcts_at_activity: [90, 80, 1, 2, 3] }), null)
})

test('zonesFromActivity uses the activity snapshots only', () => {
  const act = { lt1_power_at_activity_w: 200, lt2_power_at_activity_w: 300, ftp_at_activity_w: 999, power_zone_pcts_at_activity: [70, 95, 98, 104, 118] }
  assert.deepEqual(zonesFromActivity(act).bounds, [140, 190, 294, 312, 354])
  assert.equal(zonesFromActivity({ ftp_at_activity_w: 250 }).estimated, true)
  assert.equal(zonesFromActivity({}), null)
  assert.equal(zonesFromActivity(null), null)
})

test('supabase helpers target power_zone_history', async () => {
  const calls = []
  const chain = (name) => {
    const q = {
      select: (...a) => (calls.push([name, 'select', a]), q),
      eq: () => q,
      order: () => Promise.resolve({ data: [entry], error: null }),
      upsert: (...a) => (calls.push([name, 'upsert', a]), Promise.resolve({ error: null })),
      update: (...a) => (calls.push([name, 'update', a]), q),
      delete: () => (calls.push([name, 'delete']), q),
      then: (res) => res({ error: null }),
    }
    return q
  }
  const sb = { from: (n) => chain(n) }
  const res = await fetchZoneHistory(sb, 'u1')
  assert.equal(res.history.length, 1)
  await saveZoneEntry(sb, { userId: 'u1', entry })
  await saveZoneEntry(sb, { userId: 'u1', entry, id: 'x' })
  await deleteZoneEntry(sb, { userId: 'u1', id: 'x' })
  assert.ok(calls.every((c) => c[0] === 'power_zone_history'))
  assert.deepEqual(calls.find((c) => c[1] === 'upsert')[2][1], { onConflict: 'user_id,effective_from' })
  assert.ok(calls.some((c) => c[1] === 'update') && calls.some((c) => c[1] === 'delete'))
})

test('migration is idempotent, RLS-protected, snapshots and backfills', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261127000000_power_zones.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.power_zone_history/)
  assert.match(sql, /power_zone_history ENABLE ROW LEVEL SECURITY/)
  assert.equal((sql.match(/user_id = auth\.uid\(\)/g) || []).length >= 5, true)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS power_zone_pcts_at_activity/)
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_activities_power_zone_snapshot/)
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_power_zone_history_resnapshot/)
  assert.match(sql, /resnapshot_activity_power_zones/)
  assert.ok(!/shared_activities/.test(sql))
})
