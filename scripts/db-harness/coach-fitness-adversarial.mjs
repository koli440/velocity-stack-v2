// Adversarial checks for 20261229000000_coach_fitness_activities.sql (issue #290 phase 2). Run with harness.mjs, see README.
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
  for (const n of ['rider', 'rider2', 'coach', 'stranger', 'pending', 'ended', 'blocked', 'rider3']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending')
  await rel(U.coach, U.rider, 'active'); await rel(U.coach, U.rider2, 'active')
  await rel(U.blocked, U.rider3, 'active')
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider3, U.blocked])

  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON activities, profiles, lactate_threshold_history TO authenticated`)
  await c.query(`INSERT INTO lactate_threshold_history(user_id, effective_from, lt2_hr) VALUES ($1,'2020-01-01',170), ($1,'2030-01-01',150)`, [U.rider])
  const ins = (owner, title, daysAgo, extra = '') =>
    c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, ${extra ? extra.split('=')[0] + ',' : ''} moving_time_s, avg_hr) VALUES ($1,$2, now() - ($3 || ' days')::interval, 'private', ${extra ? extra.split('=')[1] + ',' : ''} 3600, 140)`, [owner, title, String(daysAgo)])
  await ins(U.rider, 'a', 1, 'training_load=55')
  await ins(U.rider, 'b', 2)
  await ins(U.rider, 'old', 900)
  await ins(U.rider2, 'c', 3)
  await ins(U.rider3, 'blocked-rider', 1)
  await ins(U.stranger, 'mine', 1)
  await ins(U.coach, 'coach-own', 1)

  const call = (u, args = '') => as(c, u, `SELECT * FROM coach_fitness_activities(${args})`)
  const r = await call(U.coach)
  ok('active coach sees both athletes only (not own/stranger)', r.ok && r.rows.length === 3 && r.rows.every((x) => [U.rider, U.rider2].includes(x.rider_id)))
  ok('window excludes the 900-day-old ride', r.rows.length === 3)
  ok('lthr resolved from history valid on date (170, not future 150)', r.rows.filter((x) => x.rider_id === U.rider).every((x) => Number(x.lthr) === 170))
  ok('rider without LT history has null lthr', r.rows.find((x) => x.rider_id === U.rider2).lthr === null)
  ok('first_activity_at is whole-history (900 days ago)', new Date(r.rows.find((x) => x.rider_id === U.rider).first_activity_at) < new Date(Date.now() - 800 * 86400000))
  ok('stored load passed through', r.rows.some((x) => Number(x.training_load) === 55))
  ok('p_riders filters', (await call(U.coach, `ARRAY['${U.rider2}']::uuid[]`)).rows.length === 1)
  ok('p_riders cannot widen to stranger', (await call(U.coach, `ARRAY['${U.stranger}']::uuid[]`)).rows.length === 0)
  ok('large p_days clamped (900-day ride still excluded at 800)', (await call(U.coach, 'NULL, 100000')).rows.length === 3)
  ok('stranger sees nothing', (await call(U.stranger)).rows.length === 0)
  ok('pending coach sees nothing', (await call(U.pending)).rows.length === 0)
  ok('ended coach sees nothing', (await call(U.ended)).rows.length === 0)
  ok('blocked coach sees nothing', (await call(U.blocked)).rows.length === 0)
  ok('rider sees nothing through the coach function (own rides not returned)', (await call(U.rider)).rows.length === 0)
  ok('anon cannot execute', !(await call(null)).ok)
  ok('columns expose no GPS/title', !Object.keys(r.rows[0]).some((k) => /title|lat|lng|route|file|time_series/.test(k)))
  await c.query(`UPDATE coaching_relationships SET status='ended' WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider2])
  ok('revocation is immediate', (await call(U.coach)).rows.every((x) => x.rider_id === U.rider))
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
}
