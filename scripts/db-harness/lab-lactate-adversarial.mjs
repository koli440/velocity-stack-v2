// Adversarial checks for 20270159000000_lab_lactate.sql (Lab lactate step test). Run with harness.mjs, see README.
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
  for (const n of ['admin', 'coach', 'rider', 'stranger']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,'active',$1,now())`, [U.coach, U.rider])
  const steps = JSON.stringify([{ power: 100, lactate: 1, hr: 110 }, { power: 200, lactate: 2, hr: null }, { power: 300, lactate: 5, hr: 170 }])
  const save = (u, a, s = steps, d = '2027-01-10') => as(c, u, `SELECT * FROM lab_lactate_save($1, $2, $3::jsonb, '{"lt1":{"power":150}}'::jsonb)`, [a, d, s], { commit: true })

  ok('table has no client privileges', !(await as(c, U.coach, `SELECT * FROM lab_lactate_tests`)).ok)
  ok('works without the coach module flag', (await as(c, U.coach, `SELECT * FROM lab_lactate_list($1)`, [U.rider])).ok)
  ok('anon cannot list', !(await as(c, null, `SELECT lab_lactate_list($1)`, [U.rider])).ok)
  ok('stranger cannot save', !(await save(U.stranger, U.rider)).ok)
  ok('too few steps rejected', !(await save(U.coach, U.rider, JSON.stringify([{ power: 1, lactate: 1 }]))).ok)
  ok('bad lactate rejected', !(await save(U.coach, U.rider, JSON.stringify([{ power: 100, lactate: 1 }, { power: 200, lactate: 99 }, { power: 300, lactate: 3 }]))).ok)
  ok('bad hr rejected', !(await save(U.coach, U.rider, JSON.stringify([{ power: 100, lactate: 1, hr: 5 }, { power: 200, lactate: 2 }, { power: 300, lactate: 3 }]))).ok)
  const r = await save(U.coach, U.rider)
  ok('coach saves for own athlete', r.ok && r.rows[0].athlete_id === U.rider && r.rows[0].created_by === U.coach)
  ok('stranger cannot list', !(await as(c, U.stranger, `SELECT lab_lactate_list($1)`, [U.rider])).ok)
  ok('coach lists', (await as(c, U.coach, `SELECT * FROM lab_lactate_list($1)`, [U.rider])).rows.length === 1)
  ok('athlete lists own via coach module', (await as(c, U.rider, `SELECT * FROM lab_lactate_list($1)`, [U.rider])).rows.length === 1)
  ok('athlete cannot read a stranger', !(await as(c, U.rider, `SELECT lab_lactate_list($1)`, [U.stranger])).ok)
  ok('stranger cannot delete', !(await as(c, U.stranger, `SELECT lab_lactate_delete($1)`, [r.rows[0].id])).ok)
  ok('athlete deletes own test', (await as(c, U.rider, `SELECT lab_lactate_delete($1)`, [r.rows[0].id], { commit: true })).ok)
  ok('deleted', (await c.query(`SELECT 1 FROM lab_lactate_tests`)).rowCount === 0)
}
