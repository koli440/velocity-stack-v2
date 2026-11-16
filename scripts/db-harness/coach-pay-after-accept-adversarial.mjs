// Adversarial checks for 20270171000000_coach_pay_after_accept.sql (package chosen in the application, pay prompt after acceptance). Run with harness.mjs, see README.
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
const HASH = 'a'.repeat(64)

export async function run(c) {
  for (const n of ['admin', 'coach', 'coach2', 'rider', 'rider2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  for (const n of ['coach', 'coach2', 'rider', 'rider2']) await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U[n]], { commit: true })
  await as(c, U.coach, `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'pay-coach', headline: 'h' })], { commit: true })
  await as(c, U.coach, `SELECT set_coach_card_visibility(true, false)`, [], { commit: true })
  await as(c, U.coach2, `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'pay-coach2', headline: 'h' })], { commit: true })
  const pkg = async (coach, kind, amount, active = true) => (await c.query(
    `INSERT INTO coach_packages (coach_id, title, kind, billing_interval, amount_cents, is_active) VALUES ($1,'Plan',$2,$3,$4,$5) RETURNING id`,
    [coach, kind, kind === 'subscription' ? 'month' : null, amount, active])).rows[0].id
  const paid = await pkg(U.coach, 'subscription', 9000)
  const free = await pkg(U.coach, 'free', null)
  const inactive = await pkg(U.coach, 'subscription', 9000, false)
  const foreign = await pkg(U.coach2, 'subscription', 9000)
  const answers = {
    about: { dob: '1990-05-05', sex: 'na', height_cm: 180, weight_kg: 72.5, country: 'BE', language: 'en' },
    goals: { main_goal: 'race', goal_text: 'Win', timeframe: '6 months' },
    history: { years_riding: 5, weekly_hours: 8, structure: 'self' },
    availability: { hours_per_week: 9, weekdays: { mon: 'short' } },
    equipment: { power_meter: 'Quarq' },
  }
  const submit = (u, pk) => as(c, u, `SELECT submit_onboarding('pay-coach', $1::jsonb, NULL, TRUE, '{}'::jsonb, 1, $2, $3) AS id`, [JSON.stringify(answers), HASH, pk], { commit: true })

  ok('foreign package refused', !(await submit(U.rider, foreign)).ok)
  ok('inactive package refused', !(await submit(U.rider, inactive)).ok)
  const info = (await as(c, U.rider, `SELECT coach_apply_info('pay-coach') AS i`)).rows[0].i
  ok('apply info lists active packages only', info.packages.length === 2 && !info.packages.some((p) => p.id === inactive))
  ok('no payment due before acceptance', (await as(c, U.rider, `SELECT my_payment_due() AS d`)).rows[0].d.length === 0)
  const s = await submit(U.rider, paid)
  ok('application with a paid package', s.ok)
  ok('package recorded', (await c.query(`SELECT package_id FROM onboarding_submissions WHERE id = $1`, [s.rows[0].id])).rows[0].package_id === paid)
  ok('still no payment due while pending', (await as(c, U.rider, `SELECT my_payment_due() AS d`)).rows[0].d.length === 0)
  const rel = (await c.query(`SELECT id FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider])).rows[0].id
  ok('coach accepts', (await as(c, U.coach, `SELECT accept_coaching($1)`, [rel], { commit: true })).ok)
  const due = (await as(c, U.rider, `SELECT my_payment_due() AS d`)).rows[0].d
  ok('payment due after acceptance', due.length === 1 && due[0].package_id === paid)
  ok('other riders see nothing', (await as(c, U.rider2, `SELECT my_payment_due() AS d`)).rows[0].d.length === 0)
  const n = (await c.query(`SELECT type FROM notifications WHERE user_id = $1 AND type IN ('payment_requested','coach_accepted')`, [U.rider])).rows
  ok('athlete gets a single payment_requested notification', n.length === 1 && n[0].type === 'payment_requested')
  await c.query(`INSERT INTO coach_subscriptions(rider_id, coach_id, package_id, stripe_subscription_id, status) VALUES ($1,$2,$3,'sub_x','trialing')`, [U.rider, U.coach, paid])
  ok('no prompt once a subscription runs', (await as(c, U.rider, `SELECT my_payment_due() AS d`)).rows[0].d.length === 0)

  // Free package: plain accepted notification and no prompt
  await as(c, U.rider2, `SELECT 1`)
  ok('free package application', (await submit(U.rider2, free)).ok)
  const rel2 = (await c.query(`SELECT id FROM coaching_relationships WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider2])).rows[0].id
  await as(c, U.coach, `SELECT accept_coaching($1)`, [rel2], { commit: true })
  ok('no prompt for a free package', (await as(c, U.rider2, `SELECT my_payment_due() AS d`)).rows[0].d.length === 0)
  ok('free package gets the plain accepted notification', (await c.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='coach_accepted'`, [U.rider2])).rows.length === 1)
}
