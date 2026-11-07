// admin_respect_stats(): admin-only, aggregate-only, bots excluded. Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  await c.query(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ`)
  const [admin, owner, fan, fan2, bot] = [uid(), uid(), uid(), uid(), uid()]
  for (const u of [admin, owner, fan, fan2, bot]) {
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u, u + '@secret.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [u])
  }
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  await c.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])
  await c.query(`UPDATE public.profiles SET is_bot = TRUE WHERE id = $1`, [bot])
  const call = async (sub, days = 30) => {
    await c.query('BEGIN')
    await c.query(`SET LOCAL ROLE authenticated`)
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub])
    try { return (await c.query(`SELECT public.admin_respect_stats($1) AS r`, [days])).rows[0].r }
    finally { await c.query('ROLLBACK') }
  }
  const base = await call(admin)
  const act = async (user, vis, type = 'ride', source = 'manual') =>
    (await c.query(`INSERT INTO public.activities (user_id, title, activity_date, source, visibility, activity_type) VALUES ($1,'a',NOW(),$2,$3,$4) RETURNING id`, [user, source, vis, type])).rows[0].id
  const pub = await act(owner, 'public'), priv = await act(owner, 'private', 'run'), botAct = await act(bot, 'public', 'ride', 'bot')
  const react = (a, u) => c.query(`INSERT INTO public.activity_reactions (activity_id, user_id) VALUES ($1,$2)`, [a, u])
  await react(pub, fan); await react(pub, fan2); await react(priv, fan); await react(botAct, fan)
  await c.query(`INSERT INTO public.activity_reactions (activity_id, user_id) VALUES ($1,$2)`, [pub, bot]).catch(() => {})

  let denied = false
  try { await call(fan) } catch { denied = true }
  ok('non-admin is rejected', denied)
  const r = await call(admin)
  ok('counts exclude bot activities', r.total - base.total === 3)
  ok('distinct reactors/activities', r.reactors - base.reactors === 2 && r.activities - base.activities === 2)
  ok('visibility split', r.by_visibility.public - base.by_visibility.public === 2 && r.by_visibility.non_public - base.by_visibility.non_public === 1)
  ok('type split has ride and run', r.by_type.some((t) => t.type === 'ride') && r.by_type.some((t) => t.type === 'run'))
  ok('daily series covers window', r.by_day.length === 30 && (await call(admin, 7)).by_day.length === 7)
  const json = JSON.stringify(r)
  ok('no PII leaks', !json.includes('secret.test') && ![owner, fan, fan2, admin].some((u) => json.includes(u)))
}
