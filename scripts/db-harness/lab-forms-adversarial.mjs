// Adversarial checks for 20270164000000_lab_field_forms.sql (Lab field forms). Run with harness.mjs, see README.
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
  const save = (u, a, kind, data, d = '2027-01-10') => as(c, u, `SELECT * FROM lab_field_save($1, $2, $3, $4::jsonb)`, [a, kind, d, JSON.stringify(data)], { commit: true })
  const body = { weight_kg: 70, body_fat_pct: 12 }

  ok('table has no client privileges', !(await as(c, U.coach, `SELECT * FROM lab_field_results`)).ok)
  ok('anon cannot list', !(await as(c, null, `SELECT lab_field_list($1)`, [U.rider])).ok)
  ok('stranger cannot save', !(await save(U.stranger, U.rider, 'body', body)).ok)
  ok('unknown kind rejected', !(await save(U.coach, U.rider, 'x', body)).ok)
  ok('out of range rejected', !(await save(U.coach, U.rider, 'body', { weight_kg: 5 })).ok)
  ok('unknown field rejected', !(await save(U.coach, U.rider, 'body', { weight_kg: 70, evil: 1 })).ok)
  ok('empty rejected', !(await save(U.coach, U.rider, 'body', {})).ok)
  ok('sprint needs time', !(await save(U.coach, U.rider, 'sprint', { distance_m: 200 })).ok)
  ok('bad mobility value rejected', !(await save(U.coach, U.rider, 'mobility', { hip_flexion: 'maybe' })).ok)
  ok('long notes rejected', !(await save(U.coach, U.rider, 'body', { weight_kg: 70, notes: 'x'.repeat(501) })).ok)
  const r = await save(U.coach, U.rider, 'body', body)
  ok('coach saves without any flag', r.ok && r.rows[0].athlete_id === U.rider && r.rows[0].entered_by === U.coach)
  ok('athlete saves own sprint', (await save(U.rider, U.rider, 'sprint', { distance_m: 200, time_s: 15 })).ok)
  ok('athlete saves own mobility', (await save(U.rider, U.rider, 'mobility', { hip_flexion: 'pass', notes: 'ok' })).ok)
  ok('athlete without coach uses own forms', (await save(U.stranger, U.stranger, 'body', body)).ok)
  ok('stranger cannot list', !(await as(c, U.stranger, `SELECT lab_field_list($1)`, [U.rider])).ok)
  ok('list filters by kind', (await as(c, U.coach, `SELECT * FROM lab_field_list($1, 'body')`, [U.rider])).rows.length === 1)
  ok('athlete lists all own', (await as(c, U.rider, `SELECT * FROM lab_field_list($1)`, [U.rider])).rows.length === 3)
  ok('athlete cannot read another athlete', !(await as(c, U.rider, `SELECT lab_field_list($1)`, [U.stranger])).ok)
  ok('stranger cannot delete', !(await as(c, U.stranger, `SELECT lab_field_delete($1)`, [r.rows[0].id])).ok)
  ok('coach deletes', (await as(c, U.coach, `SELECT lab_field_delete($1)`, [r.rows[0].id], { commit: true })).ok)
  ok('deleted', (await c.query(`SELECT 1 FROM lab_field_results WHERE id = $1`, [r.rows[0].id])).rowCount === 0)
}
