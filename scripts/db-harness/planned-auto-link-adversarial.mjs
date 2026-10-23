// Adversarial checks for 20261231000000_planned_workout_auto_link.sql. Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const U = {}
const uid = () => crypto.randomUUID()
async function as(c, user, sql, params = [], role) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${role || (user ? 'authenticated' : 'anon')}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('COMMIT')
    return { ok: true, rows: r.rows, rowCount: r.rowCount }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  for (const n of ['rider', 'coach', 'stranger', 'pending', 'ended', 'blocked', 'rider2']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [U[n]])
  }
  const rel = (coach, rider, status) => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,$3,$1)`, [coach, rider, status])
  await rel(U.ended, U.rider, 'ended'); await rel(U.pending, U.rider, 'pending'); await rel(U.coach, U.rider, 'active')
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider, U.blocked])
  await rel(U.blocked, U.rider2, 'active'); await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1,$2)`, [U.rider2, U.blocked])

  // Apply the migration a second time to prove idempotency, and once more at the end.
  const mig = fs.readFileSync(process.env.MIG, 'utf8')
  await c.query(mig); ok('migration is re-appliable', true)

  const day = (off) => `(CURRENT_DATE + ${off})`
  const mkAct = async (owner, off = 0) =>
    (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility) VALUES ($1,'t', (CURRENT_DATE + ${off})::timestamptz + interval '12 hours', 'private') RETURNING id`, [owner])).rows[0].id
  const mkW = async (rider, off = 0, extra = '') =>
    (await c.query(`INSERT INTO planned_workouts(rider_id, workout_date, title) VALUES ($1, ${day(off)}, 'W') RETURNING id`, [rider])).rows[0].id
  const row = async (id) => (await c.query(`SELECT * FROM planned_workouts WHERE id=$1`, [id])).rows[0]
  const dateOf = async (off) => (await c.query(`SELECT to_char(${day(off)}, 'YYYY-MM-DD') d`)).rows[0].d
  const auto = (u, w, a, off = 0, role) => as(c, u, `SELECT planned_workout_auto_link($1,$2,${day(off)}) r`, [w, a], role)
  const nNotif = async () => +(await c.query(`SELECT count(*) n FROM notifications`)).rows[0].n
  const backdate = async (id, by) => {
    await c.query(`ALTER TABLE planned_workouts DISABLE TRIGGER trg_planned_workouts_stamp`)
    await c.query(`UPDATE planned_workouts SET updated_at = now() - interval '2 days', updated_by = $2 WHERE id=$1`, [id, by])
    await c.query(`ALTER TABLE planned_workouts ENABLE TRIGGER trg_planned_workouts_stamp`)
  }
  const notif0 = await nNotif()

  // ---- stamp trigger: unchanged behaviour for normal paths ----
  const create = await as(c, U.coach, `SELECT * FROM planned_workout_create($1, ${day(0)}, 'ride', 'Coach W')`, [U.rider])
  ok('coach plans: created_by/updated_by/set_by_coach', create.ok && create.rows[0].created_by === U.coach && create.rows[0].updated_by === U.coach && create.rows[0].set_by_coach === true && create.rows[0].link_source === null && create.rows[0].auto_link_suppressed === false)
  const cw = create.rows[0].id
  const own = await as(c, U.rider, `SELECT * FROM planned_workout_create($1, ${day(0)}, 'ride', 'Own W')`, [U.rider])
  ok('rider plans: set_by_coach false', own.ok && own.rows[0].set_by_coach === false && own.rows[0].created_by === U.rider)
  const rw = own.rows[0].id
  await c.query(`UPDATE planned_workouts SET updated_at = now() - interval '1 day' WHERE id=$1`, [cw])
  const up = await as(c, U.rider, `UPDATE planned_workouts SET title='  Edited ' WHERE id=$1 RETURNING *`, [cw])
  ok('rider edit stamps updated_by/updated_at, trims, keeps created_by + set_by_coach', up.ok && up.rows[0].title === 'Edited' && up.rows[0].updated_by === U.rider && up.rows[0].created_by === U.coach && up.rows[0].set_by_coach === true && Date.now() - new Date(up.rows[0].updated_at) < 60000)
  const mv = await as(c, U.coach, `UPDATE planned_workouts SET workout_date = ${day(3)} WHERE id=$1 RETURNING updated_by, workout_date`, [cw])
  ok('coach move works and stamps', mv.ok && mv.rows[0].updated_by === U.coach)
  const sk = await as(c, U.rider, `UPDATE planned_workouts SET status='skipped' WHERE id=$1 RETURNING status`, [cw])
  ok('skip works', sk.ok && sk.rows[0].status === 'skipped')
  await as(c, U.rider, `UPDATE planned_workouts SET status='planned', workout_date=${day(0)} WHERE id=$1`, [cw])
  ok('cannot change rider', !(await as(c, U.rider, `UPDATE planned_workouts SET rider_id=$2 WHERE id=$1`, [rw, U.rider2])).ok)
  ok('cannot write stamps / link columns directly', !(await as(c, U.rider, `UPDATE planned_workouts SET created_by=$2 WHERE id=$1`, [rw, U.coach])).ok
    && !(await as(c, U.rider, `UPDATE planned_workouts SET set_by_coach=true WHERE id=$1`, [rw])).ok
    && !(await as(c, U.rider, `UPDATE planned_workouts SET link_source='manual' WHERE id=$1`, [rw])).ok
    && !(await as(c, U.rider, `UPDATE planned_workouts SET auto_link_suppressed=false WHERE id=$1`, [rw])).ok
    && !(await as(c, U.rider, `UPDATE planned_workouts SET activity_id=gen_random_uuid() WHERE id=$1`, [rw])).ok)
  ok('no direct INSERT for clients', !(await as(c, U.rider, `INSERT INTO planned_workouts(rider_id, workout_date, title) VALUES ($1, ${day(0)}, 'x')`, [U.rider])).ok)
  // 20 per day cap (rider has 2 on day 0 already -> 18 more fit)
  let capOk = true
  for (let i = 0; i < 18; i++) capOk = capOk && (await as(c, U.rider, `SELECT * FROM planned_workout_create($1, ${day(0)}, 'ride', 'f${i}')`, [U.rider])).ok
  ok('20 per day: up to 20 allowed', capOk)
  ok('20 per day: 21st rejected (create)', !(await as(c, U.rider, `SELECT * FROM planned_workout_create($1, ${day(0)}, 'ride', 'x')`, [U.rider])).ok)
  const m = await mkW(U.rider, 5)
  ok('20 per day: move into a full day rejected', !(await as(c, U.rider, `UPDATE planned_workouts SET workout_date=${day(0)} WHERE id=$1`, [m])).ok)
  await c.query(`DELETE FROM planned_workouts WHERE rider_id=$1 AND workout_date=${day(0)} AND title LIKE 'f%'`, [U.rider])

  // ---- manual link / unlink through the RPCs ----
  const a1 = await mkAct(U.rider)
  const w1 = await mkW(U.rider)
  const l = await as(c, U.rider, `SELECT * FROM planned_workout_link($1,$2)`, [w1, a1])
  ok('manual link: link_source manual, stamped by rider', l.ok && l.rows[0].link_source === 'manual' && l.rows[0].updated_by === U.rider && l.rows[0].activity_id === a1)
  const ul = await as(c, U.rider, `SELECT * FROM planned_workout_unlink($1)`, [w1])
  ok('unlink RPC: clears link_source, sets auto_link_suppressed', ul.ok && ul.rows[0].link_source === null && ul.rows[0].auto_link_suppressed === true && ul.rows[0].activity_id === null)
  const a1b = await mkAct(U.rider)
  ok('auto link after unlink returns false', (await auto(U.rider, w1, a1b)).rows[0].r === false)
  ok('manual re-link still works after unlink', (await as(c, U.rider, `SELECT * FROM planned_workout_link($1,$2)`, [w1, a1b])).ok)
  ok('suppressed flag survives re-link and the next unlink', (await row(w1)).auto_link_suppressed === true)

  // coach unlink also suppresses
  const wc = await mkW(U.rider, 1); const ac = await mkAct(U.rider, 1)
  await as(c, U.coach, `SELECT * FROM planned_workout_link($1,$2)`, [wc, ac])
  await as(c, U.coach, `SELECT * FROM planned_workout_unlink($1)`, [wc])
  ok('coach unlink suppresses too', (await row(wc)).auto_link_suppressed === true)

  // unlink via a direct UPDATE as the (SQL) owner / service role path
  const wd = await mkW(U.rider, 2); const ad = await mkAct(U.rider, 2)
  await c.query(`UPDATE planned_workouts SET activity_id=$2 WHERE id=$1`, [wd, ad])
  ok('owner direct link is manual', (await row(wd)).link_source === 'manual')
  await c.query(`UPDATE planned_workouts SET activity_id=NULL WHERE id=$1`, [wd])
  const rd = await row(wd)
  ok('direct unlink (any path) suppresses and clears source', rd.auto_link_suppressed === true && rd.link_source === null)

  // ---- auto link happy path ----
  const wa = await mkW(U.rider, 0); const aa = await mkAct(U.rider, 0)
  await backdate(wa, U.coach)
  const before = await row(wa)
  const r1 = await auto(U.rider, wa, aa)
  const after = await row(wa)
  ok('auto link returns true and links', r1.ok && r1.rows[0].r === true && after.activity_id === aa)
  ok('auto link: source auto, stamps untouched, not suppressed', after.link_source === 'auto' && +new Date(after.updated_at) === +new Date(before.updated_at) && after.updated_by === U.coach && after.auto_link_suppressed === false && after.set_by_coach === before.set_by_coach)
  ok('auto link again: false (already linked)', (await auto(U.rider, wa, aa)).rows[0].r === false)
  ok('no notification sent', (await nNotif()) === notif0)
  // relink on replace keeps source + stamps
  const aNew = await mkAct(U.rider, 0)
  const rl = await as(c, U.rider, `SELECT planned_workouts_relink_activity($1,$2) n`, [aa, aNew])
  const rlw = await row(wa)
  ok('relink-on-replace moves link, keeps link_source and stamps', rl.rows[0].n === 1 && rlw.activity_id === aNew && rlw.link_source === 'auto' && +new Date(rlw.updated_at) === +new Date(before.updated_at) && rlw.updated_by === U.coach)
  ok('relink by someone else is refused', !(await as(c, U.stranger, `SELECT planned_workouts_relink_activity($1,$2)`, [aNew, aa])).ok)
  // deleting the activity (FK SET NULL) clears link_source, does not suppress
  await c.query(`DELETE FROM activities WHERE id=$1`, [aNew])
  const dw = await row(wa)
  ok('activity deleted: link cleared, source cleared, not suppressed', dw.activity_id === null && dw.link_source === null && dw.auto_link_suppressed === false)
  ok('...and it can be auto linked again', (await auto(U.rider, wa, await mkAct(U.rider, 0))).rows[0].r === true)

  // ---- false / error cases ----
  const aR = await mkAct(U.rider)
  const wl = await mkW(U.rider); await c.query(`UPDATE planned_workouts SET activity_id=$2 WHERE id=$1`, [wl, await mkAct(U.rider)])
  ok('already linked workout: false', (await auto(U.rider, wl, aR)).rows[0].r === false)
  const wsk = await mkW(U.rider); await c.query(`UPDATE planned_workouts SET status='skipped' WHERE id=$1`, [wsk])
  ok('skipped workout: false', (await auto(U.rider, wsk, aR)).rows[0].r === false)
  ok('wrong date: false', (await auto(U.rider, await mkW(U.rider, 0), aR, 1)).rows[0].r === false)
  const wo = await mkW(U.rider)
  const so = await auto(U.stranger, wo, aR)
  ok("stranger: 'Activity not found'", !so.ok && /Activity not found/.test(so.err))
  ok('rider cannot use rider2 activity / workout of someone else', !(await auto(U.rider2, wo, aR)).ok && !(await auto(U.rider, wo, await mkAct(U.rider2))).ok)
  ok('coach cannot call', !(await auto(U.coach, wo, aR)).ok)
  ok('anon cannot call', !(await as(c, null, `SELECT planned_workout_auto_link($1,$2,CURRENT_DATE)`, [wo, aR])).ok)
  ok('NULL args: false', (await as(c, U.rider, `SELECT planned_workout_auto_link(NULL,$1,CURRENT_DATE) r`, [aR])).rows[0].r === false)
  // old activities
  const aOld = await mkAct(U.rider, -16); const wOld = await mkW(U.rider, -16)
  ok('old activity (>15 days): false', (await auto(U.rider, wOld, aOld, -16)).rows[0].r === false)
  const aEdge = await mkAct(U.rider, -15); const wEdge = await mkW(U.rider, -15)
  ok('15 days old is still allowed', (await auto(U.rider, wEdge, aEdge, -15)).rows[0].r === true)
  // local date plausibility
  const aFar = await mkAct(U.rider, 0); const wFar = await mkW(U.rider, 1)
  ok('local date 1 day from UTC date is plausible', (await auto(U.rider, wFar, aFar, 1)).rows[0].r === true)
  const aFar2 = await mkAct(U.rider, -3); const wFar2 = await mkW(U.rider, -1)
  ok('local date >1 day from UTC date: false', (await auto(U.rider, wFar2, aFar2, -1)).rows[0].r === false)
  const aFut = await mkAct(U.rider, 3); const wFut = await mkW(U.rider, 3)
  ok('future activity more than 1 day ahead: false', (await auto(U.rider, wFut, aFut, 3)).rows[0].r === false)
  // activity already linked elsewhere (unique)
  const aShared = await mkAct(U.rider); const wS1 = await mkW(U.rider); const wS2 = await mkW(U.rider)
  ok('first workout links', (await auto(U.rider, wS1, aShared)).rows[0].r === true)
  const s2 = await auto(U.rider, wS2, aShared)
  ok('activity already linked elsewhere: false (no error)', s2.ok && s2.rows[0].r === false && (await row(wS2)).activity_id === null)
  // concurrent calls: two connections race for the same activity
  const pgmod = (await import('pg')).default
  const mkc = async () => { const x = new pgmod.Client(c.connectionParameters); await x.connect(); return x }
  const x1 = await mkc(), x2 = await mkc()
  const aC = await mkAct(U.rider); const wC1 = await mkW(U.rider); const wC2 = await mkW(U.rider)
  const [rc1, rc2] = await Promise.all([auto2(x1, U.rider, wC1, aC), auto2(x2, U.rider, wC2, aC)])
  async function auto2(cl, u, w, a) {
    try {
      await cl.query('BEGIN'); await cl.query(`SET LOCAL ROLE authenticated`); await cl.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [u])
      const r = (await cl.query(`SELECT planned_workout_auto_link($1,$2,CURRENT_DATE) r`, [w, a])).rows[0].r
      await cl.query('COMMIT'); return r
    } catch (e) { await cl.query('ROLLBACK'); return 'err:' + e.message }
  }
  ok('concurrent: exactly one wins, no errors', [rc1, rc2].filter((v) => v === true).length === 1 && [rc1, rc2].filter((v) => v === false).length === 1)
  const [rc3, rc4] = await Promise.all([auto2(x1, U.rider, wC1, aC), auto2(x2, U.rider, wC1, await mkAct(U.rider))])
  ok('concurrent on the same workout: at most one links', [rc3, rc4].filter((v) => v === true).length <= 1 && ![rc3, rc4].some((v) => String(v).startsWith('err')))
  await x1.end(); await x2.end()
  // service role
  const aSv = await mkAct(U.rider); const wSv = await mkW(U.rider)
  const sv = await as(c, null, `SELECT planned_workout_auto_link($1,$2,CURRENT_DATE) r`, [wSv, aSv], 'service_role')
  ok('service role works', sv.ok && sv.rows[0].r === true && (await row(wSv)).link_source === 'auto')
  // existing rows with NULL link_source are manual: simulate pre-migration row
  const wN = await mkW(U.rider, 4); const aN = await mkAct(U.rider, 4)
  await c.query(`UPDATE planned_workouts SET activity_id=$2 WHERE id=$1`, [wN, aN])
  await c.query(`ALTER TABLE planned_workouts DISABLE TRIGGER trg_planned_workouts_stamp`)
  await c.query(`UPDATE planned_workouts SET link_source=NULL WHERE id=$1`, [wN])
  await c.query(`ALTER TABLE planned_workouts ENABLE TRIGGER trg_planned_workouts_stamp`)
  ok('NULL link_source row: auto link false (already linked)', (await auto(U.rider, wN, await mkAct(U.rider, 0), 4)).rows[0].r === false)
  const ulN = await as(c, U.rider, `SELECT * FROM planned_workout_unlink($1)`, [wN])
  ok('NULL link_source row unlinks like a manual link (suppressed)', ulN.ok && ulN.rows[0].auto_link_suppressed === true && ulN.rows[0].link_source === null)

  // ---- forging the link mode ----
  const aF = await mkAct(U.rider); const wF = await mkW(U.rider)
  await backdate(wF, U.coach)
  const bf = await row(wF)
  // authenticated sessions can call set_config(); a forged 'auto' / 'keep' must not be honoured
  await c.query('BEGIN'); await c.query(`SET LOCAL ROLE authenticated`); await c.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [U.rider])
  await c.query(`SELECT set_config('app.planned_link','auto',true)`)
  const fl = await c.query(`SELECT planned_workout_link($1,$2)`, [wF, aF]).then(() => true, () => false)
  await c.query('COMMIT')
  const af = await row(wF)
  ok('forged app.planned_link=auto: link is manual and stamped', fl && af.link_source === 'manual' && af.updated_by === U.rider && +new Date(af.updated_at) > +new Date(bf.updated_at))
  // forged 'keep' on a relink via planned_workout_link (replace link)
  const aF2 = await mkAct(U.rider)
  await backdate(wF, U.coach)
  await c.query('BEGIN'); await c.query(`SET LOCAL ROLE authenticated`); await c.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [U.rider])
  await c.query(`SELECT set_config('app.planned_link','keep',true)`)
  await c.query(`SELECT planned_workout_link($1,$2)`, [wF, aF2])
  await c.query('COMMIT')
  const af2 = await row(wF)
  ok('forged app.planned_link=keep: stamps updated, source manual', af2.updated_by === U.rider && af2.link_source === 'manual')
  // forged mode cannot unsuppress or hide an unlink
  await c.query('BEGIN'); await c.query(`SET LOCAL ROLE authenticated`); await c.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [U.rider])
  await c.query(`SELECT set_config('app.planned_link','auto',true)`)
  await c.query(`SELECT planned_workout_unlink($1)`, [wF])
  await c.query('COMMIT')
  const af3 = await row(wF)
  ok('forged mode: unlink still suppresses', af3.auto_link_suppressed === true && af3.link_source === null)
  // helper functions and the context table are not reachable by clients
  ok('clients cannot call planned_link_mode_set', !(await as(c, U.rider, `SELECT planned_link_mode_set('auto')`)).ok)
  ok('clients cannot write planned_link_ctx', !(await as(c, U.rider, `INSERT INTO planned_link_ctx(txid, mode) VALUES (txid_current(), 'auto')`)).ok && !(await as(c, U.rider, `SELECT * FROM planned_link_ctx`)).ok)
  ok('ctx table is empty after all calls', +(await c.query(`SELECT count(*) n FROM planned_link_ctx`)).rows[0].n === 0)

  // ---- RLS / coach policies unchanged ----
  const wp = await mkW(U.rider, 6)
  const sees = async (u) => (await as(c, u, `SELECT id FROM planned_workouts WHERE id=$1`, [wp])).rowCount
  const edits = async (u) => (await as(c, u, `UPDATE planned_workouts SET title='by '||left($2,4) WHERE id=$1`, [wp, u])).rowCount
  ok('rider sees/edits', (await sees(U.rider)) === 1 && (await edits(U.rider)) === 1)
  ok('active coach sees/edits', (await sees(U.coach)) === 1 && (await edits(U.coach)) === 1)
  for (const n of ['pending', 'ended', 'blocked', 'stranger'])
    ok(`${n} sees nothing / edits nothing`, (await sees(U[n])) === 0 && (await edits(U[n])) === 0)
  ok('anon sees nothing', !(await as(c, null, `SELECT id FROM planned_workouts`)).ok)
  ok('stranger cannot delete', (await as(c, U.stranger, `DELETE FROM planned_workouts WHERE id=$1`, [wp])).rowCount === 0)
  ok('coach can delete', (await as(c, U.coach, `DELETE FROM planned_workouts WHERE id=$1`, [wp])).rowCount === 1)

  await c.query(mig); ok('migration re-applied again after use', true)
  ok('no notification sent overall', (await nNotif()) === notif0)
  console.log('ALL OK')
}
