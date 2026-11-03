// Adversarial checks for 20270124000000_gym_load.sql (issue #336). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('ROLLBACK')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'off']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,'active',$1), ($1,$3,'active',$1)`, [U.coach, U.rider, U.off])
  await c.query(`UPDATE profiles SET include_gym_in_fitness = FALSE WHERE id = $1`, [U.off])
  ok('toggle defaults to ON', (await c.query(`SELECT include_gym_in_fitness FROM profiles WHERE id=$1`, [U.rider])).rows[0].include_gym_in_fitness === true)

  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON activities, profiles TO authenticated`)
  const ins = async (owner, type, model, load) =>
    (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, activity_type, moving_time_s, avg_hr, training_load, gym_load_model) VALUES ($1,'t', now() - interval '1 day', 'private', $2, 3600, 120, $3, $4) RETURNING id`, [owner, type, load, model])).rows[0].id
  const gymScored = await ins(U.rider, 'gym', 1, 49.2)
  const gymUnscored = await ins(U.rider, 'gym', null, null)
  await ins(U.rider, 'ride', null, 55)
  const gymOff = await ins(U.off, 'gym', 1, 30)
  await ins(U.off, 'ride', null, 20)
  await c.query(`INSERT INTO gym_load_details(activity_id, user_id, model, detail) VALUES ($1,$2,1,'{"load":49.2}')`, [gymScored, U.rider])

  const r = await as(c, U.coach, `SELECT * FROM coach_fitness_activities()`)
  ok('coach RPC works', r.ok)
  ok('scored gym of an INCLUDING rider is returned with its marker', r.rows.some((x) => x.id === gymScored && x.activity_type === 'gym' && x.gym_load_model === 1 && x.include_gym === true))
  ok('unscored gym is not returned', !r.rows.some((x) => x.id === gymUnscored))
  ok('toggle OFF: rider gym rows are not returned, rides are', !r.rows.some((x) => x.id === gymOff) && r.rows.some((x) => x.rider_id === U.off && x.include_gym === false))
  ok('rides unchanged', r.rows.filter((x) => x.activity_type === 'ride').length === 2)
  ok('stranger sees nothing', (await as(c, U.stranger, `SELECT * FROM coach_fitness_activities()`)).rows.length === 0)

  ok('coach reads the breakdown through RLS', (await as(c, U.coach, `SELECT * FROM gym_load_details WHERE activity_id=$1`, [gymScored])).rows.length === 1)
  ok('rider reads own breakdown', (await as(c, U.rider, `SELECT * FROM gym_load_details WHERE activity_id=$1`, [gymScored])).rows.length === 1)
  ok('stranger cannot read the breakdown', (await as(c, U.stranger, `SELECT * FROM gym_load_details WHERE activity_id=$1`, [gymScored])).rows.length === 0)
  ok('rider cannot write the breakdown', !(await as(c, U.rider, `UPDATE gym_load_details SET detail='{}' WHERE activity_id=$1`, [gymScored])).ok || (await c.query(`SELECT detail FROM gym_load_details WHERE activity_id=$1`, [gymScored])).rows[0].detail.load === 49.2)
  ok('shared_activities exposes the marker', (await as(c, U.coach, `SELECT gym_load_model FROM shared_activities WHERE id=$1`, [gymScored])).ok)

  await c.query(`INSERT INTO gym_session_edits(activity_id, user_id, edited_by, edited_by_coach) VALUES ($1,$2,$2,false)`, [gymScored, U.rider])
  const st = (await c.query(`SELECT gym_load_stale FROM activities WHERE id=$1`, [gymScored])).rows[0].gym_load_stale
  ok('editing a session marks its load stale', st === true)
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
}
