// Checks for 20270174000000_directory_verified_licence.sql. Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }
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

export async function run(c) {
  const U = {}
  for (const n of ['admin', 'a', 'b']) {
    U[n] = uid()
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [U[n], n + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id, nickname) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U[n], n])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE profiles SET is_admin = TRUE WHERE id = $1`, [U.admin])
  await c.query(`SELECT set_config('request.jwt.claim.role', '', false)`)
  for (const n of ['a', 'b']) {
    await as(c, U.admin, `SELECT admin_coach_module_allow($1, true)`, [U[n]], { commit: true })
    await as(c, U[n], `SELECT save_coach_card($1::jsonb)`, [JSON.stringify({ slug: `dir-${n}-coach`, headline: 'h' })], { commit: true })
    await as(c, U[n], `SELECT set_coach_card_visibility(true, true)`, [], { commit: true })
  }
  const body = (await c.query(`SELECT id, levels[1] AS lvl FROM licence_bodies WHERE is_active LIMIT 1`)).rows[0]
  for (const n of ['a', 'b']) {
    await as(c, U[n], `SELECT save_my_licence($1, $2, 'SECRET-123', NULL, $3)`, [body.id, body.lvl, `${U[n]}/p.pdf`], { commit: true })
  }
  const lic = (await c.query(`SELECT id FROM coach_licences WHERE coach_id = $1`, [U.a])).rows[0].id
  ok('admin verifies', (await as(c, U.admin, `SELECT admin_review_licence($1, 'verify', NULL)`, [lic], { commit: true })).ok)
  const list = async (...a) => (await as(c, null, `SELECT list_coaches(NULL, NULL, 24, 0, $1) AS l`, [a[0] ?? false])).rows[0].l
  const all = await list()
  const a = all.find((x) => x.slug === 'dir-a-coach-coach' || x.slug.startsWith('dir-a'))
  const b = all.find((x) => x.slug.startsWith('dir-b'))
  ok('verified coach shows body and level only', a.licence && a.licence.verified === true && a.licence.body && a.licence.level && Object.keys(a.licence).length === 3)
  ok('pending coach shows no licence', b.licence === null)
  ok('no licence number leaks', !JSON.stringify(all).includes('SECRET-123'))
  const only = await list(true)
  ok('verified-only filter', only.length === 1 && only[0].slug === a.slug)
  await c.query(`UPDATE coach_licences SET valid_until = CURRENT_DATE - 3 WHERE coach_id = $1`, [U.a])
  ok('expired licence is hidden', (await list(true)).length === 0 && (await list()).find((x) => x.slug === a.slug).licence === null)
}
