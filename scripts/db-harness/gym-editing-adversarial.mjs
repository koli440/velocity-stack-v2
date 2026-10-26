// Adversarial checks for 20270116000000_gym_editing.sql (issue #335). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
let pass = 0
async function as(c, user, sql, params = [], commit = false) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
const save = (c, user, act, ex, commit = true) => as(c, user, `SELECT save_gym_session($1, $2::jsonb) AS r`, [act, JSON.stringify(ex)], commit)
const EX = [{ name: '  Back  squat ', sets: [
  { kind: 'warmup', reps: 5, weight_kg: 60, rpe: 5, rest_s: 60 },
  { reps: 5, weight_kg: 100, rpe: 8.5, rir: 1.5, tempo: '3-1-1-0', side: 'left', metrics: { mean_velocity_ms: 0.5 }, notes: 'n' },
] }, { name: 'Pull-up', sets: [{ reps: 8, load_mode: 'bodyweight' }] }]

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'rider2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON activities, profiles TO authenticated`)
  const mk = async (owner, type = 'gym') => (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, activity_type) VALUES ($1,'t', now(), 'private', $2) RETURNING id`, [owner, type])).rows[0].id
  const act = await mk(U.rider), ride = await mk(U.rider, 'ride'), act2 = await mk(U.rider2)

  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)

  let r = await save(c, U.rider, act, EX)
  ok('rider saves', r.ok && r.rows[0].r.sets === 3 && r.rows[0].r.edited_by_coach === false)
  const rows = (await c.query(`SELECT e.name, e.name_key, s.* FROM gym_sets s JOIN gym_exercises e ON e.id = s.exercise_id WHERE s.activity_id=$1 ORDER BY s.position`, [act])).rows
  ok('fields stored', rows[1].rpe == 8.5 && rows[1].rir == 1.5 && rows[1].tempo === '3-1-1-0' && rows[1].side === 'left' && rows[1].metrics.mean_velocity_ms === 0.5 && rows[0].kind === 'warmup' && rows[2].load_mode === 'bodyweight')
  ok('name trimmed + normalised key', rows[0].name === 'Back  squat' && rows[0].name_key === 'back squat')
  ok('edited flag set, not coach', (await c.query(`SELECT edited_by_coach, edited_by FROM gym_session_edits WHERE activity_id=$1`, [act])).rows[0].edited_by === U.rider)

  r = await save(c, U.rider, act, [{ name: 'Only', sets: [{ reps: 1 }] }])
  ok('re-save replaces', r.ok && (await c.query(`SELECT count(*)::int n FROM gym_sets WHERE activity_id=$1`, [act])).rows[0].n === 1)

  ok('coach saves rider session', (r = await save(c, U.coach, act, EX)).ok && r.rows[0].r.edited_by_coach === true)
  ok('coach edit audited', (await c.query(`SELECT count(*)::int n FROM coach_edits WHERE rider_id=$1 AND table_name='gym_sets' AND coach_id=$2`, [U.rider, U.coach])).rows[0].n === 1)
  ok('coach notified', (await c.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND type='coach_edited'`, [U.rider])).rows[0].n === 1)
  ok('edit stamp says coach', (await c.query(`SELECT edited_by_coach, edited_by FROM gym_session_edits WHERE activity_id=$1`, [act])).rows[0].edited_by === U.coach)
  ok('rider edit clears coach label', (await save(c, U.rider, act, EX)).ok && (await c.query(`SELECT edited_by_coach FROM gym_session_edits WHERE activity_id=$1`, [act])).rows[0].edited_by_coach === false)

  for (const [n, who] of [['stranger', U.stranger], ['pending coach', U.pending], ['ended coach', U.ended], ['other rider', U.rider2]]) {
    r = await save(c, who, act, EX)
    ok(`${n} rejected`, !r.ok && /Activity not found/.test(r.err))
  }
  ok('missing activity same answer', /Activity not found/.test((await save(c, U.rider, uid(), EX)).err))
  ok('anon cannot call', !(await as(c, null, `SELECT save_gym_session($1,'[]')`, [act])).ok)
  ok('rides rejected', /Only gym/.test((await save(c, U.rider, ride, EX)).err))

  const bad = async (name, set) => ok(`reject ${name}`, !(await save(c, U.rider, act, [{ name: 'x', sets: [set] }])).ok)
  await bad('rpe 11', { rpe: 11 }); await bad('rpe 0', { rpe: 0 }); await bad('rpe 7.3', { rpe: 7.3 })
  await bad('rir -1', { rir: -1 }); await bad('kind', { kind: 'bogus' }); await bad('tempo', { tempo: 'abc' })
  await bad('side', { side: 'up' }); await bad('load_mode', { load_mode: 'x' }); await bad('negative reps', { reps: -1 })
  await bad('huge weight', { weight_kg: 99999 }); await bad('metrics array', { metrics: [] })
  ok('reject empty name', !(await save(c, U.rider, act, [{ name: ' ', sets: [] }])).ok)
  ok('reject non-array', !(await save(c, U.rider, act, { a: 1 })).ok)
  ok('failed save leaves data intact', (await c.query(`SELECT count(*)::int n FROM gym_sets WHERE activity_id=$1`, [act])).rows[0].n === 3)

  // RLS: coach reads, stranger does not, direct coach write blocked
  ok('coach reads sets', (await as(c, U.coach, `SELECT count(*)::int n FROM gym_sets WHERE activity_id=$1`, [act])).rows[0].n === 3)
  ok('stranger cannot read private sets', (await as(c, U.stranger, `SELECT count(*)::int n FROM gym_sets WHERE activity_id=$1`, [act])).rows[0].n === 0)
  ok('coach cannot direct-write sets', (await as(c, U.coach, `UPDATE gym_sets SET reps=99 WHERE activity_id=$1`, [act])).rowCount === 0)
  ok('coach reads edit flag', (await as(c, U.coach, `SELECT count(*)::int n FROM gym_session_edits WHERE activity_id=$1`, [act])).rows[0].n === 1)
  ok('nobody writes the edit flag directly', !(await as(c, U.rider2, `INSERT INTO gym_session_edits(activity_id,user_id) VALUES ($1,$2)`, [act2, U.rider2])).ok)
  console.log(`${pass} checks passed`)
}
