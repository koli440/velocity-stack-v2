// Adversarial checks for 20270165000000_lab_reports.sql (Lab reports). Run with harness.mjs, see README.
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
  const snap = { thresholds: { ftp_w: 280 } }
  const create = (u, a, s = snap, t = 'Report') => as(c, u, `SELECT * FROM lab_report_create($1, $2, 'n', $3::jsonb)`, [a, t, JSON.stringify(s)], { commit: true })
  const pub = async (tok) => (await as(c, null, `SELECT lab_report_public($1) AS r`, [tok])).rows?.[0]?.r

  ok('table has no client privileges', !(await as(c, U.coach, `SELECT * FROM lab_reports`)).ok)
  ok('anon cannot create', !(await create(null, U.rider)).ok)
  ok('stranger cannot create', !(await create(U.stranger, U.rider)).ok)
  ok('unknown section rejected', !(await create(U.coach, U.rider, { evil: {} })).ok)
  ok('wrong section shape rejected', !(await create(U.coach, U.rider, { thresholds: [] })).ok)
  ok('empty title rejected', !(await create(U.coach, U.rider, snap, ' ')).ok)
  ok('coach cannot share body composition', !(await create(U.coach, U.rider, { forms: { weight_kg: 70 } })).ok)
  const r = await create(U.coach, U.rider)
  ok('coach creates without any flag', r.ok && /^[0-9a-f]{64}$/.test(r.rows[0].token))
  const tok = r.rows[0].token
  const a = await create(U.rider, U.rider, { forms: { weight_kg: 70 } })
  ok('athlete can share body composition', a.ok)
  ok('coach can share lactate/fit/cadence sections', (await create(U.coach, U.rider, { lactate: { lt1_power_w: 180 }, fit: { saddle_height_mm: 720 }, cadence: { steps: [] }, pedalling: {}, durability: [], decoupling: [] })).ok)
  ok('coach cannot share fueling (health)', !(await create(U.coach, U.rider, { fueling: [] })).ok)
  ok('athlete can share fueling and aero', (await create(U.rider, U.rider, { fueling: [{ session: 'fed' }], aero: [{ cda: 0.3 }] })).ok)
  ok('fueling must be an array', !(await create(U.rider, U.rider, { fueling: {} })).ok)
  ok('lactate must be an object', !(await create(U.rider, U.rider, { lactate: [] })).ok)
  ok('age is null when no birth year', (await as(c, U.rider, `SELECT lab_athlete_age($1) AS a`, [U.rider])).rows[0].a === null)
  await c.query(`UPDATE profiles SET birth_year = extract(year FROM now())::int - 40 WHERE id = $1`, [U.rider])
  ok('age computed from birth year for athlete and coach', (await as(c, U.rider, `SELECT lab_athlete_age($1) AS a`, [U.rider])).rows[0].a === 40 && (await as(c, U.coach, `SELECT lab_athlete_age($1) AS a`, [U.rider])).rows[0].a === 40)
  ok('stranger cannot read age', !(await as(c, U.stranger, `SELECT lab_athlete_age($1) AS a`, [U.rider])).ok)
  ok('athlete without coach can create own', (await create(U.stranger, U.stranger)).ok)

  const p = await pub(tok)
  ok('anon reads by token', p && p.snapshot.thresholds.ftp_w === 280 && p.title === 'Report')
  ok('coach branding present for coach-created report', p.coach && p.coach.name === 'coach')
  ok('athlete-created report has no coach branding', (await pub(a.rows[0].token)).coach === null)
  ok('unknown or malformed token gives nothing', (await pub('f'.repeat(64))) === null && (await pub('abc')) === null)
  ok('anon cannot list', !(await as(c, null, `SELECT lab_reports_list($1)`, [U.rider])).ok)
  ok('stranger cannot list', !(await as(c, U.stranger, `SELECT lab_reports_list($1)`, [U.rider])).ok)
  ok('coach lists', (await as(c, U.coach, `SELECT * FROM lab_reports_list($1)`, [U.rider])).rows.length === 4)
  ok('stranger cannot revoke', !(await as(c, U.stranger, `SELECT lab_report_revoke($1)`, [r.rows[0].id])).ok)
  ok('athlete revokes', (await as(c, U.rider, `SELECT lab_report_revoke($1)`, [r.rows[0].id], { commit: true })).ok)
  ok('revoked token no longer readable', (await pub(tok)) === null)
}
