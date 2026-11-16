// Adversarial checks for 20270177000000_lab_lactate_plan.sql (coach-editable lactate steps; instruction fixed). Run with harness.mjs, see README.
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
  for (const n of ['coach', 'rider', 'solo', 'stranger']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,'active',$1,now())`, [U.coach, U.rider])
  const steps = JSON.stringify([{ pct: 50 }, { pct: 70 }, { pct: 90 }])
  const save = (u, a, { i = 'Do it', m = 5, s = steps } = {}) =>
    as(c, u, `SELECT lab_lactate_plan_save($1, $2, $3, $4::jsonb)`, [a, i, m, s], { commit: true })
  const get = async (u, a) => (await as(c, u, `SELECT lab_lactate_plan_get($1) AS p`, [a])).rows[0].p

  ok('table has no client privileges', !(await as(c, U.coach, `SELECT * FROM lab_lactate_plans`)).ok)
  ok('anon cannot read', !(await as(c, null, `SELECT lab_lactate_plan_get($1)`, [U.rider])).ok)
  ok('stranger cannot read or save', !(await as(c, U.stranger, `SELECT lab_lactate_plan_get($1)`, [U.rider])).ok && !(await save(U.stranger, U.rider)).ok)
  ok('no custom plan by default', (await get(U.rider, U.rider)).custom === false)
  ok('too few steps', !(await save(U.coach, U.rider, { s: JSON.stringify([{ pct: 50 }]) })).ok)
  ok('bad pct', !(await save(U.coach, U.rider, { s: JSON.stringify([{ pct: 50 }, { pct: 70 }, { pct: 500 }]) })).ok)
  ok('bad minutes', !(await save(U.coach, U.rider, { m: 99 })).ok)
  ok('instruction argument is ignored even when long', (await save(U.coach, U.rider, { i: 'x'.repeat(5000) })).ok)
  ok('plan returns no instruction', !('instruction' in (await get(U.coach, U.rider))))
  ok('coach saves their plan', (await save(U.coach, U.rider)).ok)
  const rp = await get(U.rider, U.rider)
  ok('rider sees coach plan read-only', rp.custom && rp.from_coach && !rp.editable && rp.steps.length === 3 )
  ok('coach sees it editable', (await get(U.coach, U.rider)).editable === true)
  ok('rider cannot overwrite the coach plan', !(await save(U.rider, U.rider)).ok)
  ok('rider cannot reset the coach plan', !(await as(c, U.rider, `SELECT lab_lactate_plan_reset($1)`, [U.rider], { commit: true })).ok)
  ok('another rider is unaffected', (await get(U.solo, U.solo)).custom === false)
  ok('solo rider saves own plan', (await save(U.solo, U.solo, { i: 'Mine' })).ok)
  ok('coach plan not leaked to solo rider', !('instruction' in (await get(U.solo, U.solo))) && (await get(U.solo, U.solo)).steps.length === 3)
  ok('coach resets', (await as(c, U.coach, `SELECT lab_lactate_plan_reset($1)`, [U.rider], { commit: true })).ok)
  ok('back to default after reset', (await get(U.rider, U.rider)).custom === false)
  await c.query(`UPDATE coaching_relationships SET status='ended' WHERE coach_id=$1`, [U.coach])
  await save(U.coach, U.rider)
  ok('ended coach plan no longer applies', (await get(U.rider, U.rider)).custom === false)
}
