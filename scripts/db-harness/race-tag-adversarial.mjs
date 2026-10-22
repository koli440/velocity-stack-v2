// Adversarial checks for 20261230000000_activity_race_tag.sql (issue #294). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], commit = true) {
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
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

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
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON activities, profiles, calendar_races TO authenticated`)
  const mk = async (owner) => (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility) VALUES ($1,'t', now(), 'private') RETURNING id`, [owner])).rows[0].id
  const st = async (id) => (await c.query(`SELECT is_race, race_tag_auto, race_set_by, race_set_by_coach FROM activities WHERE id=$1`, [id])).rows[0]
  const rpc = (u, id, v) => as(c, u, `SELECT set_activity_race($1, $2) j`, [id, v])
  const link = (u, rider, act) => as(c, u, `INSERT INTO calendar_races(rider_id, race_date, name, activity_id) VALUES ($1, CURRENT_DATE, 'Cup', $2) RETURNING id`, [rider, act])

  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
  const a = await mk(U.rider)
  ok('default: not a race', (await st(a)).is_race === false)

  // auto tag via link; unlink removes only the auto tag
  const l1 = await link(U.rider, U.rider, a)
  let s = await st(a)
  ok('link auto-tags', l1.ok && s.is_race && s.race_tag_auto && s.race_set_by === null && s.race_set_by_coach === false)
  await as(c, U.rider, `UPDATE calendar_races SET activity_id = NULL WHERE id=$1`, [l1.rows[0].id])
  ok('unlinking removes an auto tag', !(await st(a)).is_race)

  // manual tag survives unlink / delete
  ok('rider sets tag via RPC', (await rpc(U.rider, a, true)).ok)
  s = await st(a)
  ok('manual tag stamped by rider, not auto', s.is_race && !s.race_tag_auto && s.race_set_by === U.rider && !s.race_set_by_coach)
  const l2 = await link(U.rider, U.rider, a)
  ok('linking a manually tagged ride keeps it manual', (await st(a)).race_tag_auto === false)
  await as(c, U.rider, `DELETE FROM calendar_races WHERE id=$1`, [l2.rows[0].id])
  ok('deleting the race keeps a manual tag', (await st(a)).is_race)

  // manual clear while linked, then relink re-tags
  const l3 = await link(U.rider, U.rider, a)
  ok('rider clears tag', (await rpc(U.rider, a, false)).ok && !(await st(a)).is_race)
  await as(c, U.rider, `UPDATE calendar_races SET activity_id=NULL WHERE id=$1`, [l3.rows[0].id])
  await as(c, U.rider, `UPDATE calendar_races SET activity_id=$2 WHERE id=$1`, [l3.rows[0].id, a])
  s = await st(a)
  ok('relinking tags again as auto', s.is_race && s.race_tag_auto)

  // forging flags / stamps from clients
  await as(c, U.rider, `UPDATE activities SET race_tag_auto=false, race_set_by=$2, race_set_by_coach=true WHERE id=$1`, [a, U.coach])
  s = await st(a)
  ok('auto flag and stamps cannot be forged', s.race_tag_auto === true && s.race_set_by === null && s.race_set_by_coach === false)
  const forged = await mk(U.rider)
  await as(c, U.rider, `UPDATE activities SET is_race=true WHERE id=$1`, [forged])
  s = await st(forged)
  ok('direct rider write is a manual tag', s.is_race && !s.race_tag_auto && s.race_set_by === U.rider)
  const ins = (await as(c, U.rider, `INSERT INTO activities(user_id,title,activity_date,is_race,race_tag_auto,race_set_by_coach) VALUES ($1,'x',now(),true,true,true) RETURNING id`, [U.rider])).rows[0].id
  s = await st(ins)
  ok('insert cannot set auto flag or coach stamp', s.is_race && !s.race_tag_auto && !s.race_set_by_coach)

  // coach: RPC only, audited, notified, stamped
  const b = await mk(U.rider)
  ok('active coach sets tag via RPC', (await rpc(U.coach, b, true)).ok)
  s = await st(b)
  ok('coach tag stamped from auth.uid()', s.is_race && s.race_set_by === U.coach && s.race_set_by_coach && !s.race_tag_auto)
  const audit = (await c.query(`SELECT old_values, new_values FROM coach_edits WHERE rider_id=$1 AND row_id=$2`, [U.rider, b])).rows
  ok('coach edit audited', audit.length === 1 && audit[0].old_values.is_race === false && audit[0].new_values.is_race === true)
  ok('rider notified', (await c.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND type='coach_edited'`, [U.rider])).rows[0].n >= 1)
  ok('no-op coach edit is not audited again', (await rpc(U.coach, b, true)).ok && (await c.query(`SELECT count(*)::int n FROM coach_edits WHERE row_id=$1`, [b])).rows[0].n === 1)
  ok('coach reads tag via shared_activities', (await as(c, U.coach, `SELECT is_race, race_set_by_coach FROM shared_activities WHERE id=$1`, [b])).rows[0]?.race_set_by_coach === true)
  ok('coach cannot update activities directly', (await as(c, U.coach, `UPDATE activities SET is_race=false WHERE id=$1`, [b])).rowCount === 0)
  const bc = await link(U.coach, U.rider, b)
  ok('coach linking a tagged ride keeps the coach-set tag', bc.ok && (await st(b)).race_tag_auto === false)
  ok('rider RPC change clears the coach label', (await rpc(U.rider, b, false)).ok && (await st(b)).race_set_by_coach === false)

  // everyone else
  const other = await mk(U.rider2)
  for (const n of ['stranger', 'pending', 'ended', 'blocked']) {
    const x = await rpc(U[n], a, false)
    ok(`${n} cannot change rider's tag`, !x.ok && /Activity not found/.test(x.err))
  }
  ok('rider cannot tag another rider', !(await rpc(U.rider, other, true)).ok)
  ok('blocked coach cannot tag rider2', !(await rpc(U.blocked, other, true)).ok)
  ok('coach cannot tag a ride of a rider he does not coach', !(await rpc(U.coach, other, true)).ok)
  ok('missing id looks the same', /Activity not found/.test((await rpc(U.coach, uid(), true)).err))
  ok('anon cannot call RPC', !(await as(c, null, `SELECT set_activity_race($1, true)`, [a])).ok)
  ok('null flag rejected', !(await rpc(U.rider, a, null)).ok)
  ok('a coach cannot link a race to someone else\'s activity (no tag leak)', !(await link(U.coach, U.rider, other)).ok && !(await st(other)).is_race)
  ok('tag helper functions are not callable by clients', !(await as(c, U.rider, `SELECT sync_race_tag()`)).ok)

  // deleting a linked activity is fine
  const d = await mk(U.rider)
  await link(U.rider, U.rider, d)
  await c.query(`DELETE FROM activities WHERE id=$1`, [d]); ok('deleting an auto-tagged linked activity works', true)
  console.log('race tag adversarial checks passed')
}
