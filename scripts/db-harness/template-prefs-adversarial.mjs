// Adversarial checks for 20261228000000_template_reference_prefs.sql (issue #283). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
let pass = 0
async function as(c, user, sql, params = [], commit = false) {
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
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'blocked']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.blocked])

  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
  const ins = (u, scope, slug = 'ladder', mode = 'pb', custom = null) =>
    as(c, u, `INSERT INTO template_reference_prefs(user_id, scope_id, template_slug, mode, custom_execution_id) VALUES ($1,$2,$3,$4,$5)
              ON CONFLICT (user_id, scope_id, template_slug) DO UPDATE SET mode = EXCLUDED.mode, custom_execution_id = EXCLUDED.custom_execution_id`, [u, scope, slug, mode, custom], true)

  ok('rider saves own preference', (await ins(U.rider, U.rider)).rowCount === 1)
  ok('rider upsert changes mode', (await ins(U.rider, U.rider, 'ladder', 'median5')).ok)
  ok('custom needs custom id', (await ins(U.rider, U.rider, 'x', 'custom', uid())).ok)
  ok('non-custom with custom id rejected', !(await ins(U.rider, U.rider, 'y', 'pb', uid())).ok)
  ok('unknown mode rejected', !(await ins(U.rider, U.rider, 'z', '90d')).ok)
  ok('active coach saves for athlete scope', (await ins(U.coach, U.rider)).ok)
  for (const n of ['stranger', 'pending', 'ended', 'blocked']) ok(`${n} cannot save for the rider scope`, !(await ins(U[n], U.rider)).ok)
  ok('user cannot write a row owned by someone else', !(await ins(U.rider, U.rider).then(() => as(c, U.stranger, `INSERT INTO template_reference_prefs(user_id, scope_id, template_slug, mode) VALUES ($1,$2,'q','pb')`, [U.rider, U.rider]))).ok)

  const seen = (u) => as(c, u, `SELECT user_id, scope_id FROM template_reference_prefs`)
  ok('rider sees only own rows', (await seen(U.rider)).rows.every((r) => r.user_id === U.rider))
  ok('coach sees only own rows (not the rider\'s)', (await seen(U.coach)).rows.every((r) => r.user_id === U.coach))
  ok('stranger sees nothing', (await seen(U.stranger)).rows.length === 0)
  ok('anon cannot read', !(await as(c, null, `SELECT 1 FROM template_reference_prefs`)).ok)
  ok('stranger cannot update rider row', (await as(c, U.stranger, `UPDATE template_reference_prefs SET mode='previous' WHERE user_id=$1`, [U.rider])).rowCount === 0)
  ok('stranger cannot delete rider row', (await as(c, U.stranger, `DELETE FROM template_reference_prefs WHERE user_id=$1`, [U.rider])).rowCount === 0)
  ok('coach loses write access once the relationship ended', (await c.query(`UPDATE coaching_relationships SET status='ended' WHERE coach_id=$1`, [U.coach]).then(() => ins(U.coach, U.rider, 'late'))).ok === false)
  console.log(`${pass} checks passed`)
}
