// Adversarial checks for 20270160000000_lab_scheduler.sql (Lab test scheduler). Run with harness.mjs, see README.
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
  const save = (u, a, proto = 'ftp_20', weeks = 8, start = '2027-01-04', end = null) =>
    as(c, u, `SELECT * FROM lab_schedule_save($1,$2,$3,$4,$5)`, [a, proto, weeks, start, end], { commit: true })

  ok('tables have no client privileges', !(await as(c, U.coach, `SELECT * FROM lab_test_schedules`)).ok && !(await as(c, U.coach, `SELECT * FROM lab_schedule_reminders`)).ok)
  ok('flag off: coach cannot save', !(await save(U.coach, U.rider)).ok)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  ok('stranger cannot save', !(await save(U.stranger, U.rider)).ok)
  ok('anon cannot list', !(await as(c, null, `SELECT * FROM lab_schedules_list($1)`, [U.rider])).ok)
  ok('bad protocol / interval / dates rejected',
    !(await save(U.coach, U.rider, 'nope')).ok && !(await save(U.coach, U.rider, 'ftp_20', 0)).ok &&
    !(await save(U.coach, U.rider, 'ftp_20', 8, '2027-02-01', '2027-01-01')).ok)
  const s = await save(U.coach, U.rider)
  ok('coach saves for own athlete', s.ok && s.rows[0].created_by === U.coach)
  ok('athlete sees own schedule with next date', (await as(c, U.rider, `SELECT * FROM lab_schedules_list($1)`, [U.rider])).rows.length === 1)
  ok('stranger cannot list', !(await as(c, U.stranger, `SELECT * FROM lab_schedules_list($1)`, [U.rider])).ok)
  ok('lab_schedule_next', (await c.query(`SELECT to_char(lab_schedule_next('2027-01-04', 8, NULL, '2027-01-05'), 'YYYY-MM-DD') AS d`)).rows[0].d === '2027-03-01')

  const tick = async (d) => (await c.query(`SELECT lab_schedule_tick($1::date) AS n`, [d])).rows[0].n
  const before = (await c.query(`SELECT count(*)::int AS n FROM notifications WHERE type='lab_test_due'`)).rows[0].n
  ok('reminder 3 days ahead', (await tick('2027-03-26')) === 0)
  ok('reminder 3 days ahead (2027-02-26 -> due 2027-03-01)', (await tick('2027-02-26')) === 1)
  ok('tick is idempotent', (await tick('2027-02-26')) === 0)
  ok('reminder on the day', (await tick('2027-03-01')) === 1)
  ok('athlete notified twice', (await c.query(`SELECT count(*)::int AS n FROM notifications WHERE type='lab_test_due' AND user_id=$1`, [U.rider])).rows[0].n === before + 2)
  ok('client cannot call tick', !(await as(c, U.coach, `SELECT lab_schedule_tick()`)).ok)
  ok('stranger cannot stop', !(await as(c, U.stranger, `SELECT lab_schedule_stop($1)`, [s.rows[0].id])).ok)
  ok('athlete stops schedule', (await as(c, U.rider, `SELECT lab_schedule_stop($1)`, [s.rows[0].id], { commit: true })).ok)
  ok('stopped schedule sends nothing', (await tick('2027-04-26')) === 0 && (await tick('2027-04-29')) === 0)
}
