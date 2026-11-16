// Adversarial checks for 20270151000000_coach_module_flag_and_notes.sql (feature flag + coach notes). Run with harness.mjs, see README.
import fs from 'node:fs'
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
  for (const n of ['admin', 'rider', 'rider2', 'coach', 'coach2', 'stranger', 'ended', 'pending', 'blocked']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const rel = (coach, rider, status, extra = '') => c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by,responded_at,ended_at) VALUES ($1,$2,$3,$1,now(),${extra || 'NULL'})`, [coach, rider, status])
  await rel(U.coach, U.rider, 'active'); await rel(U.coach, U.rider2, 'active')
  await rel(U.ended, U.rider, 'ended', `now() - interval '5 days'`)
  await c.query(`INSERT INTO coaching_relationships(coach_id,rider_id,status,initiated_by) VALUES ($1,$2,'pending',$1)`, [U.pending, U.rider])
  await rel(U.blocked, U.rider2, 'ended', `now() - interval '1 day'`)

  const save = (u, p) => as(c, u, `SELECT coach_note_save($1::jsonb) AS id`, [JSON.stringify(p)], { commit: true })
  const list = (u, rider) => as(c, u, `SELECT * FROM coach_notes_list($1)`, [rider])

  // Flag: default off, enforced in RPCs
  ok('flag off by default', (await as(c, U.coach, `SELECT my_coach_module_enabled() AS e`)).rows[0].e === false)
  ok('coach cannot save a note while flag is off', !(await save(U.coach, { rider_id: U.rider, body: 'x' })).ok)
  ok('coach cannot list while flag is off', !(await list(U.coach, U.rider)).ok)
  ok('non-admin cannot read flag status', !(await as(c, U.coach, `SELECT admin_coach_module_status()`)).ok)
  ok('non-admin cannot set global', !(await as(c, U.coach, `SELECT admin_set_coach_module_global(true)`)).ok)
  ok('non-admin cannot allow-list', !(await as(c, U.coach, `SELECT admin_coach_module_allow($1, true)`, [U.coach])).ok)
  ok('anon cannot call flag RPC', !(await as(c, null, `SELECT my_coach_module_enabled()`)).ok)
  ok('client cannot read settings tables', !(await as(c, U.admin, `SELECT * FROM coach_module_settings`)).ok && !(await as(c, U.admin, `SELECT * FROM coach_module_allowlist`)).ok)
  ok('admin allow-lists the coach', (await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })).ok)
  ok('flag on for coach only', (await as(c, U.coach, `SELECT my_coach_module_enabled() AS e`)).rows[0].e && !(await as(c, U.rider, `SELECT my_coach_module_enabled() AS e`)).rows[0].e)
  ok('admin sees status with allowlist', (await as(c, U.admin, `SELECT admin_coach_module_status() AS s`)).rows[0].s.allowlist.length === 1)

  // Writes
  const a = await save(U.coach, { rider_id: U.rider, title: 'Knee', body: 'Left knee sore', tags: ['injury'], pinned: true })
  ok('coach saves a note for own athlete', a.ok)
  const noteId = a.rows[0].id
  ok('stranger cannot save', !(await save(U.stranger, { rider_id: U.rider, body: 'x' })).ok)
  await c.query(`INSERT INTO coach_module_allowlist(user_id) VALUES ($1), ($2), ($3), ($4) ON CONFLICT DO NOTHING`, [U.stranger, U.ended, U.pending, U.blocked])
  ok('allow-listed stranger still cannot save', !(await save(U.stranger, { rider_id: U.rider, body: 'x' })).ok)
  ok('pending coach cannot save', !(await save(U.pending, { rider_id: U.rider, body: 'x' })).ok)
  ok('ended coach cannot save', !(await save(U.ended, { rider_id: U.rider, body: 'x' })).ok)
  ok('coach cannot write for another coach athlete', !(await save(U.coach2, { rider_id: U.rider, body: 'x' })).ok)
  ok('rider cannot write notes about self', !(await save(U.rider, { rider_id: U.rider, body: 'x' })).ok)
  ok('empty body refused', !(await save(U.coach, { rider_id: U.rider, body: '  ' })).ok)
  ok('too long body refused', !(await save(U.coach, { rider_id: U.rider, body: 'x'.repeat(4001) })).ok)
  ok('unknown tag refused', !(await save(U.coach, { rider_id: U.rider, body: 'x', tags: ['nope'] })).ok)
  ok('forged coach_id/rider in body ignored (coach_id is auth.uid())', (await save(U.coach, { rider_id: U.rider, body: 'f', coach_id: U.stranger })).ok
    && (await c.query(`SELECT count(*)::int n FROM coach_notes WHERE coach_id = $1`, [U.stranger])).rows[0].n === 0)
  // cross-rider activity link
  const act = (await c.query(`INSERT INTO activities(user_id, title, activity_date, visibility, moving_time_s) VALUES ($1,'a', now(), 'private', 10) RETURNING id`, [U.rider2])).rows[0].id
  ok('cross-rider activity link refused', !(await save(U.coach, { rider_id: U.rider, body: 'x', activity_id: act })).ok)
  ok('cannot move a note to another rider via update', (await save(U.coach, { id: noteId, rider_id: U.rider2, body: 'moved' })).ok
    && (await c.query(`SELECT rider_id FROM coach_notes WHERE id=$1`, [noteId])).rows[0].rider_id === U.rider)
  ok("other coach cannot update the note", !(await save(U.coach2, { id: noteId, body: 'hijack' })).ok)

  // Reads
  ok('coach lists own notes', (await list(U.coach, U.rider)).rows.length === 2)
  ok('stranger sees nothing', (await list(U.stranger, U.rider)).rows.length === 0)
  ok('pending coach sees nothing', (await list(U.pending, U.rider)).rows.length === 0)
  ok('rider has no direct table access', !(await as(c, U.rider, `SELECT * FROM coach_notes`)).ok)
  ok('coach has no direct table access', !(await as(c, U.coach, `SELECT * FROM coach_notes`)).ok && !(await as(c, U.coach, `DELETE FROM coach_notes`)).ok)
  ok('rider sees no unshared notes', (await as(c, U.rider, `SELECT * FROM my_shared_notes()`)).rows.length === 0)

  // Sharing + notification dedupe
  ok('share a note', (await save(U.coach, { id: noteId, rider_id: U.rider, body: 'Left knee sore', shared_with_rider: true })).ok)
  ok('rider sees the shared note with coach name', (await as(c, U.rider, `SELECT * FROM my_shared_notes()`)).rows.map((r) => r.coach_name).join() === 'coach')
  ok('one unread notification', (await c.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND type='coach_note_shared'`, [U.rider])).rows[0].n === 1)
  await save(U.coach, { id: noteId, rider_id: U.rider, body: 'x', shared_with_rider: false })
  await save(U.coach, { id: noteId, rider_id: U.rider, body: 'x', shared_with_rider: true })
  ok('re-sharing does not spam (still one unread)', (await c.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND type='coach_note_shared' AND read_at IS NULL`, [U.rider])).rows[0].n === 1)
  ok('other rider sees none', (await as(c, U.rider2, `SELECT * FROM my_shared_notes()`)).rows.length === 0)
  ok('rider cannot hide a stranger note id', !(await as(c, U.rider2, `SELECT hide_shared_note($1)`, [noteId])).ok)

  // End coaching: window
  await c.query(`UPDATE coaching_relationships SET status='ended', ended_at = now() WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider])
  ok('coach may still list during window (read-only)', (await list(U.coach, U.rider)).rows.every((r) => r.read_only) && (await list(U.coach, U.rider)).rows.length === 2)
  ok('coach cannot add after end', !(await save(U.coach, { rider_id: U.rider, body: 'late' })).ok)
  ok('coach cannot edit after end', !(await save(U.coach, { id: noteId, rider_id: U.rider, body: 'late' })).ok)
  ok('coach cannot delete shared note after end', !(await as(c, U.coach, `SELECT coach_note_delete($1)`, [noteId])).ok)
  ok('rider keeps shared note after end', (await as(c, U.rider, `SELECT * FROM my_shared_notes()`)).rows.length === 1)
  const unshared = (await c.query(`SELECT id FROM coach_notes WHERE coach_id=$1 AND rider_id=$2 AND NOT shared_with_rider LIMIT 1`, [U.coach, U.rider])).rows[0].id
  ok('coach can delete unshared note in window', (await as(c, U.coach, `SELECT coach_note_delete($1)`, [unshared], { commit: true })).ok)

  // Purge after 30 days
  await c.query(`INSERT INTO coach_notes(coach_id, rider_id, body) VALUES ($1,$2,'old private')`, [U.coach, U.rider])
  ok('purge keeps notes inside the window', (await c.query(`SELECT coach_notes_purge() n`)).rows[0].n === 0)
  await c.query(`UPDATE coaching_relationships SET ended_at = now() - interval '31 days' WHERE coach_id=$1 AND rider_id=$2`, [U.coach, U.rider])
  ok('coach list empty after window', (await list(U.coach, U.rider)).rows.length === 0)
  const purged = (await c.query(`SELECT coach_notes_purge() n`)).rows[0].n
  ok('purge deletes unshared notes after window', purged >= 1 && (await c.query(`SELECT count(*)::int n FROM coach_notes WHERE coach_id=$1 AND rider_id=$2 AND NOT shared_with_rider`, [U.coach, U.rider])).rows[0].n === 0)
  ok('purge keeps the shared note as rider copy', (await as(c, U.rider, `SELECT * FROM my_shared_notes()`)).rows.length === 1)
  ok('rider hides copy', (await as(c, U.rider, `SELECT hide_shared_note($1)`, [noteId], { commit: true })).ok)
  await c.query(`SELECT coach_notes_purge()`)
  ok('hidden shared note purged after window', (await c.query(`SELECT count(*)::int n FROM coach_notes WHERE id=$1`, [noteId])).rows[0].n === 0)
  ok('purge is not callable by clients', !(await as(c, U.coach, `SELECT coach_notes_purge()`)).ok)
  ok('purge job scheduled', (await c.query(`SELECT count(*)::int n FROM cron.job WHERE jobname='coach-notes-purge'`)).rows[0].n === 1)

  // Rate limit & cap
  for (let i = 0; i < 60; i++) await c.query(`INSERT INTO coach_notes(coach_id, rider_id, body) VALUES ($1,$2,'b')`, [U.coach, U.rider2])
  ok('per-athlete/hourly limit refuses', !(await save(U.coach, { rider_id: U.rider2, body: 'over' })).ok)

  // Global flag
  await c.query(`DELETE FROM coach_module_allowlist WHERE user_id = $1`, [U.coach])
  ok('removing from allow-list disables again', !(await save(U.coach, { rider_id: U.rider2, body: 'x' })).ok)
  await as(c, U.admin, `SELECT admin_set_coach_module_global(true)`, [], { commit: true })
  ok('global flag enables for everyone', (await as(c, U.rider, `SELECT my_coach_module_enabled() e`)).rows[0].e)
  await as(c, U.admin, `SELECT admin_set_coach_module_global(false)`, [], { commit: true })

  // Account deletion
  await c.query(`DELETE FROM profiles WHERE id = $1`, [U.coach])
  ok('deleting the coach deletes their notes', (await c.query(`SELECT count(*)::int n FROM coach_notes WHERE coach_id=$1`, [U.coach])).rows[0].n === 0)

  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
}
