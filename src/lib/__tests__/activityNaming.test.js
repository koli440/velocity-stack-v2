import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TITLE_POOLS, TIME_FLAVOURS, isGenericActivityName, timeOfDay, localHourFromStamp, generateActivityName,
  resolveImportTitle, rerollActivityTitle, chooseCategory, rideCharacter, runCharacter, gymCharacter, countPowerBlocks,
} from '../activityNaming.js'
import { buildActivityUpdates } from '../activityEdit.js'
import { importActivity } from '../server/importActivity.js'

test('pools are big, unique and tasteful', () => {
  for (const [key, pool] of Object.entries(TITLE_POOLS)) {
    assert.ok(pool.length >= 20, `${key} has ${pool.length}`)
    assert.equal(new Set(pool.map((t) => t.toLowerCase())).size, pool.length, `${key} has duplicates`)
    for (const t of pool) assert.ok(t.length > 2 && t.length < 60, t)
  }
  for (const [key, pool] of Object.entries(TIME_FLAVOURS)) {
    assert.ok(pool.length >= 6, key)
    assert.equal(new Set(pool).size, pool.length)
  }
  const all = [...Object.values(TITLE_POOLS).flat(), ...Object.values(TIME_FLAVOURS).flat()].join(' ')
  assert.doesNotMatch(all, /\b(fuck|shit|damn|bitch|ass hole|london|paris|berlin|new york)\b/i)
})

test('generic names are detected, meaningful ones are not', () => {
  for (const g of ['', null, 'Garmin Sync', 'Strava Sync', 'Wahoo Gym Session', 'Morning Ride', 'Lunch Ride', 'Evening Run', 'Virtual Ride', 'Ride', 'Cycling', 'Indoor Cycling', 'Mountain Biking', 'Weight Training', 'Velodrome Flying Laps', '2026-11-02-073000', '12345678901', 'activity_123']) {
    assert.ok(isGenericActivityName(g), String(g))
  }
  for (const n of ['Hill repeats with Sam', 'Sunrise Sufferfest: Hill Grudge', 'Race: Tour of the Park', 'Leg day']) {
    assert.ok(!isGenericActivityName(n), n)
  }
})

test('time of day and local hour parsing', () => {
  assert.equal(timeOfDay(5), 'dawn')
  assert.equal(timeOfDay(8), 'morning')
  assert.equal(timeOfDay(12), 'lunch')
  assert.equal(timeOfDay(15), 'afternoon')
  assert.equal(timeOfDay(18), 'sunset')
  assert.equal(timeOfDay(23), 'night')
  assert.equal(timeOfDay(2), 'night')
  assert.equal(timeOfDay(null), null)
  assert.equal(localHourFromStamp('2026-11-02T07:30:00'), 7)
  assert.equal(localHourFromStamp(undefined), null)
})

test('ride categories follow intensity, climbing and length', () => {
  const base = { elapsed_time_s: 3600, distance_m: 30000, normalized_power_w: 100 }
  assert.equal(rideCharacter({ summary: base, ftpWatts: 250 }), 'ride_recovery')
  assert.equal(rideCharacter({ summary: { ...base, elapsed_time_s: 7200, normalized_power_w: 160 }, ftpWatts: 250 }), 'ride_endurance')
  assert.equal(rideCharacter({ summary: { ...base, normalized_power_w: 205 }, ftpWatts: 250 }), 'ride_tempo')
  assert.equal(rideCharacter({ summary: { ...base, normalized_power_w: 235 }, ftpWatts: 250 }), 'ride_threshold')
  assert.equal(rideCharacter({ summary: { ...base, normalized_power_w: 270 }, ftpWatts: 250 }), 'ride_vo2')
  assert.equal(rideCharacter({ summary: { ...base, normalized_power_w: 190, max_power_w: 900 }, ftpWatts: 250 }), 'ride_sprint')
  assert.equal(rideCharacter({ summary: { ...base, normalized_power_w: 190, elevation_gain_m: 900 }, ftpWatts: 250 }), 'ride_hills')
  assert.equal(rideCharacter({ summary: { ...base, elapsed_time_s: 5 * 3600 } }), 'ride_epic')
  assert.equal(rideCharacter({ summary: { ...base, distance_m: 120000 } }), 'ride_epic')
  assert.equal(rideCharacter({ summary: { elapsed_time_s: 1800 } }), 'ride_generic')
})

