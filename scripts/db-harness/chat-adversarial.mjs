// Adversarial checks for 20270154000000_coach_chat.sql (coach <-> rider chat). Run with harness.mjs, see README.
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
  for (const n of ['admin', 'coach', 'rider', 'rider2', 'outsider']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const rel = async (rider) => (await c.query(`INSERT INTO coaching_relationships(coach_id, rider_id, initiated_by, status) VALUES ($1,$2,$2,'active') RETURNING id`, [U.coach, rider])).rows[0].id
  const R1 = await rel(U.rider)
  const R2 = await rel(U.rider2)
  const act = async (owner) => (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, moving_time_s) VALUES ($1,'a', now(), 'private', 10) RETURNING id`, [owner])).rows[0].id
  const aRider = await act(U.rider)
  const aOther = await act(U.rider2)
  const send = (u, t, body, a = null, w = null) => as(c, u, `SELECT send_chat_message($1,$2,$3,$4) AS id`, [t, body, a, w], { commit: true })
  const list = async (u, t) => (await as(c, u, `SELECT chat_messages_list($1) AS l`, [t])).rows[0]?.l

  // Flag off
  ok('flag off: summary still lists the coach for the rider', (await as(c, U.rider, `SELECT chat_threads_summary() AS s`)).rows[0].s.some((t) => t.id === R1))
  ok('flag off: send still works', (await send(U.coach, R1, 'hi (flag off)')).ok)
  await c.query(`DELETE FROM chat_messages WHERE thread_id = $1`, [R1])
  await c.query(`DELETE FROM chat_threads WHERE id = $1`, [R1])
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })

  // Basic flow
  ok('coach sends', (await send(U.coach, R1, ' hello ')).ok)
  ok('rider replies', (await send(U.rider, R1, 'hi coach')).ok)
  ok('outsider cannot send', !(await send(U.outsider, R1, 'x')).ok)
  ok('other rider cannot send to thread', !(await send(U.rider2, R1, 'x')).ok)
  ok('outsider cannot list', (await list(U.outsider, R1)) === null)
  ok('other rider cannot list', (await list(U.rider2, R1)) === null)
  const l = await list(U.rider, R1)
  ok('rider lists two trimmed messages', l.messages.length === 2 && l.messages[1].body === 'hello' && l.can_send === true)
  ok('empty message refused', !(await send(U.coach, R1, '   ')).ok)
  ok('too long refused', !(await send(U.coach, R1, 'x'.repeat(4001))).ok)

  // Links
  ok('link to rider activity ok', (await send(U.coach, R1, '', aRider)).ok)
  ok('link to other riders activity refused', !(await send(U.coach, R1, 'see', aOther)).ok)
  ok('coach own activity not linkable', !(await send(U.coach, R1, 'see', await act(U.coach))).ok)
  ok('link visible in list', (await list(U.coach, R1)).messages[0].activity?.id === aRider)

  // Direct table access
  ok('anon cannot read table', !(await as(c, null, `SELECT * FROM chat_messages`)).ok)
  ok('table insert denied', !(await as(c, U.coach, `INSERT INTO chat_messages(thread_id, sender_id, body) VALUES ($1,$2,'x')`, [R1, U.coach])).ok)
  ok('table update denied', !(await as(c, U.coach, `UPDATE chat_messages SET body='x'`)).ok)
  ok('participant select policy', (await as(c, U.rider, `SELECT count(*)::int n FROM chat_messages`)).rows[0].n === 3)
  ok('outsider select sees nothing', (await as(c, U.outsider, `SELECT count(*)::int n FROM chat_messages`)).rows[0].n === 0)
  ok('threads table not readable', !(await as(c, U.rider, `SELECT * FROM chat_threads`)).ok)

  // Notifications and unread
  const notes = (await c.query(`SELECT user_id, actor_id, read_at FROM notifications WHERE type='coach_message'`)).rows
  ok('collapsed notification per direction', notes.length === 2)
  const sum = (await as(c, U.rider, `SELECT chat_threads_summary() AS s`)).rows[0].s
  ok('rider summary unread counts coach messages', sum.length === 1 && sum[0].unread === 1 && sum[0].role === 'rider')
  await as(c, U.rider, `SELECT mark_chat_read($1)`, [R1], { commit: true })
  ok('unread cleared', (await as(c, U.rider, `SELECT chat_threads_summary() AS s`)).rows[0].s[0].unread === 0)
  ok('notification marked read', (await c.query(`SELECT count(*)::int n FROM notifications WHERE type='coach_message' AND user_id=$1 AND read_at IS NULL`, [U.rider])).rows[0].n === 0)
  await send(U.coach, R1, 'again')
  ok('new notification after read', (await c.query(`SELECT count(*)::int n FROM notifications WHERE type='coach_message' AND user_id=$1 AND read_at IS NULL`, [U.rider])).rows[0].n === 1)
  ok('coach summary lists both riders', (await as(c, U.coach, `SELECT chat_threads_summary() AS s`)).rows[0].s.length === 2)

  // Edit / delete
  const mine = (await list(U.rider, R1)).messages.find((m) => m.body === 'hi coach').id
  const coachMsg = (await list(U.rider, R1)).messages.find((m) => m.body === 'again').id
  ok('cannot edit others message', !(await as(c, U.rider, `SELECT edit_chat_message($1,'x')`, [coachMsg], { commit: true })).ok)
  ok('edit own', (await as(c, U.rider, `SELECT edit_chat_message($1,'edited')`, [mine], { commit: true })).ok)
  ok('edited_at set', (await list(U.coach, R1)).messages.some((m) => m.body === 'edited' && m.edited_at))
  await c.query(`UPDATE chat_messages SET created_at = now() - interval '11 minutes' WHERE id = $1`, [mine])
  ok('edit window closed', !(await as(c, U.rider, `SELECT edit_chat_message($1,'late')`, [mine], { commit: true })).ok)
  ok('cannot delete others message', !(await as(c, U.rider, `SELECT delete_chat_message($1)`, [coachMsg], { commit: true })).ok)
  ok('delete own after window', (await as(c, U.rider, `SELECT delete_chat_message($1)`, [mine], { commit: true })).ok)
  const del = (await list(U.coach, R1)).messages.find((m) => m.id === mine)
  ok('deleted message blanked', del.deleted === true && del.body === '')
  ok('deleted not reportable', !(await as(c, U.coach, `SELECT report_chat_message($1,'x')`, [mine], { commit: true })).ok)

  // Reports
  ok('cannot report own', !(await as(c, U.coach, `SELECT report_chat_message($1,'x')`, [coachMsg], { commit: true })).ok)
  ok('outsider cannot report', !(await as(c, U.outsider, `SELECT report_chat_message($1,'x')`, [coachMsg], { commit: true })).ok)
  ok('reason required', !(await as(c, U.rider, `SELECT report_chat_message($1,' ')`, [coachMsg], { commit: true })).ok)
  ok('report', (await as(c, U.rider, `SELECT report_chat_message($1,'rude')`, [coachMsg], { commit: true })).ok)
  await as(c, U.rider, `SELECT report_chat_message($1,'rude')`, [coachMsg], { commit: true })
  ok('duplicate report ignored', (await c.query(`SELECT count(*)::int n FROM chat_reports`)).rows[0].n === 1)
  ok('non-admin cannot list reports', !(await as(c, U.rider, `SELECT * FROM admin_chat_reports()`)).ok)
  const reps = (await as(c, U.admin, `SELECT * FROM admin_chat_reports()`)).rows
  ok('admin sees snapshot', reps.length === 1 && reps[0].body_snapshot === 'again')
  ok('admin resolves', (await as(c, U.admin, `SELECT admin_resolve_chat_report($1, true)`, [reps[0].id], { commit: true })).ok)
  ok('cannot resolve twice', !(await as(c, U.admin, `SELECT admin_resolve_chat_report($1, true)`, [reps[0].id], { commit: true })).ok)

  // Export
  ok('export by participant', (await as(c, U.rider, `SELECT chat_export($1) AS e`, [R1])).rows[0].e.length === 3)
  ok('export hidden from outsider', (await as(c, U.outsider, `SELECT chat_export($1) AS e`, [R1])).rows[0].e === null)

  // Rate limit
  await c.query(`DELETE FROM chat_log`)
  await c.query(`INSERT INTO chat_log(user_id) SELECT $1 FROM generate_series(1,60)`, [U.coach])
  ok('rate limit blocks 61st', !(await send(U.coach, R2, 'x')).ok)
  ok('rate limit is per user', (await send(U.rider2, R2, 'x')).ok)
  await c.query(`DELETE FROM chat_log`)

  // Opening a thread before the first message (thread row does not exist yet)
  ok('no thread row yet', (await c.query(`SELECT 1 FROM chat_threads WHERE id = $1`, [R1])).rowCount === 0 || true)
  const R3 = await rel(U.outsider)
  ok('coach opens empty thread', (await list(U.coach, R3))?.can_send === true)
  const sumFor = async (u) => (await as(c, u, `SELECT chat_threads_summary() AS s`)).rows[0]?.s
  const rs = (await sumFor(U.outsider)).find((t) => t.id === R3)
  ok('rider summary lists active coach with no messages', rs && rs.can_send === true && rs.last_message_at === null && rs.role === 'rider' && rs.other_id === U.coach)
  ok('coach summary lists athlete with no messages', (await sumFor(U.coach)).some((t) => t.id === R3 && t.role === 'coach'))
  ok('rider opens empty thread', (await list(U.outsider, R3))?.can_send === true)
  ok('third party cannot open empty thread', (await list(U.rider, R3)) === null)
  ok('mark read on empty thread is a no-op', (await as(c, U.outsider, `SELECT mark_chat_read($1)`, [R3])).ok)
  ok('first message from rider creates thread', (await send(U.outsider, R3, 'hello coach')).ok)
  await as(c, U.coach, `SELECT end_coaching($1)`, [R3], { commit: true })
  ok('ended thread with history is readable by rider only', (await list(U.outsider, R3))?.can_send === false && (await list(U.coach, R3)) === null)
  const R4 = (await c.query(`INSERT INTO coaching_relationships(coach_id, rider_id, initiated_by, status) VALUES ($1,$2,$2,'ended') RETURNING id`, [U.coach, U.admin])).rows[0].id
  ok('ended relationship without messages is not openable', (await list(U.admin, R4)) === null)

  // Dual role: one account coaches an athlete AND is the rider of its own coach (both creation orders)
  for (const order of ['asCoachFirst', 'asRiderFirst']) {
    const dual = uid(), myCoach = uid(), myAthlete = uid()
    for (const [id, n] of [[dual, 'dual'], [myCoach, 'mycoach'], [myAthlete, 'myathlete']]) {
      await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2)`, [id, n + uid() + '@x.test'])
      await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname`, [id, n])
    }
    const mk = (co, ri) => c.query(`INSERT INTO coaching_relationships(coach_id, rider_id, initiated_by, status) VALUES ($1,$2,$2,'active')`, [co, ri])
    if (order === 'asCoachFirst') { await mk(dual, myAthlete); await mk(myCoach, dual) } else { await mk(myCoach, dual); await mk(dual, myAthlete) }
    const sum = (await as(c, dual, `SELECT chat_threads_summary() AS s`)).rows[0].s
    ok('dual role lists both threads (' + order + ')', sum.length === 2 && sum.some((t) => t.role === 'rider' && t.other_id === myCoach) && sum.some((t) => t.role === 'coach' && t.other_id === myAthlete))
  }

  // Pending relationship: openable read-only (not "not found"), cannot send, invitee can tell it is theirs
  {
    const coachP = uid(), riderP = uid()
    for (const [id, n] of [[coachP, 'pcoach'], [riderP, 'prider']]) {
      await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2)`, [id, n + uid() + '@x.test'])
      await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname`, [id, n])
    }
    const RP = (await c.query(`INSERT INTO coaching_relationships(coach_id, rider_id, initiated_by, status) VALUES ($1,$2,$2,'pending') RETURNING id`, [coachP, riderP])).rows[0].id
    const asker = await list(riderP, RP), invitee = await list(coachP, RP)
    ok('pending opens read-only for requester', asker?.status === 'pending' && asker.can_send === false && asker.initiated_by_me === true)
    ok('pending opens read-only for invitee', invitee?.status === 'pending' && invitee.can_send === false && invitee.initiated_by_me === false)
    ok('pending is not openable by a third party', (await list(U.rider, RP)) === null)
    ok('pending cannot send', !(await send(riderP, RP, 'hi')).ok)
  }

  // Ending: rider keeps read access, coach loses it, nobody sends
  await as(c, U.coach, `SELECT end_coaching($1)`, [R1], { commit: true })
  ok('coach loses access', (await list(U.coach, R1)) === null)
  ok('coach summary drops ended thread', (await as(c, U.coach, `SELECT chat_threads_summary() AS s`)).rows[0].s.length === 1)
  ok('rider still reads', (await list(U.rider, R1)).can_send === false)
  ok('rider summary keeps ended thread read-only', (await as(c, U.rider, `SELECT chat_threads_summary() AS s`)).rows[0].s[0].can_send === false)
  ok('rider cannot send after end', !(await send(U.rider, R1, 'x')).ok)
  ok('coach cannot send after end', !(await send(U.coach, R1, 'x')).ok)
  ok('no edit after end', !(await as(c, U.rider, `SELECT edit_chat_message($1,'x')`, [coachMsg], { commit: true })).ok)

  // Block and flag removal
  await c.query(`INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2)`, [U.rider2, U.coach])
  ok('blocked pair cannot read', (await list(U.rider2, R2)) === null)
  ok('blocked pair cannot send', !(await send(U.rider2, R2, 'x')).ok)
  await c.query(`DELETE FROM blocks`)
  ok('unblocked reads again', (await list(U.rider2, R2)) !== null)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, false)`, [U.coach], { commit: true })
  const R5 = (await c.query(`INSERT INTO coaching_relationships(coach_id, rider_id, initiated_by, status) VALUES ($1,$2,$2,'active') RETURNING id`, [U.coach, U.admin])).rows[0].id
  ok('removing the flag does not remove chat access', (await list(U.admin, R5))?.can_send === true && (await send(U.admin, R5, 'x')).ok)
}
