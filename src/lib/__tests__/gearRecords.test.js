import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gearsUsed, activityUsesGear, selectedGear, buildGearRecords, fetchGearRecords } from '../gearRecords.js'
import { setActivityRace, raceTagOrigin } from '../raceTag.js'

const G1 = { id: 'g1', chainring: 58, cog: 14, note: '' }
const G2 = { id: 'g2', chainring: 52, cog: 15, note: '' }
const G3 = { id: 'g3', chainring: 60, cog: 14, note: '' }

const ride = (over) => ({ id: 'a1', title: 'Race day', activity_date: '2026-06-01', ride_type: 'track', is_race: true, gears: [G1, G2, G3], gear_segments: [], ...over })

test('gearsUsed: primary plus gears referenced by segments, not unused extras', () => {
  const a = ride({ gear_segments: [{ start_s: 10, end_s: 20, gear_id: 'g2' }] })
  assert.deepEqual(gearsUsed(a).map((g) => [g.id, g.role]), [['g1', 'primary'], ['g2', 'segment']])
  assert.equal(activityUsesGear(a, 52, 15), true)
  assert.equal(activityUsesGear(a, 60, 14), false)
})

test('gearsUsed: road rides hide gear, unset type keeps legacy gear', () => {
  assert.deepEqual(gearsUsed(ride({ ride_type: 'road' })), [])
  assert.equal(activityUsesGear({ chainring: 58, cog: 14, ride_type: null }, 58, 14), true)
  assert.deepEqual(gearsUsed({}), [])
})

test('selectedGear rejects empty and invalid gears', () => {
  assert.deepEqual(selectedGear('58', 14), { chainring: 58, cog: 14 })
  assert.equal(selectedGear('', ''), null)
  assert.equal(selectedGear(5, 14), null)
})

test('buildGearRecords: PBs by gear, race rides by any used gear, newest first, race link wins for event/venue', () => {
  const pbs = [
    { id: 'p1', chainring: 58, cog: 14, achieved_date: '2026-03-01', event_name: 'Nationals', track_name: 'Brno', discipline: '1 km', time_seconds: 62.5 },
    { id: 'p2', chainring: 52, cog: 15, achieved_date: '2026-04-01', discipline: '500 m', time_seconds: 30 },
    { id: 'p3', chainring: 58, cog: 14, achieved_date: '2026-05-01', discipline: '1 km', time_seconds: 61 },
  ]
  const activities = [
    ride({ id: 'a1', activity_date: '2026-06-01', avg_power_w: 400, max_power_w: 1200, moving_time_s: 65, tracks: { name: 'Třebešín' } }),
    ride({ id: 'a2', activity_date: '2026-07-01', gear_segments: [{ start_s: 0, end_s: 5, gear_id: 'g2' }], max_power_w: 900 }),
    ride({ id: 'a3', activity_date: '2026-08-01', gears: [G3] }),
  ]
  const races = [{ id: 'r1', activity_id: 'a1', name: 'Cup', location: 'Prague', race_date: '2026-06-01' }]
  const r58 = buildGearRecords({ chainring: 58, cog: 14, pbs, activities, races })
  assert.deepEqual(r58.pbRecords.map((p) => p.id), ['p3', 'p1'])
  assert.equal(r58.pbRecords[1].event, 'Nationals')
  assert.equal(r58.pbRecords[1].venue, 'Brno')
  assert.deepEqual(r58.raceRecords.map((r) => r.id), ['a2', 'a1'])
  const a1 = r58.raceRecords[1]
  assert.equal(a1.event, 'Cup')
  assert.equal(a1.venue, 'Prague')
  assert.equal(a1.maxPowerW, 1200)
  assert.equal(a1.timeSeconds, 65)
  const r52 = buildGearRecords({ chainring: 52, cog: 15, pbs, activities, races })
  assert.deepEqual(r52.raceRecords.map((r) => [r.id, r.gearRole]), [['a2', 'segment']])
  assert.deepEqual(r52.pbRecords.map((p) => p.id), ['p2'])
  const none = buildGearRecords({ chainring: '', cog: '', pbs, activities, races })
  assert.deepEqual(none, { pbRecords: [], raceRecords: [] })
})

test('buildGearRecords: an unlinked race ride falls back to its title and velodrome', () => {
  const { raceRecords } = buildGearRecords({ chainring: 58, cog: 14, activities: [ride({ tracks: { name: 'Brno' } })] })
  assert.equal(raceRecords[0].event, 'Race day')
  assert.equal(raceRecords[0].venue, 'Brno')
})

function fakeClient(tables) {
  const calls = []
  const client = {
    calls,
    from(table) {
      const q = { table, filters: [] }
      calls.push(q)
      const chain = {
        select: () => chain,
        eq: (c, v) => (q.filters.push([c, v]), chain),
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (res) => res({ data: tables[table] || [], error: null }),
      }
      return chain
    },
  }
  return client
}

test('fetchGearRecords filters every query by the explicit owner', async () => {
  const client = fakeClient({ activities: [ride()], personal_bests: [], calendar_races: [] })
  const r = await fetchGearRecords(client, 'me', 58, 14)
  assert.equal(r.error, null)
  assert.equal(r.raceRecords.length, 1)
  for (const q of client.calls) {
    const col = q.table === 'calendar_races' ? 'rider_id' : 'user_id'
    assert.ok(q.filters.some(([c, v]) => c === col && v === 'me'), `${q.table} is owner-scoped`)
  }
  assert.ok(client.calls.find((c) => c.table === 'activities').filters.some(([c, v]) => c === 'is_race' && v === true))
})

test('fetchGearRecords refuses to run without an owner or gear', async () => {
  const client = fakeClient({})
  assert.deepEqual((await fetchGearRecords(client, null, 58, 14)).raceRecords, [])
  assert.deepEqual((await fetchGearRecords(client, 'me', '', '')).pbRecords, [])
  assert.equal(client.calls.length, 0)
})

test('setActivityRace goes through the audited RPC', async () => {
  const calls = []
  const client = { rpc: async (n, a) => (calls.push([n, a]), { data: true, error: null }) }
  assert.deepEqual(await setActivityRace(client, 'a1', 1), { isRace: true, error: null })
  assert.deepEqual(calls, [['set_activity_race', { p_activity: 'a1', p_is_race: true }]])
  assert.ok((await setActivityRace(client, '', true)).error)
  const bad = { rpc: async () => ({ data: null, error: new Error('Activity not found') }) }
  assert.equal((await setActivityRace(bad, 'a1', true)).isRace, null)
})

test('raceTagOrigin explains auto, coach and manual tags', () => {
  assert.equal(raceTagOrigin({ is_race: false }), '')
  assert.match(raceTagOrigin({ is_race: true, race_tag_auto: true }), /automatically/)
  assert.match(raceTagOrigin({ is_race: true, race_set_by_coach: true }), /coach/)
  assert.match(raceTagOrigin({ is_race: true }), /manually/)
})
