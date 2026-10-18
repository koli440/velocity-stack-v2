import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
let pass = 0
async function as(c, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('ROLLBACK'); return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) { await c.query('ROLLBACK'); return { ok: false, err: e.message } }
}
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'blocked', 'rider2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.blocked])
  await rel(U.blocked, U.rider2, 'active'); await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider2, U.blocked])
  await c.query(`INSERT INTO connections(user_id, provider, external_athlete_id, api_key, status) VALUES ($1,'intervals','i123','SECRET-KEY','active')`, [U.rider])
  const w = await c.query(`INSERT INTO planned_workouts(rider_id, workout_date, discipline, title, created_by, updated_by) VALUES ($1, current_date+1,'ride','W1',$1,$1) RETURNING id`, [U.rider])
  const wid = w.rows[0].id
  await c.query(`INSERT INTO planned_workout_pushes(workout_id, rider_id, intervals_event_id, push_status, pushed_hash) VALUES ($1,$2,'555','pushed','h')`, [wid, U.rider])

  // idempotent re-apply
  const mig = fs.readFileSync(process.env.MIG, 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/g, '')
  await c.query(mig); ok('migration is re-appliable', true)
  ok('one cron job only', (await c.query(`SELECT count(*)::int n FROM cron.job WHERE jobname='planned-workout-push'`)).rows[0].n === 1)

  // push rows visibility
  const sel = (u) => as(c, u, `SELECT workout_id FROM planned_workout_pushes`)
  ok('rider sees own push row', (await sel(U.rider)).rows.length === 1)
  ok('active coach sees push row', (await sel(U.coach)).rows.length === 1)
  for (const n of ['stranger', 'pending', 'ended', 'blocked', 'rider2']) ok(`${n} sees no push rows`, (await sel(U[n])).rows.length === 0)
  ok('anon cannot select pushes', !(await as(c, null, `SELECT 1 FROM planned_workout_pushes`)).ok)
  // no direct writes
  for (const q of [`UPDATE planned_workout_pushes SET intervals_event_id='x'`, `DELETE FROM planned_workout_pushes`, `INSERT INTO planned_workout_pushes(workout_id,rider_id) VALUES (gen_random_uuid(), '${U.rider}')`])
    for (const u of [U.rider, U.coach]) ok(`no direct write (${q.slice(0, 18)}) as ${u === U.rider ? 'rider' : 'coach'}`, !(await as(c, u, q)).ok)
  // connections secrets
  ok('coach cannot read connections', (await as(c, U.coach, `SELECT * FROM connections`)).rows?.length === 0 || !(await as(c, U.coach, `SELECT * FROM connections`)).ok)
  ok('coach cannot read api_key col', !(await as(c, U.coach, `SELECT api_key FROM connections`)).ok)
  ok('rider cannot read api_key col', !(await as(c, U.rider, `SELECT api_key FROM connections`)).ok)
  ok('rider can read push flag', (await as(c, U.rider, `SELECT push_planned_workouts, planned_push_error FROM connections`)).rows.length === 1)
  ok('rider cannot write flag directly', !(await as(c, U.rider, `UPDATE connections SET push_planned_workouts = true`)).ok)
  ok('coach cannot write flag directly', !(await as(c, U.coach, `UPDATE connections SET push_planned_workouts = true`)).ok)
  // context RPC
  const ctx = (u, r) => as(c, u, `SELECT planned_push_context($1) j`, [r])
  const rc = await ctx(U.coach, U.rider)
  ok('coach context has no secrets', rc.ok && Object.keys(rc.rows[0].j).sort().join() === 'auto_enabled,connected,is_self' && rc.rows[0].j.connected === true)
  ok('rider context ok', (await ctx(U.rider, U.rider)).ok)
  for (const n of ['stranger', 'pending', 'ended', 'blocked']) ok(`${n} context denied`, !(await ctx(U[n], U.rider)).ok)
  ok('rider cannot ask for other rider', !(await ctx(U.rider, U.rider2)).ok)
  ok('anon cannot call context', !(await as(c, null, `SELECT planned_push_context($1)`, [U.rider])).ok)
  ok('anon cannot call set_planned_push_enabled', !(await as(c, null, `SELECT set_planned_push_enabled(true)`)).ok)
  ok('cron fn not callable by authenticated', !(await as(c, U.rider, `SELECT sync_trigger_planned_push()`)).ok)
  // setting toggle
  ok('toggle on requires connection', !(await as(c, U.stranger, `SELECT set_planned_push_enabled(true)`)).ok)
  await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated'); await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [U.rider])
  await c.query(`SELECT set_planned_push_enabled(true)`)
  ok('toggle on works for rider', (await c.query(`SELECT push_planned_workouts f FROM connections`)).rows[0].f === true)
  await c.query('COMMIT')
  ok('default OFF for others', (await c.query(`SELECT count(*)::int n FROM connections WHERE push_planned_workouts AND user_id<>$1`, [U.rider])).rows[0].n === 0)
  // cron trigger: fires only with something to do
  await c.query(`DELETE FROM net.calls`)
  await c.query(`SELECT sync_trigger_planned_push()`)
  ok('cron posts when flag on', (await c.query(`SELECT url, headers FROM net.calls`)).rows[0]?.url.endsWith('/api/planned-workouts/push/run'))
  // tombstones: delete by rider and coach
  ok('coach can delete planned workout (RLS)', (await as(c, U.coach, `DELETE FROM planned_workouts WHERE id=$1`, [wid])).rowCount === 1)
  ok('stranger cannot delete', (await as(c, U.stranger, `DELETE FROM planned_workouts WHERE id=$1`, [wid])).rowCount === 0)
  await c.query(`DELETE FROM planned_workouts WHERE id=$1`, [wid])
  const t = await c.query(`SELECT push_status FROM planned_workout_pushes WHERE workout_id=$1`, [wid])
  ok('delete leaves pending_delete tombstone', t.rows[0]?.push_status === 'pending_delete')
  ok('tombstone hidden from rider/coach', (await sel(U.rider)).rows.length === 0 && (await sel(U.coach)).rows.length === 0)
  const w2 = (await c.query(`INSERT INTO planned_workouts(rider_id, workout_date, discipline, title, created_by, updated_by) VALUES ($1, current_date+2,'ride','W2',$1,$1) RETURNING id`, [U.rider])).rows[0].id
  await c.query(`INSERT INTO planned_workout_pushes(workout_id, rider_id) VALUES ($1,$2)`, [w2, U.rider])
  await c.query(`DELETE FROM planned_workouts WHERE id=$1`, [w2])
  ok('never-pushed delete leaves no row', (await c.query(`SELECT 1 FROM planned_workout_pushes WHERE workout_id=$1`, [w2])).rowCount === 0)
  // cron fires for tombstone even when flag off
  await c.query(`UPDATE connections SET push_planned_workouts=false`); await c.query(`DELETE FROM net.calls`); await c.query(`SELECT sync_trigger_planned_push()`)
  ok('cron fires for tombstones', (await c.query(`SELECT 1 FROM net.calls`)).rowCount === 1)
  // disconnect resets
  await as(c, U.rider, `SELECT 1`)
  await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated'); await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [U.rider])
  await c.query(`SELECT disconnect_connection('intervals')`); await c.query('COMMIT')
  ok('disconnect clears mappings', (await c.query(`SELECT 1 FROM planned_workout_pushes WHERE rider_id=$1`, [U.rider])).rowCount === 0)
  await c.query(`DELETE FROM net.calls`); await c.query(`SELECT sync_trigger_planned_push()`)
  ok('cron silent when nothing to do', (await c.query(`SELECT 1 FROM net.calls`)).rowCount === 0)
  // profile deletion cascade works
  const w3 = (await c.query(`INSERT INTO planned_workouts(rider_id, workout_date, discipline, title, created_by, updated_by) VALUES ($1, current_date+2,'ride','W3',$1,$1) RETURNING id`, [U.rider2])).rows[0].id
  await c.query(`INSERT INTO planned_workout_pushes(workout_id, rider_id, intervals_event_id, push_status) VALUES ($1,$2,'9','pushed')`, [w3, U.rider2])
  await c.query(`DELETE FROM auth.users WHERE id=$1`, [U.rider2])
  ok('user deletion cascades (no leftover pushes)', (await c.query(`SELECT 1 FROM planned_workout_pushes WHERE rider_id=$1`, [U.rider2])).rowCount === 0)
  console.log('ALL OK', pass)
}
