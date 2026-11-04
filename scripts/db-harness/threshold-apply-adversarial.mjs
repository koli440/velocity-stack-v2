// Adversarial checks for x0000000_activity_race_tag.sql (issue #294). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], commit = true) {
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
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'other']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ftp_history, lactate_threshold_history TO authenticated`)
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
  const act = (await c.query(`INSERT INTO activities(user_id, title, activity_date) VALUES ($1,'t', now()) RETURNING id`, [U.rider])).rows[0].id
  const foreign = (await c.query(`INSERT INTO activities(user_id, title, activity_date) VALUES ($1,'t', now()) RETURNING id`, [U.other])).rows[0].id
  const ins = (u, day, w, a) => as(c, u, `INSERT INTO ftp_history(user_id, effective_from, ftp_w, source, source_activity_id) VALUES ($1,$2,$3,'template_estimate',$4) RETURNING id, changed_by, set_by_coach, source`, [U.rider, day, w, a])

  const own = await ins(U.rider, '2026-11-01', 280, act)
  ok('rider writes own entry with source', own.ok && own.rows[0].source === 'template_estimate' && !own.rows[0].set_by_coach)
  const co = await ins(U.coach, '2026-11-02', 285, act)
  ok('active coach writes, stamped as coach', co.ok && co.rows[0].set_by_coach && co.rows[0].changed_by === U.coach)
  ok('coach edit is audited', (await c.query(`SELECT 1 FROM coach_edits WHERE rider_id=$1 AND table_name='ftp_history'`, [U.rider])).rowCount >= 1)
  for (const n of ['stranger', 'pending', 'ended']) ok(`${n} cannot write the rider history`, !(await ins(U[n], '2026-11-03', 290, act)).ok)
  ok('source activity of another rider is rejected', !(await ins(U.rider, '2026-11-04', 290, foreign)).ok)
  const lt = await as(c, U.coach, `INSERT INTO lactate_threshold_history(user_id, effective_from, lt2_hr, source, source_activity_id) VALUES ($1,'2026-11-02',170,'template_estimate',$2) RETURNING set_by_coach`, [U.rider, act])
  ok('active coach writes LT history', lt.ok && lt.rows[0].set_by_coach)
  ok('stranger cannot write LT history', !(await as(c, U.stranger, `INSERT INTO lactate_threshold_history(user_id, effective_from, lt2_hr) VALUES ($1,'2026-11-05',170)`, [U.rider])).ok)
  const clr = await as(c, U.rider, `UPDATE ftp_history SET source = NULL, source_activity_id = $2 WHERE id=$1 RETURNING source_activity_id`, [own.rows[0].id, act])
  ok('without a source the references are cleared', clr.ok && clr.rows[0].source_activity_id === null)
}
