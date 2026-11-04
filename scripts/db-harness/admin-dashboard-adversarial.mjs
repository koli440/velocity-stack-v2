// Admin dashboard RPC: admin-only, aggregate-only (no ids/names/e-mails). Run with harness.mjs, see README.
import assert from 'node:assert/strict'
const uid = () => crypto.randomUUID()
const ok = (name, cond) => { assert.ok(cond, name); console.log('ok -', name) }

export async function run(c) {
  // The harness stubs auth.users; real Supabase has last_sign_in_at.
  await c.query(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ`)
  const admin = uid(), user = uid(), bot = uid()
  await c.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`)
  for (const u of [admin, user, bot]) {
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u, u + '@secret.test'])
    await c.query(`INSERT INTO public.profiles(id) VALUES ($1) ON CONFLICT DO NOTHING`, [u])
  }
  await c.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])
  await c.query(`UPDATE public.profiles SET is_bot = TRUE WHERE id = $1`, [bot])
  const call = async (sub) => {
    await c.query('BEGIN')
    await c.query(`SET LOCAL ROLE authenticated`)
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub])
    try { return (await c.query(`SELECT public.admin_dashboard_stats(30) AS r`)).rows[0].r }
    finally { await c.query('ROLLBACK') }
  }
  const base = await call(admin)
  await c.query(`INSERT INTO public.activities (user_id, title, activity_date, source) VALUES ($1,'a',NOW(),'manual'), ($1,'b',NOW(),'garmin'), ($2,'c',NOW(),'bot')`, [user, bot])
  await c.query(`INSERT INTO public.connections (user_id, provider, status, last_error) VALUES ($1,'wahoo','error','token 0123456789abcdef0123456789abcdef bad')`, [user])

  let denied = false
  try { await call(user) } catch { denied = true }
  ok('non-admin is rejected', denied)
  const r = await call(admin)
  ok('rides exclude bots', r.rides.total - base.rides.total === 2 && r.rides.by_source.every((s) => s.source !== 'bot'))
  ok('users exclude bots', r.users.total === Number((await c.query(`SELECT COUNT(*) AS n FROM public.profiles WHERE NOT is_bot`)).rows[0].n))
  ok('daily series covers window', r.users.signups_by_day.length === 30 && r.rides.by_day.length === 30)
  ok('wahoo error grouped without long ids', r.sync.recent_errors.some((e) => e.provider === 'wahoo') && !JSON.stringify(r.sync.recent_errors).includes('0123456789abcdef'))
  const json = JSON.stringify(r)
  ok('no PII leaks', !json.includes('secret.test') && !json.includes(user))
}
