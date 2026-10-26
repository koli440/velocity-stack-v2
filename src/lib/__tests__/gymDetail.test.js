import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGymDetail, gymDetailRows, gymTotals, restAfter, saveGymDetail } from '../gymDetail.js'
import { prepareAnalysis } from '../gymAnalysis.js'
import { repairGymDetail } from '../server/gymRepair.js'

const strength = {
  sets: [
    { index: 2, type: 'rest', duration_s: 60 },
    { index: 0, type: 'active', reps: 10, weight_kg: 60, duration_s: 30, category: 'bench_press', subtype: 'barbell_bench_press' },
    { index: 1, type: 'rest', duration_s: 90 },
    { index: 3, type: 'active', reps: 8, weight_kg: 65, duration_s: 28, category: 'bench_press', subtype: 'barbell_bench_press' },
    { index: 4, type: 'active', reps: 12, weight_kg: null, category: 'squat', subtype: '7' },
  ],
  titles: [{ category: 'squat', name_id: 7, title: 'Front squat' }],
}

test('buildGymDetail groups consecutive sets into exercises and keeps rests', () => {
  const d = buildGymDetail(strength)
  assert.equal(d.exercises.length, 2)
  assert.equal(d.exercises[0].name, 'Barbell bench press')
  assert.equal(d.exercises[0].sets.length, 4)
  assert.equal(restAfter(d.exercises[0], 0), 90)
  assert.equal(d.exercises[1].name, 'Front squat')
  assert.deepEqual(gymTotals(d), { exercises: 2, sets: 3, reps: 30, volumeKg: 1120 })
})

test('buildGymDetail returns null without active sets', () => {
  assert.equal(buildGymDetail(null), null)
  assert.equal(buildGymDetail({ sets: [{ type: 'rest', duration_s: 5 }] }), null)
})

test('prepareAnalysis exposes gym detail for gym only', () => {
  const gym = prepareAnalysis({ summary: { activity_type: 'gym' }, strength })
  assert.equal(gym.gym.exercises.length, 2)
  assert.equal(prepareAnalysis({ summary: { activity_type: 'gym' } }).gym, null)
  assert.equal(prepareAnalysis({ summary: {}, strength }).gym, null)
})

test('gymDetailRows numbers sets across the activity and links exercises', () => {
  let n = 0
  const { exerciseRows, setRows } = gymDetailRows(buildGymDetail(strength), { activityId: 'a', userId: 'u', newId: () => `e${n++}` })
  assert.deepEqual(exerciseRows.map((r) => r.id), ['e0', 'e1'])
  assert.deepEqual(setRows.map((r) => r.position), [0, 1, 2, 3, 4])
  assert.equal(setRows[4].exercise_id, 'e1')
  assert.ok(setRows.every((r) => r.user_id === 'u' && r.activity_id === 'a'))
})

function fakeDb({ gaps = [] } = {}) {
  const calls = []
  const chain = (table, op) => {
    const q = {
      select: () => q, eq: () => q, is: () => q, order: () => q,
      limit: () => Promise.resolve({ data: gaps, error: null }),
      then: (res) => res({ error: null }),
    }
    calls.push([table, op])
    return q
  }
  return {
    calls,
    from: (t) => ({
      select: (...a) => chain(t, 'select').select(...a),
      insert: () => Promise.resolve(chain(t, 'insert') && { error: null }),
      update: () => chain(t, 'update'),
      delete: () => chain(t, 'delete'),
    }),
  }
}

test('saveGymDetail inserts exercises then sets, nothing for null', async () => {
  const db = fakeDb()
  assert.equal(await saveGymDetail(db, null, { activityId: 'a', userId: 'u' }), null)
  assert.equal(db.calls.length, 0)
  await saveGymDetail(db, buildGymDetail(strength), { activityId: 'a', userId: 'u' })
  assert.deepEqual(db.calls.map((c) => c.join(':')), ['gym_exercises:insert', 'gym_sets:insert'])
})

test('repairGymDetail re-reads file-backed sessions only, and never Strava', async () => {
  const db = fakeDb({ gaps: [{ id: 'g1', external_id: '9' }] })
  const fetched = []
  const provider = {
    source: 'intervals',
    fetchActivity: async (id) => (fetched.push(id), { activityType: 'gym', summary: { activity_type: 'gym' }, strength }),
  }
  const out = await repairGymDetail(db, { userId: 'u', provider, analyzeFit: () => null })
  assert.deepEqual(fetched, ['9'])
  assert.equal(out.repaired, 1)

  const strava = { source: 'strava', fetchActivity: async () => assert.fail('no Strava request') }
  assert.deepEqual(await repairGymDetail(db, { userId: 'u', provider: strava, analyzeFit: () => null }), { repaired: 0, checked: 0, failed: 0, error: null })
})
