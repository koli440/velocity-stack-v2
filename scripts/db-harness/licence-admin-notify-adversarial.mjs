// Checks for 20270173000000_licence_admin_notify.sql. Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
async function as(c, user, sql, params = [], { commit = false } = {}) {
  await c.query('BEGIN')
  try {
    await c.query('SET LOCAL ROLE authenticated')
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}

export async function run(c) {
  const U = {}
  for (const n of ['admin', 'admin2', 'coach', 'other']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = ANY($1)`, [[U.admin, U.admin2]])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U.coach], { commit: true })
  const body = (await c.query(`SELECT id, levels[1] AS lvl FROM licence_bodies WHERE is_active LIMIT 1`)).rows[0]
  const save = (path) => as(c, U.coach, `SELECT save_my_licence($1, $2, NULL, NULL, $3)`, [body.id, body.lvl, path], { commit: true })
  const count = async (u) => Number((await c.query(`SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'licence_submitted' AND read_at IS NULL`, [u])).rows[0].count)

  ok('self-declared licence (no evidence) does not notify', (await save(null)).ok && (await count(U.admin)) === 0)
  ok('submission with evidence', (await save(`${U.coach}/proof.pdf`)).ok)
  ok('each admin gets one notification', (await count(U.admin)) === 1 && (await count(U.admin2)) === 1)
  ok('non-admins get none', (await count(U.other)) === 0 && (await count(U.coach)) === 0)
  await save(`${U.coach}/proof2.pdf`)
  ok('deduped to one unread per admin', (await count(U.admin)) === 1)
  await c.query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND type = 'licence_submitted'`, [U.admin])
  await save(`${U.coach}/proof3.pdf`)
  ok('a new one after the admin read it', (await count(U.admin)) === 1 && (await count(U.admin2)) === 1)
}
