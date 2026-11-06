// Adversarial checks for 20270137000000_web_push.sql. Run with harness.mjs, see README.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
let pass = 0
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
async function as(c, user, sql, params = [], commit = false) {
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

export async function run(c) {
  const [a, b] = [uid(), uid()]
  for (const u of [a, b]) {
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u, u + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [u])
  }
  await c.query(fs.readFileSync(process.env.MIG, 'utf8')); ok('migration is re-appliable', true)
  const save = (u, ep = 'https://push.test/e1') => as(c, u, `SELECT save_push_subscription($1,'p','a','Chrome on Android')`, [ep], true)
  ok('anon cannot save', !(await as(c, null, `SELECT save_push_subscription('https://push.test/x','p','a')`)).ok)
  ok('owner saves', (await save(a)).ok)
  ok('http endpoint rejected', !(await save(a, 'http://push.test/x')).ok)
  ok('direct insert denied', !(await as(c, a, `INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES ($1,'https://push.test/z','p','a')`, [a])).ok)
  ok('other user sees nothing', (await as(c, b, `SELECT 1 FROM push_subscriptions`)).rowCount === 0)
  ok('other user cannot delete', (await as(c, b, `SELECT delete_push_subscription('https://push.test/e1')`, [], true)).ok
    && (await as(c, a, `SELECT 1 FROM push_subscriptions`)).rowCount === 1)
  ok('device moves to the new user', (await save(b)).ok && (await as(c, a, `SELECT 1 FROM push_subscriptions`)).rowCount === 0)
  ok('owner deletes', (await as(c, b, `SELECT delete_push_subscription('https://push.test/e1')`, [], true)).ok
    && (await as(c, b, `SELECT 1 FROM push_subscriptions`)).rowCount === 0)
  await c.query(`UPDATE sync_settings SET value='https://app.test' WHERE key='app_base_url'`)
  await c.query(`INSERT INTO sync_settings(key,value) VALUES ('app_base_url','https://app.test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
  await save(a)
  await c.query('DELETE FROM net.calls')
  await c.query(`INSERT INTO notifications(user_id, actor_id, type) VALUES ($1,$2,'new_follower')`, [a, b])
  ok('new notification triggers push run', (await c.query(`SELECT 1 FROM net.calls WHERE url LIKE '%/api/notifications/push/run'`)).rowCount >= 1)
  console.log(pass, 'checks passed')
}