test('interval blocks are detected from power', () => {
  const watts = []
  for (let i = 0; i < 5; i++) {
    for (let s = 0; s < 120; s++) watts.push(320)
    for (let s = 0; s < 120; s++) watts.push(120)
  }
  assert.ok(countPowerBlocks(watts, 250, watts.length) >= 4)
  assert.equal(countPowerBlocks(watts.map(() => 150), 250, watts.length), 0)
  assert.equal(rideCharacter({ summary: { elapsed_time_s: 1200, normalized_power_w: 200 }, ftpWatts: 250, timeSeries: { watts } }), 'ride_vo2')
})

test('run and gym categories', () => {
  assert.equal(runCharacter({ sport: 'trail_run', summary: {} }), 'run_trail')
  assert.equal(runCharacter({ sport: 'treadmill_run', summary: {} }), 'run_treadmill')
  assert.equal(runCharacter({ sport: 'run', summary: { distance_m: 10000, avg_hr: 170, max_hr: 185, elapsed_time_s: 2800 } }), 'run_race')
  assert.equal(runCharacter({ sport: 'run', summary: { distance_m: 20000, elapsed_time_s: 6000 } }), 'run_long')
  assert.equal(runCharacter({ sport: 'run', summary: { distance_m: 8000, elevation_gain_m: 300, elapsed_time_s: 2800 } }), 'run_hilly')
  assert.equal(runCharacter({ sport: 'run', summary: { distance_m: 6000, elapsed_time_s: 2000, avg_speed_kmh: 10, max_speed_kmh: 20 } }), 'run_intervals')
  assert.equal(runCharacter({ sport: 'run', summary: { distance_m: 7000, elapsed_time_s: 2400, avg_hr: 165, max_hr: 180 } }), 'run_tempo')
  assert.equal(runCharacter({ sport: 'run', summary: { distance_m: 6000, elapsed_time_s: 2400, avg_hr: 140, max_hr: 180 } }), 'run_easy')
  assert.equal(runCharacter({ sport: 'run', summary: {} }), 'run_generic')
  assert.equal(gymCharacter({ summary: { elapsed_time_s: 1500 } }), 'gym_short')
  assert.equal(gymCharacter({ summary: { elapsed_time_s: 3600, avg_hr: 110 } }), 'gym_standard')
  assert.equal(gymCharacter({ summary: { elapsed_time_s: 3600, avg_hr: 150 } }), 'gym_hard')
  assert.equal(gymCharacter({ summary: {} }), 'gym_generic')
})

test('sport flavours: MTB, gravel, e-bike, track and indoor pools', () => {
  assert.equal(chooseCategory({ sport: 'mtb', summary: {} }).pool, 'ride_mtb')
  assert.equal(chooseCategory({ sport: 'gravel', summary: {} }).pool, 'ride_gravel')
  assert.equal(chooseCategory({ sport: 'ebike', summary: {} }).pool, 'ride_ebike')
  assert.equal(chooseCategory({ sport: 'virtual', summary: {} }).pool, 'ride_indoor')
  assert.equal(chooseCategory({ rideType: 'track', summary: {} }).pool, 'ride_track')
  assert.equal(chooseCategory({ activityType: 'gym', summary: {} }).pool, 'gym_generic')
  assert.equal(chooseCategory({ activityType: 'run', summary: {} }).pool, 'run_generic')
  assert.equal(chooseCategory({ sport: 'mtb', summary: { elapsed_time_s: 5 * 3600 } }).pool, 'ride_epic')
})

test('names are deterministic, flavoured and avoid recent names', () => {
  const args = { seed: 'u1|2026-11-02T07:00:00Z', sport: 'gravel', summary: { elapsed_time_s: 3600 }, localHour: 6 }
  const a = generateActivityName(args)
  assert.equal(a, generateActivityName(args))
  const [flavour, title] = a.split(': ')
  assert.ok(TIME_FLAVOURS.dawn.includes(flavour))
  assert.ok(TITLE_POOLS.ride_gravel.includes(title))
  assert.ok(!generateActivityName({ ...args, localHour: null }).includes(': '))
  const recent = [a]
  assert.notEqual(generateActivityName({ ...args, recentNames: recent }).split(': ')[1], title)
  const names = new Set()
  const recentNames = []
  for (let i = 0; i < TITLE_POOLS.ride_gravel.length; i++) {
    const n = generateActivityName({ ...args, seed: `s${i}`, recentNames })
    recentNames.unshift(n)
    names.add(n.split(': ')[1])
  }
  assert.equal(names.size, TITLE_POOLS.ride_gravel.length)
})

test('resolveImportTitle keeps non-generic names and honours a locked one', () => {
  const naming = { seed: 'x', summary: {}, localHour: 9 }
  assert.deepEqual(resolveImportTitle({ title: 'Hill repeats', ...naming }), { title: 'Hill repeats', generated: false })
  assert.equal(resolveImportTitle({ title: 'Morning Ride', ...naming }).generated, true)
  assert.deepEqual(resolveImportTitle({ title: 'Morning Ride', lockedTitle: 'Mine', ...naming }), { title: 'Mine', generated: false })
})

