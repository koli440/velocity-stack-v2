import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeAndStoreGymLoad, GYM_LOAD_MODEL_VERSION } from '../server/gymLoadStore.js'

const fx = JSON.parse(readFileSync(new URL('./fixtures/gpath-2026-11-03.json', import.meta.url), 'utf8'))

// Minimal in-memory PostgREST-like client for the tables the store touches.
function fakeClient(tables) {
  const writes = { updates: [], upserts: [], deletes: [] }
  const from = (name) => {
    let rows = tables[name] || []
    const filters = []
    const q = {
      select() { return q },
      eq(c, v) { filters.push((r) => r[c] === v); return q },
      neq(c, v) { filters.push((r) => r[c] !== v); return q },
      lt(c, v) { filters.push((r) => r[c] < v); return q },
      in(c, v) { filters.push((r) => v.includes(r[c])); return q },
      order() { return q },
      range(a, b) { return Promise.resolve({ data: run().slice(a, b + 1), error: null }) },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }) },
      update(v) { writes.updates.push({ table: name, v }); return { eq: () => Promise.resolve({ error: null }) } },
      upsert(v) { writes.upserts.push({ table: name, v }); return Promise.resolve({ error: null }) },
      delete() { return { eq: () => { writes.deletes.push(name); return Promise.resolve({ error: null }) } } },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej) },
    }
    const run = () => rows.filter((r) => filters.every((f) => f(r)))
    return q
  }
  return { from, writes }
}

const exerciseRows = fx.exercises.map((e, i) => ({ id: `e${i}`, position: i, name: e.name, category: null, subtype: null, notes: null }))
const setRows = fx.exercises.flatMap((e, i) => e.sets.map((s, j) => ({ ...s, exercise_id: `e${i}`, position: j })))

test('stores the load, model version and breakdown for the real GPath session (49.2)', async () => {
  const client = fakeClient({
    activities: [{ id: 'a1', user_id: 'u', activity_type: 'gym', activity_date: fx.date, elapsed_time_s: fx.durationS, avg_hr: fx.avgHr }],
    gym_exercises: exerciseRows.map((e) => ({ ...e, activity_id: 'a1', user_id: 'u', name_key: e.name.toLowerCase() })),
    gym_sets: setRows.map((s) => ({ ...s, activity_id: 'a1' })),
  })
  const r = await computeAndStoreGymLoad(client, 'a1')
  assert.equal(r.status, 'stored')
  assert.equal(r.load, 49.2)
  const upd = client.writes.updates.find((u) => u.table === 'activities').v
  assert.equal(upd.training_load, 49.2)
  assert.equal(upd.gym_load_model, GYM_LOAD_MODEL_VERSION)
  assert.equal(upd.gym_load_stale, false)
  const det = client.writes.upserts.find((u) => u.table === 'gym_load_details').v
  assert.equal(det.detail.load, 49.2)
  assert.equal(det.detail.breakdown.length, 4)
})

test('sessions without sets get no estimate but are marked scored', async () => {
  const client = fakeClient({ activities: [{ id: 'a2', user_id: 'u', activity_type: 'gym', activity_date: fx.date }] })
  const r = await computeAndStoreGymLoad(client, 'a2')
  assert.equal(r.status, 'no_detail')
  const upd = client.writes.updates[0].v
  assert.equal(upd.training_load, null)
  assert.equal(upd.gym_load_model, null)
  assert.ok(upd.gym_load_at)
})

test('non-gym and missing activities are left alone', async () => {
  const client = fakeClient({ activities: [{ id: 'r1', user_id: 'u', activity_type: 'ride', activity_date: fx.date }] })
  assert.equal((await computeAndStoreGymLoad(client, 'r1')).status, 'not_gym')
  assert.equal((await computeAndStoreGymLoad(client, 'nope')).status, 'not_found')
  assert.equal(client.writes.updates.length, 0)
})
