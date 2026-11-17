// Adversarial checks for 20270182000000_coach_plans.sql (coach plans, founding coaches, accept limit). Run with harness.mjs, see README.
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

export async function run(c) {
  for (const n of ['admin', 'coach', 'founder', 'r1', 'r2', 'r3', 'r4', 'r5']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await c.query(`UPDATE coach_module_settings SET global_enabled = TRUE`)
  for (const k of ['coach', 'founder']) {
    await c.query(`INSERT INTO coach_cards(coach_id, slug, is_public, is_listed) VALUES ($1, $2, TRUE, TRUE) ON CONFLICT DO NOTHING`, [U[k], k + '-slug'])
  }
  const pend = async (coach, rider) => (await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,'pending',$2) RETURNING id`, [coach, rider])).rows[0].id
  const accept = (coach, id) => as(c, coach, `SELECT accept_coaching($1)`, [id], { commit: true })

  ok('tables have no client privileges', !(await as(c, U.coach, `SELECT * FROM coach_plan_tiers`)).ok && !(await as(c, U.coach, `SELECT * FROM coach_founders`)).ok)
  ok('non-admin cannot read admin status', !(await as(c, U.coach, `SELECT admin_coach_plans_status()`)).ok)
  ok('non-admin cannot enforce', !(await as(c, U.coach, `SELECT admin_set_coach_plans(TRUE, 5)`)).ok)
  ok('non-admin cannot grant', !(await as(c, U.coach, `SELECT admin_grant_founder($1, 'free')`, [U.coach])).ok)
  ok('anon cannot call my_coach_plan', !(await as(c, null, `SELECT my_coach_plan()`)).ok)
  const p0 = (await as(c, U.coach, `SELECT my_coach_plan() AS p`)).rows[0].p
  ok('default: not enforced, Free, limit 3, 4 tiers', p0.enforced === false && p0.tier_key === 'free' && p0.limit === 3 && p0.tiers.length === 4 && p0.active === 0)

  // Enforcement off: more than the limit is accepted
  const ids = []
  for (const r of ['r1', 'r2', 'r3', 'r4']) ids.push(await pend(U.coach, U[r]))
  for (const id of ids.slice(0, 4)) ok('accept works while enforcement is off', (await accept(U.coach, id)).ok)
  ok('usage counts active only', (await as(c, U.coach, `SELECT (my_coach_plan()->>'active')::int AS n`)).rows[0].n === 4)

  // Enforcement on: existing stay, NEW acceptance above limit blocked
  ok('admin enforces', (await as(c, U.admin, `SELECT admin_set_coach_plans(TRUE, NULL)`, [], { commit: true })).ok)
  const id5 = await pend(U.coach, U.r5)
  const blocked = await accept(U.coach, id5)
  ok('new acceptance above the limit is blocked', !blocked.ok && /limit/i.test(blocked.err))
  ok('existing athletes stay active', (await c.query(`SELECT count(*)::int n FROM coaching_relationships WHERE coach_id=$1 AND status='active'`, [U.coach])).rows[0].n === 4)
  ok('chat/export unaffected: coach still sees plan', (await as(c, U.coach, `SELECT my_coach_plan()`)).ok)
  // Below the limit still works for another coach
  const fid = await pend(U.founder, U.r5)
  ok('coach under the limit can accept', (await accept(U.founder, fid)).ok)

  // Founders
  ok('cap 1', (await as(c, U.admin, `SELECT admin_set_coach_plans(NULL, 1)`, [], { commit: true })).ok)
  ok('grant needs a coach card', !(await as(c, U.admin, `SELECT admin_grant_founder($1, 'roster_unlimited')`, [U.r1])).ok)
  ok('grant founder', (await as(c, U.admin, `SELECT admin_grant_founder($1, 'roster_10')`, [U.founder], { commit: true })).ok)
  ok('cap reached for the next founder', !(await as(c, U.admin, `SELECT admin_grant_founder($1, 'roster_10')`, [U.coach])).ok)
  ok('re-grant of an existing founder is allowed at the cap', (await as(c, U.admin, `SELECT admin_grant_founder($1, 'roster_unlimited')`, [U.founder], { commit: true })).ok)
  ok('founder is unlimited', (await as(c, U.founder, `SELECT my_coach_plan()->'limit' AS l, my_coach_plan()->>'founding' AS f`)).rows[0].f === 'true')
  await c.query(`UPDATE coach_plan_tiers SET max_athletes = 1 WHERE tier_key = 'roster_unlimited'`)
  ok('tier edits never downgrade a founder', (await as(c, U.founder, `SELECT my_coach_plan()->'limit' AS l`)).rows[0].l === null)
  ok('card exposes only the founding flag', (await c.query(`SELECT coach_card_json($1)->>'founding' f`, [U.founder])).rows[0].f === 'true')
  const dir = (await as(c, null, `SELECT list_coaches() AS d`)).rows[0].d
  ok('directory marks founders only', dir.find((x) => x.slug === 'founder-slug').founding === true && dir.find((x) => x.slug === 'coach-slug').founding === false)
  ok('revoke', (await as(c, U.admin, `SELECT admin_revoke_founder($1)`, [U.founder], { commit: true })).ok)
  ok('Free tier cannot be deactivated', !(await as(c, U.admin, `SELECT admin_set_coach_plan_tier('free','Free',3,0,0,FALSE)`)).ok)
}
