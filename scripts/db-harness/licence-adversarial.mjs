// Adversarial checks for 20270155000000_coach_licences.sql (licence verification). Run with harness.mjs, see README.
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
  for (const n of ['admin', 'coach', 'coach2', 'rider']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  const save = (u, ...a) => as(c, u, `SELECT save_my_licence($1,$2,$3,$4,$5) AS s`, [a[0], a[1], a[2] ?? null, a[3] ?? null, a[4] ?? null], { commit: true })
  const mine = async (u) => (await as(c, u, `SELECT my_licence() AS l`)).rows[0]?.l
  const review = (u, id, d, note = 'ok') => as(c, u, `SELECT admin_review_licence($1,$2,$3)`, [id, d, note], { commit: true })
  const lic = async (u) => (await c.query(`SELECT * FROM coach_licences WHERE coach_id=$1`, [U[u]])).rows[0]
  const card = async () => (await as(c, null, `SELECT get_coach_card('coach-one') AS c`)).rows[0].c
  const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10)
  const ev = (u) => `${U[u]}/evidence.pdf`

  ok('save refused while flag off', !(await save(U.coach, 'uci', 'Level 2')).ok)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach2], { commit: true })
  await as(c, U.coach, `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: 'coach-one', headline: 'h' })], { commit: true })
  await as(c, U.coach, `SELECT set_coach_card_visibility(true, false)`, [], { commit: true })

  ok('bodies list', (await as(c, U.coach, `SELECT licence_bodies_list() AS b`)).rows[0].b.length >= 5)
  ok('unknown body refused', !(await save(U.coach, 'nope', 'Level 2')).ok)
  ok('level must belong to body', !(await save(U.coach, 'uci', 'Level 9')).ok)
  ok('expired date refused', !(await save(U.coach, 'uci', 'Level 2', null, day(-5))).ok)
  ok('foreign evidence path refused', !(await save(U.coach, 'uci', 'Level 2', null, null, ev('coach2'))).ok)
  ok('traversal path refused', !(await save(U.coach, 'uci', 'Level 2', null, null, `${U.coach}/../x.pdf`)).ok)
  ok('nothing stored by failures', (await lic('coach')) === undefined)

  // Self-declared
  ok('save without evidence is self-declared', (await save(U.coach, 'uci', 'Level 2', 'N-1')).rows[0].s === 'unverified')
  ok('card shows grey self-declared', (await card()).licence.verified === false && (await card()).licence.level === 'Level 2')
  ok('card does not leak number or evidence', !JSON.stringify(await card()).includes('N-1'))
  ok('review of unverified refused', !(await review(U.admin, (await lic('coach')).id, 'verify')).ok)

  // Pending and review
  ok('with evidence goes pending', (await save(U.coach, 'uci', 'Level 2', 'N-1', day(200), ev('coach'))).rows[0].s === 'pending')
  const id = (await lic('coach')).id
  ok('coach cannot verify', !(await review(U.coach, id, 'verify')).ok)
  ok('rider cannot verify', !(await review(U.rider, id, 'verify')).ok)
  ok('non-admin cannot read queue', !(await as(c, U.coach, `SELECT * FROM admin_licence_queue()`)).ok)
  ok('admin queue lists pending', (await as(c, U.admin, `SELECT * FROM admin_licence_queue()`)).rows.length === 1)
  ok('direct table write denied', !(await as(c, U.coach, `UPDATE coach_licences SET status='verified'`)).ok)
  ok('direct table read denied', !(await as(c, U.coach, `SELECT * FROM coach_licences`)).ok)
  ok('invalid decision refused', !(await review(U.admin, id, 'bogus')).ok)
  ok('reject needs note', !(await review(U.admin, id, 'reject', ' ')).ok)
  ok('admin verifies', (await review(U.admin, id, 'verify', 'checked register')).ok)
  ok('verified chip on card', (await card()).licence.verified === true)
  ok('licence_reviewed notification without actor', (await c.query(`SELECT count(*)::int n FROM notifications WHERE type='licence_reviewed' AND user_id=$1 AND actor_id IS NULL`, [U.coach])).rows[0].n === 1)
  ok('cannot verify twice', !(await review(U.admin, id, 'verify')).ok)
  ok('counts', (await as(c, U.admin, `SELECT admin_licence_counts() AS n`)).rows[0].n.verified === 1)

  // Change resets
  await save(U.coach, 'uci', 'Level 2', 'N-1', day(200), ev('coach'))
  ok('identical resave keeps verified', (await lic('coach')).status === 'verified')
  await save(U.coach, 'uci', 'Level 3', 'N-1', day(200), ev('coach'))
  ok('level change resets to pending', (await lic('coach')).status === 'pending' && (await lic('coach')).reviewed_by === null)
  await review(U.admin, id, 'verify')
  ok('revoke needs note', !(await review(U.admin, id, 'revoke', null)).ok)
  ok('revoke', (await review(U.admin, id, 'revoke', 'complaint')).ok)
  ok('revoked shows no chip', (await card()).licence === null)
  ok('audit trail', (await c.query(`SELECT count(*)::int n FROM licence_audit WHERE licence_id=$1`, [id])).rows[0].n >= 6)

  // Rejection and evidence cleanup
  await save(U.coach, 'uci', 'Level 1', 'N-1', day(200), ev('coach'))
  ok('reject', (await review(U.admin, id, 'reject', 'blurry')).ok)
  ok('rejected shows no chip', (await card()).licence === null)
  await c.query(`UPDATE coach_licences SET reviewed_at = now() - interval '91 days' WHERE id=$1`, [id])
  await c.query(`SELECT coach_licence_expiry_run()`)
  ok('rejected evidence cleared after 90 days', (await lic('coach')).evidence_path === null)

  // Expiry job
  await save(U.coach, 'uci', 'Level 1', 'N-1', day(20), ev('coach'))
  await review(U.admin, id, 'verify')
  const before = (await c.query(`SELECT count(*)::int n FROM notifications WHERE type='licence_expiring'`)).rows[0].n
  await c.query(`SELECT coach_licence_expiry_run()`)
  await c.query(`SELECT coach_licence_expiry_run()`)
  ok('expiring notice once', (await c.query(`SELECT count(*)::int n FROM notifications WHERE type='licence_expiring'`)).rows[0].n === before + 1)
  await c.query(`SET session_replication_role = replica`)
  await c.query(`UPDATE coach_licences SET valid_until = current_date - 1 WHERE id=$1`, [id])
  await c.query(`SET session_replication_role = DEFAULT`)
  await c.query(`SELECT coach_licence_expiry_run()`)
  ok('expired by job', (await lic('coach')).status === 'expired' && (await card()).licence === null)
  ok('re-verification restarts at pending', (await save(U.coach, 'uci', 'Level 1', 'N-1', day(300), ev('coach'))).rows[0].s === 'pending')
  ok('new valid licence can be verified', (await review(U.admin, id, 'verify')).ok)
  ok('job not callable by users', !(await as(c, U.coach, `SELECT coach_licence_expiry_run()`)).ok)

  // Storage policies (the harness stub of storage.objects has no grants; real Supabase grants these to authenticated)
  await c.query(`GRANT USAGE ON SCHEMA storage TO authenticated, anon; GRANT SELECT, INSERT ON storage.objects TO authenticated`)
  const put = (u, name) => as(c, u, `INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('licence-evidence', $1, $2)`, [name, u], { commit: true })
  const up = await put(U.coach, ev('coach')); assert.ok(up.ok, 'upload to own prefix: ' + up.err); console.log('ok - upload to own prefix')
  ok('upload to foreign prefix refused', !(await put(U.coach, ev('coach2'))).ok)
  ok('rider with flag off cannot upload', !(await put(U.rider, ev('rider'))).ok)
  ok('owner reads own evidence', (await as(c, U.coach, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id='licence-evidence'`)).rows[0].n === 1)
  ok('other coach cannot read', (await as(c, U.coach2, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id='licence-evidence'`)).rows[0].n === 0)
  ok('admin reads evidence', (await as(c, U.admin, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id='licence-evidence'`)).rows[0].n === 1)
  ok('bucket is private', (await c.query(`SELECT public FROM storage.buckets WHERE id='licence-evidence'`)).rows[0].public === false)

  // Deleting a licence is a privacy right, flag independent
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, false)`, [U.coach], { commit: true })
  ok('delete works with flag off', (await as(c, U.coach, `SELECT delete_my_licence()`, [], { commit: true })).ok && (await lic('coach')) === undefined)
}
