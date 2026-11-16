// Adversarial checks for 20270158000000_lab_runs.sql (Lab protocol runner). Run with harness.mjs, see README.
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
  for (const n of ['admin', 'coach', 'rider', 'rider2', 'stranger', 'nocoach']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at) VALUES ($1,$2,$3,$1,now())`, [coach, rider, status])
  await rel(U.coach, U.rider, 'active')
  await rel(U.coach, U.rider2, 'ended')
  const act = async (owner) => { const id = uid(); await c.query(`INSERT INTO activities(id,user_id,title,activity_date) VALUES ($1,$2,'Test ride',now())`, [id, owner]); return id }
  const aRider = await act(U.rider)
  const aStranger = await act(U.stranger)
  const create = (u, athlete, proto = 'ftp_20', date = '2027-01-10') =>
    as(c, u, `SELECT * FROM lab_run_create($1, $2, $3, 'FTP test', 'brief', $4, $5::jsonb)`, [athlete, proto, date, 'work 20min ±0% @ best', JSON.stringify({ steps: [{ role: 'work' }] })], { commit: true })
  const result = (proto = 'ftp_20') => JSON.stringify({ protocol: proto, efforts: [{ durationSec: 1200, avgW: 300 }], ftp: 285 })

  ok('tables have no client privileges', !(await as(c, U.coach, `SELECT * FROM lab_test_runs`)).ok)
  ok('module flag off: coach cannot create', !(await create(U.coach, U.rider)).ok)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  ok('anon cannot call', !(await as(c, null, `SELECT lab_runs_list($1)`, [U.rider])).ok)
  ok('stranger cannot create for a rider', !(await create(U.stranger, U.rider)).ok)
  ok('coach of ended relationship cannot create', !(await create(U.coach, U.rider2)).ok)
  ok('unknown protocol rejected', !(await create(U.coach, U.rider, 'nope')).ok)
  ok('invalid date rejected', !(await create(U.coach, U.rider, 'ftp_20', '1999-01-01')).ok)

  const r = await create(U.coach, U.rider)
  ok('coach creates a run for own athlete', r.ok && r.rows[0].status === 'planned')
  const runId = r.rows[0].id
  const pw = (await c.query(`SELECT * FROM planned_workouts WHERE id = $1`, [r.rows[0].planned_workout_id])).rows[0]
  ok('planned workout created on athlete calendar', pw && pw.rider_id === U.rider && pw.set_by_coach && pw.structure_dsl.includes('best'))
  ok('athlete notified', (await c.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'lab_test_planned'`, [U.rider])).rowCount === 1)

  ok('stranger cannot list', !(await as(c, U.stranger, `SELECT lab_runs_list($1)`, [U.rider])).ok)
  ok('coach lists the run', (await as(c, U.coach, `SELECT lab_runs_list($1) AS l`, [U.rider])).rows[0].l.length === 1)
  ok('athlete lists own runs through the coach module', (await as(c, U.rider, `SELECT lab_runs_list($1)`, [U.rider])).ok)
  ok('athlete cannot read another athlete', !(await as(c, U.rider, `SELECT lab_runs_list($1)`, [U.rider2])).ok)

  const sub = (u, run, activity, res) => as(c, u, `SELECT * FROM lab_run_submit($1, $2, $3::jsonb)`, [run, activity, res], { commit: true })
  ok('stranger cannot submit', !(await sub(U.stranger, runId, aRider, result())).ok)
  ok('activity of someone else rejected', !(await sub(U.coach, runId, aStranger, result())).ok)
  ok('result of another protocol rejected', !(await sub(U.coach, runId, aRider, result('ftp_8'))).ok)
  ok('oversized result rejected', !(await sub(U.coach, runId, aRider, JSON.stringify({ protocol: 'ftp_20', x: 'a'.repeat(9000) }))).ok)
  ok('athlete submits the result', (await sub(U.rider, runId, aRider, result())).ok)
  ok('coach notified of result', (await c.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'lab_test_result'`, [U.coach])).rowCount === 1)
  ok('cannot cancel a completed run', !(await as(c, U.coach, `SELECT lab_run_cancel($1)`, [runId])).ok)
  const mark = (u, run) => as(c, u, `SELECT * FROM lab_run_mark_applied($1, $2::jsonb)`, [run, JSON.stringify({ field: 'ftp', value: 285, date: '2027-01-10' })], { commit: true })
  ok('stranger cannot mark applied', !(await mark(U.stranger, runId)).ok)
  ok('coach marks applied', (await mark(U.coach, runId)).rows[0].status === 'applied')
  ok('applied run no longer accepts results', !(await sub(U.coach, runId, aRider, result())).ok)

  const r2 = await create(U.coach, U.rider, 'cp3_12', '2027-02-01')
  ok('cannot apply a planned run', !(await mark(U.coach, r2.rows[0].id)).ok)
  ok('coach cancels a planned run', (await as(c, U.coach, `SELECT lab_run_cancel($1)`, [r2.rows[0].id], { commit: true })).ok)
  ok('cancelling removes the planned workout', (await c.query(`SELECT 1 FROM planned_workouts WHERE id = $1`, [r2.rows[0].planned_workout_id])).rowCount === 0)

  ok('athlete creates own run (module via coach)', (await create(U.rider, U.rider, 'ftp_8', '2027-03-01')).ok)
  ok('athlete without coach cannot use the lab', !(await create(U.nocoach, U.nocoach)).ok)
  const mine = (await as(c, U.rider, `SELECT lab_runs_list($1) AS l`, [U.rider])).rows[0].l
  ok('athlete sees own results', mine.some((x) => x.status === 'applied' && x.result.ftp === 285))
}
