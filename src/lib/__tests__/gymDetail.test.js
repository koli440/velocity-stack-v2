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
      maybeSingle: () => Promise.resolve({ data: null }),
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

// ---- Editing (issue #335) ----
import {
  blankSet, bestSet, buildSavePayload, copySet, estimate1RM, gymSummary, kgToUnit, replaceGymDetail, setVolume,
  suggestExerciseNames, toEditable, unitToKg, fetchLastSessionSets, fetchExerciseNameHistory,
} from '../gymDetail.js'

test('estimate1RM: Epley / Brzycki, estimate only within 1-12 reps', () => {
  assert.equal(estimate1RM(100, 1), 100)
  assert.equal(estimate1RM(100, 5), 116.7)
  assert.equal(estimate1RM(100, 5, 'brzycki'), 112.5)
  assert.equal(estimate1RM(100, 13), null)
  assert.equal(estimate1RM(null, 5), null)
  assert.equal(estimate1RM(0, 5), null)
})

test('volume ignores bodyweight / assisted load; best set skips warm-ups', () => {
  assert.equal(setVolume(blankSet({ reps: 5, weight_kg: 100 })), 500)
  assert.equal(setVolume(blankSet({ reps: 5, weight_kg: 20, load_mode: 'assisted' })), 0)
  const ex = { sets: [blankSet({ kind: 'warmup', reps: 5, weight_kg: 200 }), blankSet({ reps: 5, weight_kg: 100 }), blankSet({ reps: 3, weight_kg: 110 })] }
  assert.equal(bestSet(ex).set.weight_kg, 110)
  assert.equal(gymSummary({ exercises: [{ sets: [blankSet({ reps: 10, weight_kg: 50 }), blankSet({ reps: 10, load_mode: 'bodyweight', weight_kg: 30 })] }] }).volumeKg, 500)
})

test('kg / lb conversion round-trips for display', () => {
  assert.equal(kgToUnit(100, 'kg'), 100)
  assert.equal(kgToUnit(100, 'lb'), 220.5)
  assert.equal(kgToUnit(unitToKg(135, 'lb'), 'lb'), 135)
  assert.equal(unitToKg(null, 'lb'), null)
})

test('suggestExerciseNames ranks by use and filters', () => {
  const h = ['Squat', 'squat ', 'Bench press', 'Back  squat', 'Squat']
  assert.deepEqual(suggestExerciseNames(h, '', 2), ['Squat', 'Back squat'])
  assert.deepEqual(suggestExerciseNames(h, 'bench'), ['Bench press'])
})

test('toEditable folds rests into rest_s and drops rest rows', () => {
  const d = buildGymDetail(strength)
  const e = toEditable(d)
  assert.equal(e[0].sets.length, 2)
  assert.equal(e[0].sets[0].rest_s, 90)
  assert.equal(e[0].sets[0].kind, 'working')
})

test('copySet keeps values but not notes / metrics', () => {
  const c = copySet(blankSet({ reps: 5, weight_kg: 80, rpe: 8, notes: 'x', metrics: { mean_velocity_ms: 0.4 } }))
  assert.deepEqual([c.reps, c.weight_kg, c.rpe, c.notes, c.metrics], [5, 80, 8, null, {}])
})

test('buildSavePayload validates', () => {
  const good = [{ name: ' Squat ', sets: [blankSet({ reps: 5, weight_kg: 100, rpe: 8.5, tempo: '3-1-1-0', metrics: { mean_velocity_ms: '0.5', junk: undefined } })] }]
  const r = buildSavePayload(good)
  assert.equal(r.exercises[0].name, 'Squat')
  assert.equal(r.exercises[0].sets[0].metrics.mean_velocity_ms, 0.5)
  const bad = (set) => buildSavePayload([{ name: 'x', sets: [blankSet(set)] }]).error
  assert.match(bad({ rpe: 11 }), /RPE/)
  assert.match(bad({ rpe: 7.3 }), /RPE/)
  assert.match(bad({ rir: -1 }), /RIR/)
  assert.match(bad({ reps: 1.5 }), /reps/)
  assert.match(bad({ tempo: 'fast' }), /tempo/)
  assert.match(bad({ kind: 'x' }), /set type/)
  assert.match(bad({ metrics: { mean_velocity_ms: 99 } }), /Mean vel/)
  assert.match(buildSavePayload([{ name: ' ', sets: [] }]).error, /needs a name/)
})

test('replaceGymDetail leaves a hand-edited session alone (re-import / repair)', async () => {
  const calls = []
  const client = (edited) => ({
    from(table) {
      calls.push(table)
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: edited ? { activity_id: 'a' } : null }), delete: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) }
      return q
    },
  })
  const detail = buildGymDetail(strength)
  calls.length = 0
  assert.equal(await replaceGymDetail(client(true), detail, { activityId: 'a', userId: 'u' }), null)
  assert.deepEqual(calls, ['gym_session_edits'])
  calls.length = 0
  await replaceGymDetail(client(false), detail, { activityId: 'a', userId: 'u' })
  assert.ok(calls.includes('gym_exercises'))
})

test('own-account name history / last session queries are owner-scoped', async () => {
  const eqs = []
  const q = { select: () => q, eq: (c, v) => (eqs.push([c, v]), q), neq: () => q, order: () => q, limit: async () => ({ data: [] }) }
  const client = { from: () => q }
  await fetchExerciseNameHistory(client, 'owner-1')
  await fetchLastSessionSets(client, 'owner-1', 'Squat', 'a')
  assert.ok(eqs.every(([c, v]) => c !== 'user_id' || v === 'owner-1'))
  assert.equal(eqs.filter(([c]) => c === 'user_id').length, 2)
  await assert.rejects(async () => fetchExerciseNameHistory(client, null))
})
