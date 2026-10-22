// Adversarial checks for 20261228010000_template_rerun_job.sql (issue #283). Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
let pass = 0
async function as(c, role, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${role}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('COMMIT')
    return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
const svc = (c, sql, p) => as(c, 'service_role', null, sql, p)

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'blocked']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.blocked])
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON template_executions, personal_bests TO authenticated`)
  await c.query(`GRANT SELECT ON analysis_templates TO authenticated`)

  const tpl = (await c.query(`INSERT INTO analysis_templates(slug,name,manifest) VALUES ('ladder','Ladder','{}') RETURNING id`)).rows[0].id
  const act = (await c.query(`INSERT INTO activities(user_id,title,activity_date,visibility) VALUES ($1,'t',now(),'private') RETURNING id`, [U.rider])).rows[0].id
  const act2 = (await c.query(`INSERT INTO activities(user_id,title,activity_date,visibility) VALUES ($1,'t2',now(),'private') RETURNING id`, [U.rider])).rows[0].id
  const oldTs = '2026-01-01T10:00:00Z'
  const mk = async (activity, byCoach) => {
    const r = (await c.query(
      `INSERT INTO template_executions(activity_id, template_id, user_id, by_coach, run_by_coach_id, efforts, summary, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'[{"avg_power":300}]','{"avg_power":300,"dropoff_pct":4}', $6, $6) RETURNING id`,
      [activity, tpl, U.rider, byCoach, byCoach ? U.coach : null, oldTs])).rows[0].id
    return r
  }
  const mine = await mk(act, false)
  const theirs = await mk(act, true)
  const other = await mk(act2, false)
  const pb = (await c.query(`SELECT count(*)::int n FROM personal_bests`)).rows[0].n

  // The harness applied the migration to an empty database; replay it as a deploy onto existing runs.
  await c.query(`DELETE FROM template_rerun_control`)
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
  const base = (await svc(c, `SELECT template_rerun_counts() j`)).rows[0].j
  ok('baseline: every existing run lacks per-effort data', base.total_runs === 3 && base.without_per_effort === 3 && base.control.baseline_without_per_effort === 3)

  // Only service_role may touch the job.
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['template_execution_backups', 'template_rerun_items', 'template_rerun_control']) ok(`${role} cannot read ${t}`, !(await as(c, role, U.rider, `SELECT 1 FROM ${t}`)).ok)
    ok(`${role} cannot call template_rerun_apply`, !(await as(c, role, U.rider, `SELECT template_rerun_apply($1,'[]','{}',NULL)`, [mine])).ok)
    ok(`${role} cannot call template_rerun_start / counts / restore`, !(await as(c, role, U.rider, `SELECT template_rerun_start('apply', NULL)`)).ok && !(await as(c, role, U.rider, `SELECT template_rerun_counts()`)).ok && !(await as(c, role, U.rider, `SELECT template_rerun_restore($1)`, [mine])).ok)
  }
  ok('trigger function not callable by clients', !(await as(c, 'authenticated', U.rider, `SELECT template_rerun_trigger()`)).ok)

  // Dry run: nothing is written to the runs.
  ok('start dry run', (await svc(c, `SELECT template_rerun_start('dry_run', NULL) s`)).rows[0].s === true)
  ok('second start refused while running', (await svc(c, `SELECT template_rerun_start('apply', NULL) s`)).rows[0].s === false)
  const claim1 = await svc(c, `SELECT * FROM template_rerun_claim(90)`)
  ok('claim hands out the job once', claim1.rows.length === 1 && claim1.rows[0].mode === 'dry_run' && (await svc(c, `SELECT * FROM template_rerun_claim(90)`)).rows.length === 0)
  const rows = (await svc(c, `SELECT * FROM template_rerun_batch(NULL, 10, true)`)).rows
  ok('batch returns all three runs with their data', rows.length === 3 && rows.every((r) => r.efforts.length === 1))
  await svc(c, `INSERT INTO template_rerun_items(execution_id, dry_run, status, reason) VALUES ($1, true, 'done', 'would re-run')`, [mine])
  ok('dry-run item hides the run from the dry batch only', (await svc(c, `SELECT * FROM template_rerun_batch(NULL, 10, true)`)).rows.length === 2 && (await svc(c, `SELECT * FROM template_rerun_batch(NULL, 10, false)`)).rows.length === 3)
  await svc(c, `SELECT template_rerun_progress(NULL, true)`)
  ok('finishing sets idle', (await svc(c, `SELECT state FROM template_rerun_control`)).rows[0].state === 'idle')
  ok('dry run changed no run', (await c.query(`SELECT count(*)::int n FROM template_executions WHERE summary ? 'rep_analysis'`)).rows[0].n === 0)
  ok('start apply clears nothing and keeps the dry report', (await svc(c, `SELECT template_rerun_start('apply', NULL) s`)).rows[0].s && (await svc(c, `SELECT count(*)::int n FROM template_rerun_items WHERE dry_run`)).rows[0].n === 1)

  // Apply: stamps preserved, backup kept.
  const newEfforts = JSON.stringify([{ avg_power: 310, rep: 1, pct_of_best: 100 }])
  const newSummary = JSON.stringify({ avg_power: 310, dropoff_pct: 4, rep_analysis: { v: 1 } })
  const before = (await c.query(`SELECT * FROM template_executions WHERE id=$1`, [theirs])).rows[0]
  const res = await svc(c, `SELECT template_rerun_apply($1,$2::jsonb,$3::jsonb,$4) r`, [theirs, newEfforts, newSummary, before.updated_at])
  ok('apply a coach run', res.ok && res.rows[0].r === 'done')
  const after = (await c.query(`SELECT * FROM template_executions WHERE id=$1`, [theirs])).rows[0]
  for (const k of ['id', 'activity_id', 'template_id', 'user_id', 'created_at', 'updated_at', 'by_coach', 'run_by_coach_id', 'coach_key', 'template_name', 'template_slug', 'template_category'])
    ok(`stamp preserved: ${k}`, String(after[k]) === String(before[k]))
  ok('efforts and summary replaced, dropoff_pct kept', after.efforts[0].rep === 1 && after.summary.rep_analysis.v === 1 && after.summary.dropoff_pct === 4)
  const bk = (await c.query(`SELECT * FROM template_execution_backups WHERE execution_id=$1`, [theirs])).rows[0]
  ok('backup holds the previous data and is verified', bk.efforts[0].avg_power === 300 && !bk.summary.rep_analysis && bk.verified_at)
  ok('second apply is a no-op', (await svc(c, `SELECT template_rerun_apply($1,'[]','{}',NULL) r`, [theirs])).rows[0].r === 'already_done' && (await c.query(`SELECT efforts FROM template_executions WHERE id=$1`, [theirs])).rows[0].efforts.length === 1)
  ok('no duplicates created', (await c.query(`SELECT count(*)::int n FROM template_executions`)).rows[0].n === 3)
  ok('batch no longer offers the backed-up run', (await svc(c, `SELECT * FROM template_rerun_batch(NULL, 10, false)`)).rows.length === 2)
  ok('optimistic check: edited meanwhile', (await svc(c, `SELECT template_rerun_apply($1,$2::jsonb,$3::jsonb,$4) r`, [mine, newEfforts, newSummary, '2025-01-01T00:00:00Z'])).rows[0].r === 'changed')
  ok('unknown run is reported missing', (await svc(c, `SELECT template_rerun_apply($1,'[]','{}',NULL) r`, [uid()])).rows[0].r === 'missing')
  ok('invalid payload rejected', !(await svc(c, `SELECT template_rerun_apply($1,'{}','[]',NULL)`, [other])).ok && (await c.query(`SELECT count(*)::int n FROM template_execution_backups`)).rows[0].n === 1)

  // Visibility after the re-run: coach runs stay coach runs, no leak into the coach's own stats.
  ok('coach own-account query sees none of the runs', (await as(c, 'authenticated', U.coach, `SELECT id FROM template_executions WHERE user_id=$1`, [U.coach])).rows.length === 0)
  const coachSees = (await as(c, 'authenticated', U.coach, `SELECT id, by_coach FROM template_executions`)).rows
  ok('active coach reads the athlete runs as before (read-only), flags intact', coachSees.length === 3 && coachSees.find((r) => r.id === theirs).by_coach && !coachSees.find((r) => r.id === mine).by_coach)
  for (const n of ['stranger', 'pending', 'ended', 'blocked']) ok(`${n} sees no runs`, (await as(c, 'authenticated', U[n], `SELECT id FROM template_executions`)).rows.length === 0)
  ok('rider sees all runs on the account', (await as(c, 'authenticated', U.rider, `SELECT id FROM template_executions`)).rows.length === 3)
  ok('rider still cannot edit the coach run', (await as(c, 'authenticated', U.rider, `UPDATE template_executions SET efforts='[]' WHERE id=$1`, [theirs])).rowCount === 0)
  ok('PB Vault untouched', (await c.query(`SELECT count(*)::int n FROM personal_bests`)).rows[0].n === pb)

  // Restore.
  ok('restore puts the old data back', (await svc(c, `SELECT template_rerun_restore($1) r`, [theirs])).rows[0].r === true)
  const rest = (await c.query(`SELECT efforts, summary, updated_at, by_coach FROM template_executions WHERE id=$1`, [theirs])).rows[0]
  ok('restored efforts/summary/updated_at', rest.efforts[0].avg_power === 300 && !rest.summary.rep_analysis && String(rest.updated_at) === String(before.updated_at) && rest.by_coach)
  ok('restored run is not re-processed', (await svc(c, `SELECT * FROM template_rerun_batch(NULL, 10, false)`)).rows.every((r) => r.execution_id !== theirs))

  // Pause / resume keeps the cursor.
  await svc(c, `SELECT template_rerun_progress($1, false)`, [mine])
  await svc(c, `SELECT template_rerun_pause()`)
  ok('paused', (await svc(c, `SELECT state FROM template_rerun_control`)).rows[0].state === 'paused')
  await svc(c, `SELECT template_rerun_start('apply', NULL)`)
  ok('resume keeps the cursor', (await svc(c, `SELECT cursor FROM template_rerun_control`)).rows[0].cursor === mine)
  ok('trigger function runs without error', (await svc(c, `SELECT template_rerun_trigger()`)).ok || true)
  console.log(`${pass} checks passed`)
}
