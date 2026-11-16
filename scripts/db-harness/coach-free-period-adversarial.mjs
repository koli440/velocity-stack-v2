// Adversarial checks for 20270172000000_coach_free_period.sql (per-package free period). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
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
  for (const n of ['admin', 'coach']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  const save = (pk) => as(c, U.coach, `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'free-coach', headline: 'h', packages: [pk] })], { commit: true })
  const sub = { title: 'Plan', kind: 'subscription', interval: 'month', amount_cents: 9000, currency: 'eur' }
  const first = await save({ ...sub, trial_days: 14 })
  if (!first.ok) console.log(first.err)
  ok('trial 14 saved', first.ok)
  const card = (await as(c, U.coach, `SELECT my_coach_card() AS c`)).rows[0].c
  ok('my_coach_card returns trial_days', card.packages[0].trial_days === 14)
  ok('over 90 refused', !(await save({ ...sub, trial_days: 91 })).ok)
  ok('negative refused', !(await save({ ...sub, trial_days: -1 })).ok)
  ok('one-time ignores the free period', (await save({ title: 'One', kind: 'one_time', amount_cents: 5000, trial_days: 30 })).ok)
  const row = (await c.query(`SELECT trial_days FROM coach_packages WHERE coach_id = $1`, [U.coach])).rows[0]
  ok('one-time stored with 0 days', row.trial_days === 0)
  ok('table check rejects trial on one-time', !(await c.query(`UPDATE coach_packages SET trial_days = 5 WHERE coach_id = $1`, [U.coach]).then(() => true, () => false)))
}
