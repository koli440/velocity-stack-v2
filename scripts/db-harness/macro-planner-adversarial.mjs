// Adversarial checks for 20270186000000_macro_planner.sql (feature flag `macro_planner` + plans). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], { commit = false } = {}) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

const monday = (offsetWeeks) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}

export async function run(c) {
  for (const n of ['admin', 'rider', 'rider2', 'coach', 'coach2', 'stranger', 'ended', 'pending', 'blocked']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const rel = (coach, rider, status, extra = '') => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at,ended_at) VALUES ($1,$2,$3,$1,now(),${extra || 'NULL'})`, [coach, rider, status])
  await rel(U.coach, U.rider, 'active'); await rel(U.coach, U.rider2, 'active')
  await rel(U.ended, U.rider, 'ended', `now() - interval '5 days'`)
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,'pending',$1)`, [U.pending, U.rider])
  await rel(U.blocked, U.rider2, 'ended', `now() - interval '1 day'`)

  const race = new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10)
  const week = (i, over = {}) => ({ week_start: monday(i), kind: 'build', target_tl: 300 + i * 10, focus: 'Base', note: 'n', day_shape: 'RHEHEHE', tl_overridden: false, ...over })
  const plan = (rider, over = {}) => ({
    rider_id: rider, race_name: 'Nationals', race_date: race, race_length: 'medium', template: '3+1', build_weeks: 3, recovery_weeks: 1,
    ramp_ceiling_pct: 7, start_weekly_tl: 300, baseline_source: 'history', goal_ctl: 80, weeks: [week(0), week(1), week(2, { kind: 'recovery' })], ...over,
  })
  const save = (u, p) => as(c, u, `SELECT macro_plan_save($1::jsonb) AS id`, [JSON.stringify(p)], { commit: true })
  const get = (u, rider) => as(c, u, `SELECT macro_plan_get($1) AS p`, [rider])
  const mine = (u) => as(c, u, `SELECT my_macro_plan() AS p`)

  // Flag: default off, enforced in every RPC, admin only
  ok('flag off by default', (await as(c, U.coach, `SELECT my_macro_planner_enabled() AS e`)).rows[0].e === false)
  ok('coach cannot save while flag is off', !(await save(U.coach, plan(U.rider))).ok)
  ok('coach cannot get while flag is off', !(await get(U.coach, U.rider)).ok)
  ok('athlete RPC returns nothing while flag is off', (await mine(U.rider)).rows[0].p === null)
  ok('non-admin cannot read flag status', !(await as(c, U.coach, `SELECT admin_macro_planner_status()`)).ok)
  ok('non-admin cannot set global', !(await as(c, U.coach, `SELECT admin_set_macro_planner_global(true)`)).ok)
  ok('non-admin cannot allow-list', !(await as(c, U.coach, `SELECT admin_macro_planner_allow($1, true)`, [U.coach])).ok)
  ok('anon cannot call flag RPC', !(await as(c, null, `SELECT my_macro_planner_enabled()`)).ok)
  ok('anon cannot call plan RPCs', !(await as(c, null, `SELECT macro_plan_get($1)`, [U.rider])).ok && !(await as(c, null, `SELECT my_macro_plan()`)).ok)
  ok('client cannot read settings, allow-list or plan tables',
    !(await as(c, U.admin, `SELECT * FROM macro_planner_settings`)).ok && !(await as(c, U.admin, `SELECT * FROM macro_planner_allowlist`)).ok
    && !(await as(c, U.coach, `SELECT * FROM macro_plans`)).ok && !(await as(c, U.coach, `SELECT * FROM macro_plan_weeks`)).ok)
  ok('client cannot write plan tables', !(await as(c, U.coach, `INSERT INTO macro_plans(coach_id, rider_id) VALUES ($1, $2)`, [U.coach, U.rider])).ok)
  ok('flag is independent of coach_module', (await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })).ok
    && !(await save(U.coach, plan(U.rider))).ok)
  ok('admin allow-lists the coach', (await as(c, U.admin, `SELECT admin_macro_planner_allow($1, true)`, [U.coach], { commit: true })).ok)
  ok('flag on for coach only', (await as(c, U.coach, `SELECT my_macro_planner_enabled() AS e`)).rows[0].e && !(await as(c, U.rider, `SELECT my_macro_planner_enabled() AS e`)).rows[0].e)
  ok('admin sees status with allowlist', (await as(c, U.admin, `SELECT admin_macro_planner_status() AS s`)).rows[0].s.allowlist.length === 1)

  // Writes: access rules
  const a = await save(U.coach, plan(U.rider))
  ok('coach saves a plan for the own athlete', a.ok)
  const planId = a.rows[0].id
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1), ($2), ($3), ($4) ON CONFLICT DO NOTHING`, [U.stranger, U.ended, U.pending, U.blocked])
  ok('allow-listed stranger cannot save', !(await save(U.stranger, plan(U.rider))).ok)
  ok('allow-listed pending coach cannot save', !(await save(U.pending, plan(U.rider))).ok)
  ok('allow-listed ended coach cannot save', !(await save(U.ended, plan(U.rider))).ok)
  ok('allow-listed ended coach cannot read', !(await get(U.ended, U.rider)).ok)
  ok('coach cannot save for another coach\'s athlete', !(await save(U.coach, plan(U.stranger))).ok)
  ok('rider cannot save a plan for themselves', !(await save(U.rider, plan(U.rider))).ok)
  ok('stranger cannot get', !(await get(U.stranger, U.rider)).ok)
  ok('coach cannot spoof coach_id / id in the payload', (await save(U.coach, { ...plan(U.rider), coach_id: U.stranger, id: uid() })).ok
    && (await c.query(`SELECT count(*)::int AS n FROM macro_plans WHERE coach_id = $1`, [U.stranger])).rows[0].n === 0)

  // Reads
  const g = await get(U.coach, U.rider)
  ok('coach reads the plan with sorted weeks', g.ok && g.rows[0].p.id === planId && g.rows[0].p.weeks.length === 3 && g.rows[0].p.weeks[0].week_start === monday(0))
  ok('plan starts as a draft', g.rows[0].p.status === 'draft')
  ok('get for an athlete without a plan is null', (await get(U.coach, U.rider2)).rows[0].p === null)
  ok('draft is invisible to the athlete', (await mine(U.rider)).rows[0].p === null)

  // Validation
  const bad = async (name, over) => ok(`rejects ${name}`, !(await save(U.coach, plan(U.rider2, over))).ok)
  await bad('empty weeks', { weeks: [] })
  await bad('61 weeks', { weeks: Array.from({ length: 61 }, (_, i) => week(i)) })
  await bad('non-array weeks', { weeks: 'x' })
  await bad('a non-Monday week', { weeks: [{ ...week(0), week_start: monday(0).replace(/..$/, (d) => String(Number(d) + 1).padStart(2, '0')) }] })
  await bad('a duplicate week', { weeks: [week(0), week(0)] })
  await bad('a week after the race', { weeks: [week(0), week(40)] })
  await bad('unknown kind', { weeks: [week(0, { kind: 'peak' })] })
  await bad('negative target', { weeks: [week(0, { target_tl: -1 })] })
  await bad('huge target', { weeks: [week(0, { target_tl: 99999 })] })
  await bad('bad day shape', { weeks: [week(0, { day_shape: 'XXXXXXX' })] })
  await bad('long note', { weeks: [week(0, { note: 'x'.repeat(501) })] })
  await bad('long focus', { weeks: [week(0, { focus: 'x'.repeat(41) })] })
  await bad('empty race name', { race_name: '  ' })
  await bad('unknown race length', { race_length: 'tiny' })
  await bad('unknown template', { template: '9+9' })
  await bad('ceiling above 15', { ramp_ceiling_pct: 40 })
  await bad('missing starting TL', { start_weekly_tl: null })
  await bad('unknown baseline source', { baseline_source: 'guess' })
  await bad('past race for a new plan', { race_date: '2020-01-01' })
  await bad('garbage date', { race_date: 'tomorrow' })
  await bad('span over 60 weeks', { race_date: new Date(Date.now() + 900 * 86400000).toISOString().slice(0, 10) })
  ok('a failed save leaves no plan behind', (await c.query(`SELECT count(*)::int AS n FROM macro_plans WHERE rider_id = $1`, [U.rider2])).rows[0].n === 0)

  // Replace is atomic and idempotent
  ok('invalid replace keeps the old weeks', !(await save(U.coach, plan(U.rider, { weeks: [week(0), week(1, { target_tl: -5 })] }))).ok
    && (await c.query(`SELECT count(*)::int AS n FROM macro_plan_weeks WHERE plan_id = $1`, [planId])).rows[0].n === 3)
  const again = await save(U.coach, plan(U.rider, { race_name: 'Worlds', weeks: [week(0), week(1)] }))
  ok('saving again updates the same plan and replaces weeks', again.ok && again.rows[0].id === planId
    && (await c.query(`SELECT count(*)::int AS n FROM macro_plans WHERE rider_id = $1`, [U.rider])).rows[0].n === 1
    && (await c.query(`SELECT count(*)::int AS n FROM macro_plan_weeks WHERE plan_id = $1`, [planId])).rows[0].n === 2)
  const pastRace = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
  ok('past race date is accepted when updating an existing plan', (await save(U.coach, plan(U.rider, { race_date: pastRace, weeks: [week(-1)] }))).ok)
  ok('...and restored', (await save(U.coach, plan(U.rider, { race_name: 'Worlds', weeks: [week(0), week(1)] }))).ok)

  // Publish / athlete read-only timeline
  ok('stranger cannot publish', !(await as(c, U.stranger, `SELECT macro_plan_publish($1, true)`, [planId])).ok)
  ok('other coach cannot publish', !(await as(c, U.coach2, `SELECT macro_plan_publish($1, true)`, [planId])).ok)
  ok('athlete cannot publish', !(await as(c, U.rider, `SELECT macro_plan_publish($1, true)`, [planId])).ok)
  ok('coach publishes', (await as(c, U.coach, `SELECT macro_plan_publish($1, true)`, [planId], { commit: true })).ok)
  const m = await mine(U.rider)
  ok('athlete reads the published plan', m.ok && m.rows[0].p?.id === planId && m.rows[0].p.weeks.length === 2 && m.rows[0].p.coach_name === 'coach')
  ok('other riders and strangers see nothing', (await mine(U.rider2)).rows[0].p === null && (await mine(U.stranger)).rows[0].p === null)
  ok('athlete has no write path', !(await as(c, U.rider, `SELECT macro_plan_save($1::jsonb)`, [JSON.stringify(plan(U.rider))])).ok
    && !(await as(c, U.rider, `SELECT macro_plan_delete($1)`, [planId])).ok
    && !(await as(c, U.rider, `UPDATE macro_plans SET status = 'draft'`)).ok)
  await c.query(`DELETE FROM macro_planner_allowlist WHERE user_id = $1`, [U.coach])
  ok('turning the coach flag off hides the plan from the athlete too', (await mine(U.rider)).rows[0].p === null)
  ok('...and the coach is refused', !(await get(U.coach, U.rider)).ok)
  await c.query(`INSERT INTO macro_planner_allowlist(user_id) VALUES ($1)`, [U.coach])
  ok('global switch also enables it', (await as(c, U.admin, `SELECT admin_set_macro_planner_global(true)`, [], { commit: true })).ok
    && (await as(c, U.rider, `SELECT my_macro_planner_enabled() AS e`)).rows[0].e)
  await c.query(`UPDATE macro_planner_settings SET global_enabled = FALSE`)

  // Revocation
  await c.query(`UPDATE coaching_relationships SET status = 'ended', ended_at = now() WHERE coach_id = $1 AND rider_id = $2`, [U.coach, U.rider])
  ok('ended relationship: coach is refused immediately', !(await get(U.coach, U.rider)).ok && !(await save(U.coach, plan(U.rider))).ok && !(await as(c, U.coach, `SELECT macro_plan_publish($1, false)`, [planId])).ok)
  ok('ended relationship: athlete no longer sees the plan', (await mine(U.rider)).rows[0].p === null)
  await c.query(`UPDATE coaching_relationships SET status = 'active', ended_at = NULL WHERE coach_id = $1 AND rider_id = $2`, [U.coach, U.rider])
  ok('re-activated pair sees the plan again', (await mine(U.rider)).rows[0].p?.id === planId)
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.coach])
  ok('a block hides the plan both ways', (await mine(U.rider)).rows[0].p === null && !(await get(U.coach, U.rider)).ok)
  await c.query(`DELETE FROM blocks WHERE blocker_id = $1`, [U.rider])
  await c.query(`UPDATE coaching_relationships SET status = 'active', ended_at = NULL WHERE coach_id = $1 AND rider_id = $2`, [U.coach, U.rider])

  // Delete
  ok('stranger cannot delete', !(await as(c, U.stranger, `SELECT macro_plan_delete($1)`, [planId])).ok)
  ok('coach deletes; weeks cascade', (await as(c, U.coach, `SELECT macro_plan_delete($1)`, [planId], { commit: true })).ok
    && (await c.query(`SELECT count(*)::int AS n FROM macro_plan_weeks WHERE plan_id = $1`, [planId])).rows[0].n === 0)

  ok('deleted plan leaves no rows', (await c.query(`SELECT count(*)::int AS n FROM macro_plans`)).rows[0].n === 0)
}
