import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const dir = new URL('../../../supabase/migrations/', import.meta.url)
const read = (f) => fs.readFileSync(new URL(f, dir), 'utf8')

test('reconnecting the same Garmin account keeps the push mappings', () => {
  const sql = read('20270145000000_garmin_keep_push_mappings.sql')
  // deletion only when both ids are known and differ
  assert.match(sql, /OLD\.external_athlete_id IS NOT NULL AND NEW\.external_athlete_id IS NOT NULL/)
  const del = sql.indexOf('DELETE FROM public.planned_workout_garmin_pushes')
  assert.ok(del > sql.indexOf('IS NOT NULL AND NEW.external_athlete_id IS NOT NULL'))
  assert.doesNotMatch(sql.slice(0, sql.indexOf('IF OLD.external_athlete_id')), /DELETE FROM/)
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/)
})

test('reship migration contains the power target and route map pieces and a schema reload', () => {
  const sql = read('20270146000000_reship_garmin_power_target_route_map.sql')
  assert.match(sql, /push_power_target/)
  assert.match(sql, /shared_route_gps/)
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('migration versions are unique', () => {
  const v = fs.readdirSync(dir).map((f) => f.slice(0, 14))
  assert.equal(new Set(v).size, v.length)
})