test('editing the name locks it; other edits do not', () => {
  const edit = { title: 'New', visibility: 'private', description: '' }
  assert.equal(buildActivityUpdates({ ...edit, lockTitle: true }).updates.title_locked, true)
  assert.equal(buildActivityUpdates({ ...edit, activityType: 'gym', lockTitle: true }).updates.title_locked, true)
  assert.ok(!('title_locked' in buildActivityUpdates(edit).updates))
})

function fake({ existing = [], replaced = null, recent = [] } = {}) {
  const calls = { inserts: [] }
  return {
    calls,
    rpc: () => Promise.resolve({ data: 1, error: null }),
    from(table) {
      return {
        select(cols) {
          const q = {
            eq: () => (cols === 'title' ? { order: () => ({ limit: () => Promise.resolve({ data: recent.map((title) => ({ title })), error: null }) }) } : cols === 'title, title_locked' ? { maybeSingle: () => Promise.resolve({ data: replaced, error: null }) } : Promise.resolve({ data: table === 'activities' ? existing : [], error: null })),
          }
          return q
        },
        insert(rows) {
          calls.inserts.push({ table, rows })
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new1' }, error: null }) }), then: (r) => r({ error: null }) }
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
  }
}
const provider = (title) => ({
  source: 'garmin',
  fetchActivity: async () => ({
    title,
    startDateLocal: '2026-11-02T06:10:00',
    summary: { start_time: '2026-11-02T05:10:00Z', elapsed_time_s: 3600, avg_power_w: 150 },
    curves: { Power: { '5s': 300 } },
    time_series: {},
  }),
})

test('importActivity names generic imports, keeps real names', async () => {
  const s1 = fake()
  await importActivity({ supabase: s1, userId: 'u1', provider: provider('Garmin Sync'), externalId: '1', profile: {} })
  const t = s1.calls.inserts[0].rows[0].title
  assert.match(t, /: /)
  assert.ok(TIME_FLAVOURS.dawn.includes(t.split(': ')[0]))
  assert.ok(!('title_locked' in s1.calls.inserts[0].rows[0]))
  const s2 = fake()
  await importActivity({ supabase: s2, userId: 'u1', provider: provider('Hill repeats'), externalId: '2', profile: {} })
  assert.equal(s2.calls.inserts[0].rows[0].title, 'Hill repeats')
})

test('importActivity upgrade keeps the replaced copy locked name and flag', async () => {
  const T = '2026-11-02T05:10:00Z'
  const s = fake({ existing: [{ id: 'old', source: 'strava', start_time: T, elapsed_time_s: 3600 }], replaced: { title: 'My name', title_locked: true } })
  const r = await importActivity({ supabase: s, userId: 'u1', provider: provider('Morning Ride'), externalId: '3', profile: {} })
  assert.equal(r.status, 'upgraded')
  assert.equal(s.calls.inserts[0].rows[0].title, 'My name')
  assert.equal(s.calls.inserts[0].rows[0].title_locked, true)
})

test('importActivity avoids the rider recent names', async () => {
  const first = fake()
  await importActivity({ supabase: first, userId: 'u1', provider: provider('Garmin Sync'), externalId: '1', profile: {} })
  const name = first.calls.inserts[0].rows[0].title
  const again = fake({ recent: [name] })
  await importActivity({ supabase: again, userId: 'u1', provider: provider('Garmin Sync'), externalId: '1', profile: {} })
  assert.notEqual(again.calls.inserts[0].rows[0].title.split(': ')[1], name.split(': ')[1])
})

test('rerollActivityTitle always changes the name and fits the activity', () => {
  const activity = { id: 'a1', title: 'My own name', title_locked: true, activity_type: 'run', ride_type: 'trail_run', start_time: '2026-11-02T06:00:00', elapsed_time_s: 3000, distance_m: 8000 }
  const seen = new Set()
  for (let n = 0; n < 15; n++) {
    const name = rerollActivityTitle({ activity, nonce: n })
    assert.notEqual(name, activity.title)
    const title = name.includes(': ') ? name.split(': ')[1] : name
    assert.ok(TITLE_POOLS.run_trail.includes(title), name)
    seen.add(name)
  }
  assert.ok(seen.size > 1)
  const current = rerollActivityTitle({ activity, nonce: 1 })
  assert.notEqual(rerollActivityTitle({ activity: { ...activity, title: current }, nonce: 1 }), current)
  assert.ok(rerollActivityTitle({ activity: { id: 'g', activity_type: 'gym', title: 'x' } }).length > 0)
})
