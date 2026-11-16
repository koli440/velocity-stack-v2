// Checks for 20270175000000_application_single_path.sql. Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
const HASH = 'a'.repeat(64)
async function as(c, user, sql, params = [], { commit = false } = {}) {
  await c.query('BEGIN')
  try {
    await c.query('SET LOCAL ROLE authenticated')
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}

export async function run(c) {
  const U = {}
  for (const n of ['admin', 'coach', 'r1', 'r2', 'r3']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  for (const n of ['coach', 'r1', 'r2', 'r3']) await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U[n]], { commit: true })
  await as(c, U.coach, `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'single-coach', headline: 'h' })], { commit: true })
  await as(c, U.coach, `SELECT set_coach_card_visibility(true, false)`, [], { commit: true })
  const answers = {
    about: { dob: '1990-05-05', sex: 'na', height_cm: 180, weight_kg: 72.5, country: 'BE', language: 'en' },
    goals: { main_goal: 'race', goal_text: 'Win', timeframe: '6 months' },
    history: { years_riding: 5, weekly_hours: 8, structure: 'self' },
    availability: { hours_per_week: 9, weekdays: { mon: 'short' } },
    equipment: { power_meter: 'Quarq' },
  }
  const apply = (u) => as(c, u, `SELECT submit_onboarding('single-coach', $1::jsonb, NULL, TRUE, '{}'::jsonb, 1, $2) AS id`, [JSON.stringify(answers), HASH], { commit: true })
  const notes = async (rider) => (await c.query(`SELECT type, read_at FROM notifications WHERE user_id = $1 AND actor_id = $2 ORDER BY type`, [U.coach, rider])).rows
  const relOf = async (rider) => (await c.query(`SELECT id FROM coaching_relationships WHERE coach_id = $1 AND rider_id = $2 AND status = 'pending'`, [U.coach, rider])).rows[0]?.id

  // Application path: exactly one notification
  ok('r1 applies', (await apply(U.r1)).ok)
  const n1 = await notes(U.r1)
  ok('only onboarding_submitted', n1.length === 1 && n1[0].type === 'onboarding_submitted')
  const rel1 = await relOf(U.r1)
  ok('standard accept refused for the coach', !(await as(c, U.coach, `SELECT accept_coaching($1)`, [rel1])).ok)
  const links = (await as(c, U.coach, `SELECT my_application_links() AS l`)).rows[0].l
  ok('link to the application is exposed', links.length === 1 && links[0].relationship_id === rel1)
  ok('other users cannot accept via accept_application', !(await as(c, U.r2, `SELECT accept_application($1)`, [rel1])).ok)
  ok('rider cannot accept via accept_application', !(await as(c, U.r1, `SELECT accept_application($1)`, [rel1])).ok)
  ok('coach accepts through the application', (await as(c, U.coach, `SELECT accept_application($1)`, [rel1], { commit: true })).ok)
  ok('relationship is active', (await c.query(`SELECT status FROM coaching_relationships WHERE id = $1`, [rel1])).rows[0].status === 'active')

  // Direct request keeps the standard flow
  await as(c, U.r2, `SELECT request_coach($1)`, [U.coach], { commit: true })
  const rel2 = await relOf(U.r2)
  ok('direct request notifies once with coach_request', (await notes(U.r2)).map((x) => x.type).join() === 'coach_request')
  ok('standard accept works without an application', (await as(c, U.coach, `SELECT accept_coaching($1)`, [rel2], { commit: true })).ok)

  // Direct request first, application afterwards: the old notification is silenced
  await as(c, U.r3, `SELECT request_coach($1)`, [U.coach], { commit: true })
  ok('r3 applies on top of the request', (await apply(U.r3)).ok)
  const n3 = await notes(U.r3)
  ok('coach_request marked read, application unread', n3.find((x) => x.type === 'coach_request')?.read_at && !n3.find((x) => x.type === 'onboarding_submitted').read_at)
  ok('still refused on the standard path', !(await as(c, U.coach, `SELECT accept_coaching($1)`, [await relOf(U.r3)])).ok)
}
