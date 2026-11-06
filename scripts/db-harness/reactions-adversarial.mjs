// Adversarial checks for 20270138000000_activity_reactions.sql. Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
let pass = 0
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('ok -', name) }
async function as(c, user, sql, params = []) {
  await c.query('BEGIN')
  try {
    await c.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    if (user) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user])
    const r = await c.query(sql, params)
    await c.query('COMMIT')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, err: e.message }
  }
}

export async function run(c) {
  const [owner, fan, fan2, stranger, bot] = [uid(), uid(), uid(), uid(), uid()]
  for (const u of [owner, fan, fan2, stranger, bot]) {
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u, u + '@x.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [u])
  }
  await c.query(`UPDATE profiles SET is_bot = true WHERE id = $1`, [bot])
  const act = async (vis) => (await c.query(`INSERT INTO activities(user_id, visibility) VALUES ($1,$2) RETURNING id`, [owner, vis])).rows[0].id
  const pub = await act('public'), priv = await act('private'), fol = await act('followers')
  const react = (u, a, on = true) => as(c, u, `SELECT set_activity_reaction($1,$2)`, [a, on])
  const notifs = async () => (await c.query(`SELECT event_count FROM notifications WHERE user_id=$1 AND type='activity_reaction' AND read_at IS NULL`, [owner])).rows

  ok('anon cannot react', !(await as(c, null, `SELECT set_activity_reaction($1)`, [pub])).ok)
  ok('fan reacts to public', (await react(fan, pub)).ok)
  ok('idempotent repeat', (await react(fan, pub)).ok && (await c.query(`SELECT 1 FROM activity_reactions WHERE activity_id=$1`, [pub])).rowCount === 1)
  ok('one notification', (await notifs()).length === 1 && (await notifs())[0].event_count === 1)
  await react(fan, pub, false); await react(fan, pub)
  ok('untoggle/retoggle does not re-notify', (await notifs())[0].event_count === 1)
  await react(fan2, pub)
  ok('second reactor coalesces', (await notifs()).length === 1 && (await notifs())[0].event_count === 2)
  ok('own activity refused', !(await react(owner, pub)).ok)
  ok('bot refused', !(await react(bot, pub)).ok)
  ok('private hidden from stranger', !(await react(stranger, priv)).ok)
  ok('followers-only hidden from non-follower', !(await react(stranger, fol)).ok)
  await c.query(`INSERT INTO follows(follower_id, followee_id) VALUES ($1,$2)`, [stranger, owner])
  ok('follower reacts to followers-only', (await react(stranger, fol)).ok)
  ok('direct insert denied', !(await as(c, fan, `INSERT INTO activity_reactions(activity_id,user_id) VALUES ($1,$2)`, [priv, fan])).ok)
  ok('direct select denied', !(await as(c, fan, `SELECT * FROM activity_reactions`)).ok)
  ok('info counts for viewer', (await as(c, fan, `SELECT reaction_count, i_reacted FROM activity_reaction_info(ARRAY[$1::uuid])`, [pub])).rows[0].reaction_count === 2)
  ok('info hides private from stranger', (await as(c, stranger, `SELECT * FROM activity_reaction_info(ARRAY[$1::uuid])`, [priv])).rows.length === 0)
  ok('reactors visible to owner', (await as(c, owner, `SELECT * FROM activity_reactors($1)`, [pub])).rows.length === 2)
  ok('reactors hidden from others', (await as(c, fan, `SELECT * FROM activity_reactors($1)`, [pub])).rows.length === 0)
  await c.query(`UPDATE profiles SET reaction_notifications = false WHERE id=$1`, [owner])
  await c.query(`DELETE FROM notifications WHERE user_id=$1`, [owner])
  await c.query(`DELETE FROM activity_reaction_notified`)
  await react(fan, pub, false); await react(fan, pub)
  ok('notifications off = none', (await notifs()).length === 0)
  await c.query(`UPDATE profiles SET reactions_enabled = false WHERE id=$1`, [owner])
  await react(fan2, pub, false)
  ok('reactions off refuses new', !(await react(fan2, pub)).ok)
  await c.query(`UPDATE profiles SET reactions_enabled = true WHERE id=$1`, [owner])
  await c.query(`INSERT INTO activity_reaction_log(user_id) SELECT $1 FROM generate_series(1,60)`, [fan2])
  ok('rate limit', !(await react(fan2, pub)).ok)
  await c.query(fs_read())
  ok('migration re-appliable', true)
  console.log(pass, 'checks passed')
}
import fs from 'node:fs'
function fs_read() { return fs.readFileSync(process.env.MIG, 'utf8') }
